#!/usr/bin/env node
/**
 * gen-fmath.mjs — витягує таблиці синусів із `sdk/lib/lilka/src/lilka/fmath.cpp`.
 *
 * Прошивка обчислює тригонометрію не через `sin()`, а через таблиці на 360 і 32
 * значення, записані в коді з шістьма знаками після коми. `Math.sin` дає інші
 * числа, і після `static_cast<int32_t>` це може зсунути піксель. Тому таблиці
 * беруться з первотвору, а не рахуються.
 *
 *   node scripts/gen-fmath.mjs [--src fmath.cpp] [--out src/generated/fmath.json]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL_FMATH = 'https://raw.githubusercontent.com/lilka-dev/sdk/main/lib/lilka/src/lilka/fmath.cpp';

function parseArgs(argv) {
    const args = { src: null, out: 'src/generated/fmath-tables.ts' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--src') args.src = argv[++i];
        else if (argv[i] === '--out') args.out = argv[++i];
        else if (argv[i] === '--help') {
            console.log('usage: gen-fmath.mjs [--src fmath.cpp] [--out FILE]');
            process.exit(0);
        } else throw new Error(`Невідомий аргумент: ${argv[i]}`);
    }
    return args;
}

/** Читає ініціалізатор масиву `float NAME[N] = { ... };` */
function extractTable(source, name, expectedLength) {
    const re = new RegExp(`float\\s+${name}\\s*\\[\\s*(\\d+)?\\s*\\]\\s*=\\s*\\{`);
    const m = re.exec(source);
    if (!m) throw new Error(`Не знайдено таблицю ${name}`);
    const start = m.index + m[0].length;
    const end = source.indexOf('}', start);
    if (end < 0) throw new Error(`Не знайдено кінець таблиці ${name}`);

    const values = source
        .slice(start, end)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            const v = Number(s);
            if (!Number.isFinite(v)) throw new Error(`${name}: не число «${s}»`);
            return v;
        });

    if (values.length !== expectedLength) {
        throw new Error(`${name}: ${values.length} значень, очікується ${expectedLength}`);
    }
    return values;
}

/** По вісім значень у рядок — щоб файл лишався читабельним. */
function chunkLines(values) {
    const lines = [];
    for (let i = 0; i < values.length; i += 8) {
        lines.push('    ' + values.slice(i, i + 8).map((v) => v.toFixed(6)).join(', ') + ',');
    }
    return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));

let source;
if (args.src) {
    source = await readFile(args.src, 'utf8');
} else {
    const res = await fetch(URL_FMATH);
    if (!res.ok) throw new Error(`HTTP ${res.status} для fmath.cpp`);
    source = await res.text();
}

const sin360 = extractTable(source, 'sin360', 360);
const sin32 = extractTable(source, 'sin32', 32);

// Незалежна перевірка: таблиці мусять сходитися зі справжнім синусом
// у межах округлення до шести знаків, з якими вони записані в коді.
let maxError = 0;
for (let deg = 0; deg < 360; deg++) {
    maxError = Math.max(maxError, Math.abs(sin360[deg] - Math.sin((deg * Math.PI) / 180)));
}
if (maxError > 1e-6) throw new Error(`sin360 розходиться зі sin() на ${maxError}`);

// Вивід — TypeScript, а не JSON: цей модуль читається і збіркою Vite, і
// скриптами під Node, а імпорт JSON у них вимагає різного синтаксису.
const body = `// Згенеровано scripts/gen-fmath.mjs — не редагувати вручну.
// Джерело: lilka-dev/sdk, lib/lilka/src/lilka/fmath.cpp
// Значення взяті з коду прошивки: Math.sin() дає інші числа і зсуває пікселі.

export const SIN_360: readonly number[] = [
${chunkLines(sin360)}
];

export const SIN_32: readonly number[] = [
${chunkLines(sin32)}
];
`;

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, body, 'utf8');

console.log(`✔ ${args.out}: sin360[360], sin32[32], максимальне відхилення від sin() ${maxError.toExponential(2)}`);
