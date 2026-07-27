#!/usr/bin/env node
/**
 * gen-icons.mjs — витягує піктограми екранної клавіатури з `sdk/.../icons/*.h`.
 *
 * Чотири зображення 20x20 у RGB565, зашиті в заголовках прошивки: Shift,
 * Shifted, Backspace і пробіл. `InputDialog::draw` малює їх через
 * `draw16bitRGBBitmapWithTranColor` із чорним як прозорим кольором.
 *
 *   node scripts/gen-icons.mjs [--out src/generated/icons.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/lilka-dev/sdk/main/lib/lilka/src/lilka/icons';
const NAMES = ['shift', 'shifted', 'backspace', 'whitespace'];

const args = { src: null, out: 'src/generated/icons.ts' };
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--src') args.src = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
}

/** Читає `const uint16_t NAME_img[] = { ... };` та розміри поруч. */
function parseIcon(source, name) {
    const width = Number(new RegExp(`${name}_img_width\\s*=\\s*(\\d+)`).exec(source)?.[1]);
    const height = Number(new RegExp(`${name}_img_height\\s*=\\s*(\\d+)`).exec(source)?.[1]);
    if (!width || !height) throw new Error(`${name}: не знайдено розміри`);

    const start = source.indexOf(`${name}_img[] = {`);
    if (start < 0) throw new Error(`${name}: не знайдено масив`);
    const end = source.indexOf('}', start);

    const pixels = source
        .slice(source.indexOf('{', start) + 1, end)
        .split(',')
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
            const value = Number(token);
            if (!Number.isFinite(value)) throw new Error(`${name}: не число «${token}»`);
            return value;
        });

    if (pixels.length !== width * height) {
        throw new Error(`${name}: ${pixels.length} пікселів, очікується ${width * height}`);
    }
    return { width, height, pixels };
}

const icons = {};
for (const name of NAMES) {
    const source = args.src
        ? await readFile(`${args.src}/${name}.h`, 'utf8')
        : await (await fetch(`${BASE}/${name}.h`)).text();
    icons[name] = parseIcon(source, name);
}

const lines = NAMES.map((name) => {
    const icon = icons[name];
    const values = [];
    for (let i = 0; i < icon.pixels.length; i += 20) {
        values.push('        ' + icon.pixels.slice(i, i + 20).map((v) => `0x${v.toString(16).padStart(4, '0')}`).join(', ') + ',');
    }
    return `    ${name}: {\n        width: ${icon.width},\n        height: ${icon.height},\n        pixels: [\n${values.join('\n')}\n        ],\n    },`;
});

await mkdir(dirname(args.out), { recursive: true });
await writeFile(
    args.out,
    `// Згенеровано scripts/gen-icons.mjs — не редагувати вручну.\n` +
        `// Джерело: lilka-dev/sdk, lib/lilka/src/lilka/icons/*.h\n` +
        `// Піктограми екранної клавіатури, RGB565. Чорний — прозорий колір.\n\n` +
        `export interface IconData {\n    width: number;\n    height: number;\n    pixels: readonly number[];\n}\n\n` +
        `export const KEYBOARD_ICONS: Readonly<Record<string, IconData>> = {\n${lines.join('\n')}\n};\n`,
    'utf8',
);

console.log(
    `✔ ${args.out}: ${NAMES.length} піктограм ` +
        NAMES.map((n) => `${n} ${icons[n].width}x${icons[n].height}`).join(', '),
);
