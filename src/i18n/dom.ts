/**
 * Прив'язка перекладу до статичних елементів.
 *
 * Більшість вмісту (меню, діалоги, рядки файлів) створюється заново під час
 * кожного власного перемальовування — воно й так читає `t()` наживо. Ці
 * хелпери потрібні лише елементам, створеним ОДИН раз при старті панелі:
 * без підписки на зміну мови такий текст лишився б у тій мові, у якій
 * сторінку відкрили.
 */

import { onLangChange } from './lang.ts';
import { t, type Key } from './strings.ts';

type Params = Record<string, string | number>;

function bind(update: () => void): void {
    update();
    onLangChange(update);
}

export function bindText(el: HTMLElement, key: Key, params?: Params): void {
    bind(() => {
        el.textContent = t(key, params);
    });
}

export function bindTitle(el: HTMLElement, key: Key, params?: Params): void {
    bind(() => {
        el.title = t(key, params);
    });
}

export function bindPlaceholder(el: HTMLInputElement, key: Key, params?: Params): void {
    bind(() => {
        el.placeholder = t(key, params);
    });
}
