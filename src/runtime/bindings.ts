/**
 * Прив'язки Lua API.
 *
 * Дерево об'єктів, яке віддається в `lua.global.set`. Кожна функція — тонка
 * обгортка над емулятором; уся змістовна робота вже зроблена в `src/emulator`.
 *
 * Що НЕ робиться тут: перетворення значень на рядки. `display.print` має
 * друкувати `5` для цілого і `5.0` для дробового — цю різницю знає лише Lua,
 * а JS її не бачить. Тому `print` доклеюється в Lua-преамбулі через `tostring`.
 */

import { color565 } from '../emulator/color.ts';
import { Transform } from '../emulator/transform.ts';
import { fCos360, fSin360 } from '../emulator/fmath.ts';
import { NOTES } from '../generated/notes.ts';
import { Image, NO_TRANSPARENT_COLOR } from '../emulator/image.ts';
import type { LilkaDevice } from './device.ts';

/** Причини зупинки, які прив'язки повідомляють нагору через виняток. */
export class LuaExit extends Error {
    constructor() {
        super('__lilka_exit__');
    }
}

/** Одна нота мелодії: частота в герцах і знаменник тривалості. */
export interface ToneEvent {
    frequency: number;
    /** Знаменник тривалості: 8 — восьма. Від'ємне значення означає ноту з крапкою. */
    size: number;
}

export interface BindingHooks {
    print(text: string): void;
    now(): number;
    sleepMs(ms: number): void;
    running(): boolean;
    /** Звук іде в головний потік: у воркері WebAudio недоступний. */
    sound(event: { kind: 'tone'; frequency: number; durationMs: number | null } | { kind: 'melody'; tones: ToneEvent[]; tempo: number } | { kind: 'stop' }): void;
}

export interface BindingsResult {
    api: Record<string, unknown>;
    /** Імена функцій, які реалізовані по-справжньому — для звіту покриття. */
    implemented: Set<string>;
    /** Імена, які є, але кидають помилку «ще не підтримується». */
    stubs: Set<string>;
}

