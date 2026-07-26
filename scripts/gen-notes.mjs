#!/usr/bin/env node
/**
 * gen-notes.mjs — витягує таблицю нот із `sdk/lib/lilka/src/lilka/buzzer.h`.
 *
 * `lualilka_buzzer_register` створює глобальну таблицю `notes` із частотами
 * від B0 до DS8. В анотаціях LuaLS її немає (як і таблиці `colors`), тому
 * значення беруться прямо з коду прошивки.
 *
 *   node scripts/gen-notes.mjs [--src buzzer.h] [--out src/generated/notes.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL_BUZZER = 'https://raw.githubusercontent.com/lilka-dev/sdk/main/lib/lilka/src/lilka/buzzer.h';

const args = { src: null, out: 'src/generated/notes.ts' };
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--src') args.src = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
}

const source = args.src ? await readFile(args.src, 'utf8') : await (await fetch(URL_BUZZER)).text();

const notes = {};
for (const m of source.matchAll(/NOTE_([A-G]S?\d)\s*=\s*(\d+)/g)) {
    notes[m[1]] = Number(m[2]);
}

if (Object.keys(notes).length < 80) {
    throw new Error(`Знайдено лише ${Object.keys(notes).length} нот — формат buzzer.h змінився?`);
}

const lines = Object.entries(notes).map(([name, freq]) => `    ${name}: ${freq},`);
await mkdir(dirname(args.out), { recursive: true });
await writeFile(
    args.out,
    `// Згенеровано scripts/gen-notes.mjs — не редагувати вручну.\n` +
        `// Джерело: lilka-dev/sdk, lib/lilka/src/lilka/buzzer.h (enum Note)\n` +
        `// Глобальна таблиця \`notes\` у прошивці; в анотаціях LuaLS її немає.\n\n` +
        `export const NOTES: Readonly<Record<string, number>> = {\n${lines.join('\n')}\n};\n`,
    'utf8',
);

console.log(`✔ ${args.out}: ${Object.keys(notes).length} нот, від ${Object.keys(notes)[0]} до ${Object.keys(notes).at(-1)}`);
