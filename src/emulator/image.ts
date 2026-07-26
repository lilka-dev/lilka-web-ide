/**
 * Зображення — порт `lilka::Image`.
 *
 * Пікселі зберігаються в RGB565, як і в прошивці. `transparentColor === -1`
 * означає «прозорого кольору немає»; саме -1, а не null, бо від цього значення
 * залежить поведінка перетворень (див. `drawImageTransformed`).
 *
 * `pivotX`/`pivotY` — точка привʼязки: `display.draw_image(image, x, y)` кладе
 * саме її в (x, y), а не лівий верхній кут.
 */

import { color565 } from './color.ts';
import { fCos360, fSin360 } from './fmath.ts';

export const NO_TRANSPARENT_COLOR = -1;

export class Image {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint16Array;
    transparentColor: number;
    pivotX: number;
    pivotY: number;

    constructor(
        width: number,
        height: number,
        transparentColor: number = NO_TRANSPARENT_COLOR,
        pivotX = 0,
        pivotY = 0,
        pixels?: Uint16Array,
    ) {
        this.width = width;
        this.height = height;
        this.transparentColor = transparentColor;
        this.pivotX = pivotX;
        this.pivotY = pivotY;
        this.pixels = pixels ?? new Uint16Array(width * height);
        if (this.pixels.length !== width * height) {
            throw new Error(`Розмір масиву пікселів ${this.pixels.length} != ${width}x${height}`);
        }
    }

    /**
     * Обертання навколо центру — порт `Image::rotate`.
     * Розмір не змінюється, кути обрізаються, а порожні місця заповнюються
     * `blankColor`. Центр обчислюється цілочисельним діленням, тому для
     * непарних розмірів він зсунутий на півпікселя — як на залізі.
     */
    rotate(angle: number, blankColor: number): Image {
        const dest = new Image(this.width, this.height, this.transparentColor, this.pivotX, this.pivotY);
        const cx = Math.trunc(this.width / 2);
        const cy = Math.trunc(this.height / 2);
        const cos = fCos360(angle);
        const sin = fSin360(angle);

        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const dx = x - cx;
                const dy = y - cy;
                // `int x2 = cx + dx * cos + dy * sin` — відкидання дробу в бік нуля
                const x2 = Math.trunc(cx + dx * cos + dy * sin);
                const y2 = Math.trunc(cy - dx * sin + dy * cos);
                dest.pixels[x + y * this.width] =
                    x2 >= 0 && x2 < this.width && y2 >= 0 && y2 < this.height
                        ? this.pixels[x2 + y2 * this.width]
                        : blankColor;
            }
        }
        return dest;
    }

    flipX(): Image {
        const dest = new Image(this.width, this.height, this.transparentColor, this.pivotX, this.pivotY);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                dest.pixels[x + y * this.width] = this.pixels[this.width - 1 - x + y * this.width];
            }
        }
        return dest;
    }

    flipY(): Image {
        const dest = new Image(this.width, this.height, this.transparentColor, this.pivotX, this.pivotY);
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                dest.pixels[x + y * this.width] = this.pixels[x + (this.height - 1 - y) * this.width];
            }
        }
        return dest;
    }

    /**
     * Зображення з RGBA — сюда веде шлях від PNG через `createImageBitmap`.
     * Квантування в 565 навмисно робиться тут, один раз: далі в конвеєрі
     * 24-бітних кольорів уже не буває.
     */
    static fromRgba(
        rgba: Uint8Array | Uint8ClampedArray,
        width: number,
        height: number,
        options: { transparentColor?: number; pivotX?: number; pivotY?: number; alphaThreshold?: number } = {},
    ): Image {
        const transparentColor = options.transparentColor ?? NO_TRANSPARENT_COLOR;
        const threshold = options.alphaThreshold ?? 128;
        const image = new Image(width, height, transparentColor, options.pivotX ?? 0, options.pivotY ?? 0);
        for (let i = 0, p = 0; i < width * height; i++, p += 4) {
            const transparent = rgba[p + 3] < threshold && transparentColor !== NO_TRANSPARENT_COLOR;
            image.pixels[i] = transparent ? transparentColor : color565(rgba[p], rgba[p + 1], rgba[p + 2]);
        }
        return image;
    }
}

/**
 * Реєстр зображень.
 *
 * У прив'язках Lua `resources.load_image` повертає не саме зображення, а
 * таблицю з числовим ідентифікатором. Отже реєстр потрібен і тут — інакше
 * прив'язки доведеться писати інакше, ніж вони працюють на залізі.
 */
export class ImageRegistry {
    private readonly items = new Map<number, Image>();
    private nextId = 1;

    add(image: Image): number {
        const id = this.nextId++;
        this.items.set(id, image);
        return id;
    }

    get(id: number): Image {
        const image = this.items.get(id);
        if (!image) throw new Error(`Немає зображення з ідентифікатором ${id}`);
        return image;
    }

    release(id: number): void {
        this.items.delete(id);
    }

    get size(): number {
        return this.items.size;
    }
}
