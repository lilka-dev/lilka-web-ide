/**
 * Пристрій усередині воркера: те, з чим працюють прив'язки Lua.
 *
 * Тримає два кадрові буфери поверх спільної пам'яті, стан тексту, реєстр
 * зображень і зняток кнопок. Уся логіка малювання — це вже готовий емулятор
 * (`src/emulator`), тут лише склейка.
 */

import { Framebuffer } from '../emulator/framebuffer.ts';
import { TextRenderer } from '../emulator/text.ts';
import { fontFromJson, type Font, type FontJson } from '../emulator/font.ts';
import { Image, ImageRegistry } from '../emulator/image.ts';
import { Vfs, joinPath, normalizePath, dirname } from '../emulator/vfs.ts';
import { detectFormat, imageFromRgba, loadImageBMP, type LoadOptions } from '../emulator/image-loader.ts';
import { CTRL, SHARED_BUTTONS, bufferOffset, type SharedMemory } from './shared.ts';

export interface ButtonSnapshot {
    pressed: boolean;
    just_pressed: boolean;
    just_released: boolean;
}

/** Заздалегідь розпакований PNG: розпакування в браузері асинхронне. */
export interface DecodedPng {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export class LilkaDevice {
    readonly images = new ImageRegistry();
    readonly fonts = new Map<string, Font>();
    readonly vfs = new Vfs();

    /** Повний шлях до скрипта — від нього рахуються відносні шляхи resources.*. */
    scriptPath = '/sd/main.lua';
    /** RGBA для PNG-файлів, розпакованих заздалегідь на головному потоці. */
    readonly decodedPng = new Map<string, DecodedPng>();
    /** Файли, які програма записала — головний потік має їх зберегти. */
    onFileWrite: ((path: string, data: Uint8Array) => void) | null = null;

    /** Індекс буфера, у який зараз малює програма. */
    private canvasIndex = 0;
    private buffers: [Framebuffer, Framebuffer];
    /**
     * По одному текстовому рендереру на кожен буфер.
     *
     * Це не оптимізація, а відтворення поведінки заліза: курсор, шрифт і колір
     * тексту в Arduino_GFX належать об'єкту канви, а канв у KeiraOS дві. Тому
     * `display.set_cursor`, викликаний один раз, впливає лише на ОДИН із двох
     * кадрів. Спільний стан приховав би цю пастку від того, хто вчиться.
     */
    private texts: [TextRenderer, TextRenderer];

    /** Зняток кнопок на початок кадру та стан прапорців just_*. */
    private snapshot: ButtonSnapshot[] = SHARED_BUTTONS.map(() => ({
        pressed: false,
        just_pressed: false,
        just_released: false,
    }));
    /** Лічильники фронтів, які вже враховано. */
    private lastPresses = new Array(SHARED_BUTTONS.length).fill(0);
    private lastReleases = new Array(SHARED_BUTTONS.length).fill(0);
    /** До першого знімка різницю рахувати нема з чим. */
    private buttonsArmed = false;

    private readonly memory: SharedMemory;
    private readonly statusBarHeight: number;

    constructor(
        memory: SharedMemory,
        fonts: Record<string, FontJson>,
        statusBarHeight: number,
        defaultFont: string,
    ) {
        this.memory = memory;
        this.statusBarHeight = statusBarHeight;
        for (const [name, json] of Object.entries(fonts)) this.fonts.set(name, fontFromJson(json));

        const { maxWidth, maxHeight } = memory;
        this.buffers = [
            new Framebuffer(maxWidth, maxHeight, memory.pixels, bufferOffset(0, maxWidth, maxHeight)),
            new Framebuffer(maxWidth, maxHeight, memory.pixels, bufferOffset(1, maxWidth, maxHeight)),
        ];
        const initial = this.fonts.get(defaultFont) ?? null;
        this.texts = [
            new TextRenderer(this.buffers[0], initial),
            new TextRenderer(this.buffers[1], initial),
        ];

        Atomics.store(memory.control, CTRL.CANVAS_WIDTH, maxWidth);
        Atomics.store(memory.control, CTRL.CANVAS_HEIGHT, maxHeight);
        Atomics.store(memory.control, CTRL.CANVAS_Y, 0);
        Atomics.store(memory.control, CTRL.FULLSCREEN, 1);
        Atomics.store(memory.control, CTRL.READY_INDEX, -1);
    }

    get canvas(): Framebuffer {
        return this.buffers[this.canvasIndex];
    }

    get textRenderer(): TextRenderer {
        return this.texts[this.canvasIndex];
    }

    /**
     * Порт `App::queueDraw`: буфери міняються місцями, готовий кадр
     * публікується для головного потоку. Ніякого очищення — програма
     * наступного кадру малює поверх кадру, що був два кадри тому.
     */
    queueDraw(): void {
        const control = this.memory.control;
        const frame = Atomics.load(control, CTRL.FRAME);

        // Пропущений кадр — це коли попередній ще не встигли вивести.
        // Порівнювати треба саме номери кадрів: READY_INDEX після виводу не
        // скидається, тому перевірка «чи є готовий буфер» рахувала б пропуск
        // щокадру.
        if (frame > 0 && Atomics.load(control, CTRL.PRESENTED) < frame) {
            Atomics.add(control, CTRL.SKIPPED, 1);
        }

        Atomics.store(control, CTRL.READY_INDEX, this.canvasIndex);
        Atomics.add(control, CTRL.FRAME, 1);

        this.canvasIndex = this.canvasIndex === 0 ? 1 : 0;
    }

