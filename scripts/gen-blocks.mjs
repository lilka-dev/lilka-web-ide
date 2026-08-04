#!/usr/bin/env node
/**
 * gen-blocks.mjs — робить визначення блоків Blockly з `lilka-api.json`.
 *
 * Написати блоки руками було б швидше один раз, але вони мовчки розійшлися б
 * з API при першій же зміні прошивки. Тому та сама логіка, що зі шрифтами й
 * таблицями: нічого про залізо руками.
 *
 * Береться не все підряд. Blockly має сенс для найпростіших дій — намалювати,
 * почитати кнопки, порахувати. Функції з дескрипторами, перетвореннями чи
 * файлами блоками не виражаються осмислено, тож у набір не входять.
 *
 *   node scripts/gen-blocks.mjs [--out src/generated/blocks.ts]
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const args = { spec: 'src/generated/lilka-api.json', out: 'src/generated/blocks.ts' };
for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--spec') args.spec = process.argv[++i];
    else if (process.argv[i] === '--out') args.out = process.argv[++i];
}

const spec = JSON.parse(await readFile(args.spec, 'utf8'));

/**
 * Що беремо в блоки, і в якій категорії воно опиняється.
 *
 * Перелік навмисно вручну: автоматично «усе з display» дало б і
 * `draw_image_transformed` із матрицею перетворення, якою блоками не покерувати.
 */
const CATEGORIES = [
    {
        id: 'draw',
        name: 'Малювання',
        colour: '#0e7c86',
        functions: [
            'display.fill_screen',
            'display.draw_pixel',
            'display.draw_line',
            'display.draw_rect',
            'display.fill_rect',
            'display.draw_circle',
            'display.fill_circle',
            'display.draw_triangle',
            'display.fill_triangle',
            'display.set_cursor',
            'display.set_text_color',
            'display.set_text_size',
            'display.color565',
        ],
    },
    {
        id: 'control',
        name: 'Кнопки',
        colour: '#f0a500',
        functions: [],
    },
    {
        id: 'sound',
        name: 'Звук',
        colour: '#7c6ba8',
        functions: ['buzzer.play', 'buzzer.stop'],
    },
    {
        id: 'math',
        name: 'Числа',
        colour: '#3f7d5b',
        functions: [
            'math.random',
            'math.clamp',
            'math.round',
            'math.floor',
            'math.abs',
            'math.min',
            'math.max',
            'math.dist',
        ],
    },
    {
        id: 'util',
        name: 'Інше',
        colour: '#5c7a6e',
        functions: ['util.sleep', 'util.time', 'util.exit'],
    },
];

/** Кнопки, які читає блок «натиснуто». */
const BUTTONS = [
    ['вгору', 'up'],
    ['вниз', 'down'],
    ['вліво', 'left'],
    ['вправо', 'right'],
    ['A', 'a'],
    ['B', 'b'],
    ['C', 'c'],
    ['D', 'd'],
    ['SELECT', 'select'],
    ['START', 'start'],
];

const COLORS = [
    ['чорний', 'black'],
    ['білий', 'white'],
    ['червоний', 'red'],
    ['зелений', 'green'],
    ['синій', 'blue'],
    ['блакитний', 'cyan'],
    ['рожевий', 'magenta'],
    ['жовтий', 'yellow'],
];

/** Український підпис для параметра. Порожній — просто назва як є. */
const LABELS = {
    x: 'x',
    y: 'y',
    r: 'радіус',
    rx: 'радіус x',
    ry: 'радіус y',
    w: 'ширина',
    h: 'висота',
    color: 'колір',
    sec: 'секунд',
    text: 'текст',
    size: 'розмір',
    frequency: 'частота',
    duration: 'тривалість',
};

function findFunction(qualified) {
    const [nsName, fnName] = qualified.split('.');
    const ns = spec.namespaces.find((item) => item.name === nsName);
    return ns?.functions.find((item) => item.name === fnName) ?? null;
}

const blocks = [];
const toolbox = [];

