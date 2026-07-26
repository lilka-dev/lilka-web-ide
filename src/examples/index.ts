/**
 * Вбудовані приклади.
 *
 * Це справжні програми, написані для заліза, а не спрощені демонстрації.
 * Якщо приклад перестав запускатися — це помилка емулятора, а не приклада.
 */

import dice from './dice.lua?raw';
import catCode from './cat/cat.lua?raw';
import catBoth from './cat/both.bmp?url';
import catLeft from './cat/left.bmp?url';
import catNo from './cat/no.bmp?url';
import catRight from './cat/right.bmp?url';
import circle from './circle.lua?raw';
import simon from './simon.lua?raw';

export interface Example {
    id: string;
    title: string;
    code: string;
    /**
     * Тека, у яку приклад «встановлюється» у віртуальну карту. Від неї
     * рахуються відносні шляхи в `resources.load_image`.
     */
    dir?: string;
    /** Супутні файли: шлях у карті -> адреса ресурсу. Вантажаться на вимогу. */
    assets?: Record<string, string>;
}

export const EXAMPLES: Example[] = [
    { id: 'circle', title: 'Коло та кнопки', code: circle },
    { id: 'dice', title: 'Гра «Кубики»', code: dice },
    { id: 'simon', title: 'Повтори комбінацію', code: simon },
    {
        id: 'cat',
        title: 'Кіт (із картинками)',
        code: catCode,
        dir: '/sd/examples/cat',
        assets: {
            'both.bmp': catBoth,
            'left.bmp': catLeft,
            'no.bmp': catNo,
            'right.bmp': catRight,
        },
    },
];
