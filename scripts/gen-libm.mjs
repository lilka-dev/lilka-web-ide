#!/usr/bin/env node
/**
 * gen-libm.mjs — витягує константи float-тригонометрії newlib, з якою
 * зібрана прошивка.
 *
 * На ESP32 `sin(float)` у C++ — це `sinf` із newlib, а для Xtensa там
 * `__OBSOLETE_MATH = 1` (machine/ieeefp.h), тобто класичний fdlibm:
 * sf_sin.c, kf_sin.c, ef_rem_pio2.c і так далі. Він НЕ завжди округлює
 * правильно: cos(rad(30)) на залізі на один ulp більший за точне значення, і
 * через це кінець лінії зсувається на піксель. `Math.fround(Math.cos(x))` такого
 * не відтворить — потрібен сам алгоритм із тими самими константами.
 *
 * Константи беруться з шістнадцяткових коментарів (`/* 0x3f490fda *\/`) — це
 * точні біти float, без похибки десяткового запису.
 *
 *   node scripts/gen-libm.mjs [--dir теки-з-файлами] [--out src/generated/newlib-libm.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Тег відповідає тулчейну ESP-IDF 4.4 (esp-2021r2), з яким зібрано LilkaSDK
const BASE = 'https://raw.githubusercontent.com/espressif/newlib-esp32/esp-2021r2/newlib/libm/math/';
const FILES = [
    'kf_sin.c', 'kf_cos.c', 'kf_tan.c', 'ef_rem_pio2.c', 'kf_rem_pio2.c',
    'ef_asin.c', 'ef_acos.c', 'sf_atan.c', 'ef_atan2.c', 'ef_log.c', 'ef_pow.c',
];
const HEADER = 'https://raw.githubusercontent.com/espressif/newlib-esp32/esp-2021r2/newlib/libm/common/fdlibm.h';

function parseArgs(argv) {
    const args = { dir: null, out: 'src/generated/newlib-libm.ts' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--dir') args.dir = argv[++i];
        else if (argv[i] === '--out') args.out = argv[++i];
        else if (argv[i] === '--help') {
            console.log('usage: gen-libm.mjs [--dir DIR] [--out FILE]');
            process.exit(0);
        } else throw new Error(`Невідомий аргумент: ${argv[i]}`);
    }
    return args;
}

async function load(dir, name) {
    if (dir) return readFile(join(dir, name), 'utf8');
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error(`Не вдалося завантажити ${name}: ${res.status}`);
    return res.text();
}

// Біти float за десятковим записом — так само, як компілятор C перетворює
// літерал у float-ініціалізаторі: десяткове -> double -> float
const f32 = new DataView(new ArrayBuffer(4));
function decimalBits(text) {
    f32.setFloat32(0, Math.fround(parseFloat(text)));
    return f32.getInt32(0);
}

/**
 * Скалярні float-константи: `NAME = 1.5e+00, /* 0x3fc00000 *\/`.
 * Шістнадцятковий коментар — точні біти; у ef_log.c він без «0x», а частина
 * констант (ovt, pio2_hi в ef_asin.c) коментаря не має зовсім, тоді біти
 * беруться з десяткового запису.
 */
function scalars(source) {
    const out = {};
    const re = /\b(\w+)\s*=\s*(-?[\d.]+(?:e[-+]?\d+)?)f?\s*([,;])[ \t]*(?:\/\*\s*(?:0x)?([0-9a-fA-F]{8})\b[^*]*\*\/)?/g;
    for (let m; (m = re.exec(source)); ) {
        out[m[1]] = m[4] ? parseInt(m[4], 16) | 0 : decimalBits(m[2]);
    }
    return out;
}

/**
 * Масив `NAME[] = { ... };` — і окремим оголошенням, і посеред переліку
 * (`static const float one = ..., T[] = {`). Якщо в елементів є
 * шістнадцяткові коментарі — це float, і береться бітовий запис; інакше —
 * цілі значення.
 */
