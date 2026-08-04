/**
 * Блоковий редактор.
 *
 * Blockly сам робить головне: тягання, перевірку сумісності й перетворення на
 * код. Наша частина — блоки для API Лілки, і вони **згенеровані** з
 * `lilka-api.json`, а не написані руками: інакше розійшлися б з API при першій
 * же зміні прошивки.
 *
 * Блоки й код — два різні файли: `гра.blocks` і згенерований `гра.lua`.
 * Blockly не вміє перетворювати код назад у блоки, тож якби вони жили в одному
 * файлі, правка коду руками мовчки знищила б блоки.
 */

import * as Blockly from 'blockly/core';
import { luaGenerator, Order } from 'blockly/lua';
import * as Uk from 'blockly/msg/uk';
import 'blockly/blocks';
import { BLOCKS, TOOLBOX } from '../generated/blocks.ts';

Blockly.setLocale(Uk as unknown as Record<string, string>);

/** Реєструє наші блоки та їхні генератори коду. Виконується один раз. */
let registered = false;

function registerBlocks(): void {
    if (registered) return;
    registered = true;

    Blockly.defineBlocksWithJsonArray(BLOCKS.map((block) => block.definition));

    for (const block of BLOCKS) {
        // Життєвий цикл: тіло блока стає тілом функції
        if (block.special === 'lifecycle') {
            luaGenerator.forBlock[block.type] = (b) => {
                const body = luaGenerator.statementToCode(b, 'BODY') || '';
                return `function ${block.target}(delta)\n${body}end\n\n`;
            };
            continue;
        }

        if (block.special === 'button_pressed' || block.special === 'button_just_pressed') {
            const field = block.special === 'button_pressed' ? 'pressed' : 'just_pressed';
            luaGenerator.forBlock[block.type] = (b) => {
                const name = b.getFieldValue('BUTTON');
                // Стан читається один раз на кадр і кладеться у змінну: інакше
                // кожен блок робив би власний виклик, а `just_pressed`
                // скидається при читанні й спрацював би лише в першому
                return [`__keys.${name}.${field}`, Order.ATOMIC];
            };
            continue;
        }

        if (block.special === 'color') {
            luaGenerator.forBlock[block.type] = (b) => [
                `colors.${b.getFieldValue('COLOR')}`,
                Order.ATOMIC,
            ];
            continue;
        }

        if (block.special === 'print') {
            luaGenerator.forBlock[block.type] = (b) => {
                const text = luaGenerator.valueToCode(b, 'TEXT', Order.NONE) || '""';
                return `display.print(${text})\n`;
            };
            continue;
        }

        // Звичайний виклик функції API
        luaGenerator.forBlock[block.type] = (b) => {
            const args = (block.params ?? []).map(
                (name) => luaGenerator.valueToCode(b, name, Order.NONE) || '0',
            );
            const call = `${block.call}(${args.join(', ')})`;
            return block.returns ? [call, Order.ATOMIC] : call + '\n';
        };
    }
}

/** Будує XML панелі блоків із згенерованих категорій. */
function toolboxXml(): string {
    const categories = TOOLBOX.map((category) => {
        const blocks = category.blocks.map((type) => `<block type="${type}"></block>`).join('');
        return `<category name="${category.name}" colour="${category.colour}">${blocks}</category>`;
    });

    // Стандартні блоки Blockly: умови, цикли, змінні, числа й текст.
    // Без них не скласти навіть найпростішої гри.
    const standard = `
        <category name="Логіка" colour="#5b80a5">
            <block type="controls_if"></block>
            <block type="logic_compare"></block>
            <block type="logic_operation"></block>
            <block type="logic_negate"></block>
            <block type="logic_boolean"></block>
        </category>
        <category name="Цикли" colour="#5ba55b">
            <block type="controls_repeat_ext"><value name="TIMES"><shadow type="math_number"><field name="NUM">10</field></shadow></value></block>
            <block type="controls_whileUntil"></block>
            <block type="controls_for"><value name="FROM"><shadow type="math_number"><field name="NUM">1</field></shadow></value><value name="TO"><shadow type="math_number"><field name="NUM">10</field></shadow></value><value name="BY"><shadow type="math_number"><field name="NUM">1</field></shadow></value></block>
        </category>
        <category name="Числа й текст" colour="#5b67a5">
            <block type="math_number"><field name="NUM">0</field></block>
            <block type="math_arithmetic"></block>
            <block type="text"></block>
            <block type="text_join"></block>
        </category>
        <category name="Змінні" colour="#a55b80" custom="VARIABLE"></category>
    `;

    return `<xml>${categories.join('')}${standard}</xml>`;
}

export interface BlocklyEditor {
    dom: HTMLElement;
    /** Lua-код із блоків. */
    toLua(): string;
    /** Стан блоків для збереження у файл. */
    save(): string;
    load(text: string): void;
    /** Перерахунок після зміни розміру панелі. */
    resize(): void;
    dispose(): void;
}

export function createBlocklyEditor(options: { onChange: () => void }): BlocklyEditor {
    registerBlocks();

    const dom = document.createElement('div');
    dom.className = 'blockly';

    const workspace = Blockly.inject(dom, {
        toolbox: toolboxXml(),
        grid: { spacing: 22, length: 3, colour: '#e4ede8', snap: true },
        zoom: { controls: true, wheel: true, startScale: 0.9, minScale: 0.4, maxScale: 1.6 },
        trashcan: true,
        renderer: 'zelos',
        theme: Blockly.Theme.defineTheme('lilka', {
            name: 'lilka',
            base: Blockly.Themes.Zelos,
            componentStyles: {
                workspaceBackgroundColour: '#fbfdfc',
                toolboxBackgroundColour: '#f2f7f4',
                flyoutBackgroundColour: '#eef4f1',
                scrollbarColour: '#c3d4cc',
            },
        }),
    });

    workspace.addChangeListener((event) => {
        // Перетягування й вибір коду не міняють, тож зайвого збереження не треба
        if (event.isUiEvent) return;
        options.onChange();
    });

    return {
        dom,

        toLua() {
            const body = luaGenerator.workspaceToCode(workspace);
            if (!body.trim()) return '';

            /*
             * Стан кнопок читається ОДИН раз на кадр.
             *
             * `just_pressed` у прошивці скидається при читанні. Якби кожен
             * блок робив власний `controller.get_state()`, спрацював би лише
             * перший, а решта мовчки не працювала б.
             */
            const needsKeys = body.includes('__keys');
            const header =
                '-- Згенеровано з блоків. Правки тут зникнуть при наступній зміні блоків.\n\n';

            if (!needsKeys) return header + body;

            return (
                header +
                'local __keys = controller.get_state()\n\n' +
                body.replace(
                    /function lilka\.update\(delta\)\n/,
                    'function lilka.update(delta)\n    __keys = controller.get_state()\n',
                )
            );
        },

        save: () => JSON.stringify(Blockly.serialization.workspaces.save(workspace)),

        load(text) {
            if (!text.trim()) return;
            try {
                Blockly.serialization.workspaces.load(JSON.parse(text), workspace);
            } catch {
                // Пошкоджений файл блоків — краще порожнє поле, ніж падіння
                workspace.clear();
            }
        },

        resize: () => Blockly.svgResize(workspace),
        dispose: () => workspace.dispose(),
    };
}
