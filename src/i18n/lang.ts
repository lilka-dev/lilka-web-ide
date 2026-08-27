/**
 * Мова інтерфейсу.
 *
 * Стан лише в пам'яті: перемикач діє до перезавантаження сторінки, а тоді
 * знову визначається з `navigator.language`. Це свідомо, а не «руки не
 * дійшли» — localStorage/sessionStorage для стану застосунку тут не
 * використовуються (див. CLAUDE.md), доки не з'явиться власний шар
 * віртуальної файлової системи для налаштувань.
 */
export type Lang = 'en' | 'uk';

function detect(): Lang {
    if (typeof navigator === 'undefined') return 'en';
    return navigator.language.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

let current: Lang = detect();
const listeners = new Set<() => void>();

export function getLang(): Lang {
    return current;
}

export function setLang(lang: Lang): void {
    if (lang === current) return;
    current = lang;
    for (const fn of listeners) fn();
}

/**
 * Підписка на зміну мови.
 *
 * Більшість динамічного вмісту (меню, діалоги, рядки файлів) і так
 * перечитує `t()` під час кожного власного перемальовування — підписка
 * потрібна лише статичним елементам, створеним один раз при старті.
 */
export function onLangChange(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
