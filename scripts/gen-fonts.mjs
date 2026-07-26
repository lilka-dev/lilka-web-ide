#!/usr/bin/env node
/**
 * gen-fonts.mjs — декодер шрифтів u8g2 у JSON з бітмапами глифів.
 *
 * Прошивка Лілки малює текст шрифтами u8g2 у варіантах `t_cyrillic`
 * (`u8g2_font_6x13_t_cyrillic` і т.д.). Вони лежать у власному стисненому
 * форматі: заголовок на 23 байти, далі глифи з RLE-бітмапами, упакованими
 * по бітах. Цей скрипт розпаковує їх один раз на етапі збірки, щоб у рантаймі
 * не було ні декодера, ні залежності від u8g2.
 *
 * Алгоритм звірено з двома первотворами:
 *   - olikraus/u8g2, csrc/u8g2_font.c (u8g2_read_font_info,
 *     u8g2_font_decode_get_unsigned_bits, u8g2_font_decode_glyph)
 *   - moononournation/Arduino_GFX, src/Arduino_GFX.cpp (власний порт того ж
 *     декодера — саме він виконується на Лілці)
 *
 * Обидва дають ідентичний результат; розбіжність між ними була б проблемою.
 *
 * Використання:
 *   node scripts/gen-fonts.mjs --fetch
 *   node scripts/gen-fonts.mjs --src /шлях/до/u8g2_fonts.c
 *   node scripts/gen-fonts.mjs --fetch --ascii 6x13 Ж    # ASCII-арт для перевірки
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Розмір заголовка шрифту: U8G2_FONT_DATA_STRUCT_SIZE */
const HEADER_SIZE = 23;

const FONTS_URL =
    'https://raw.githubusercontent.com/olikraus/U8g2_Arduino/master/src/clib/u8g2_fonts.c';

/* ------------------------------------------------------------------ *
 * Аргументи
 * ------------------------------------------------------------------ */

function parseArgs(argv) {
    const args = {
        src: null,
        fetch: false,
        boardJson: 'src/generated/board.json',
        outDir: 'src/generated/fonts',
        ascii: null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--src') args.src = argv[++i];
        else if (a === '--fetch') args.fetch = true;
        else if (a === '--board') args.boardJson = argv[++i];
        else if (a === '--out') args.outDir = argv[++i];
        else if (a === '--ascii') args.ascii = { font: argv[++i], char: argv[++i] };
        else if (a === '--help' || a === '-h') {
            console.log('usage: gen-fonts.mjs [--src u8g2_fonts.c | --fetch] [--out DIR] [--ascii ШРИФТ СИМВОЛ]');
            process.exit(0);
        } else throw new Error(`Невідомий аргумент: ${a}`);
    }
    if (!args.src && !args.fetch) args.fetch = true;
    return args;
}

/* ------------------------------------------------------------------ *
 * Витяг масиву з C-файлу
 * ------------------------------------------------------------------ */

const C_ESCAPES = {
    n: 0x0a, t: 0x09, r: 0x0d, a: 0x07, b: 0x08, f: 0x0c, v: 0x0b,
    '\\': 0x5c, "'": 0x27, '"': 0x22, '?': 0x3f,
};

/**
 * Розбирає суміжні C-рядки у байти, починаючи з позиції `from`, і зупиняється
 * на першій `;` ПОЗА рядковим літералом.
 *
 * Окремою функцією саме через це: дані u8g2 містять друковані символи як є,
 * тому `;` (глиф 0x3b), `"` та інші розділювачі трапляються всередині літералів.
 * Наївний пошук `indexOf(';')` обрізає масив посередині.
 */
