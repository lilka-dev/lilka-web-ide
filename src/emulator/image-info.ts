/**
 * Розпізнавання картинок, які прошивка прочитає не так, як очікує людина.
 *
 * Усі чотири пастки знайдені читанням `lilka::Resources::loadImageBMP`. Емулятор
 * їх відтворює — тобто в браузері картинка теж поводитиметься неправильно. Але
 * замість того щоб чекати мовчазного падіння, менеджер каже про це заздалегідь.
 *
 * Виправлення — перевід у PNG. Це не хитрість, а справжнє усунення причини:
 * `loadImagePNG` не має жодної з цих пасток, і виправлений файл однаково працює
 * і в браузері, і на залізі.
 */

import { detectFormat, readPngSize } from './image-loader.ts';

/** `width <= 1024 && height <= 1024` у первотворі. */
const MAX_SIDE = 1024;

export type ImageProblem = 'too-large' | 'top-down' | 'alpha-lost' | 'row-padding';

export interface ImageInfo {
    format: 'bmp' | 'png';
    width: number;
    height: number;
    /** Біт на піксель; для PNG не визначено. */
    bitsPerPixel: number | null;
    problems: ImageProblem[];
    /** Чи можна виправити переведенням у PNG. */
    fixable: boolean;
}

const dword = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const sdword = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24);
const word = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);

/**
 * Чи справді використовується альфа-канал.
 *
 * Багато редакторів пишуть у 32-бітний BMP нулі в четвертий байт, хоча
 * прозорості там немає. Якщо вважати це прозорістю й перевести у PNG,
 * зображення стане повністю невидимим. Тому ознакою є саме РІЗНОМАНІТТЯ:
 * мають бути і повністю прозорі, і повністю непрозорі пікселі.
 */
function hasRealAlpha(bytes: Uint8Array, offset: number, count: number): boolean {
    let transparent = false;
    let opaque = false;
    for (let i = 0; i < count; i++) {
        const alpha = bytes[offset + i * 4 + 3];
        if (alpha === 0) transparent = true;
        else if (alpha === 255) opaque = true;
        if (transparent && opaque) return true;
    }
    return false;
}

export function inspectImage(bytes: Uint8Array): ImageInfo | null {
    const format = detectFormat(bytes);

    if (format === 'png') {
        const { width, height } = readPngSize(bytes);
        const problems: ImageProblem[] = [];
        if (width > MAX_SIDE || height > MAX_SIDE) problems.push('too-large');
        return { format, width, height, bitsPerPixel: null, problems, fixable: false };
    }

    if (format !== 'bmp') return null;

    const dataOffset = dword(bytes, 10);
    const width = dword(bytes, 18);
    const rawHeight = sdword(bytes, 22);
    const bitsPerPixel = word(bytes, 28);
    const height = Math.abs(rawHeight);

    const problems: ImageProblem[] = [];

    // Первотвір читає висоту беззнаково, тож від'ємна стає величезним числом
    // і не проходить перевірку розміру
    if (rawHeight < 0) problems.push('top-down');
    if (width > MAX_SIDE || height > MAX_SIDE) problems.push('too-large');

    // Рядок у BMP вирівняний до 4 байтів, а прошивка читає рівно width*bpp
    if (bitsPerPixel === 24 && (width * 3) % 4 !== 0) problems.push('row-padding');

    if (bitsPerPixel === 32 && hasRealAlpha(bytes, dataOffset, Math.min(width * height, 20000))) {
        problems.push('alpha-lost');
    }

    // Завелику картинку переводом у PNG не врятувати — доведеться зменшувати
    const fixable = problems.length > 0 && !problems.includes('too-large');
    return { format, width, height, bitsPerPixel, problems, fixable };
}

/**
 * Розпаковує BMP у RGBA.
 *
 * Тут, на відміну від емулятора, все читається ПРАВИЛЬНО: з вирівнюванням
 * рядків і з урахуванням від'ємної висоти. Мета інша — не відтворити прошивку,
 * а дістати справжнє зображення, щоб зберегти його у форматі, який прошивка
 * прочитає без пасток.
 */
export function decodeBmpToRgba(bytes: Uint8Array): { width: number; height: number; rgba: Uint8ClampedArray } {
    const dataOffset = dword(bytes, 10);
    const width = dword(bytes, 18);
    const rawHeight = sdword(bytes, 22);
    const height = Math.abs(rawHeight);
    const topDown = rawHeight < 0;
    const bytesPerPixel = word(bytes, 28) >> 3;

    if (bytesPerPixel < 3) throw new Error('Підтримуються лише 24- та 32-бітні BMP');

    // ось воно, вирівнювання, якого немає в прошивці
    const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const useAlpha = bytesPerPixel === 4 && hasRealAlpha(bytes, dataOffset, width * height);

    for (let y = 0; y < height; y++) {
        const sourceRow = topDown ? y : height - 1 - y;
        const rowStart = dataOffset + sourceRow * rowSize;
        for (let x = 0; x < width; x++) {
            const from = rowStart + x * bytesPerPixel;
            const to = (y * width + x) * 4;
            rgba[to] = bytes[from + 2];
            rgba[to + 1] = bytes[from + 1];
            rgba[to + 2] = bytes[from];
            rgba[to + 3] = useAlpha ? bytes[from + 3] : 255;
        }
    }

    return { width, height, rgba };
}

/** Перепаковує картинку в PNG. Повертає нові байти та нове ім'я файлу. */
export async function convertToPng(name: string, bytes: Uint8Array): Promise<{ name: string; data: Uint8Array }> {
    const { width, height, rgba } = decodeBmpToRgba(bytes);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не вдалося створити полотно для перепакування');
    context.putImageData(new ImageData(rgba, width, height), 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Не вдалося зберегти PNG');

    return {
        name: name.replace(/\.[^.]*$/, '') + '.png',
        data: new Uint8Array(await blob.arrayBuffer()),
    };
}
