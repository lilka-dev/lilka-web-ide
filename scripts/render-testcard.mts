/**
 * Малює еталонну тест-карту без браузера і зберігає її як PNG.
 *
 * Це основа перевірки достовірності: той самий файл згодом порівнюватиметься
 * зі знімком екрана справжньої Лілки. Запуск:
 *
 *   node --experimental-strip-types scripts/render-testcard.mts [файл.png]
 *
 * PNG пишеться вручну, без залежностей — потрібен лише deflate з zlib.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { Framebuffer } from '../src/emulator/framebuffer.ts';
import { drawTestCard } from '../src/emulator/testcard.ts';
import { drawImageTestCard } from '../src/emulator/testcard-images.ts';
import { toRgb888 } from '../src/emulator/color.ts';
import { fontFromJson, type Font, type FontJson } from '../src/emulator/font.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const board = JSON.parse(readFileSync(join(root, 'src/generated/board.json'), 'utf8'));
const { width, height } = board.boards.v2.canvas.fullscreen;

/*
 * Шрифти читаються з диска, а не через `emulator/fonts.ts`: у браузері Vite
 * імпортує JSON без атрибутів, а Node без `with { type: 'json' }` цього не вміє.
 * Замість того щоб підганяти один модуль під два середовища, кожне отримує
 * шрифти своїм способом — а `fontFromJson` спільний.
 */
const fonts: Record<string, Font> = {};
let missing = 0;
for (const info of board.fonts as Array<{ name: string }>) {
    const path = join(root, 'src/generated/fonts', `${info.name}.json`);
    if (!existsSync(path)) {
        missing++;
        continue;
    }
    fonts[info.name] = fontFromJson(JSON.parse(readFileSync(path, 'utf8')) as FontJson);
}
if (missing > 0) {
    console.warn(`▲ бракує ${missing} шрифтів — спершу треба виконати npm run gen:fonts`);
}

const fb = new Framebuffer(width, height);
const card = process.argv[3] ?? 'geometry';
if (card === 'images') drawImageTestCard(fb, fonts);
else drawTestCard(fb, fonts);

// --- мінімальний кодувальник PNG (RGB, 8 біт на канал, фільтр 0) ---------

function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let bit = 0; bit < 8; bit++) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
}

const raw = new Uint8Array(height * (1 + width * 3));
let offset = 0;
for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // фільтр «none»
    for (let x = 0; x < width; x++) {
        const [r, g, b] = toRgb888(fb.getPixel(x, y));
        raw[offset++] = r;
        raw[offset++] = g;
        raw[offset++] = b;
    }
}

const ihdr = new Uint8Array(13);
const ihdrView = new DataView(ihdr.buffer);
ihdrView.setUint32(0, width);
ihdrView.setUint32(4, height);
ihdr[8] = 8; // біт на канал
ihdr[9] = 2; // truecolor

const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
]);

const target = process.argv[2] ?? 'testcard.png';
writeFileSync(target, png);

const unique = new Set(fb.pixels).size;
console.log(`${target}: ${width}x${height}, шрифтів ${Object.keys(fonts).length}, унікальних кольорів ${unique}`);
