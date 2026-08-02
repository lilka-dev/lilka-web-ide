/**
 * Панель редактора: вкладки мов, поле коду, кнопки й консоль.
 *
 * Вкладок три, як і мов у меті проєкту: Blockly, Lua, mJS. Дві останні поки
 * без рантайму, і це показано прямо, а не приховано: вимкнена вкладка з
 * поясненням чесніша за її відсутність — видно, куди проєкт іде.
 *
 * Повноцінний редактор (підсвітка, номери рядків, автодоповнення зі
 * `lilka-api.json`) — окремий крок. Тут навмисно звичайне текстове поле: воно
 * вже дозволяє запускати програми й не заважає замінити себе згодом.
 */

import { EXAMPLES } from '../examples/index.ts';

export type LanguageId = 'blockly' | 'lua' | 'mjs';

interface LanguageTab {
    id: LanguageId;
    title: string;
    ready: boolean;
    note?: string;
}

const LANGUAGES: LanguageTab[] = [
    {
        id: 'blockly',
        title: 'Blockly',
        ready: false,
        note: 'Блоки з генераторами Lua та JavaScript. Blockly має обидва генератори з коробки, лишається зробити блоки для API Лілки.',
    },
    { id: 'lua', title: 'Lua', ready: true },
    {
        id: 'mjs',
        title: 'mJS',
        ready: false,
        note: 'Двигун mJS збирається з keira/lib/mJS/src/mjs.c у WASM. Запускати цей код у движку браузера не можна: mJS — урізана підмножина ES, і браузер прийме те, що на залізі впаде.',
    },
];

export interface EditorPanel {
    root: HTMLElement;
    getCode(): string;
    setCode(code: string): void;
    print(text: string, kind?: 'out' | 'err'): void;
    clearConsole(): void;
    setState(state: string, running: boolean): void;
    onRun(handler: () => void): void;
    onStop(handler: () => void): void;
    /** Викликається, коли код треба записати у файл. */
    onSave(handler: (code: string) => void): void;
    /** Показує, який файл зараз відкрито. */
    setFile(path: string): void;
    /** Зберігає негайно — потрібно перед запуском. */
    flush(): void;
    /** Вибрано приклад — можливо, із супутніми файлами. */
    onExample(handler: (example: (typeof EXAMPLES)[number]) => void): void;
}