function array(source, name) {
    const m = new RegExp(`\\b${name}\\s*\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*[,;]`).exec(source);
    if (!m) throw new Error(`Не знайдено масив ${name}`);
    // Варіант із #ifdef __STDC__ / #else: тіло першого збігу містить ще й
    // початок другого оголошення, тож береться текст після останньої «{»
    const body = m[1].slice(m[1].lastIndexOf('{') + 1).replace(/^\s*#.*$/gm, '');
    const hex = [...body.matchAll(/\/\*\s*(0x[0-9a-fA-F]{8})\s*\*\//g)];
    const items = body.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim()).filter(Boolean);
    let values;
    if (hex.length > 0 && hex.length === items.length) values = hex.map((x) => parseInt(x[1], 16) | 0);
    else if (items.every((x) => /^-?0x[0-9a-fA-F]+$|^-?\d+$/.test(x))) values = items.map((x) => Number(x));
    // Дробові без побітового запису (bp, dp_h, dp_l в ef_pow.c)
    else values = items.map((x) => decimalBits(x.replace(/f$/, '')));
    if (values.some((v) => !Number.isFinite(v))) throw new Error(`Масив ${name} розібрано з помилкою`);
    return values;
}

const args = parseArgs(process.argv.slice(2));
const src = {};
for (const name of FILES) src[name] = await load(args.dir, name);
const header = args.dir ? await readFile(join(args.dir, 'fdlibm.h'), 'utf8') : await (await fetch(HEADER)).text();

/** Останнє визначення макросу — гілка #else, тобто IEEE із денормалами, як на Xtensa */
function lastDefine(name) {
    const all = [...header.matchAll(new RegExp(`#define\\s+${name}\\s+(0x[0-9a-fA-F]+)`, 'g'))];
    if (all.length === 0) throw new Error(`Не знайдено ${name} у fdlibm.h`);
    return parseInt(all[all.length - 1][1], 16) | 0;
}

const data = {
    kf_sin: scalars(src['kf_sin.c']),
    kf_cos: scalars(src['kf_cos.c']),
    kf_tan: { ...scalars(src['kf_tan.c']), T: array(src['kf_tan.c'], 'T') },
    ef_rem_pio2: {
        ...scalars(src['ef_rem_pio2.c']),
        npio2_hw: array(src['ef_rem_pio2.c'], 'npio2_hw'),
        two_over_pi: array(src['ef_rem_pio2.c'], 'two_over_pi'),
    },
    kf_rem_pio2: {
        ...scalars(src['kf_rem_pio2.c']),
        PIo2: array(src['kf_rem_pio2.c'], 'PIo2'),
        init_jk: array(src['kf_rem_pio2.c'], 'init_jk'),
    },
    ef_asin: scalars(src['ef_asin.c']),
    ef_acos: scalars(src['ef_acos.c']),
    sf_atan: {
        atanhi: array(src['sf_atan.c'], 'atanhi'),
        atanlo: array(src['sf_atan.c'], 'atanlo'),
        aT: array(src['sf_atan.c'], 'aT'),
    },
    ef_atan2: scalars(src['ef_atan2.c']),
    ef_log: scalars(src['ef_log.c']),
    ef_pow: {
        ...scalars(src['ef_pow.c']),
        bp: array(src['ef_pow.c'], 'bp'),
        dp_h: array(src['ef_pow.c'], 'dp_h'),
        dp_l: array(src['ef_pow.c'], 'dp_l'),
    },
    fdlibm: {
        FLT_UWORD_EXP_MAX: lastDefine('FLT_UWORD_EXP_MAX'),
        FLT_UWORD_EXP_MIN: lastDefine('FLT_UWORD_EXP_MIN'),
    },
};

// Захист від тихої зміни формату джерела: без цих значень алгоритм хибний
const expect = {
    'kf_sin.S6': data.kf_sin.S6,
    'kf_cos.C6': data.kf_cos.C6,
    'kf_tan.T': data.kf_tan.T?.length === 13,
    'ef_rem_pio2.pio2_3t': data.ef_rem_pio2.pio2_3t,
    'ef_rem_pio2.npio2_hw': data.ef_rem_pio2.npio2_hw.length === 32,
    'ef_rem_pio2.two_over_pi': data.ef_rem_pio2.two_over_pi.length === 198,
    'kf_rem_pio2.PIo2': data.kf_rem_pio2.PIo2.length === 11,
    'ef_asin.pio2_hi': data.ef_asin.pio2_hi,
    'ef_asin.qS4': data.ef_asin.qS4,
    'ef_acos.qS4': data.ef_acos.qS4,
    'sf_atan.aT': data.sf_atan.aT.length === 11,
    'ef_atan2.pi_lo': data.ef_atan2.pi_lo,
    'ef_log.Lg7': data.ef_log.Lg7,
    'ef_pow.ivln2_l': data.ef_pow.ivln2_l,
    'ef_pow.ovt': data.ef_pow.ovt,
    'ef_pow.dp_l': data.ef_pow.dp_l.length === 2,
};
for (const [name, value] of Object.entries(expect)) {
    if (value === undefined || value === false) throw new Error(`Не вдалося витягти ${name}`);
}

const body = [
    '// Згенеровано scripts/gen-libm.mjs із espressif/newlib-esp32 (esp-2021r2), libm/math і fdlibm.h. Не редагувати вручну.',
    '',
    '/** Константи fdlibm для float: скаляри й елементи float-масивів — біти IEEE 754 як int32. */',
    `export const NEWLIB = ${JSON.stringify(data, null, 4)} as const;`,
    '',
].join('\n');

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, body);
console.log(`✔ константи newlib → ${args.out}`);
