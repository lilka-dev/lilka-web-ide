/**
 * Піксельне полотно для редактора картинок.
 *
 * Кожен піксель — або колір RGB565, або «прозоро». Рівно ці два стани
 * лишаються від PNG після `lilka::Resources::loadImagePNG`: колір зводиться до
 * 5-6-5, а альфа — до одного біта (повністю прозорий піксель стає прозорим,
 * будь-який інший — непрозорим). Тож полотно не може містити нічого, чого
 * залізо не покаже, і намальоване збігається з екраном Лілки за побудовою.
 *
 * Тут лише чисті обчислення: канви під Node немає, а саме тут живуть помилки
 * заливки, ліній і історії правок.
 */

import { color565, RGB565_TO_RGBA } from './color.ts';

/** Прозорий піксель. Від'ємне, щоб не збігтися з жодним RGB565. */
export const TRANSPARENT = -1;

/** `width <= 1024 && height <= 1024` у `Resources::loadImageBMP`/`loadImagePNG`. */
export const MAX_SIDE = 1024;

export interface PixelImage {
    width: number;
    height: number;
    /** RGB565 або TRANSPARENT, рядок за рядком. */
    pixels: Int32Array;
}

export function createPixels(width: number, height: number, fill = TRANSPARENT): PixelImage {
    const pixels = new Int32Array(width * height);
    pixels.fill(fill);
    return { width, height, pixels };
}

export function clonePixels(image: PixelImage): PixelImage {
    return { width: image.width, height: image.height, pixels: image.pixels.slice() };
}

/**
 * RGBA → полотно за правилом `loadImagePNG`: `alpha == 0` — прозоро, інакше
 * `color565(r, g, b)`. Напівпрозорість на залізі не існує, тож і тут теж.
 */
export function fromRgba(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): PixelImage {
    const image = createPixels(width, height);
    for (let i = 0, at = 0; i < width * height; i++, at += 4) {
        image.pixels[i] = rgba[at + 3] === 0 ? TRANSPARENT : color565(rgba[at], rgba[at + 1], rgba[at + 2]);
    }
    return image;
}

/**
 * Полотно → RGBA для збереження в PNG.
 *
 * Розширення 5/6 біт до 8 повторенням старших біт оборотне: `color565` від
 * результату дає точно той самий RGB565. Тож збережений файл прочитається
 * прошивкою рівно тими кольорами, що були на полотні.
 */
export function toRgba(image: PixelImage): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    const words = new Uint32Array(rgba.buffer);
    for (let i = 0; i < image.pixels.length; i++) {
        const value = image.pixels[i];
        words[i] = value === TRANSPARENT ? 0 : RGB565_TO_RGBA[value];
    }
    return rgba;
}

/** `#rrggbb` → RGB565 — те, що лишиться від кольору на екрані Лілки. */
export function hexTo565(hex: string): number {
    const value = parseInt(hex.replace('#', ''), 16) || 0;
    return color565((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
}

/** Запис кольору так, як його пишуть у Lua: `0xF800`. */
export function luaHex(color: number): string {
    return '0x' + color.toString(16).toUpperCase().padStart(4, '0');
}

export function inside(image: PixelImage, x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < image.width && y < image.height;
}

export function getPixel(image: PixelImage, x: number, y: number): number {
    return inside(image, x, y) ? image.pixels[y * image.width + x] : TRANSPARENT;
}

export function setPixel(image: PixelImage, x: number, y: number, color: number): void {
    if (inside(image, x, y)) image.pixels[y * image.width + x] = color;
}

/**
 * Відрізок Брезенгема з обома кінцями.
 *
 * Потрібен і для інструмента «лінія», і для олівця: миша між двома подіями
 * перестрибує кілька пікселів, і без з'єднання штрих розсипався б на крапки.
 */
export function drawLine(image: PixelImage, x0: number, y0: number, x1: number, y1: number, color: number): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    for (;;) {
        setPixel(image, x0, y0, color);
        if (x0 === x1 && y0 === y1) return;
        const doubled = 2 * error;
        if (doubled >= dy) {
            error += dy;
            x0 += sx;
        }
        if (doubled <= dx) {
            error += dx;
            y0 += sy;
        }
    }
}

/** Прямокутник між двома кутами, у будь-якому порядку кутів. */
export function drawRect(
    image: PixelImage,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: number,
    filled: boolean,
): void {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
            if (filled || y === top || y === bottom || x === left || x === right) setPixel(image, x, y, color);
        }
    }
}

/**
 * Заливка чотиризв'язної області однакового кольору.
 *
 * Чотири сусіди, а не вісім: інакше заливка просочувалася б крізь діагональну
 * лінію в один піксель — а саме такими лініями в піксель-арті й обводять.
 * Стек замість рекурсії — полотно 1024×1024 переповнило б стек викликів.
 */
export function floodFill(image: PixelImage, x: number, y: number, color: number): void {
    if (!inside(image, x, y)) return;
    const { width, height, pixels } = image;
    const target = pixels[y * width + x];
    if (target === color) return;

    const stack = [y * width + x];
    while (stack.length) {
        const at = stack.pop()!;
        if (pixels[at] !== target) continue;
        pixels[at] = color;
        const px = at % width;
        if (px > 0) stack.push(at - 1);
        if (px < width - 1) stack.push(at + 1);
        if (at >= width) stack.push(at - width);
        if (at < width * (height - 1)) stack.push(at + width);
    }
}

/**
 * Історія правок — знімки цілого полотна.
 *
 * Знімки, а не різниці: найбільше полотно 1024×1024 — 4 МБ, і навіть сотня
 * знімків спрайтів Лілки (зазвичай до 280×240) важить менше, ніж складність
 * зворотних операцій для заливки.
 */
export class History {
    private past: Int32Array[] = [];
    private future: Int32Array[] = [];
    private limit: number;

    constructor(limit = 100) {
        this.limit = limit;
    }

    /** Запам'ятати стан ПЕРЕД зміною. */
    push(image: PixelImage): void {
        this.past.push(image.pixels.slice());
        if (this.past.length > this.limit) this.past.shift();
        this.future = [];
    }

    undo(image: PixelImage): boolean {
        const previous = this.past.pop();
        if (!previous) return false;
        this.future.push(image.pixels.slice());
        image.pixels.set(previous);
        return true;
    }

    redo(image: PixelImage): boolean {
        const next = this.future.pop();
        if (!next) return false;
        this.past.push(image.pixels.slice());
        image.pixels.set(next);
        return true;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }
}