    /**
     * Зміна `lilka.fullscreen`. Висота канви змінюється, ширина — ні.
     * Буфери не перевиділяються: вони від початку розміром на весь екран.
     */
    setFullscreen(fullscreen: boolean): void {
        const control = this.memory.control;
        if (Atomics.load(control, CTRL.FULLSCREEN) === (fullscreen ? 1 : 0)) return;
        Atomics.store(control, CTRL.FULLSCREEN, fullscreen ? 1 : 0);
        Atomics.store(control, CTRL.CANVAS_Y, fullscreen ? 0 : this.statusBarHeight);
        Atomics.store(
            control,
            CTRL.CANVAS_HEIGHT,
            fullscreen ? this.memory.maxHeight : this.memory.maxHeight - this.statusBarHeight,
        );
    }

    /**
     * Скидає стан кнопок на початок програми.
     *
     * Те, що натиснули до запуску, програмі не належить: інакше перший кадр
     * побачив би натискання кнопки, якою її ж і запустили.
     */
    resetButtons(): void {
        this.buttonsArmed = false;
        for (const slot of this.snapshot) {
            slot.pressed = false;
            slot.just_pressed = false;
            slot.just_released = false;
        }
    }

    /**
     * Знімає стан кнопок і накопичує переходи.
     *
     * Переходи беруться з лічильників головного потоку, а не з порівняння
     * рівнів: дотик, який почався й закінчився між двома знімками, за рівнем
     * невидимий, а на залізі його видно. Прапорці накопичуються й живуть до
     * читання — саме так поводиться `justPressed` у прошивці.
     */
    sampleButtons(): void {
        const control = this.memory.control;
        for (let i = 0; i < SHARED_BUTTONS.length; i++) {
            const presses = Atomics.load(control, CTRL.PRESSES + i);
            const releases = Atomics.load(control, CTRL.RELEASES + i);
            const slot = this.snapshot[i];
            if (this.buttonsArmed) {
                if (presses !== this.lastPresses[i]) slot.just_pressed = true;
                if (releases !== this.lastReleases[i]) slot.just_released = true;
            }
            this.lastPresses[i] = presses;
            this.lastReleases[i] = releases;
            slot.pressed = Atomics.load(control, CTRL.BUTTONS + i) === 1;
        }
        this.buttonsArmed = true;
    }

    /**
     * Читання стану з боку Lua. Прапорці just_* скидаються при читанні —
     * так само, як у прошивці.
     *
     * Знімок робиться просто тут, а не лише в головному циклі: на залізі
     * `controller.getState()` читає живий стан у будь-який момент, зокрема з
     * тіла скрипта чи з власного циклу `while true do ... util.sleep() end`,
     * де головний цикл середовища не працює взагалі.
     */
    readControllerState(): Record<string, ButtonSnapshot> {
        this.sampleButtons();
        const state: Record<string, ButtonSnapshot> = {};
        for (let i = 0; i < SHARED_BUTTONS.length; i++) {
            const slot = this.snapshot[i];
            state[SHARED_BUTTONS[i]] = {
                pressed: slot.pressed,
                just_pressed: slot.just_pressed,
                just_released: slot.just_released,
            };
            slot.just_pressed = false;
            slot.just_released = false;
        }
        return state;
    }

    /** Тека скрипта: `dir` у реєстрі Lua з `LuaFileRunnerApp::run`. */
    get scriptDir(): string {
        return dirname(this.scriptPath);
    }

    /**
     * Шлях зі світу `resources.*`.
     *
     * Порт `luapath_to_path`: абсолютний шлях лишається як є, відносний
     * приклеюється до теки скрипта.
     */
    resolveResourcePath(path: string): string {
        if (path.startsWith('/')) return normalizePath(path);
        return normalizePath(joinPath(this.scriptDir, path));
    }

    /**
     * Шлях зі світу `sdcard.*`.
     *
     * Порт `getSDRoot() + path` — саме склеювання, БЕЗ joinPath. Тому
     * `sdcard.open("a.txt")` дає "/sda.txt", і файл не відкривається.
     * Особливість первотвору відтворена; попередження додається окремо,
     * бо консолі середовища на залізі не існує в принципі.
     */
    resolveSdPath(path: string): { path: string; suspicious: boolean } {
        return { path: '/sd' + path, suspicious: !path.startsWith('/') };
    }

    /** Порт `Resources::loadImage`: формат визначається за підписом файлу. */
    loadImage(path: string, options: LoadOptions): Image {
        const full = this.resolveResourcePath(path);
        const bytes = this.vfs.read(full);
        if (!bytes) throw new Error(`Не вдалося відкрити файл ${full}`);

        const format = detectFormat(bytes);
        if (format === 'bmp') return loadImageBMP(bytes, options);
        if (format === 'png') {
            const decoded = this.decodedPng.get(full);
            if (!decoded) {
                throw new Error(
                    `PNG ${full} не розпакований. Файли з PNG треба додати у файлову систему ` +
                        'до запуску програми — розпакування в браузері асинхронне.',
                );
            }
            return imageFromRgba(decoded.rgba, decoded.width, decoded.height, options);
        }
        throw new Error(`Невідомий формат зображення: ${full} (прошивка читає лише BMP і PNG)`);
    }

    writeFile(path: string, data: Uint8Array): void {
        this.vfs.write(path, data);
        this.onFileWrite?.(path, data);
    }

    font(name: string): Font {
        const font = this.fonts.get(name);
        if (!font) {
            throw new Error(`Невідомий шрифт "${name}". Доступні: ${[...this.fonts.keys()].join(', ')}`);
        }
        return font;
    }

    image(handle: unknown): Image {
        const id = typeof handle === 'number' ? handle : (handle as { id?: number } | null)?.id;
        if (typeof id !== 'number') throw new Error('Очікувався об\'єкт зображення');
        return this.images.get(id);
    }
}