function parseCStringLiterals(text, from = 0) {
    const bytes = [];
    let i = from;
    let inString = false;

    while (i < text.length) {
        const ch = text[i];

        if (!inString) {
            if (ch === '"') {
                inString = true;
                i++;
            } else if (ch === ';') {
                return { bytes: Uint8Array.from(bytes), end: i };
            } else if (/\s/.test(ch)) {
                i++;
            } else {
                throw new Error(`Неочікуваний символ поза рядком на позиції ${i}: ${JSON.stringify(ch)}`);
            }
            continue;
        }

        if (ch === '"') {
            inString = false;
            i++;
            continue;
        }

        if (ch !== '\\') {
            bytes.push(text.charCodeAt(i));
            i++;
            continue;
        }

        const next = text[i + 1];
        if (next >= '0' && next <= '7') {
            let digits = '';
            let j = i + 1;
            while (j < text.length && digits.length < 3 && text[j] >= '0' && text[j] <= '7') {
                digits += text[j];
                j++;
            }
            bytes.push(parseInt(digits, 8) & 0xff);
            i = j;
        } else if (next === 'x') {
            let digits = '';
            let j = i + 2;
            while (j < text.length && /[0-9a-fA-F]/.test(text[j])) {
                digits += text[j];
                j++;
            }
            bytes.push(parseInt(digits, 16) & 0xff);
            i = j;
        } else if (next in C_ESCAPES) {
            bytes.push(C_ESCAPES[next]);
            i += 2;
        } else {
            throw new Error(`Невідома екранована послідовність \\${next}`);
        }
    }

    throw new Error('Незакритий рядковий літерал');
}

/** Знаходить визначення масиву за іменем і повертає його байти. */
function extractFontArray(source, symbol) {
    const marker = `${symbol}[`;
    const start = source.indexOf(marker);
    if (start < 0) throw new Error(`Не знайдено масив ${symbol}`);

    // очікуваний розмір із квадратних дужок — незалежна перевірка розбору
    const sizeMatch = /^\[(\d+)\]/.exec(source.slice(start + symbol.length));
    const declaredSize = sizeMatch ? Number(sizeMatch[1]) : null;

    const eq = source.indexOf('=', start);
    if (eq < 0) throw new Error(`Пошкоджене визначення ${symbol}`);

    const parsed = parseCStringLiterals(source, eq + 1);
    // C-рядок отримує неявний нульовий байт у кінці, і він враховується в
    // оголошеному розмірі масиву. Для декодера цей нуль важливий: на ньому
    // тримається ознака кінця секції Unicode.
    const bytes = new Uint8Array(parsed.bytes.length + 1);
    bytes.set(parsed.bytes, 0);
    return { bytes, declaredSize };
}

/* ------------------------------------------------------------------ *
 * Декодер
 * ------------------------------------------------------------------ */

function readWord(data, offset) {
    return (data[offset] << 8) | data[offset + 1];
}

function signedByte(v) {
    return v > 127 ? v - 256 : v;
}

function readFontInfo(data) {
    return {
        glyphCnt: data[0],
        bbxMode: data[1],
        bitsPer0: data[2],
        bitsPer1: data[3],
        bitsPerCharWidth: data[4],
        bitsPerCharHeight: data[5],
        bitsPerCharX: data[6],
        bitsPerCharY: data[7],
        bitsPerDeltaX: data[8],
        maxCharWidth: data[9],
        maxCharHeight: data[10],
        xOffset: signedByte(data[11]),
        yOffset: signedByte(data[12]),
        ascentA: signedByte(data[13]),
        descentG: signedByte(data[14]),
        ascentPara: signedByte(data[15]),
        descentPara: signedByte(data[16]),
        startPosUpperA: readWord(data, 17),
        startPosLowerA: readWord(data, 19),
        startPosUnicode: readWord(data, 21),
    };
}

/**
 * Читач біт: молодші біти першими, з переходом через межу байта.
 * Порт `u8g2_font_decode_get_unsigned_bits`. Обмеження cnt <= 8 — з первотвору.
 */
class BitReader {
    constructor(data, offset) {
        this.data = data;
        this.ptr = offset;
        this.bitPos = 0;
    }

    unsigned(cnt) {
        if (cnt > 8) throw new Error(`Читання ${cnt} біт не підтримується (первотвір обмежений 8)`);
        let val = this.data[this.ptr] >>> this.bitPos;
        let bitPosPlusCnt = this.bitPos + cnt;
        if (bitPosPlusCnt >= 8) {
            const s = 8 - this.bitPos;
            this.ptr++;
            val |= this.data[this.ptr] << s;
            bitPosPlusCnt -= 8;
        }
        this.bitPos = bitPosPlusCnt;
        return val & ((1 << cnt) - 1);
    }

    signed(cnt) {
        return this.unsigned(cnt) - (1 << (cnt - 1));
    }
}

/**
 * Розпаковує один глиф. `offset` вказує на дані ПІСЛЯ байтів кодування
 * та розміру — так само, як повертає `u8g2_font_get_glyph_data`.
 */
