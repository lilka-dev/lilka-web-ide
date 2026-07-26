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
import { CTRL, SHARED_BUTTONS, bufferOffset, type SharedMemory } from './shared.ts';

export interface ButtonSnapshot {
    pressed: boolean;
    just_pressed: boolean;
    just_released: boolean;
}

export class LilkaDevice {
    readonly images = new ImageRegistry();
    readonly fonts = new Map<string, Font>();

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
    private previous = new Array(SHARED_BUTTONS.length).fill(false);
    private snapshot: ButtonSnapshot[] = SHARED_BUTTONS.map(() => ({
        pressed: false,
        just_pressed: false,
        just_released: false,
    }));

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

    /** Знімає стан кнопок раз на кадр і обчислює переходи. */
    sampleButtons(): void {
        const control = this.memory.control;
        for (let i = 0; i < SHARED_BUTTONS.length; i++) {
            const pressed = Atomics.load(control, CTRL.BUTTONS + i) === 1;
            const slot = this.snapshot[i];
            if (pressed && !this.previous[i]) slot.just_pressed = true;
            if (!pressed && this.previous[i]) slot.just_released = true;
            slot.pressed = pressed;
            this.previous[i] = pressed;
        }
    }

    /**
     * Читання стану з боку Lua. Прапорці just_* скидаються при читанні —
     * так само, як у прошивці.
     */
    readControllerState(): Record<string, ButtonSnapshot> {
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
