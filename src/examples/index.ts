/**
 * Вбудовані приклади.
 *
 * Це справжні програми, написані для заліза, а не спрощені демонстрації.
 * Якщо приклад перестав запускатися — це помилка емулятора, а не приклада.
 */

import dice from './dice.lua?raw';
import catCode from './cat/cat.lua?raw';
import asteroidsCode from './asteroids/asteroids.lua?raw';
import catBoth from './cat/both.bmp?url';
import catLeft from './cat/left.bmp?url';
import catNo from './cat/no.bmp?url';
import catRight from './cat/right.bmp?url';
import circle from './circle.lua?raw';
import simon from './simon.lua?raw';
import snake from './snake/snake.lua?raw';
import type { Key } from '../i18n/strings.ts';

export interface Example {
    id: string;
    /** Назва — рядок словника, а не текст: показується в обох мовах середовища. */
    titleKey: Key;
    code: string;
    /**
     * Ім'я головного файлу.
     *
     * Раніше всі приклади звалися `main.lua`, і в менеджері було не розібрати,
     * де що. Прошивці однаково, як зветься файл, тож кожен приклад має власне
     * ім'я.
     */
    file?: string;
    /**
     * Тека, у яку приклад «встановлюється» у віртуальну карту. Від неї
     * рахуються відносні шляхи в `resources.load_image`.
     */
    dir?: string;
    /** Супутні файли: шлях у карті -> адреса ресурсу. Вантажаться на вимогу. */
    assets?: Record<string, string>;
    /**
     * Ресурси, зібрані автоматично з підтек. Зручніше за ручний перелік, коли
     * файлів багато: астероїди мають чотири модулі й шістнадцять ресурсів.
     */
    assetGlob?: Record<string, string>;
    assetBase?: string;
}

/** Зводить обидва способи опису ресурсів до одного вигляду. */
export function exampleAssets(example: Example): Record<string, string> {
    if (example.assets) return example.assets;
    if (!example.assetGlob || !example.assetBase) return {};

    const out: Record<string, string> = {};
    for (const [path, url] of Object.entries(example.assetGlob)) {
        out[path.slice(example.assetBase.length)] = url;
    }
    return out;
}

export const EXAMPLES: Example[] = [
    { id: 'circle', titleKey: 'example.circle', code: circle, file: 'circle.lua' },
    { id: 'dice', titleKey: 'example.dice', code: dice, file: 'dice.lua' },
    { id: 'simon', titleKey: 'example.simon', code: simon, file: 'repeat.lua' },
    { id: 'snake', titleKey: 'example.snake', code: snake, file: 'snake.lua' },
    {
        id: 'asteroids',
        titleKey: 'example.asteroids',
        code: asteroidsCode,
        file: 'asteroids.lua',
        dir: '/sd/Examples/asteroids',
        // Ресурси беруться цілою текою: у грі є і модулі, і картинки, і звук
        assetGlob: import.meta.glob('./asteroids/{modules,resources}/*', {
            query: '?url',
            import: 'default',
            eager: true,
        }) as Record<string, string>,
        assetBase: './asteroids/',
    },
    {
        id: 'cat',
        titleKey: 'example.cat',
        code: catCode,
        file: 'cat.lua',
        dir: '/sd/Examples/cat',
        assets: {
            'both.bmp': catBoth,
            'left.bmp': catLeft,
            'no.bmp': catNo,
            'right.bmp': catRight,
        },
    },
];
