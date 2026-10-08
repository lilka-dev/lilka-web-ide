/**
 * Смуга з помилкою програми під пристроєм.
 *
 * Консоль стоїть у колонці коду й легко гортається вниз — тоді помилка
 * лишається непоміченою, а пристрій просто завмирає. Смуга під екраном
 * показує останню помилку там, куди дивляться під час запуску.
 *
 * Тримає лише останнє повідомлення: перше зазвичай причина, але Lua зупиняє
 * виконання на першій же помилці, тож друге на практиці не з'являється.
 */

import { t, bindText, onLangChange } from '../i18n/index.ts';

export interface ErrorBar {
    root: HTMLElement;
    show(message: string): void;
    clear(): void;
}

export function createErrorBar(onGoToLine: (line: number) => void): ErrorBar {
    const root = document.createElement('div');
    root.className = 'error-bar';
    root.setAttribute('role', 'alert');
    root.hidden = true;

    const head = document.createElement('div');
    head.className = 'error-bar__head';

    const title = document.createElement('span');
    title.className = 'error-bar__title';
    bindText(title, 'errorBar.title');

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'error-bar__jump';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'error-bar__close';
    close.textContent = '×';
    close.setAttribute('aria-label', t('errorBar.dismiss'));
    onLangChange(() => close.setAttribute('aria-label', t('errorBar.dismiss')));

    head.append(title, jump, close);

    const text = document.createElement('pre');
    text.className = 'error-bar__text';

    root.append(head, text);

    let line: number | null = null;
    const drawJump = () => {
        jump.hidden = line === null;
        if (line !== null) jump.textContent = t('editor.goToLine', { n: line });
    };
    onLangChange(drawJump);

    jump.addEventListener('click', () => {
        if (line !== null) onGoToLine(line);
    });

    function clear(): void {
        root.hidden = true;
        text.textContent = '';
        line = null;
    }
    close.addEventListener('click', clear);

    return {
        root,
        show(message) {
            text.textContent = message;
            // Той самий розбір, що й у консолі: Lua пише `файл:рядок: опис`
            const at = /:(\d+):/.exec(message);
            line = at ? Number(at[1]) : null;
            drawJump();
            root.hidden = false;
        },
        clear,
    };
}