export function createBindings(device: LilkaDevice, hooks: BindingHooks): BindingsResult {
    const implemented = new Set<string>();
    const stubs = new Set<string>();

    /** Позначає функцію як реалізовану та повертає її. */
    const impl = <T>(name: string, fn: T): T => {
        implemented.add(name);
        return fn;
    };

    /** Заглушка з чесним повідомленням замість мовчазної нічого-не-роблячої. */
    const stub = (name: string, why: string) => {
        stubs.add(name);
        return () => {
            throw new Error(`${name}: ${why}`);
        };
    };

    const fb = () => device.canvas;
    const text = () => device.textRenderer;

    const display = {
        color565: impl('display.color565', (r: number, g: number, b: number) => color565(r, g, b)),

        fill_screen: impl('display.fill_screen', (c: number) => fb().fillScreen(c)),
        draw_pixel: impl('display.draw_pixel', (x: number, y: number, c: number) => fb().drawPixel(x, y, c)),
        draw_line: impl('display.draw_line', (x1: number, y1: number, x2: number, y2: number, c: number) =>
            fb().drawLine(x1, y1, x2, y2, c),
        ),
        draw_rect: impl('display.draw_rect', (x: number, y: number, w: number, h: number, c: number) =>
            fb().drawRect(x, y, w, h, c),
        ),
        fill_rect: impl('display.fill_rect', (x: number, y: number, w: number, h: number, c: number) =>
            fb().fillRect(x, y, w, h, c),
        ),
        draw_circle: impl('display.draw_circle', (x: number, y: number, r: number, c: number) =>
            fb().drawCircle(x, y, r, c),
        ),
        fill_circle: impl('display.fill_circle', (x: number, y: number, r: number, c: number) =>
            fb().fillCircle(x, y, r, c),
        ),
        // Назва з однією «l» — саме так вона пишеться в прошивці
        draw_elipse: impl('display.draw_elipse', (x: number, y: number, rx: number, ry: number, c: number) =>
            fb().drawEllipse(x, y, rx, ry, c),
        ),
        fill_elipse: impl('display.fill_elipse', (x: number, y: number, rx: number, ry: number, c: number) =>
            fb().fillEllipse(x, y, rx, ry, c),
        ),
        draw_arc: impl(
            'display.draw_arc',
            (x: number, y: number, r1: number, r2: number, a1: number, a2: number, c: number) =>
                fb().drawArc(x, y, r1, r2, a1, a2, c),
        ),
        fill_arc: impl(
            'display.fill_arc',
            (x: number, y: number, r1: number, r2: number, a1: number, a2: number, c: number) =>
                fb().fillArc(x, y, r1, r2, a1, a2, c),
        ),
        draw_triangle: impl(
            'display.draw_triangle',
            (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: number) =>
                fb().drawTriangle(x1, y1, x2, y2, x3, y3, c),
        ),
        fill_triangle: impl(
            'display.fill_triangle',
            (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, c: number) =>
                fb().fillTriangle(x1, y1, x2, y2, x3, y3, c),
        ),

        draw_image: impl('display.draw_image', (handle: unknown, x: number, y: number) =>
            fb().drawImage(device.image(handle), x, y),
        ),
        draw_image_transformed: impl(
            'display.draw_image_transformed',
            (handle: unknown, x: number, y: number, transform: unknown) =>
                fb().drawImageTransformed(device.image(handle), x, y, toTransform(transform)),
        ),

        set_font: impl('display.set_font', (name: string) => text().setFont(device.font(name))),
        set_cursor: impl('display.set_cursor', (x: number, y: number) => text().setCursor(x, y)),
        set_text_size: impl('display.set_text_size', (size: number) => text().setTextSize(size)),
        set_text_color: impl('display.set_text_color', (fg: number, bg?: number) => text().setTextColor(fg, bg)),
        set_text_bound: impl('display.set_text_bound', (x: number, y: number, w: number, h: number) =>
            text().setTextBound(x, y, w, h),
        ),
        queue_draw: impl('display.queue_draw', () => device.queueDraw()),

        // display.print доклеюється в преамбулі: рядки має формувати Lua
        __print: (s: string) => text().write(s),
        __size: () => [fb().width, fb().height],
    };

    implemented.add('display.print');

    const controller = {
        get_state: impl('controller.get_state', () => device.readControllerState()),
    };

    const util = {
        exit: impl('util.exit', () => {
            throw new LuaExit();
        }),
        sleep: impl('util.sleep', (sec: number) => hooks.sleepMs(Math.max(0, Math.round(sec * 1000)))),
        time: impl('util.time', () => hooks.now() / 1000),
        // На залізі це справжні байти купи ESP32. У браузері таких чисел немає,
        // тому повертаються значення з board.json — щоб програми, які їх
        // друкують, не падали, але й не вводили в оману правдоподібними цифрами.
        free_ram: impl('util.free_ram', () => 0),
        total_ram: impl('util.total_ram', () => 0),
    };

    /**
     * math — ПОВНА заміна стандартної таблиці, а не доповнення.
     *
     * `lualilka_math_register` робить `luaL_newlib` і `lua_setglobal("math")`,
     * тобто затирає таблицю Lua цілком. Отже на Лілці НЕМАЄ `math.huge`,
     * `math.fmod`, `math.tointeger`, `math.type`, `math.maxinteger`. Скрипт,
     * який на них спирається, працює у звичайній Lua і падає на залізі —
     * саме тому емулятор мусить поводитися так само.
     *
     * Аргументи в прошивці читаються як `float`, тому кожен вхід
     * округлюється через `Math.fround`. Обчислення далі йдуть у double, як і
     * в C, де `sin(float)` підвищується до double.
     */
    const num = Math.fround;
    const table = (t: unknown): number[] => {
        const values = Object.values(t as Record<string, number>).map(num);
        if (values.length === 0) throw new Error('Очікувалася непорожня таблиця чисел');
        return values;
    };

    const mathApi = {
        // Arduino random(): з одним аргументом 0..max-1, з двома min..max-1.
        // Верхня межа НЕ включається — на відміну від math.random у звичайній Lua.
        random: impl('math.random', (a?: number, b?: number) => {
            if (a === undefined) return Math.random();
            if (b === undefined) return Math.floor(Math.random() * Math.trunc(a));
            const lo = Math.trunc(a);
            const hi = Math.trunc(b);
            return lo + Math.floor(Math.random() * (hi - lo));
        }),
        clamp: impl('math.clamp', (v: number, lo: number, hi: number) => {
            const x = num(v);
            return x < num(lo) ? num(lo) : x > num(hi) ? num(hi) : x;
        }),
        lerp: impl('math.lerp', (a: number, b: number, t: number) => num(a) + (num(b) - num(a)) * num(t)),
        map: impl('math.map', (v: number, i1: number, i2: number, o1: number, o2: number) =>
            ((num(v) - num(i1)) * (num(o2) - num(o1))) / (num(i2) - num(i1)) + num(o1),
        ),
        abs: impl('math.abs', (v: number) => Math.abs(num(v))),
        sign: impl('math.sign', (v: number) => Math.sign(num(v))),
        sqrt: impl('math.sqrt', (v: number) => Math.sqrt(num(v))),
        pow: impl('math.pow', (base: number, exp: number) => Math.pow(num(base), num(exp))),
        min: impl('math.min', (t: unknown) => Math.min(...table(t))),
        max: impl('math.max', (t: unknown) => Math.max(...table(t))),
        sum: impl('math.sum', (t: unknown) => table(t).reduce((a, b) => a + b, 0)),
        avg: impl('math.avg', (t: unknown) => {
            const values = table(t);
            return values.reduce((a, b) => a + b, 0) / values.length;
        }),
        floor: impl('math.floor', (v: number) => Math.floor(num(v))),
        ceil: impl('math.ceil', (v: number) => Math.ceil(num(v))),
        // roundf округлює половину ВІД нуля: -2.5 -> -3, а Math.round дав би -2
        round: impl('math.round', (v: number) => {
            const x = num(v);
            return Math.sign(x) * Math.round(Math.abs(x));
        }),
        sin: impl('math.sin', (v: number) => Math.sin(num(v))),
        cos: impl('math.cos', (v: number) => Math.cos(num(v))),
        tan: impl('math.tan', (v: number) => Math.tan(num(v))),
        asin: impl('math.asin', (v: number) => Math.asin(num(v))),
        acos: impl('math.acos', (v: number) => Math.acos(num(v))),
        atan: impl('math.atan', (v: number) => Math.atan(num(v))),
        atan2: impl('math.atan2', (y: number, x: number) => Math.atan2(num(y), num(x))),
        log: impl('math.log', (v: number, base?: number) =>
            base === undefined ? Math.log(num(v)) : Math.log(num(v)) / Math.log(num(base)),
        ),
        deg: impl('math.deg', (v: number) => (num(v) * 180) / Math.PI),
        rad: impl('math.rad', (v: number) => (num(v) * Math.PI) / 180),
        len: impl('math.len', (x: number, y: number) => Math.sqrt(num(x) * num(x) + num(y) * num(y))),
        dist: impl('math.dist', (x1: number, y1: number, x2: number, y2: number) => {
            const dx = num(x2) - num(x1);
            const dy = num(y2) - num(y1);
            return Math.sqrt(dx * dx + dy * dy);
        }),
        __norm: impl('math.norm', (x: number, y: number) => {
            const fx = num(x);
            const fy = num(y);
            const length = Math.sqrt(fx * fx + fy * fy);
            return [fx / length, fy / length];
        }),
        // Обертання тут — через таблиці прошивки, і БЕЗ відкидання дробу:
        // на відміну від Transform, math.rotate повертає дробові числа
        __rotate: impl('math.rotate', (x: number, y: number, angle: number) => {
            const c = fCos360(angle);
            const s = fSin360(angle);
            const fx = num(x);
            const fy = num(y);
            return [fx * c - fy * s, fx * s + fy * c];
        }),
    };

    const geometry = {
        __intersect_lines: impl(
            'geometry.intersect_lines',
            (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) => {
                const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
                if (d === 0) return null;
                const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
                const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
                if (t < 0 || t > 1 || u < 0 || u > 1) return null;
                return [ax + t * (bx - ax), ay + t * (by - ay)];
            },
        ),
        intersect_aabb: impl(
            'geometry.intersect_aabb',
            (ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) =>
                ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by,
        ),
    };

    const resources = {
        load_image: stub(
            'resources.load_image',
            'файлова система ще не підключена — зображення поки можна створювати лише процедурно',
        ),
        read_file: stub('resources.read_file', 'файлова система ще не підключена'),
        write_file: stub('resources.write_file', 'файлова система ще не підключена'),
        rotate_image: impl('resources.rotate_image', (handle: unknown, angle: number, blank: number) =>
            imageHandle(device.images.add(device.image(handle).rotate(angle, blank)), device.image(handle)),
        ),
        flip_image_x: impl('resources.flip_image_x', (handle: unknown) =>
            imageHandle(device.images.add(device.image(handle).flipX()), device.image(handle)),
        ),
        flip_image_y: impl('resources.flip_image_y', (handle: unknown) =>
            imageHandle(device.images.add(device.image(handle).flipY()), device.image(handle)),
        ),
    };

    const state = {
        save: stub('state.save', 'збереження стану ще не підключене'),
        clear: stub('state.clear', 'збереження стану ще не підключене'),
        reset: stub('state.reset', 'збереження стану ще не підключене'),
    };

    /**
     * Тимчасове розширення, якого немає на залізі: створення зображення в
     * пам'яті. Потрібне, доки немає файлової системи, і позначене окремим
     * префіксом, щоб не переплутати з рідним API.
     */
    const sandbox = {
        new_image: (w: number, h: number, transparent?: number) => {
            const image = new Image(w, h, transparent ?? NO_TRANSPARENT_COLOR, 0, 0);
            return imageHandle(device.images.add(image), image);
        },
        set_pixel: (handle: unknown, x: number, y: number, color: number) => {
            const image = device.image(handle);
            if (x >= 0 && y >= 0 && x < image.width && y < image.height) {
                image.pixels[x + y * image.width] = color;
            }
        },
        set_pivot: (handle: unknown, px: number, py: number) => {
            const image = device.image(handle);
            image.pivotX = px;
            image.pivotY = py;
        },
    };

    const transforms = {
        __new: impl('transforms.new', () => transformHandle(new Transform())),
        __rotate: (m: number[], angle: number) => transformHandle(fromMatrix(m).rotate(angle)),
        __scale: (m: number[], sx: number, sy: number) => transformHandle(fromMatrix(m).scale(sx, sy)),
        __multiply: (a: number[], b: number[]) => transformHandle(fromMatrix(a).multiply(fromMatrix(b))),
        __inverse: (m: number[]) => transformHandle(fromMatrix(m).inverse()),
        __apply: (m: number[], x: number, y: number) => {
            const v = fromMatrix(m).apply(x, y);
            return [v.x, v.y];
        },
    };
    for (const name of ['Transform.rotate', 'Transform.scale', 'Transform.multiply', 'Transform.inverse', 'Transform.vtransform', 'Transform.get', 'Transform.set']) {
        implemented.add(name);
    }

    /**
     * Зумер. `playMelody` у прошивці запускає окреме завдання і повертається
     * одразу, тому тут теж не блокує. Тривалість ноти рахується так само:
     * `(60000 / tempo) / |size|`, а від'ємний size додає половину — це нота з
     * крапкою. Частота 0 означає паузу.
     */
    const buzzer = {
        play: impl('buzzer.play', (frequency: number, duration?: number) =>
            hooks.sound({
                kind: 'tone',
                frequency: Math.trunc(frequency),
                durationMs: duration === undefined ? null : Math.trunc(duration),
            }),
        ),
        play_melody: impl('buzzer.play_melody', (melody: unknown, tempo: number) => {
            const tones: ToneEvent[] = [];
            for (const item of Object.values(melody as Record<string, unknown>)) {
                const pair = Object.values(item as Record<string, number>);
                tones.push({ frequency: Math.trunc(pair[0] ?? 0), size: Math.trunc(pair[1] ?? 0) });
            }
            hooks.sound({ kind: 'melody', tones, tempo: Math.trunc(tempo) });
        }),
        stop: impl('buzzer.stop', () => hooks.sound({ kind: 'stop' })),
    };

    /**
     * Аудіо. Відтворення файлів потребує файлової системи, тож `play` поки
     * заглушка. Решта — справжній стан гучності: гра, яка викликає
     * `audio.stop()` або читає гучність, не має падати через це.
     */
    let volume = 100;
    const audio = {
        play: stub('audio.play', 'відтворення файлів потребує файлової системи'),
        stop: impl('audio.stop', () => hooks.sound({ kind: 'stop' })),
        pause: impl('audio.pause', () => hooks.sound({ kind: 'stop' })),
        resume: impl('audio.resume', () => {}),
        is_playing: impl('audio.is_playing', () => false),
        get_volume: impl('audio.get_volume', () => volume),
        set_volume: impl('audio.set_volume', (value: number) => {
            volume = Math.trunc(value);
        }),
    };

    const console = {
        print: (s: string) => hooks.print(s),
    };

    return {
        api: {
            display,
            controller,
            util,
            math: mathApi,
            geometry,
            resources,
            state,
            transforms,
            buzzer,
            audio,
            console,
            sandbox,
            __notes: { ...NOTES },
            __running: () => hooks.running(),
            __millis: () => hooks.now(),
            __sleep_ms: (ms: number) => hooks.sleepMs(ms),
            __queue_draw: () => device.queueDraw(),
            __sample_buttons: () => device.sampleButtons(),
            __set_fullscreen: (value: boolean) => device.setFullscreen(!!value),
        },
        implemented,
        stubs,
    };
}

/** Дескриптор зображення для Lua: id плюс розміри, як у прошивці. */
function imageHandle(id: number, image: Image) {
    return { id, width: image.width, height: image.height };
}

function transformHandle(t: Transform) {
    const m = t.matrix;
    return [m[0][0], m[0][1], m[1][0], m[1][1]];
}

function fromMatrix(m: number[] | { [k: number]: number }): Transform {
    const a = Array.from({ length: 4 }, (_, i) => Number((m as Record<number, number>)[i] ?? 0));
    return new Transform([
        [a[0], a[1]],
        [a[2], a[3]],
    ]);
}

function toTransform(value: unknown): Transform {
    if (value && typeof value === 'object' && '__m' in (value as Record<string, unknown>)) {
        return fromMatrix((value as { __m: number[] }).__m);
    }
    if (Array.isArray(value)) return fromMatrix(value);
    throw new Error('Очікувався об\'єкт перетворення (transforms.new())');
}
