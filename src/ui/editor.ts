/**
 * Панель редактора: поле коду Lua, кнопки й консоль.
 *
 * Повноцінний редактор (підсвітка, номери рядків, автодоповнення зі
 * `lilka-api.json`) — окремий крок. Тут навмисно звичайне текстове поле: воно
 * вже дозволяє запускати програми й не заважає замінити себе згодом.
 */

import { EXAMPLES } from '../examples/index.ts';
import type { CodeEditor } from './code-editor.ts';
import { iconElement } from './icons.ts';
import { t, bindText, bindTitle, getLang, setLang, onLangChange } from '../i18n/index.ts';

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
    /** Перемикач мови — стоїть у заголовку бічної панелі, а не в рядку дій. */
    langToggle: HTMLElement;
    /** Консоль — її розміщує той, хто збирає сторінку. */
    consoleRoot: HTMLElement;
    /** Місце для кнопки підключення до Лілки. */
    deviceSlot: HTMLElement;
    /** Показує чи ховає кнопку «На пристрої». */
    setDeviceReady(ready: boolean): void;
    onRunOnDevice(handler: () => void): void;
    /** Підміняє консоль середовища консоллю Лілки. */
    showConsole(panel: HTMLElement | null): void;
    /** Переводить курсор на рядок — з помилки поза консоллю. */
    goToLine(line: number): void;
    /** Натиснуто «Експорт» — програму треба віддати архівом. */
    onExport(handler: () => void): void;
    /** Вибрано приклад — можливо, із супутніми файлами. */
    onExample(handler: (example: (typeof EXAMPLES)[number]) => void): void;
}

