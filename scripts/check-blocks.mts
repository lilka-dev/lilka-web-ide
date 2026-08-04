/**
 * Перевірки блоків.
 *
 * Блоки згенеровані з анотацій прошивки, тож головне — щоб вони не
 * розходилися з дійсністю: викликали справжні функції зі справжньою кількістю
 * аргументів.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOCKS, TOOLBOX } from '../src/generated/blocks.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'src/generated/lilka-api.json'), 'utf8'));

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

/** Знаходить функцію в специфікації прошивки. */
function findFunction(qualified: string) {
    const [nsName, fnName] = qualified.split('.');
    const ns = spec.namespaces.find((item: { name: string }) => item.name === nsName);
    return ns?.functions.find((item: { name: string }) => item.name === fnName) ?? null;
}

// 1. Кожен блок-виклик посилається на СПРАВЖНЮ функцію API.
//    Це головна перевірка: якщо прошивка перейменує функцію, блок мовчки
//    генерував би код, який не працює.
for (const block of BLOCKS) {
    if (!block.call) continue;
    const fn = findFunction(block.call);
    ok(fn !== null, `${block.type}: функція ${block.call} існує в API`);
    if (!fn) continue;

    ok(
        (block.params?.length ?? 0) === fn.params.length,
        `${block.call}: ${block.params?.length} аргументів у блоці проти ${fn.params.length} в API`,
    );
}

// 2. Життєвий цикл на місці — без нього програма не запуститься
for (const type of ['lilka_init', 'lilka_update', 'lilka_draw']) {
    const block = BLOCKS.find((item) => item.type === type);
    ok(block !== undefined, `є блок ${type}`);
    ok(block?.special === 'lifecycle', `${type} — блок життєвого циклу`);
}

// 3. Кнопки: обидва різновиди й усі десять кнопок
const pressed = BLOCKS.find((item) => item.special === 'button_pressed');
const justPressed = BLOCKS.find((item) => item.special === 'button_just_pressed');
ok(pressed !== undefined && justPressed !== undefined, 'є блоки «натиснута» і «щойно натиснули»');

const options = (pressed?.definition as { args0?: Array<{ options?: string[][] }> })?.args0?.[0]?.options;
ok(options?.length === 10, `десять кнопок у списку, знайдено ${options?.length}`);

// 4. Кожен блок із панелі справді визначений — інакше панель показала б порожнє місце
const known = new Set(BLOCKS.map((item) => item.type));
const standard = new Set([
    'controls_if', 'logic_compare', 'logic_operation', 'logic_negate', 'logic_boolean',
    'controls_repeat_ext', 'controls_whileUntil', 'controls_for',
    'math_number', 'math_arithmetic', 'text', 'text_join',
]);
for (const category of TOOLBOX) {
    for (const type of category.blocks) {
        ok(known.has(type) || standard.has(type), `блок ${type} із категорії «${category.name}» визначений`);
    }
}

// 5. Блоки, що повертають значення, не можуть бути діями, і навпаки
for (const block of BLOCKS) {
    if (!block.call) continue;
    const fn = findFunction(block.call);
    const apiReturns = fn.returns.length > 0 && fn.returns[0].type !== 'nil';
    ok(
        block.returns === apiReturns,
        `${block.call}: блок ${block.returns ? 'повертає значення' : 'дія'}, API каже інакше`,
    );
}

// 6. Категорій достатньо, і кожна не порожня
ok(TOOLBOX.length >= 5, `категорій ${TOOLBOX.length}`);
for (const category of TOOLBOX) {
    ok(category.blocks.length > 0, `категорія «${category.name}» не порожня`);
}

console.log(
    fails === 0
        ? `✔ блоки: усі перевірки пройдено (${BLOCKS.length} блоків)`
        : `✖ блоки: ${fails} перевірок не пройдено`,
);
process.exit(fails ? 1 : 0);
