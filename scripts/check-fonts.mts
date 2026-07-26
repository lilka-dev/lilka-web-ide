/**
 * Перевірки декодованих шрифтів.
 *
 * Декодер не можна перевірити самим декодером — це було б колом. Тому тут
 * зіставляються величини, які в u8g2 зберігаються НЕЗАЛЕЖНО одна від одної:
 * байти заголовка проти результату розбору бітпотоку, і назва шрифту проти
 * delta_x. Якщо бітпотік читається зі зсувом, ці числа розійдуться.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontFromJson, type FontJson } from '../src/emulator/font.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const board = JSON.parse(readFileSync(join(root, 'src/generated/board.json'), 'utf8'));

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

/** Класичний X11 6x13 «A» — форма відома незалежно від декодера. */
const REFERENCE_A_6x13 = [
    '..#..',
    '.#.#.',
    '#...#',
    '#...#',
    '#...#',
    '#####',
    '#...#',
    '#...#',
    '#...#',
];

for (const info of board.fonts as Array<{ name: string; cellWidth: number; cellHeight: number; u8g2: string }>) {
    const json = JSON.parse(
        readFileSync(join(root, 'src/generated/fonts', `${info.name}.json`), 'utf8'),
    ) as FontJson;
    const font = fontFromJson(json);

    ok(json.u8g2 === info.u8g2, `${info.name}: символ ${json.u8g2} != ${info.u8g2}`);

    // 1. delta_x великої «A» з бітпотоку проти ширини клітини з назви шрифту
    const a = font.glyph(0x41);
    ok(a !== null, `${info.name}: немає глифа «A»`);
    if (a) {
        ok(a.advance === info.cellWidth, `${info.name}: advance('A')=${a.advance}, очікується ${info.cellWidth}`);
        // 2. висота «A» з бітпотоку проти ascent_A з заголовка
        ok(a.height === json.header.ascentA, `${info.name}: height('A')=${a.height} != ascentA=${json.header.ascentA}`);
        ok(a.offsetY === json.header.ascentA, `${info.name}: offsetY('A')=${a.offsetY} != ascentA`);
    }

    // 3. жоден глиф не виходить за максимуми з заголовка
    for (const [cp, raw] of Object.entries(json.glyphs)) {
        ok(
            raw.w <= json.header.maxCharWidth && raw.h <= json.header.maxCharHeight,
            `${info.name}: глиф ${cp} ${raw.w}x${raw.h} > ${json.header.maxCharWidth}x${json.header.maxCharHeight}`,
        );
        const expectedBytes = Math.ceil(raw.w / 8) * raw.h;
        ok(
            Buffer.from(raw.bits, 'base64').length === expectedBytes,
            `${info.name}: глиф ${cp} має ${Buffer.from(raw.bits, 'base64').length} Б, очікується ${expectedBytes}`,
        );
    }

    // 4. клітина з назви шрифту відповідає максимумам заголовка
    ok(
        json.header.maxCharWidth === info.cellWidth && json.header.maxCharHeight === info.cellHeight,
        `${info.name}: заголовок ${json.header.maxCharWidth}x${json.header.maxCharHeight} != назви ${info.cellWidth}x${info.cellHeight}`,
    );

    // 5. українські літери мають бути на місці — саме через них варіант t_cyrillic
    for (const ch of 'ҐґЄєІіЇїЙйЖж') {
        ok(font.glyph(ch.codePointAt(0)!) !== null, `${info.name}: немає глифа «${ch}»`);
    }
}

// 6. форма «A» у 6x13 проти незалежно відомого зразка
{
    const json = JSON.parse(readFileSync(join(root, 'src/generated/fonts/6x13.json'), 'utf8')) as FontJson;
    const g = fontFromJson(json).glyph(0x41)!;
    const bytesPerRow = Math.ceil(g.width / 8);
    const rows: string[] = [];
    for (let row = 0; row < g.height; row++) {
        let line = '';
        for (let col = 0; col < g.width; col++) {
            line += (g.bitmap[row * bytesPerRow + (col >> 3)] >> (7 - (col & 7))) & 1 ? '#' : '.';
        }
        rows.push(line);
    }
    ok(
        rows.join('|') === REFERENCE_A_6x13.join('|'),
        `6x13: форма «A» не збігається зі зразком X11:\n${rows.join('\n')}`,
    );
}

console.log(fails === 0 ? '✔ шрифти: усі перевірки пройдено' : `✖ шрифти: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
