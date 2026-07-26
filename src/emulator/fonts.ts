/**
 * Реєстр шрифтів із відкладеним завантаженням.
 *
 * Дев'ять шрифтів разом — близько 183 КБ JSON. Тягнути їх усі одразу немає
 * сенсу: програма зазвичай користується одним-двома. Кожен файл окремий, тож
 * Vite розкладає їх у власні чанки, а `loadFont` підтягує потрібний на вимогу.
 */

import { fontFromJson, type Font, type FontJson } from './font.ts';

/**
 * Явна карта замість шаблонного шляху: Vite має бачити кожен import
 * статично, інакше чанки не створяться.
 */
const LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
    '4x6': () => import('../generated/fonts/4x6.json'),
    '5x7': () => import('../generated/fonts/5x7.json'),
    '5x8': () => import('../generated/fonts/5x8.json'),
    '6x12': () => import('../generated/fonts/6x12.json'),
    '6x13': () => import('../generated/fonts/6x13.json'),
    '7x13': () => import('../generated/fonts/7x13.json'),
    '8x13': () => import('../generated/fonts/8x13.json'),
    '9x15': () => import('../generated/fonts/9x15.json'),
    '10x20': () => import('../generated/fonts/10x20.json'),
};

export const FONT_NAMES = Object.keys(LOADERS);

const loaded = new Map<string, Font>();
const inFlight = new Map<string, Promise<Font>>();

/** Назви шрифтів такі самі, як приймає `display.set_font` у Lua. */
export async function loadFont(name: string): Promise<Font> {
    const ready = loaded.get(name);
    if (ready) return ready;

    const pending = inFlight.get(name);
    if (pending) return pending;

    const loader = LOADERS[name];
    if (!loader) {
        throw new Error(`Невідомий шрифт "${name}". Доступні: ${FONT_NAMES.join(', ')}`);
    }

    const promise = loader().then((module) => {
        const font = fontFromJson(module.default as FontJson);
        loaded.set(name, font);
        inFlight.delete(name);
        return font;
    });
    inFlight.set(name, promise);
    return promise;
}

/** Синхронний доступ до вже завантаженого шрифту. */
export function getLoadedFont(name: string): Font | null {
    return loaded.get(name) ?? null;
}

/**
 * Завантажує кілька шрифтів наперед. Знадобиться, коли з'явиться Lua:
 * `display.set_font` синхронний, тому очікувати завантаження в момент виклику
 * вже не буде можливості.
 */
export async function preloadFonts(names: readonly string[]): Promise<void> {
    await Promise.all(names.map((name) => loadFont(name)));
}

/**
 * Сирий JSON усіх шрифтів — потрібен рантайму Lua.
 *
 * `display.set_font` у Lua синхронний, тож воркер не може підвантажити шрифт
 * посеред кадру. Тому перед запуском програми в нього передаються всі дев'ять
 * одразу — це близько 183 КБ на весь сеанс.
 */
export async function loadAllFontJson(): Promise<Record<string, FontJson>> {
    const entries = await Promise.all(
        Object.entries(LOADERS).map(async ([name, load]) => {
            const module = await load();
            return [name, module.default as FontJson] as const;
        }),
    );
    return Object.fromEntries(entries);
}
