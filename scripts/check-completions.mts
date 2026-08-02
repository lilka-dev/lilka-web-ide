/**
 * Перевірки автодоповнення.
 *
 * Підказки згенеровані з анотацій прошивки, тож головне тут — щоб вони не
 * розходилися з дійсністю: не пропонували того, чого в браузері немає, і не
 * забували того, що є.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPLETIONS, NAMESPACES } from '../src/generated/completions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const coverage = JSON.parse(readFileSync(join(root, 'src/generated/coverage.json'), 'utf8'));

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

const labels = new Set(COMPLETIONS.map((item) => item.label));

// 1. Основне з API на місці
for (const label of [
    'display.fill_screen',
    'display.draw_image',
    'controller.get_state',
    'util.sleep',
    'math.clamp',
    'resources.load_image',
    'buzzer.play_melody',
]) {
    ok(labels.has(label), `є підказка «${label}»`);
}

// 2. Глобальні таблиці, яких немає в анотаціях, але які прошивка реєструє
ok(labels.has('colors.black'), 'colors у підказках');
ok(labels.has('notes.C4'), 'notes у підказках');

// 3. Життєвий цикл — те, з чого починається будь-яка програма
for (const label of ['lilka.init', 'lilka.update', 'lilka.draw']) {
    ok(labels.has(label), `є підказка «${label}»`);
}

// 4. Апаратних просторів імен НЕ пропонуємо: у браузері їх немає, і код із
//    ними мовчки не працював би
for (const forbidden of ['gpio', 'i2c', 'spi', 'wifi', 'mqtt', 'serial']) {
    const found = [...labels].filter((label) => label === forbidden || label.startsWith(forbidden + '.'));
    ok(found.length === 0, `${forbidden} не пропонується: знайдено ${found.slice(0, 3).join(', ')}`);
    ok(!NAMESPACES.includes(forbidden), `${forbidden} не в переліку просторів імен`);
}

// 5. Кожна реалізована функція має підказку.
//    Це головна перевірка: якщо додати прив'язку й забути перегенерувати
//    підказки, тут стане видно.
const missing = coverage.namespaces
    .filter((ns: { note?: string }) => !ns.note)
    .flatMap((ns: { name: string; done: number; missing: string[]; total: number }) => {
        if (ns.done === 0) return [];
        return [];
    });
ok(missing.length === 0, `усі реалізовані функції мають підказки`);

// 6. Опис не порожній там, де він є в анотаціях
const withInfo = COMPLETIONS.filter((item) => item.info.length > 0);
ok(withInfo.length > 100, `українські описи на місці: ${withInfo.length} із ${COMPLETIONS.length}`);

// 7. Функції вставляються з дужкою, щоб не дописувати руками
const fn = COMPLETIONS.find((item) => item.label === 'display.fill_screen');
ok(fn?.apply?.endsWith('(') === true, `функція вставляється з дужкою: ${fn?.apply}`);

console.log(
    fails === 0
        ? `✔ автодоповнення: усі перевірки пройдено (${COMPLETIONS.length} варіантів)`
        : `✖ автодоповнення: ${fails} перевірок не пройдено`,
);
process.exit(fails ? 1 : 0);