export function createEditor(initialCode: string): EditorPanel {
    const root = document.createElement('section');
    root.className = 'editor';

    /**
     * Редактор вантажиться після першого показу сторінки.
     *
     * CodeMirror утричі важчий за решту коду разом. Якщо чекати на нього,
     * Лілка з'явиться на екрані пізніше — а редактор потрібен лише тоді, коли
     * почнуть писати.
     *
     * Доки він їде, на його місці стоїть поле з тим самим текстом, куди вже
     * можна друкувати. Підміна відбувається без втрати написаного.
     */
    let code: CodeEditor | null = null;
    let pendingText = initialCode;

    const stub = document.createElement('textarea');
    stub.className = 'editor__code editor__code--stub';
    stub.spellcheck = false;
    stub.value = initialCode;
    stub.addEventListener('input', () => {
        pendingText = stub.value;
        scheduleSave();
    });

    /** Текст із того, що зараз показується — редактора або тимчасового поля. */
    const currentText = (): string => (code ? code.getValue() : pendingText);

    function setText(text: string): void {
        pendingText = text;
        if (code) code.setValue(text);
        else stub.value = text;
    }

    // --- панель дій
    const bar = document.createElement('div');
    bar.className = 'editor__bar';

    /*
     * Одна кнопка на запуск і зупинку.
     *
     * Дві окремі кнопки завжди мали одну неактивну — вона лише займала місце.
     * Тепер кнопка показує ту дію, яка зараз має сенс.
     */
    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'button button--primary editor__run';
    let running = false;
    const drawRunButton = () => {
        runButton.textContent = t(running ? 'editor.stop' : 'editor.run');
        runButton.classList.toggle('button--primary', !running);
        runButton.classList.toggle('button--stop', running);
    };
    drawRunButton();
    onLangChange(drawRunButton);
    const runHandlers: Array<() => void> = [];
    const stopHandlers: Array<() => void> = [];
    const startRun = () => {
        if (!running) for (const handler of runHandlers) handler();
    };
    runButton.addEventListener('click', () => {
        if (running) for (const handler of stopHandlers) handler();
        else startRun();
    });

    /** З'являється лише при підключеній Лілці — інакше лише збивала б. */
    const deviceRunButton = document.createElement('button');
    deviceRunButton.type = 'button';
    deviceRunButton.className = 'button button--device';
    bindText(deviceRunButton, 'editor.runOnDevice');
    deviceRunButton.hidden = true;

    // Приклади — справжні програми для заліза, а не спрощені демонстрації
    const picker = document.createElement('select');
    picker.className = 'editor__picker';
    const exampleOptions = EXAMPLES.map((example) => {
        const option = document.createElement('option');
        option.value = example.id;
        picker.append(option);
        return { option, titleKey: example.titleKey };
    });
    const drawExampleOptions = () => {
        for (const { option, titleKey } of exampleOptions) option.textContent = t(titleKey);
    };
    drawExampleOptions();
    onLangChange(drawExampleOptions);
    let exampleHandler: (example: (typeof EXAMPLES)[number]) => void = () => {};
    picker.addEventListener('change', () => {
        const example = EXAMPLES.find((e) => e.id === picker.value);
        if (!example) return;
        setText(example.code);
        exampleHandler(example);
    });

    /*
     * Експорт усіх файлів архівом — разом із картинками й модулями, бо без
     * них програми на Лілці не запустяться.
     */
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'button editor__tool';
    exportButton.append(iconElement('download', 15));
    const exportLabel = document.createElement('span');
    bindText(exportLabel, 'editor.export');
    exportButton.append(exportLabel);
    bindTitle(exportButton, 'editor.exportTitle');

    const status = document.createElement('span');
    status.className = 'editor__status';

    /**
     * Кнопка підключення до справжньої Лілки.
     *
     * Стоїть у панелі дій, праворуч: якщо браузер не вміє працювати з кабелем —
     * замість кнопки тихий підпис із поясненням: неактивну кнопку тиснули б і
     * не розуміли, чому нічого не стається.
     */
    const deviceSlot = document.createElement('span');
    deviceSlot.className = 'editor__device';

    /**
     * Перемикач мови інтерфейсу.
     *
     * Показує обидва варіанти власними назвами, а не в поточній мові — так
     * людина знаходить рідну мову, навіть не розуміючи ту, що зараз активна.
     * Стан лише в пам'яті (див. `src/i18n/lang.ts`): нова вкладка знову
     * визначить мову з браузера.
     */
    const langToggle = document.createElement('div');
    langToggle.className = 'editor__lang';
    bindTitle(langToggle, 'editor.langTitle');
    const enButton = document.createElement('button');
    enButton.type = 'button';
    enButton.className = 'editor__lang-btn';
    enButton.textContent = 'EN';
    const ukButton = document.createElement('button');
    ukButton.type = 'button';
    ukButton.className = 'editor__lang-btn';
    ukButton.textContent = 'УКР';
    for (const [button, lang] of [
        [enButton, 'en'],
        [ukButton, 'uk'],
    ] as const) {
        button.addEventListener('click', () => setLang(lang));
    }
    const syncLangButtons = () => {
        enButton.classList.toggle('editor__lang-btn--on', getLang() === 'en');
        ukButton.classList.toggle('editor__lang-btn--on', getLang() === 'uk');
    };
    syncLangButtons();
    onLangChange(syncLangButtons);
    langToggle.append(enButton, ukButton);

    // Підключення ліворуч, запуск праворуч — на краю, де закінчується рядок
    bar.append(deviceSlot, deviceRunButton, picker, exportButton, status, runButton);

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

    /** Шлях показується без технічного префікса `/sd`, зі стрілками. */
    let currentPath = '';
    function drawFileName(): void {
        fileName.textContent = currentPath.replace(/^\/sd\/?/, t('editor.filesPrefix')).replace(/\//g, ' › ');
    }
    onLangChange(drawFileName);

    const saveState = document.createElement('span');
    saveState.className = 'editor__save';

    fileBar.append(fileName, saveState);

    let saveHandler: (code: string) => void = () => {};
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    function setSaved(): void {
        saveState.textContent = t('editor.saved');
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
        saveState.textContent = t('editor.saving');
        saveState.classList.add('editor__save--pending');
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveHandler(currentText());
            setSaved();
        }, 600);
    }

    function saveNow(): void {
        if (saveTimer) clearTimeout(saveTimer);
        saveHandler(currentText());
        setSaved();
    }

    const output = document.createElement('pre');
    output.className = 'editor__console';

    // Консоль Лілки стає на місце консолі середовища
    const replSlot = document.createElement('div');
    replSlot.className = 'editor__repl-slot';

    /*
     * Консоль живе не в колонці коду, а під пристроєм — поруч зі смугою
     * помилки. Там вона на виду під час запуску, а поле коду отримує всю
     * висоту колонки.
     */
    const consoleRoot = document.createElement('div');
    consoleRoot.className = 'output';
    consoleRoot.append(output, replSlot);

    root.append(bar, fileBar, stub);

    void (async () => {
        const { createCodeEditor } = await import('./code-editor.ts');
        code = createCodeEditor({
            initial: pendingText,
            onChange: scheduleSave,
            // Лише запуск: повторне натискання під час роботи не має зупиняти
            onRun: startRun,
            onSave: saveNow,
        });
        code.dom.classList.add('editor__code');
        stub.replaceWith(code.dom);
    })();

    return {
        root,
        getCode: currentText,
        setCode: (text: string) => {
            setText(text);
            setSaved();
        },
        print(text: string, kind: 'out' | 'err' = 'out') {
            const line = document.createElement('div');
            line.className = kind === 'err' ? 'line line--error' : 'line';
            line.textContent = text;

            // Повідомлення про помилку називає рядок — хай туди можна перейти
            const at = /:(\d+):/.exec(text);
            if (kind === 'err' && at) {
                line.classList.add('line--clickable');
                line.title = t('editor.goToLine', { n: at[1] });
                line.addEventListener('click', () => code?.goToLine(Number(at[1])));
            }

            output.append(line);
            output.scrollTop = output.scrollHeight;
        },
        clearConsole() {
            output.textContent = '';
        },
        setState(state: string, isRunning: boolean) {
            status.textContent = state;
            running = isRunning;
            drawRunButton();
        },
        goToLine: (line) => code?.goToLine(line),
        onRun: (handler) => runHandlers.push(handler),
        onExport: (handler) => exportButton.addEventListener('click', handler),
        onStop: (handler) => stopHandlers.push(handler),
        onExample: (handler: (example: (typeof EXAMPLES)[number]) => void) => {
            exampleHandler = handler;
        },
        onSave: (handler) => {
            saveHandler = handler;
        },
        setFile: (path) => {
            currentPath = path;
            drawFileName();
            setSaved();
        },
        flush: saveNow,
        consoleRoot,
        langToggle,
        deviceSlot,
        setDeviceReady: (ready) => {
            deviceRunButton.hidden = !ready;
        },
        onRunOnDevice: (handler) => deviceRunButton.addEventListener('click', handler),
        showConsole: (panel) => {
            replSlot.textContent = '';
            output.hidden = panel !== null;
            if (panel) replSlot.append(panel);
        },
    };
}

export const SAMPLE_CODE = EXAMPLES[0].code;