export function createEditor(initialCode: string): EditorPanel {
    const root = document.createElement('section');
    root.className = 'editor';

    // --- вкладки мов
    const tabs = document.createElement('div');
    tabs.className = 'tabs';

    /*
     * Номери рядків. Повноцінний редактор буде окремим кроком (CodeMirror), а
     * поки це найпростіше з робочого: колонка з номерами поруч із полем,
     * синхронізована прокруткою. Головне — щоб число з повідомлення про
     * помилку («main.lua:12») можна було знайти очима.
     */
    const codeWrap = document.createElement('div');
    codeWrap.className = 'editor__code-wrap';

    const gutter = document.createElement('div');
    gutter.className = 'editor__gutter';
    gutter.setAttribute('aria-hidden', 'true');

    const textarea = document.createElement('textarea');
    textarea.className = 'editor__code';
    textarea.spellcheck = false;
    /*
     * Єдине джерело правди — файл на віртуальній карті.
     *
     * Раніше редактор мав ще й окрему «чернетку» в пам'яті браузера, не
     * пов'язану з файлом. Через це змінений `main.lua` після перегляду
     * прикладу показував не те, що лежало у файлі.
     */
    textarea.value = initialCode;

    const syncGutter = (): void => {
        const count = textarea.value.split('\n').length;
        gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
    };

    textarea.addEventListener('input', () => {
        syncGutter();
        scheduleSave();
    });
    textarea.addEventListener('scroll', () => {
        gutter.scrollTop = textarea.scrollTop;
    });

    codeWrap.append(gutter, textarea);

    const placeholder = document.createElement('div');
    placeholder.className = 'editor__placeholder';
    placeholder.hidden = true;

    let active: LanguageId = 'lua';

    const selectLanguage = (id: LanguageId): void => {
        const language = LANGUAGES.find((l) => l.id === id);
        if (!language) return;
        active = id;

        for (const button of tabs.querySelectorAll('button')) {
            button.classList.toggle('tab--active', button.dataset.id === id);
        }

        const ready = language.ready;
        codeWrap.hidden = !ready;
        placeholder.hidden = ready;
        runButton.disabled = !ready;
        if (!ready) {
            placeholder.innerHTML = `<div><strong>${language.title} — ще попереду</strong>${language.note ?? ''}</div>`;
        }
    };

    for (const language of LANGUAGES) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tab';
        button.dataset.id = language.id;
        button.textContent = language.title;
        button.disabled = !language.ready;
        if (!language.ready) {
            const badge = document.createElement('span');
            badge.className = 'tab__soon';
            badge.textContent = 'скоро';
            button.append(badge);
        }
        button.addEventListener('click', () => selectLanguage(language.id));
        tabs.append(button);
    }

    // --- панель дій
    const bar = document.createElement('div');
    bar.className = 'editor__bar';

    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'button button--primary';
    runButton.textContent = '▶ Запустити';

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'button';
    stopButton.textContent = '■ Зупинити';
    stopButton.disabled = true;

    // Приклади — справжні програми для заліза, а не спрощені демонстрації
    const picker = document.createElement('select');
    picker.className = 'editor__picker';
    for (const example of EXAMPLES) {
        const option = document.createElement('option');
        option.value = example.id;
        option.textContent = example.title;
        picker.append(option);
    }
    let exampleHandler: (example: (typeof EXAMPLES)[number]) => void = () => {};
    picker.addEventListener('change', () => {
        const example = EXAMPLES.find((e) => e.id === picker.value);
        if (!example) return;
        textarea.value = example.code;
        syncGutter();
        exampleHandler(example);
    });

    const status = document.createElement('span');
    status.className = 'editor__status';

    bar.append(runButton, stopButton, picker, status);

    /*
     * Рядок із назвою файлу.
     *
     * Показується шлях від кореня, а не саме ім'я: так видно і де програма
     * лежить, і що саме запуститься. Раніше всі приклади звалися `main.lua`,
     * і зорієнтуватися було годі.
     */
    const fileBar = document.createElement('div');
    fileBar.className = 'editor__file';

    const fileName = document.createElement('span');
    fileName.className = 'editor__file-name';

    const saveState = document.createElement('span');
    saveState.className = 'editor__save';

    fileBar.append(fileName, saveState);

    let saveHandler: (code: string) => void = () => {};
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    function setSaved(): void {
        saveState.textContent = 'збережено';
        saveState.classList.remove('editor__save--pending');
    }

    /**
     * Збереження без кнопки.
     *
     * Кнопка з дискетою тут нічого не рятує: втратити роботу неможливо, бо
     * кожна зміна лягає у файл сама. Натомість показується стан — це знімає
     * тривогу краще, ніж дія, яку треба пам'ятати робити.
     *
     * Затримка потрібна, щоб не писати у сховище на кожну натиснуту клавішу.
     */
    function scheduleSave(): void {
        saveState.textContent = 'збереження…';
        saveState.classList.add('editor__save--pending');
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveHandler(textarea.value);
            setSaved();
        }, 600);
    }

    function saveNow(): void {
        if (saveTimer) clearTimeout(saveTimer);
        saveHandler(textarea.value);
        setSaved();
    }

    const output = document.createElement('pre');
    output.className = 'editor__console';

    root.append(tabs, bar, fileBar, codeWrap, placeholder, output);

    // Ctrl/Cmd+Enter — звична комбінація для середовищ такого типу
    textarea.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            runButton.click();
        }
        // Cmd+S не потрібен для збереження, але рука сама тягнеться — хай
        // зберігає негайно замість того, щоб браузер пропонував зберегти сторінку
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            saveNow();
        }
    });

    syncGutter();
    selectLanguage('lua');

    return {
        root,
        getCode: () => textarea.value,
        setCode: (code: string) => {
            textarea.value = code;
            syncGutter();
            setSaved();
        },
        print(text: string, kind: 'out' | 'err' = 'out') {
            const line = document.createElement('div');
            line.className = kind === 'err' ? 'line line--error' : 'line';
            line.textContent = text;
            output.append(line);
            output.scrollTop = output.scrollHeight;
        },
        clearConsole() {
            output.textContent = '';
        },
        setState(state: string, running: boolean) {
            status.textContent = state;
            runButton.disabled = running || active !== 'lua';
            stopButton.disabled = !running;
        },
        onRun: (handler) => runButton.addEventListener('click', handler),
        onStop: (handler) => stopButton.addEventListener('click', handler),
        onExample: (handler: (example: (typeof EXAMPLES)[number]) => void) => {
            exampleHandler = handler;
        },
        onSave: (handler) => {
            saveHandler = handler;
        },
        setFile: (path) => {
            // Шлях показується без технічного префікса `/sd`, зі стрілками
            fileName.textContent = path.replace(/^\/sd\/?/, 'Файли › ').replace(/\//g, ' › ');
            setSaved();
        },
        flush: saveNow,
    };
}

export const SAMPLE_CODE = EXAMPLES[0].code;
