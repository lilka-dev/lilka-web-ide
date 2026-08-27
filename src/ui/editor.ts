/**
 * Панель редактора: поле коду Lua, кнопки й консоль.
 *
 * Повноцінний редактор (підсвітка, номери рядків, автодоповнення зі
 * `lilka-api.json`) — окремий крок. Тут навмисно звичайне текстове поле: воно
 * вже дозволяє запускати програми й не заважає замінити себе згодом.
 */

import { EXAMPLES } from '../examples/index.ts';
import type { CodeEditor } from './code-editor.ts';
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
    /** Місце для кнопки підключення до Лілки. */
    deviceSlot: HTMLElement;
    /** Показує чи ховає кнопку «На пристрої». */
    setDeviceReady(ready: boolean): void;
    onRunOnDevice(handler: () => void): void;
    /** Підміняє консоль середовища консоллю Лілки. */
    showConsole(panel: HTMLElement | null): void;
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

    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'button button--primary';
    bindText(runButton, 'editor.run');

    /** З'являється лише при підключеній Лілці — інакше лише збивала б. */
    const deviceRunButton = document.createElement('button');
    deviceRunButton.type = 'button';
    deviceRunButton.className = 'button button--device';
    bindText(deviceRunButton, 'editor.runOnDevice');
    deviceRunButton.hidden = true;

    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.className = 'button';
    bindText(stopButton, 'editor.stop');
    stopButton.disabled = true;

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

    bar.append(runButton, deviceRunButton, stopButton, picker, status, langToggle, deviceSlot);

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

    root.append(bar, fileBar, stub, output, replSlot);

    void (async () => {
        const { createCodeEditor } = await import('./code-editor.ts');
        code = createCodeEditor({
            initial: pendingText,
            onChange: scheduleSave,
            onRun: () => runButton.click(),
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
        setState(state: string, running: boolean) {
            status.textContent = state;
            runButton.disabled = running;
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
            currentPath = path;
            drawFileName();
            setSaved();
        },
        flush: saveNow,
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
