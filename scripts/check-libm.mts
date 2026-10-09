/**
 * Перевірка float-математики проти значень, ЗНЯТИХ ЗІ СПРАВЖНЬОЇ ЛІЛКИ.
 *
 * Це не числа, виведені з коду, а вимір: scripts/fixtures/lilka-libm.json
 * надруковано самим залізом (див. поле source). Тому тут перевіряється збіг
 * до біта — саме він дає ті самі пікселі, коли координати рахуються через
 * math.sin/math.cos.
 *
 * Відомий виняток — pow: 54 із 60 значень збігаються, решта на 1 ulp інша.
 * Ні fdlibm powf, ні точне округлення цього не пояснюють; поріг нижче не дає
 * результату погіршитися, доки причину не знайдено (issues.md).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sinf, cosf, tanf, asinf, acosf, atanf, atan2f, logf, powf } from '../src/emulator/libm.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'scripts/fixtures/lilka-libm.json'), 'utf8'));
const f = Math.fround;

let fails = 0;
let total = 0;
const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));
const check = (name: string, expected: number, actual: number) => {
    total++;
    if (!same(expected, actual)) {
        if (fails < 10) console.log(`  ✖ ${name}: залізо ${expected}, емулятор ${actual}`);
        fails++;
    }
};

for (const [x, s, c, t] of data.trig) {
    check(`sin(${x})`, s, sinf(x));
    check(`cos(${x})`, c, cosf(x));
    check(`tan(${x})`, t, tanf(x));
}
for (const [x, as, ac, at] of data.inverse) {
    check(`asin(${x})`, as, asinf(x));
    check(`acos(${x})`, ac, acosf(x));
    check(`atan(${x} * 7)`, at, atanf(f(f(x) * 7)));
}
for (const [y, x, r] of data.atan2) check(`atan2(${y}, ${x})`, r, atan2f(y, x));
// log(x, b) у прошивці — logf(x) / logf(b) у float
for (const [x, ln, l2, l10] of data.log) {
    check(`log(${x})`, ln, logf(x));
    check(`log(${x}, 2)`, l2, f(logf(x) / logf(2)));
    check(`log(${x}, 10)`, l10, f(logf(x) / logf(10)));
}

let powSame = 0;
for (const [b, e, r] of data.pow) if (same(r, powf(b, e))) powSame++;
const POW_KNOWN = 54;
if (powSame < POW_KNOWN) {
    console.log(`  ✖ pow: збігається ${powSame} із ${data.pow.length}, було ${POW_KNOWN}`);
    fails++;
}

console.log(
    fails === 0
        ? `✔ float-математика: ${total} значень збігаються із залізом до біта, pow ${powSame}/${data.pow.length}`
        : `✖ float-математика: ${fails} розбіжностей із залізом`,
);
process.exit(fails ? 1 : 0);
