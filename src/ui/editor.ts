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
import type { CodeEditor } from './code-editor.ts';

export type LanguageId = 'blockly' | 'lua' | 'mjs';

interface LanguageTab {
    id: LanguageId;
    title: string;
    ready: boolean;
    note?: string;
}

const LANGUAGES: LanguageTab[] = [
    { id: 'blockly', title: 'Блоки', ready: true },
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
    /** Місце для кнопки підключення до Лілки. */
    deviceSlot: HTMLElement;
    /** Показує чи ховає кнопку «На пристрої». */
    setDeviceReady(ready: boolean): void;
    onRunOnDevice(handler: () => void): void;
    /** Підміняє консоль середовища консоллю Лілки. */
    showConsole(panel: HTMLElement | null): void;
    /** Зберігає стан блоків і згенерований код. */
    onBlocksSave(handler: (state: string, lua: string) => void): void;
    setBlocks(state: string): void;
    /** Код із блоків — потрібен для запуску. */
    blocksLua(): string;
    isBlocksMode(): boolean;
    /** Вибрано приклад — можливо, із супутніми файлами. */
    onExample(handler: (example: (typeof EXAMPLES)[number]) => void): void;
}

export function createEditor(initialCode: string): EditorPanel {
    const root = document.createElement('section');
    root.className = 'editor';

    // --- вкладки мов
    const tabs = document.createElement('div');
    tabs.className = 'tabs';

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

    /**
     * Блоковий редактор.
     *
     * Вантажиться на вимогу — при першому переході на вкладку. Blockly важить
     * ще більше за CodeMirror, і тягнути його в кожне завантаження сторінки
     * заради вкладки, на яку можуть жодного разу не натиснути, було б марно.
     */
    let blocks: import('./blockly-editor.ts').BlocklyEditor | null = null;
    let blocksLoading = false;
    let blocksText = '';

    const blocksSlot = document.createElement('div');
    blocksSlot.className = 'editor__blocks';
    blocksSlot.hidden = true;

    let blocksSaveHandler: (state: string, lua: string) => void = () => {};

    async function ensureBlocks(): Promise<void> {
        if (blocks || blocksLoading) return;
        blocksLoading = true;

        const { createBlocklyEditor } = await import('./blockly-editor.ts');
        blocks = createBlocklyEditor({
            onChange: () => {
                if (!blocks) return;
                blocksSaveHandler(blocks.save(), blocks.toLua());
                setSaved();
            },
        });
        blocksSlot.append(blocks.dom);
        if (blocksText) blocks.load(blocksText);
        blocks.resize();
    }

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
        const isBlocks = id === 'blockly';

        (code?.dom ?? stub).hidden = !ready || isBlocks;
        blocksSlot.hidden = !isBlocks;
        fileBar.hidden = isBlocks;

        if (isBlocks) {
            void ensureBlocks().then(() => blocks?.resize());
        } else if (ready) {
            void code?.setLanguage(id === 'mjs' ? 'js' : 'lua');
        }
        placeholder.hidden = ready;
        runButton.disabled = !ready;
        if (!ready) {
            placeholder.innerHTML = `<div><strong>${language.title} — ще попереду</strong>${language.note ?? ''}</div>`;
        }
    };

    /**
     * Кнопка підключення до справжньої Лілки.
     *
     * Стоїть праворуч у рядку вкладок: там вільно, і вона не мішається з
     * «Запустити». Якщо браузер не вміє працювати з кабелем — замість кнопки
     * тихий підпис із поясненням: неактивну кнопку тиснули б і не розуміли,
     * чому нічого не стається.
     */
    const deviceSlot = document.createElement('span');
    deviceSlot.className = 'tabs__device';

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
    tabs.append(deviceSlot);

    // --- панель дій
    const bar = document.createElement('div');
    bar.className = 'editor__bar';

    const runButton = document.createElement('button');
    runButton.type = 'button';
    runButton.className = 'button button--primary';
    runButton.textContent = '▶ Запустити';

    /** З'являється лише при підключеній Лілці — інакше лише збивала б. */
    const deviceRunButton = document.createElement('button');
    deviceRunButton.type = 'button';
    deviceRunButton.className = 'button button--device';
    deviceRunButton.textContent = 'На пристрої';
    deviceRunButton.hidden = true;

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
        setText(example.code);
        exampleHandler(example);
    });

    const status = document.createElement('span');
    status.className = 'editor__status';

    bar.append(runButton, deviceRunButton, stopButton, picker, status);

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

    root.append(tabs, bar, fileBar, stub, blocksSlot, placeholder, output, replSlot);

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

    selectLanguage('lua');

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
                line.title = `Перейти до рядка ${at[1]}`;
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
        deviceSlot,
        setDeviceReady: (ready) => {
            deviceRunButton.hidden = !ready;
        },
        onRunOnDevice: (handler) => deviceRunButton.addEventListener('click', handler),
        onBlocksSave: (handler) => {
            blocksSaveHandler = handler;
        },
        setBlocks: (state) => {
            blocksText = state;
            blocks?.load(state);
        },
        blocksLua: () => blocks?.toLua() ?? '',
        isBlocksMode: () => active === 'blockly',
        showConsole: (panel) => {
            replSlot.textContent = '';
            output.hidden = panel !== null;
            if (panel) replSlot.append(panel);
        },
    };
}

export const SAMPLE_CODE = EXAMPLES[0].code;
