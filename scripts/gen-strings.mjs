#!/usr/bin/env node
/**
 * gen-strings.mjs — витягує тексти помилок Lua-прив'язок із
 * `keira/src/keira/localizations/lang_uk.h`.
 *
 * Прошивка кидає помилки через `luaL_error(L, K_S_LUA_..., n)`, і скрипт, який
 * ловить їх через pcall, бачить саме ці рядки. Якщо в емуляторі текст інший,
 * програма, що порівнює повідомлення, поводиться в браузері не так, як на
 * залізі. Тому рядки беруться з первотвору, а не переписуються руками.
 *
 * Береться українська локалізація: це мова збірки Keira за замовчуванням
 * (перша в languages.txt).
 *
 *   node scripts/gen-strings.mjs [--src lang_uk.h] [--out src/generated/firmware-strings.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const URL_LANG = 'https://raw.githubusercontent.com/lilka-dev/keira/main/src/keira/localizations/lang_uk.h';

function parseArgs(argv) {
    const args = { src: null, out: 'src/generated/firmware-strings.ts' };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--src') args.src = argv[++i];
        else if (argv[i] === '--out') args.out = argv[++i];
        else if (argv[i] === '--help') {
            console.log('usage: gen-strings.mjs [--src lang_uk.h] [--out FILE]');
            process.exit(0);
        } else throw new Error(`Невідомий аргумент: ${argv[i]}`);
    }
    return args;
}

async function load(src) {
    if (src) return readFile(src, 'utf8');
    const res = await fetch(URL_LANG);
    if (!res.ok) throw new Error(`Не вдалося завантажити ${URL_LANG}: ${res.status}`);
    return res.text();
}

const args = parseArgs(process.argv.slice(2));
const source = await load(args.src);

const strings = {};
// Лише рядкові макроси Lua-прив'язок: #define K_S_LUA_NAME "текст"
const re = /^#define\s+K_S_LUA_(\w+)\s+"((?:[^"\\]|\\.)*)"\s*$/gm;
for (let m; (m = re.exec(source)); ) {
    strings[m[1]] = JSON.parse(`"${m[2]}"`);
}
if (Object.keys(strings).length < 20) {
    throw new Error(`Знайдено підозріло мало рядків: ${Object.keys(strings).length}`);
}

const body = [
    '// Згенеровано scripts/gen-strings.mjs із keira lang_uk.h. Не редагувати вручну.',
    '',
    '/** Тексти luaL_error прошивки, ключ — назва макросу без префікса K_S_LUA_. */',
    `export const FIRMWARE_STRINGS: Record<string, string> = ${JSON.stringify(strings, null, 4)};`,
    '',
].join('\n');

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, body);
console.log(`✔ ${Object.keys(strings).length} рядків → ${args.out}`);
