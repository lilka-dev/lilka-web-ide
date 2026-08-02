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
const SILENT_HINTS: Array<[RegExp, string]> = [
    [/^display\.fill_screen/, 'екран Лілки залито кольором'],
    [/^display\./, 'намальовано на екрані Лілки'],
    [/^buzzer\./, 'звук на Лілці'],
    [/^util\.sleep/, 'пауза'],
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
    title.textContent = 'Спробувати команду';

    const badge = document.createElement('span');
    badge.className = 'repl__badge';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'repl__icon';
    clear.textContent = '⌫';
    clear.title = 'Очистити';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'repl__icon';
    close.textContent = '×';
    close.title = 'Закрити';

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
    input.placeholder = 'команда для Лілки…';
    input.spellcheck = false;

    const tip = document.createElement('span');
    tip.className = 'repl__tip';
    tip.textContent = 'Enter — виконати';

    inputRow.append(caret, input, tip);
    root.append(head, log, inputRow);

    let commandHandler: (line: string) => void = () => {};
    let closeHandler: () => void = () => {};

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

    function showHints(): void {
        log.textContent = '';
        line('repl__note', 'Пишіть по одному рядку — Лілка виконає його одразу.');
        line('repl__note repl__note--dim', 'Спробуйте:');

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

        line('repl__command', '› ' + text);
        history.push(text);
        historyAt = history.length;
        input.value = '';

        // Команда без `print` нічого не поверне — підписуємо, що вона зробила
        if (!text.includes('print')) {
            const hint = SILENT_HINTS.find(([pattern]) => pattern.test(text));
            if (hint) line('repl__silent', hint[1]);
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

    clear.addEventListener('click', showHints);
    close.addEventListener('click', () => closeHandler());

    showHints();

    return {
        root,

        addOutput(text) {
            const trimmed = text.trimEnd();
            if (!trimmed) return;
            // Помилки Lua впізнаються за характерними словами
            const isError = /error|attempt to|nil value|near '/.test(trimmed);
            line(isError ? 'repl__error' : 'repl__output', trimmed);
        },

        /**
         * Стан «мовчить» — найважливіший.
         *
         * Консоль працює лише коли на самій Лілці відкрито «Розробка → Lua
         * REPL». Це неочевидно, і без підказки людина сиділа б і не розуміла,
         * чому нічого не відбувається.
         */
        setState(state) {
            const ready = state === 'ready';
            badge.textContent = ready ? 'Лілка на звʼязку' : 'Лілка мовчить';
            badge.className = ready ? 'repl__badge repl__badge--ready' : 'repl__badge repl__badge--silent';
            input.disabled = !ready;
            inputRow.classList.toggle('repl__input-row--off', !ready);

            const existing = root.querySelector('.repl__warning');
            existing?.remove();

            if (!ready) {
                const warning = document.createElement('div');
                warning.className = 'repl__warning';
                warning.innerHTML =
                    'Схоже, Лілка зараз не чекає команд. На самій Лілці відкрийте ' +
                    '<strong>Розробка → Lua REPL</strong> — і поверніться сюди.' +
                    '<div class="repl__warning-note">Вийти з цього режиму на Лілці — кнопкою A.</div>';
                log.after(warning);
            }
        },

        onCommand: (handler) => {
            commandHandler = handler;
        },
        onClose: (handler) => {
            closeHandler = handler;
        },
        focus: () => input.focus(),
    };
}
