#!/usr/bin/env node
/**
 * gen-completions.mjs — готує дані для автодоповнення в редакторі.
 *
 * Джерело — `lilka-api.json`, знятий з анотацій прошивки. Тобто підказки не
 * вигадані й не переписані вручну: вони описують рівно те, що є в API, разом
 * з українськими поясненнями.
 *
 * Сюди ж додаються дві глобальні таблиці, яких у анотаціях немає, але які
 * прошивка реєструє: `colors` і `notes`.
 *
 *   node scripts/gen-completions.mjs [--out src/generated/completions.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = { spec: 'src/generated/lilka-api.json', out: 'src/generated/completions.ts' };
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--spec') args.spec = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
}

const spec = JSON.parse(await readFile(args.spec, 'utf8'));

/**
 * Простори імен, яких у браузері немає.
 *
 * Показувати їх у підказках було б шкідливо: людина написала б код, який у
 * браузері мовчки не працює, а на залізі працює. Краще не пропонувати.
 */
const UNAVAILABLE = new Set([
    'gpio', 'i2c', 'spi', 'pwm', 'ws2812',
    'wifi', 'http', 'httpserver', 'mqtt', 'net', 'socket', 'serial',
    'crypto',
]);

/** Опис одного варіанта доповнення. */
const entries = [];

/** Короткий підпис: назва з типами параметрів. */
function signatureOf(fn) {
    const args = fn.params.map((p) => `${p.name}${p.optional ? '?' : ''}`).join(', ');
    return `(${args})`;
}

/** Перший рядок опису — більше в підказку не влізе. */
function shortDoc(text) {
    if (!text) return '';
    const line = text.split('\n')[0].trim();
    return line.length > 110 ? line.slice(0, 107) + '…' : line;
}

const namespaces = [];

for (const ns of spec.namespaces) {
    if (ns.kind === 'struct' || UNAVAILABLE.has(ns.name)) continue;
    if (ns.functions.length === 0 && ns.fields.length === 0) continue;

    if (ns.kind === 'module') {
        namespaces.push(ns.name);
        entries.push({
            label: ns.name,
            type: 'namespace',
            detail: '',
            info: shortDoc(ns.summary || ns.doc),
        });
    }

    for (const fn of ns.functions) {
        entries.push({
            label: ns.kind === 'module' ? `${ns.name}.${fn.name}` : fn.name,
            type: 'function',
            detail: signatureOf(fn),
            info: shortDoc(fn.summary || fn.doc),
            // Шаблон для вставки: курсор одразу між дужками, якщо є параметри
            apply: (ns.kind === 'module' ? `${ns.name}.${fn.name}` : fn.name) + (fn.params.length ? '(' : '()'),
        });
    }

    for (const field of ns.fields) {
        entries.push({
            label: `${ns.name}.${field.name}`,
            type: field.isConstant ? 'constant' : 'property',
            detail: field.type ?? '',
            info: shortDoc(field.summary || field.doc),
        });
    }
}

/** Глобальні таблиці, які прошивка реєструє повз анотації. */
const COLORS = [
    'black', 'white', 'red', 'green', 'blue',
    'cyan', 'magenta', 'yellow', 'midnight_blue', 'orange_red',
];

for (const name of COLORS) {
    entries.push({ label: `colors.${name}`, type: 'constant', detail: 'колір', info: '' });
}

/** Ноти беруться з того самого файлу, що й для зумера. */
const notes = await readFile('src/generated/notes.ts', 'utf8');
for (const match of notes.matchAll(/^\s{4}([A-G]S?\d):/gm)) {
    entries.push({ label: `notes.${match[1]}`, type: 'constant', detail: 'нота', info: '' });
}

/** Життєвий цикл: те, з чого починається будь-яка програма. */
const LIFECYCLE = [
    ['lilka.init', 'викликається один раз перед стартом'],
    ['lilka.update', 'викликається щокадру, delta — секунди від минулого кадру'],
    ['lilka.draw', 'малювання кадру'],
    ['lilka.fullscreen', 'true — на весь екран, false — зі смугою статусу'],
    ['lilka.show_fps', 'показувати кадри за секунду'],
];
for (const [label, info] of LIFECYCLE) {
    entries.push({ label, type: 'property', detail: '', info });
}

entries.sort((a, b) => a.label.localeCompare(b.label));

const body =
    `// Згенеровано scripts/gen-completions.mjs — не редагувати вручну.\n` +
    `// Джерело: src/generated/lilka-api.json (анотації прошивки) плюс глобальні\n` +
    `// таблиці colors і notes, яких у анотаціях немає.\n\n` +
    `export interface Completion {\n` +
    `    label: string;\n` +
    `    type: string;\n` +
    `    detail: string;\n` +
    `    info: string;\n` +
    `    apply?: string;\n` +
    `}\n\n` +
    `/** Простори імен, доступні в браузері. */\n` +
    `export const NAMESPACES: readonly string[] = ${JSON.stringify(namespaces.sort())};\n\n` +
    `export const COMPLETIONS: readonly Completion[] = ${JSON.stringify(entries, null, 0)};\n`;

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, body, 'utf8');

console.log(
    `✔ ${args.out}: ${entries.length} варіантів доповнення, ${namespaces.length} просторів імен`,
);