for (const category of CATEGORIES) {
    const entries = [];

    for (const qualified of category.functions) {
        const fn = findFunction(qualified);
        if (!fn) {
            console.warn(`⚠ немає в специфікації: ${qualified}`);
            continue;
        }

        const type = 'lilka_' + qualified.replace('.', '_');
        const returns = fn.returns.length > 0 && fn.returns[0].type !== 'nil';

        // Перший рядок — назва дії, далі по рядку на параметр
        const message = [fn.name.replace(/_/g, ' ')];
        const argsList = [];
        fn.params.forEach((param, index) => {
            message.push(`${LABELS[param.name] ?? param.name} %${index + 1}`);
            argsList.push({
                type: 'input_value',
                name: param.name.toUpperCase(),
                check: 'Number',
            });
        });

        /*
         * Тіньові значення в гніздах.
         *
         * Без них гніздо порожнє, і незрозуміло, що туди можна написати —
         * доводиться здогадуватись, що спершу треба перетягнути блок числа.
         * Тінь видно одразу, у ній можна друкувати, а якщо перетягнути щось
         * своє — вона зникає.
         *
         * Розумні значення за замовчуванням: координати посеред екрана,
         * радіус видимий, колір білий. Так перший запуск одразу щось показує.
         */
        const DEFAULTS = {
            x: 140, y: 120, x1: 40, y1: 40, x2: 240, y2: 200, x3: 140, y3: 40,
            r: 30, rx: 60, ry: 40, w: 80, h: 60,
            r1: 20, r2: 40, start_angle: 0, end_angle: 180,
            size: 2, sec: 1, frequency: 440, duration: 200,
        };

        const shadows = {};
        fn.params.forEach((param) => {
            const key = param.name.toUpperCase();
            if (param.name === 'color' || param.name === 'bg') {
                shadows[key] = { shadow: { type: 'lilka_color', fields: { COLOR: 'white' } } };
            } else {
                shadows[key] = {
                    shadow: { type: 'math_number', fields: { NUM: DEFAULTS[param.name] ?? 0 } },
                };
            }
        });

        blocks.push({
            type,
            call: qualified,
            params: fn.params.map((param) => param.name.toUpperCase()),
            returns,
            shadows,
            colour: category.colour,
            definition: {
                type,
                message0: message.join(' '),
                args0: argsList,
                ...(returns ? { output: 'Number' } : { previousStatement: null, nextStatement: null }),
                colour: category.colour,
                tooltip: (fn.summary || '').split('\n')[0],
            },
        });
        entries.push(type);
    }

    if (category.id === 'control') {
        /*
         * Подія «коли натиснули» замість трьох блоків.
         *
         * Раніше для реакції на кнопку треба було скласти «щокадру» + «якщо» +
         * «кнопку щойно натиснули». Це три дії там, де думка одна.
         */
        blocks.push({
            type: 'lilka_on_button',
            special: 'on_button',
            colour: category.colour,
            definition: {
                type: 'lilka_on_button',
                message0: 'коли натиснули %1 %2 %3',
                args0: [
                    { type: 'field_dropdown', name: 'BUTTON', options: BUTTONS },
                    { type: 'input_dummy' },
                    { type: 'input_statement', name: 'BODY' },
                ],
                colour: category.colour,
                tooltip: 'Виконується один раз на кожне натискання',
            },
        });
        entries.push('lilka_on_button');

        // Читання кнопок — не пряма функція, а зручний блок поверх get_state
        blocks.push({
            type: 'lilka_button_pressed',
            special: 'button_pressed',
            colour: category.colour,
            definition: {
                type: 'lilka_button_pressed',
                message0: 'кнопка %1 натиснута',
                args0: [{ type: 'field_dropdown', name: 'BUTTON', options: BUTTONS }],
                output: 'Boolean',
                colour: category.colour,
                tooltip: 'Чи натиснута кнопка зараз',
            },
        });
        blocks.push({
            type: 'lilka_button_just_pressed',
            special: 'button_just_pressed',
            colour: category.colour,
            definition: {
                type: 'lilka_button_just_pressed',
                message0: 'кнопку %1 щойно натиснули',
                args0: [{ type: 'field_dropdown', name: 'BUTTON', options: BUTTONS }],
                output: 'Boolean',
                colour: category.colour,
                tooltip: 'Спрацьовує один раз на натискання',
            },
        });
        entries.push('lilka_button_pressed', 'lilka_button_just_pressed');
    }

    if (category.id === 'draw') {
        blocks.push({
            type: 'lilka_color',
            special: 'color',
            colour: category.colour,
            definition: {
                type: 'lilka_color',
                message0: 'колір %1',
                args0: [{ type: 'field_dropdown', name: 'COLOR', options: COLORS }],
                output: 'Number',
                colour: category.colour,
                tooltip: 'Готовий колір',
            },
        });
        blocks.push({
            type: 'lilka_print',
            special: 'print',
            colour: category.colour,
            definition: {
                type: 'lilka_print',
                message0: 'написати %1',
                args0: [{ type: 'input_value', name: 'TEXT' }],
                previousStatement: null,
                nextStatement: null,
                colour: category.colour,
                tooltip: 'Виводить текст у позиції курсора',
            },
        });
        entries.push('lilka_color', 'lilka_print');
    }

    toolbox.push({ id: category.id, name: category.name, colour: category.colour, blocks: entries });
}

