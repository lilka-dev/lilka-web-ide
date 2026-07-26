/**
 * Завантаження зображень — порт `lilka::Resources::loadImage`.
 *
 * Формат визначається за підписом файлу, а не за розширенням: `BM` веде в
 * BMP, `\x89PNG` — у PNG. Розширення прошивка не дивиться взагалі.
 *
 * У парсері BMP відтворено п'ять особливостей первотвору. Кожна з них зламала б
 * «правильну» реалізацію, тому їх не варто «виправляти»:
 *
 *   1. Чотири байти підпису читає ВИКЛИКАЛЬНИК, а не парсер. Тому всі зсуви в
 *      `loadImageBMP` рахуються від байта 4, і зміщення даних лежить у
 *      `fileheader[6..9]`, тобто в байтах 10..13 файлу.
 *   2. Поле `compression` не перевіряється взагалі. 32-бітні BI_BITFIELDS
 *      читаються як сирий BGRA і працюють лише тому, що маски стандартні.
 *   3. Альфа-канал у BMP відкидається: беруться перші три байти пікселя.
 *      У PNG альфа, навпаки, враховується.
 *   4. Вирівнювання рядків на 4 байти НЕ виконується. Для 32 біт це збігається
 *      випадково, а 24-бітний файл із шириною, не кратною 4, «їде» по діагоналі.
 *   5. Висота читається беззнаково, тож BMP «згори вниз» (від'ємна висота)
 *      перетворюється на величезне число й не проходить перевірку розміру.
 */

import { color565 } from './color.ts';
import { Image, NO_TRANSPARENT_COLOR } from './image.ts';

/** `width <= 1024 && height <= 1024` у первотворі. */
const MAX_SIDE = 1024;

export type ImageFormat = 'bmp' | 'png' | 'unknown';

export function detectFormat(bytes: Uint8Array): ImageFormat {
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
    if (
        bytes.length >= 4 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47
    ) {
        return 'png';
    }
    return 'unknown';
}

const word = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const dword = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export interface LoadOptions {
    transparentColor?: number;
    pivotX?: number;
    pivotY?: number;
}

/** Порт `Resources::loadImageBMP`. */
export function loadImageBMP(bytes: Uint8Array, options: LoadOptions = {}): Image {
    const transparentColor = options.transparentColor ?? NO_TRANSPARENT_COLOR;

    // Зміщення даних — байти 10..13 файлу (у первотворі це fileheader[6..9],
    // бо перші чотири байти підпису вже прочитані викликальником)
    const dataOffset = dword(bytes, 10);

    const width = dword(bytes, 18);
    const height = dword(bytes, 22); // саме беззнаково — див. особливість 5
    const bitsPerPixel = word(bytes, 28);
    const bytesPerPixel = bitsPerPixel >> 3;

    if (!(width <= MAX_SIDE && height <= MAX_SIDE)) {
        throw new Error(
            `BMP ${width}x${height} не проходить перевірку розміру (максимум ${MAX_SIDE}x${MAX_SIDE}). ` +
                'Якщо висота від\'ємна — це BMP «згори вниз», і прошивка його не читає.',
        );
    }
    if (bytesPerPixel < 3) {
        throw new Error(`BMP з ${bitsPerPixel} бітами на піксель не підтримується прошивкою`);
    }

    const image = new Image(width, height, transparentColor, options.pivotX ?? 0, options.pivotY ?? 0);

    // Рядки читаються послідовно знизу вгору. Довжина рядка — рівно
    // width * bytesPerPixel, БЕЗ вирівнювання на 4 байти (особливість 4)
    const rowBytes = width * bytesPerPixel;
    let at = dataOffset;

    for (let y = height - 1; y >= 0; y--) {
        for (let x = 0; x < width; x++) {
            const pixel = at + x * bytesPerPixel;
            const b = bytes[pixel];
            const g = bytes[pixel + 1];
            const r = bytes[pixel + 2];
            // четвертий байт — альфа — навмисно не читається (особливість 3)
            image.pixels[y * width + x] = color565(r, g, b);
        }
        at += rowBytes;
    }

    return image;
}

/**
 * Порт `Resources::loadImagePNG`.
 *
 * Прошивка розпаковує PNG через LodePNG у RGBA і застосовує єдине правило:
 * повністю прозорий піксель стає прозорим кольором. Часткова прозорість
 * втрачається — проміжних значень альфи немає.
 *
 * Сюди приходить уже розпакований RGBA, бо розпакування в браузері асинхронне,
 * а `resources.load_image` у Lua синхронний. Розпаковування відбувається
 * заздалегідь, коли файл потрапляє у файлову систему.
 */
export function imageFromRgba(
    rgba: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
    options: LoadOptions = {},
): Image {
    const transparentColor = options.transparentColor ?? NO_TRANSPARENT_COLOR;
    const image = new Image(width, height, transparentColor, options.pivotX ?? 0, options.pivotY ?? 0);

    for (let i = 0, at = 0; i < width * height; i++, at += 4) {
        const alpha = rgba[at + 3];
        image.pixels[i] =
            alpha === 0 ? transparentColor : color565(rgba[at], rgba[at + 1], rgba[at + 2]);
    }
    return image;
}

/** Розміри PNG із заголовка IHDR — потрібні до розпакування. */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
}
