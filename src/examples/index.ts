/**
 * Вбудовані приклади.
 *
 * Це справжні програми, написані для заліза, а не спрощені демонстрації.
 * Якщо приклад перестав запускатися — це помилка емулятора, а не приклада.
 */

import dice from './dice.lua?raw';
import circle from './circle.lua?raw';
import simon from './simon.lua?raw';

export interface Example {
    id: string;
    title: string;
    code: string;
}

export const EXAMPLES: Example[] = [
    { id: 'circle', title: 'Коло та кнопки', code: circle },
    { id: 'dice', title: 'Гра «Кубики»', code: dice },
    { id: 'simon', title: 'Повтори комбінацію', code: simon },
];