function decodeGlyph(data, offset, info) {
    const reader = new BitReader(data, offset);
    const width = reader.unsigned(info.bitsPerCharWidth);
    const height = reader.unsigned(info.bitsPerCharHeight);
    const charX = reader.signed(info.bitsPerCharX);
    const charY = reader.signed(info.bitsPerCharY);
    const deltaX = reader.signed(info.bitsPerDeltaX);

    const glyph = {
        width,
        height,
        // Розміщення з Arduino_GFX:
        //   target_x = cursorX + charX
        //   target_y = cursorY - (height + charY)
        offsetX: charX,
        offsetY: height + charY,
        advance: deltaX,
        rows: [],
    };

    if (width === 0) return glyph;

    const grid = new Uint8Array(width * height);
    let lx = 0;
    let ly = 0;

    /** Порт `u8g2_font_decode_len`: серія пікселів із переносом на межі глифа. */
    const decodeLen = (len, isForeground) => {
        let cnt = len;
        for (;;) {
            const rem = width - lx;
            const current = cnt < rem ? cnt : rem;
            if (isForeground && ly < height) {
                for (let i = 0; i < current; i++) grid[ly * width + lx + i] = 1;
            }
            if (cnt < rem) break;
            cnt -= rem;
            lx = 0;
            ly++;
        }
        lx += cnt;
    };

    let guard = 0;
    for (;;) {
        const a = reader.unsigned(info.bitsPer0);
        const b = reader.unsigned(info.bitsPer1);
        do {
            decodeLen(a, false);
            decodeLen(b, true);
        } while (reader.unsigned(1) !== 0);

        if (ly >= height) break;
        if (++guard > 4096) throw new Error('Декодер глифа не сходиться');
    }

    // упаковка по рядках, старший біт — лівий піксель
    const bytesPerRow = Math.ceil(width / 8);
    const packed = new Uint8Array(bytesPerRow * height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (grid[y * width + x]) {
                packed[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
            }
        }
    }
    glyph.packed = packed;
    glyph.grid = grid;
    return glyph;
}

/** Перебирає всі глифи шрифту: 8-бітну секцію і секцію Unicode. */
function decodeFont(data) {
    const info = readFontInfo(data);
    const glyphs = new Map();

    // --- 8-бітна секція: [кодування:1][стрибок:1][дані...]
    let pos = HEADER_SIZE;
    for (;;) {
        const jump = data[pos + 1];
        if (jump === 0) break;
        const encoding = data[pos];
        glyphs.set(encoding, decodeGlyph(data, pos + 2, info));
        pos += jump;
    }

    // --- секція Unicode: спершу таблиця пошуку, далі [кодування:2][стрибок:1][дані...]
    pos += 2;
    const tableStart = pos;
    const tableLength = readWord(data, tableStart);
    if (tableLength > 0) {
        let glyphPos = tableStart + tableLength;
        for (;;) {
            const encoding = readWord(data, glyphPos);
            if (encoding === 0) break;
            const jump = data[glyphPos + 2];
            if (jump === 0) break;
            glyphs.set(encoding, decodeGlyph(data, glyphPos + 3, info));
            glyphPos += jump;
        }
    }

    return { info, glyphs };
}

/* ------------------------------------------------------------------ *
 * Допоміжне
 * ------------------------------------------------------------------ */

function toAsciiArt(glyph) {
    if (glyph.width === 0) return '(порожній глиф)';
    const lines = [];
    for (let y = 0; y < glyph.height; y++) {
        let line = '';
        for (let x = 0; x < glyph.width; x++) {
            line += glyph.grid[y * glyph.width + x] ? '#' : '.';
        }
        lines.push(line);
    }
    return lines.join('\n');
}

const isCyrillic = (cp) => (cp >= 0x0400 && cp <= 0x04ff) || (cp >= 0x0500 && cp <= 0x052f);

