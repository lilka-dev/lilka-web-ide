/**
 * Звіт покриття Lua API.
 *
 * Порівнює те, що справді прив'язано в рантаймі, зі специфікацією
 * `lilka-api.json`, знятою з анотацій прошивки. Сенс у тому, щоб межа
 * емулятора була видна в числах, а не на відчуття: урок, який спирається на
 * функцію, якої немає, має ламатися тут, а не в класі.
 *
 *   node --experimental-strip-types scripts/gen-coverage.mts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LuaRuntime } from '../src/runtime/runtime.ts';
import { createSharedMemory } from '../src/runtime/shared.ts';
import type { FontJson } from '../src/emulator/font.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const board = JSON.parse(readFileSync(join(root, 'src/generated/board.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(root, 'src/generated/lilka-api.json'), 'utf8'));
const profile = board.boards[board.defaultBoard];

const fonts: Record<string, FontJson> = {};
for (const f of board.fonts) {
    fonts[f.name] = JSON.parse(readFileSync(join(root, 'src/generated/fonts', `${f.name}.json`), 'utf8'));
}

const runtime = new LuaRuntime({
    memory: createSharedMemory(profile.display.width, profile.display.height),
    fonts,
    statusBarHeight: profile.canvas.statusBarHeight,
    defaultFont: board.defaultFont,
    onPrint: () => {},
});
await runtime.prepare();
const { implemented, stubs } = runtime.apiCoverage;
runtime.close();

const implementedSet = new Set(implemented);
const stubSet = new Set(stubs);

/** Простори імен, яких у браузері не буде взагалі — і це не тимчасово. */
const OUT_OF_SCOPE: Record<string, string> = {
    gpio: 'фізичні виводи',
    i2c: 'фізична шина',
    spi: 'фізична шина',
    pwm: 'фізичні виводи',
    ws2812: 'фізична стрічка',
    wifi: 'мережа пристрою',
    http: 'мережа пристрою',
    httpserver: 'мережа пристрою',
    mqtt: 'мережа пристрою',
    net: 'мережа пристрою',
    socket: 'мережа пристрою',
    sdcard: 'файлова система',
    serial: 'апаратний UART',
    crypto: 'не пріоритет',
    UI: 'не пріоритет',
    console: 'інший інтерфейс',
};

const rows: Array<{
    name: string;
    total: number;
    done: number;
    stub: number;
    missing: string[];
    note?: string;
}> = [];

for (const ns of spec.namespaces) {
    if (ns.kind === 'struct' || ns.functions.length === 0) continue;

    const missing: string[] = [];
    let done = 0;
    let stub = 0;

    for (const fn of ns.functions) {
        const key = `${ns.name}.${fn.name}`;
        if (implementedSet.has(key)) done++;
        else if (stubSet.has(key)) stub++;
        else missing.push(fn.name);
    }

    rows.push({
        name: ns.name,
        total: ns.functions.length,
        done,
        stub,
        missing,
        note: OUT_OF_SCOPE[ns.name],
    });
}

rows.sort((a, b) => b.done / b.total - a.done / a.total || a.name.localeCompare(b.name));

const inScope = rows.filter((r) => !r.note);
const totals = {
    functions: rows.reduce((n, r) => n + r.total, 0),
    implemented: rows.reduce((n, r) => n + r.done, 0),
    stubs: rows.reduce((n, r) => n + r.stub, 0),
    inScopeFunctions: inScope.reduce((n, r) => n + r.total, 0),
    inScopeImplemented: inScope.reduce((n, r) => n + r.done, 0),
};

writeFileSync(
    join(root, 'src/generated/coverage.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), totals, namespaces: rows }, null, 2) + '\n',
    'utf8',
);

const pct = (a: number, b: number) => (b === 0 ? '—' : `${Math.round((a / b) * 100)}%`);

console.log('простір імен      готово  заглушки  усього   покриття  примітка');
for (const r of rows) {
    console.log(
        `  ${r.name.padEnd(14)} ${String(r.done).padStart(6)} ${String(r.stub).padStart(9)} ` +
            `${String(r.total).padStart(7)} ${pct(r.done, r.total).padStart(10)}  ${r.note ?? ''}`,
    );
}
console.log(
    `\nразом: ${totals.implemented}/${totals.functions} функцій ` +
        `(${pct(totals.implemented, totals.functions)}), заглушок ${totals.stubs}`,
);
console.log(
    `у межах задуманого: ${totals.inScopeImplemented}/${totals.inScopeFunctions} ` +
        `(${pct(totals.inScopeImplemented, totals.inScopeFunctions)})`,
);

const gaps = inScope.filter((r) => r.missing.length);
if (gaps.length) {
    console.log('\nчого бракує:');
    for (const r of gaps) console.log(`  ${r.name}: ${r.missing.join(', ')}`);
}