/**
 * Життєвий цикл — окрема категорія.
 *
 * Це не функції API, а місця, куди складають решту: те, що виконується раз на
 * початку, щокадру й при малюванні. Без них програма не запуститься.
 */
const LIFECYCLE = [
    ['lilka_init', 'на початку', 'lilka.init'],
    ['lilka_update', 'щокадру', 'lilka.update'],
    ['lilka_draw', 'малювати', 'lilka.draw'],
];

for (const [type, label, target] of LIFECYCLE) {
    blocks.push({
        type,
        special: 'lifecycle',
        target,
        colour: '#b5510b',
        definition: {
            type,
            message0: `${label} %1 %2`,
            args0: [
                { type: 'input_dummy' },
                { type: 'input_statement', name: 'BODY' },
            ],
            colour: '#b5510b',
            tooltip:
                target === 'lilka.update'
                    ? 'Виконується щокадру. Тут читають кнопки й рухають об\'єкти.'
                    : target === 'lilka.draw'
                      ? 'Виконується щокадру після оновлення. Тут малюють.'
                      : 'Виконується один раз перед стартом.',
        },
    });
}

toolbox.unshift({
    id: 'lifecycle',
    name: 'Програма',
    colour: '#b5510b',
    blocks: LIFECYCLE.map(([type]) => type),
});

const body =
    `// Згенеровано scripts/gen-blocks.mjs — не редагувати вручну.\n` +
    `// Джерело: src/generated/lilka-api.json (анотації прошивки).\n\n` +
    `export interface BlockSpec {\n` +
    `    type: string;\n` +
    `    /** Яку функцію API викликає блок. */\n` +
    `    call?: string;\n` +
    `    /** Імена вхідних значень у порядку аргументів. */\n` +
    `    params?: string[];\n` +
    `    /** true — блок повертає значення, false — це дія. */\n` +
    `    returns?: boolean;\n` +
    `    /** Особливі блоки з власним генератором коду. */\n` +
    `    special?: string;\n` +
    `    /** Тіньові значення в гніздах: видно одразу, можна друкувати. */\n` +
    `    shadows?: Record<string, unknown>;\n` +
    `    target?: string;\n` +
    `    colour: string;\n` +
    `    definition: Record<string, unknown>;\n` +
    `}\n\n` +
    `export interface ToolboxCategory {\n` +
    `    id: string;\n` +
    `    name: string;\n` +
    `    colour: string;\n` +
    `    blocks: string[];\n` +
    `}\n\n` +
    `export const BLOCKS: readonly BlockSpec[] = ${JSON.stringify(blocks, null, 0)};\n\n` +
    `export const TOOLBOX: readonly ToolboxCategory[] = ${JSON.stringify(toolbox, null, 0)};\n`;

await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, body, 'utf8');

console.log(`✔ ${args.out}: ${blocks.length} блоків у ${toolbox.length} категоріях`);
