/**
 * Консоль Лілки — розмова з пристроєм по одному рядку.
 *
 * Займає місце звичайної консолі середовища: двох консолей поруч бути не має,
 * це лише плутало б.
 *
 * Важливе обмеження прошивки: повертається **лише те, що програма надрукувала
 * через `print`**. Вираз сам по собі нічого не покаже — тому всі підказки тут
 * саме з `print`, щоб звичка склалася правильна.
 */

import { t, bindText, bindTitle, bindPlaceholder, onLangChange } from '../i18n/index.ts';


/** Готові приклади для порожнього екрана. Перший показує сам принцип. */
const HINTS = [
    'print(3 + 4)',
    'display.fill_screen(colors.red)',
    'print(util.free_ram())',
];

/**
 * Команди, які нічого не друкують, але щось роблять.
 *
 * Без підпису після них не було б жодної відповіді, і здавалося б, що не
 * спрацювало.
 */
const SILENT_HINTS: Array<[RegExp, () => string]> = [
    [/^display\.fill_screen/, () => t('console.silentFillScreen')],
    [/^display\./, () => t('console.silentDisplay')],
    [/^buzzer\./, () => t('console.silentBuzzer')],
    [/^util\.sleep/, () => t('console.silentSleep')],
];

export interface ConsolePanel {
    root: HTMLElement;
    /** Рядок, що надійшов від Лілки. */
    addOutput(text: string): void;
    setState(state: 'ready' | 'silent'): void;
    onCommand(handler: (line: string) => void): void;
    onClose(handler: () => void): void;
    focus(): void;
}

export function createConsolePanel(): ConsolePanel {
    const root = document.createElement('section');
    root.className = 'repl';

    // --- шапка
    const head = document.createElement('div');
    head.className = 'repl__head';

    const title = document.createElement('span');
    title.className = 'repl__title';
    bindText(title, 'console.title');

    const badge = document.createElement('span');
    badge.className = 'repl__badge';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'repl__icon';
    clear.textContent = '⌫';
    bindTitle(clear, 'console.clear');

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'repl__icon';
    close.textContent = '×';
    bindTitle(close, 'console.close');

    head.append(title, badge, clear, close);

    // --- вивід
    const log = document.createElement('div');
    log.className = 'repl__log';

    // --- рядок введення
    const inputRow = document.createElement('div');
    inputRow.className = 'repl__input-row';

    const caret = document.createElement('span');
    caret.className = 'repl__caret';
    caret.textContent = '›';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'repl__input';
    bindPlaceholder(input, 'console.placeholder');
    input.spellcheck = false;

    const tip = document.createElement('span');
    tip.className = 'repl__tip';
    bindText(tip, 'console.tip');

    inputRow.append(caret, input, tip);
    root.append(head, log, inputRow);

    let commandHandler: (line: string) => void = () => {};
    let closeHandler: () => void = () => {};
    let lastState: 'ready' | 'silent' = 'silent';

    /** Історія команд: стрілки повертають попередні. */
    const history: string[] = [];
    let historyAt = -1;

    function line(className: string, text: string): HTMLElement {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = text;
        log.append(element);
        log.scrollTop = log.scrollHeight;
        return element;
    }

    /** Чи зараз у логу лише вступні підказки — щоб знати, чи можна їх оновити. */
    let showingHints = false;

    function showHints(): void {
        showingHints = true;
        log.textContent = '';
        line('repl__note', t('console.hint1'));
        line('repl__note repl__note--dim', t('console.hint2'));

        const row = document.createElement('div');
        row.className = 'repl__hints';
        for (const hint of HINTS) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'repl__hint';
            chip.textContent = hint;
            chip.addEventListener('click', () => {
                input.value = hint;
                input.focus();
            });
            row.append(chip);
        }
        log.append(row);
    }

    function submit(): void {
        const text = input.value.trim();
        if (!text) return;

        showingHints = false;
        line('repl__command', '› ' + text);
        history.push(text);
        historyAt = history.length;
        input.value = '';

        // Команда без `print` нічого не поверне — підписуємо, що вона зробила
        if (!text.includes('print')) {
            const hint = SILENT_HINTS.find(([pattern]) => pattern.test(text));
            if (hint) line('repl__silent', hint[1]());
        }

        commandHandler(text);
    }

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submit();
            return;
        }
        if (event.key === 'ArrowUp' && history.length) {
            event.preventDefault();
            historyAt = Math.max(0, historyAt - 1);
            input.value = history[historyAt] ?? '';
        }
        if (event.key === 'ArrowDown' && history.length) {
            event.preventDefault();
            historyAt = Math.min(history.length, historyAt + 1);
            input.value = history[historyAt] ?? '';
        }
    });

    /**
     * Стан «мовчить» — найважливіший.
     *
     * Консоль працює лише коли на самій Лілці відкрито «Розробка → Lua
     * REPL». Це неочевидно, і без підказки людина сиділа б і не розуміла,
     * чому нічого не відбувається.
     */
    let stateApplied = false;
    function applyState(state: 'ready' | 'silent'): void {
        stateApplied = true;
        lastState = state;
        const ready = state === 'ready';
        badge.textContent = t(ready ? 'console.ready' : 'console.silent');
        badge.className = ready ? 'repl__badge repl__badge--ready' : 'repl__badge repl__badge--silent';
        input.disabled = !ready;
        inputRow.classList.toggle('repl__input-row--off', !ready);

        const existing = root.querySelector('.repl__warning');
        existing?.remove();

        if (!ready) {
            const warning = document.createElement('div');
            warning.className = 'repl__warning';
            warning.innerHTML =
                t('console.warning') + `<div class="repl__warning-note">${t('console.warningNote')}</div>`;
            log.after(warning);
        }
    }

    clear.addEventListener('click', showHints);
    close.addEventListener('click', () => closeHandler());

    showHints();

    // Статичні заголовки прив'язані через bindText/bindTitle вище; це —
    // динамічний вміст, який inline-виклики `t()` не оновлюють самі, бо
    // перемальовується не щоразу, а лише за подією (клік, відповідь Лілки)
    onLangChange(() => {
        if (showingHints) showHints();
        if (stateApplied) applyState(lastState);
    });

    return {
        root,

        addOutput(text) {
            const trimmed = text.trimEnd();
            if (!trimmed) return;
            showingHints = false;
            // Помилки Lua впізнаються за характерними словами
            const isError = /error|attempt to|nil value|near '/.test(trimmed);
            line(isError ? 'repl__error' : 'repl__output', trimmed);
        },

        setState: applyState,

        onCommand: (handler) => {
            commandHandler = handler;
        },
        onClose: (handler) => {
            closeHandler = handler;
        },
        focus: () => input.focus(),
    };
}