/* ------------------------------------------------------------------ *
 * Головна функція
 * ------------------------------------------------------------------ */

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const board = JSON.parse(await readFile(args.boardJson, 'utf8'));
    const wanted = board.fonts;
    if (!Array.isArray(wanted) || wanted.length === 0) {
        throw new Error(`У ${args.boardJson} немає переліку шрифтів`);
    }

    let source;
    if (args.src) {
        source = await readFile(args.src, 'utf8');
    } else {
        process.stderr.write(`Завантаження ${FONTS_URL} (близько 40 МБ)...\n`);
        const res = await fetch(FONTS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status} при завантаженні шрифтів`);
        source = await res.text();
    }

    await mkdir(args.outDir, { recursive: true });

    const index = [];
    let totalBytes = 0;

    for (const font of wanted) {
        const { bytes, declaredSize } = extractFontArray(source, font.u8g2);
        if (declaredSize !== null && declaredSize !== bytes.length) {
            // Незалежна перевірка розбору екранованих послідовностей:
            // розмір у квадратних дужках мусить збігтися з кількістю байтів.
            throw new Error(
                `${font.u8g2}: розібрано ${bytes.length} байт, а в оголошенні ${declaredSize}`,
            );
        }

        const { info, glyphs } = decodeFont(bytes);

        if (args.ascii && args.ascii.font === font.name) {
            const cp = args.ascii.char.codePointAt(0);
            const glyph = glyphs.get(cp);
            console.log(`\n${font.u8g2} · "${args.ascii.char}" (U+${cp.toString(16).toUpperCase()})`);
            if (!glyph) console.log('  глифа немає у шрифті');
            else {
                console.log(
                    `  ${glyph.width}x${glyph.height}, offset (${glyph.offsetX}, ${glyph.offsetY}), advance ${glyph.advance}`,
                );
                console.log(toAsciiArt(glyph));
            }
            console.log();
        }

        // --- перевірки цілісності
        const problems = [];
        for (const [cp, glyph] of glyphs) {
            if (glyph.width > info.maxCharWidth) {
                problems.push(`U+${cp.toString(16)}: ширина ${glyph.width} > maxCharWidth ${info.maxCharWidth}`);
            }
            if (glyph.height > info.maxCharHeight) {
                problems.push(`U+${cp.toString(16)}: висота ${glyph.height} > maxCharHeight ${info.maxCharHeight}`);
            }
        }
        // glyph_cnt у заголовку — один байт, тому для шрифтів із понад 255
        // глифами він переповнюється. Порівнюємо за модулем 256.
        if (glyphs.size % 256 !== info.glyphCnt) {
            problems.push(`знайдено ${glyphs.size} глифів, у заголовку ${info.glyphCnt} (за модулем 256)`);
        }

        const out = {
            name: font.name,
            u8g2: font.u8g2,
            source: args.src ? { kind: 'file', path: args.src } : { kind: 'url', url: FONTS_URL },
            /* Перенос рядка в Arduino_GFX: cursor_y += textsize_y * maxCharHeight */
            lineHeight: info.maxCharHeight,
            ascent: info.ascentA,
            header: info,
            glyphs: {},
        };

        for (const [cp, glyph] of [...glyphs].sort((a, b) => a[0] - b[0])) {
            out.glyphs[cp] = {
                w: glyph.width,
                h: glyph.height,
                ox: glyph.offsetX,
                oy: glyph.offsetY,
                adv: glyph.advance,
                bits: glyph.packed ? Buffer.from(glyph.packed).toString('base64') : '',
            };
        }

        const cyrillic = [...glyphs.keys()].filter(isCyrillic).length;
        const ascii = [...glyphs.keys()].filter((cp) => cp < 128).length;

        const target = join(args.outDir, `${font.name}.json`);
        const json = JSON.stringify(out);
        await writeFile(target, json + '\n', 'utf8');
        totalBytes += json.length;

        index.push({
            name: font.name,
            u8g2: font.u8g2,
            file: `${font.name}.json`,
            cellWidth: font.cellWidth,
            cellHeight: font.cellHeight,
            lineHeight: info.maxCharHeight,
            glyphs: glyphs.size,
        });

        const mark = problems.length ? '▲' : '✔';
        console.log(
            `${mark} ${font.name.padEnd(6)} ${String(bytes.length).padStart(6)} Б -> ${String(json.length).padStart(7)} Б JSON · ` +
                `глифів ${String(glyphs.size).padStart(3)} (ASCII ${ascii}, кирилиця ${cyrillic}) · ` +
                `клітина ${info.maxCharWidth}x${info.maxCharHeight}, ascent A ${info.ascentA}`,
        );
        for (const p of problems) console.log(`    ▲ ${p}`);
    }

    await writeFile(
        join(args.outDir, 'index.json'),
        JSON.stringify({ generatedAt: new Date().toISOString(), fonts: index }, null, 2) + '\n',
        'utf8',
    );

    console.log(`\nразом ${wanted.length} шрифтів, ${(totalBytes / 1024).toFixed(1)} КБ JSON`);
}

main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
});
