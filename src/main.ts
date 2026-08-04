/**
 * Точка входу.
 *
 * Поки що ні Lua, ні редактора — лише вертикальний зріз:
 * board.json -> подвійний буфер -> примітиви, текст і зображення -> canvas ->
 * контролер -> цикл кадрів.
 *
 * Життєвий цикл названий так само, як у прошивці (`init` / `update(delta)` /
 * `draw` + `queue_draw`), щоб коли з'явиться wasmoon, на його місце стало
 * виконання Lua без переробки циклу.
 */

import './style.css';
import { getBoard, keyBindings, DEFAULT_FONT } from './board/board.ts';
import { Screen } from './emulator/screen.ts';
import { Controller } from './emulator/controller.ts';
import { DisplaySurface } from './emulator/surface.ts';
import { imageFromRgba } from './emulator/image-loader.ts';
import { color565 } from './emulator/color.ts';
import { TextRenderer } from './emulator/text.ts';
import { loadFont, getLoadedFont } from './emulator/fonts.ts';
import splashUrl from './assets/splash.png?url';
import { createShell } from './ui/shell.ts';
import { createEditor, SAMPLE_CODE } from './ui/editor.ts';
import { exampleAssets } from './examples/index.ts';
import { LilkaDevice, isSerialSupported } from './device/serial.ts';
import { createConsolePanel } from './ui/console.ts';
import { createFilesPanel, ROOT, type FileEntry } from './ui/files.ts';
import { basename, dirname } from './emulator/vfs.ts';
import { LuaHost } from './runtime/host.ts';
import { loadAllFontJson } from './emulator/fonts.ts';
import type { FontJson } from './emulator/font.ts';

const board = getBoard();

const surface = new DisplaySurface(board.display.width, board.display.height, board.canvas.fullscreen);
const screen = new Screen(surface.display);
const controller = new Controller(keyBindings(board));
controller.attachKeyboard();

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Не знайдено #app');

// Дві колонки, як у CodeBug: ліворуч пристрій, праворуч код
const deviceColumn = document.createElement('div');
deviceColumn.className = 'column';
const editorColumn = document.createElement('div');
editorColumn.className = 'column column--editor';
app.append(deviceColumn, editorColumn);

const shell = createShell(board, controller, screen);
deviceColumn.append(shell.root);

const hud = document.createElement('div');
hud.className = 'hud';
deviceColumn.append(hud);

// ------------------------------------------------------------------ рантайм Lua

const editor = createEditor(SAMPLE_CODE);
editorColumn.append(editor.root);

let fontJson: Record<string, FontJson> = {};

/**
 * Тека програми, яка зараз у редакторі.
 *
 * Це НЕ те саме, що поточна тека менеджера. Раніше було саме так — і `main.lua`
 * записувався всюди, куди зайдеш, зокрема в `modules` і `resources` чужої гри.
 *
 * Тепер тека програми міняється лише у двох випадках: коли відкривають приклад
 * і коли відкривають `.lua` з менеджера. Просто ходити теками безпечно.
 */
let scriptDir = ROOT;

/** Ім'я файлу програми в цій теці. У прикладів воно своє. */
let scriptFile = 'main.lua';

/** Повний шлях до програми, яка зараз у редакторі. */
function scriptPath(): string {
    return `${scriptDir}/${scriptFile}`;
}

/** Приклади живуть окремо, щоб не мішатися з роботою. */
const EXAMPLES_DIR = `${ROOT}/Examples`;

/** Перелік вмісту поточної теки для панелі. Теки спершу, далі за назвою. */
function listCurrent(): FileEntry[] {
    const dir = files.currentDir();
    return host.vfs
        .list(dir)
        .map((name) => {
            const path = `${dir}/${name}`;
            const info = host.vfs.stat(path);
            const data = info?.isDirectory ? null : host.vfs.read(path);
            return {
                path,
                name,
                isDirectory: info?.isDirectory ?? false,
                size: data?.length ?? 0,
                data,
            };
        })
        .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
}

function refreshFiles(): void {
    files.render(listCurrent, () => host.vfs.allDirectories(ROOT));
}

/** Спільна частина: віддає готові байти як завантаження. */
function saveAs(name: string, data: Uint8Array): void {
    const url = URL.createObjectURL(new Blob([data.slice() as unknown as BlobPart]));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Завантаження: файл віддається як є, тека пакується в архів.
 *
 * Шляхи в архіві рахуються від самої теки, без неї самої — тож розпакування
 * поруч дає ту саму структуру, яку чекає програма.
 */
async function downloadPath(path: string): Promise<void> {
    const info = host.vfs.stat(path);

    if (info && !info.isDirectory) {
        const data = host.vfs.read(path);
        if (data) saveAs(basename(path), data);
        return;
    }

    const entries: Record<string, Uint8Array> = {};
    const prefix = path + '/';
    for (const file of host.vfs.allFiles()) {
        if (!file.path.startsWith(prefix)) continue;
        const data = host.vfs.read(file.path);
        if (data) entries[file.path.slice(prefix.length)] = data;
    }

    if (Object.keys(entries).length === 0) {
        editor.print(`Тека «${basename(path)}» порожня — пакувати нічого.`, 'err');
        return;
    }

    const { zipSync } = await import('fflate');
    saveAs(`${basename(path)}.zip`, zipSync(entries, { level: 6 }));
}

// Панель файлів живе під пристроєм, а не під редактором: ліворуч під
// намальованою Лілкою лишався порожній простір, а праворуч кожен піксель
// потрібен коду. Плюс файли — це карта пам'яті, тобто частина пристрою.
const files = createFilesPanel({
    onAdd: (path, data) => void host.addFile(path, data),
    onRemove: (path) => host.removeFile(path),
    onMkdir: (path) => host.mkdir(path),
    onMove: (from, to) => host.movePath(from, to),
    onDuplicate: (path) => host.duplicateFile(path),
    onDownload: (path) => void downloadPath(path),
    onOpenLua: (path) => {
        const data = host.vfs.read(path);
        if (!data) return;
        scriptDir = dirname(path);
        scriptFile = basename(path);
        editor.setCode(new TextDecoder().decode(data));
        editor.setFile(path);
    },
    // Навігація менеджером НЕ переносить програму: інакше `main.lua`
    // з'являвся б у кожній теці, куди зайшли подивитися
    onDirChange: () => {},
});
deviceColumn.append(files.root);

const host = new LuaHost(board, DEFAULT_FONT, {
    onPrint: (text) => editor.print(text),
    onError: (message) => editor.print(message, 'err'),
    onFilesChange: () => refreshFiles(),
    onStateChange: (state) => {
        const labels: Record<string, string> = {
            idle: 'запуск середовища…',
            loading: 'завантаження Lua…',
            ready: 'готово',
            running: 'виконується',
            stopping: 'зупинка…',
        };
        editor.setState(labels[state] ?? state, state === 'running' || state === 'stopping');
    },
});

/**
 * Приклад створює ВЛАСНУ теку й відкривається в ній.
 *
 * Ніяких підтверджень: робота людини в корені не чіпається, тож питати нема
 * про що. Повторне відкриття перезаписує теку прикладу мовчки — по приклад
 * приходять саме за чистою версією.
 */
editor.onExample((example) => {
    void (async () => {
        // Приклад без супутніх файлів лягає прямо в Examples, з файлами —
        // у власну теку: інакше `modules` і `resources` різних ігор змішалися б
        const hasAssets = Object.keys(exampleAssets(example)).length > 0;
        const dir = hasAssets ? `${EXAMPLES_DIR}/${example.id}` : EXAMPLES_DIR;
        if (hasAssets) {
            for (const file of host.vfs.allFiles()) {
                if (file.path.startsWith(dir + '/')) host.removeFile(file.path);
            }
        }
        // Ім'я ресурсу може містити підтеки: `modules/ship.lua`
        for (const [name, url] of Object.entries(exampleAssets(example))) {
            const response = await fetch(url);
            await host.addFile(`${dir}/${name}`, new Uint8Array(await response.arrayBuffer()));
        }
        const name = example.file ?? 'main.lua';
        await host.addFile(`${dir}/${name}`, new TextEncoder().encode(example.code));
        scriptDir = dir;
        scriptFile = name;
        editor.setFile(`${dir}/${name}`);
        files.setDir(dir);
    })();
});

// Автозбереження: кожна зміна лягає у файл, який зараз відкрито
editor.onSave((code) => {
    void host.addFile(scriptPath(), new TextEncoder().encode(code));
});

/**
 * Блоки й код — ДВА різні файли.
 *
 * `гра.blocks` зберігає самі блоки, `гра.lua` — згенерований із них код.
 * Blockly не вміє перетворювати код назад у блоки, тож якби вони жили в
 * одному файлі, правка коду руками мовчки знищила б усю роботу з блоками.
 *
 * Так само видно, що з чого взялося: у згенерованому файлі перший рядок про
 * це прямо каже.
 */
editor.onBlocksSave((state, lua) => {
    void host.addFile(`${ROOT}/main.blocks`, new TextEncoder().encode(state));
    void host.addFile(`${ROOT}/main.lua`, new TextEncoder().encode(lua));
});

/* ------------------------------------------------- справжня Лілка ------- */

/**
 * Зв'язок із пристроєм по кабелю.
 *
 * Через кабель їде ЛИШЕ код. Програма з картинками або `require` потребує
 * файлів на самій картці — і сказати про це треба ДО запуску, а не після
 * незрозумілої помилки на Лілці.
 */
const consolePanel = createConsolePanel();
let consoleOpen = false;

const device = new LilkaDevice({
    onLine: (text) => {
        if (consoleOpen) {
            // Перша ж відповідь означає, що Лілка справді в режимі консолі
            consolePanel.setState('ready');
            consolePanel.addOutput(text);
        } else {
            editor.print(text);
        }
    },
    onConnect: () => {
        editor.setDeviceReady(true);
        drawDeviceButton();
        editor.print('Лілку під\'єднано.');
    },
    onDisconnect: () => {
        editor.setDeviceReady(false);
        closeConsole();
        drawDeviceButton();
        editor.print('Лілку від\'єднано.');
    },
    onError: (message) => editor.print(message, 'err'),
});

/** Кнопка підключення в рядку вкладок. Три стани, як домовлялися. */
function drawDeviceButton(): void {
    const slot = editor.deviceSlot;
    slot.textContent = '';

    if (!isSerialSupported()) {
        const note = document.createElement('span');
        note.className = 'tabs__device-note';
        note.textContent = 'підключення до Лілки — у Chrome';
        note.title = 'Доступ до USB із веб-сторінки є лише в Chrome і Edge';
        slot.append(note);
        return;
    }

    const button = document.createElement('button');
    button.type = 'button';

    if (!device.connected) {
        button.className = 'device-chip';
        button.textContent = 'Під\'єднати Лілку';
        button.addEventListener('click', () => void device.connect());
    } else {
        button.className = 'device-chip device-chip--on';
        button.innerHTML = '<span class="device-chip__dot"></span>Лілка · USB ▾';
        button.addEventListener('click', () => (consoleOpen ? closeConsole() : openConsole()));
    }
    slot.append(button);
}

function openConsole(): void {
    consoleOpen = true;
    editor.showConsole(consolePanel.root);
    // Стан «мовчить» доти, доки Лілка не відповість: на ній самій треба
    // відкрити «Розробка → Lua REPL», і через кабель це не вмикається
    consolePanel.setState('silent');
    consolePanel.focus();
    void device.sendCommand('');
}

function closeConsole(): void {
    consoleOpen = false;
    editor.showConsole(null);
}

consolePanel.onCommand((line) => void device.sendCommand(line));
consolePanel.onClose(closeConsole);

/** Запуск на справжній Лілці. */
editor.onRunOnDevice(() => {
    const code = editor.getCode();

    // Попередження ДО запуску: через кабель їде лише код
    if (/require\s*\(|load_image\s*\(|load_audio\s*\(/.test(code)) {
        const proceed = confirm(
            'Через кабель їде лише код.\n\n' +
                'Ця програма використовує файли — картинки, звуки або модулі. ' +
                'Вони мають уже лежати на картці пам\'яті Лілки, інакше програма впаде.\n\n' +
                'Запустити все одно?',
        );
        if (!proceed) return;
    }

    editor.print('Надсилаю код на Лілку…');
    void device
        .runProgram(code)
        .then(() => editor.print('Код надіслано. На Лілці має відкритися «Розробка → Lua Live».'))
        .catch((error) => editor.print(String(error), 'err'));
});

drawDeviceButton();

editor.onRun(() => void runEditorCode());

/**
 * Спершу зберегти файл, і лише тоді запускати.
 *
 * Раніше обидві дії йшли одночасно, тож воркер міг отримати вміст карти без
 * щойно збереженої програми. Плюс `main.lua` оновлювався навіть тоді, коли
 * запуск не відбувався — і виглядало, ніби програма пішла, хоч насправді ні.
 */
async function runEditorCode(): Promise<void> {
    editor.clearConsole();
    // Записати негайно: автозбереження має затримку, і без цього воркер міг
    // би отримати попередню версію коду
    editor.flush();

    // У режимі блоків запускається згенерований із них код
    const code = editor.isBlocksMode() ? editor.blocksLua() : editor.getCode();
    const path = editor.isBlocksMode() ? `${ROOT}/main.lua` : scriptPath();

    if (editor.isBlocksMode() && !code.trim()) {
        editor.print(
            'Блоки порожні. Покладіть щось УСЕРЕДИНУ «малювати» або «щокадру» — ' +
                'блок сам по собі не виконується.',
            'err',
        );
        return;
    }

    surface.display.fillScreen(0);
    screen.present(true);

    await host.addFile(path, new TextEncoder().encode(code));

    if (!host.run(code, 'main.lua', path)) {
        editor.setState('Lua не готова', false);
    }
}
editor.onStop(() => host.stop());

// ----------------------------------------------------------------- заставка

/**
 * Заставка Лілки — та сама, що показує прошивка при вмиканні.
 *
 * Картинка розпакована з `sdk/lib/lilka/src/lilka/default_splash.h`, де вона
 * лежить у RLE-стисненому вигляді: байт-лічильник повторів, далі два байти
 * кольору RGB565. Окремий скрипт-генератор тут зайвий — заставка не змінюється
 * разом із прошивкою, тож достатньо готового PNG із цим поясненням поруч.
 *
 * Показується від завантаження сторінки до першого запуску програми.
 */
async function showSplash(): Promise<void> {
    // Заставка — прикраса, тож її поломка не має заважати нічому іншому
    try {
        await paintSplash();
    } catch (error) {
        console.warn('Заставку показати не вдалося:', error);
    }
}

async function paintSplash(): Promise<void> {
    const response = await fetch(splashUrl);
    const bitmap = await createImageBitmap(await response.blob());

    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(bitmap, 0, 0);

    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const image = imageFromRgba(pixels.data, bitmap.width, bitmap.height);
    surface.display.drawImage(image, 0, 0);
    screen.present(true);
}

/**
 * Малює на екрані пристрою справжню причину, чому Lua не запустилася.
 *
 * Раніше тут стояло одне наперед задане пояснення про спільну пам'ять — і
 * будь-яка інша поломка виглядала так само. Тепер показується те, що справді
 * сталося.
 */
function showFailure(message: string): void {
    const font = getLoadedFont('6x13');
    if (!font) return;

    const fb = surface.display;
    fb.fillScreen(color565(24, 28, 40));
    const text = new TextRenderer(fb, font);
    text.setTextColor(color565(255, 210, 80));
    text.setTextBound(10, 10, fb.width - 20, fb.height - 20);
    text.setCursor(10, 30);
    text.write('Lua не запустилася');

    text.setTextColor(color565(200, 210, 220));
    text.setCursor(10, 58);
    text.write(message);

    screen.present(true);
}

let frames = 0;
let fpsWindow = 0;
let fps = 0;

// ------------------------------------------------------------------ цикл кадрів

let last = performance.now();

function frame(now: number): void {
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;

    const luaRunning = host.currentState === 'running' || host.currentState === 'stopping';

    if (luaRunning) {
        host.pushButtons(controller);
        host.checkWatchdog(fontJson);
        host.present(surface.display);
        // прапорці just_* споживає Lua, але їх треба скидати й тут,
        // інакше після зупинки програми накопичиться черга натискань
        controller.readState();
        screen.present();
    }

    frames++;
    fpsWindow += delta;
    if (fpsWindow >= 0.5) {
        fps = Math.round(frames / fpsWindow);
        frames = 0;
        fpsWindow = 0;
        hud.textContent = luaRunning
            ? `${fps} к/с виводу · кадр Lua ${host.frame} · пропущено ${host.skippedFrames} · ` +
              `масштаб ${screen.currentScale}×`
            : `масштаб ${screen.currentScale}×`;
    }
    shell.syncButtons();

    requestAnimationFrame(frame);
}

window.addEventListener('resize', () => shell.layout());
shell.layout();

void showSplash();
requestAnimationFrame(frame);

void (async () => {
    // Рантайм піднімається окремо: без SharedArrayBuffer він не запуститься,
    // і про це краще сказати прямо, ніж мовчки лишити кнопку неактивною.
    // Один рядок у консолі браузера: за ним видно, чи браузер дав ізоляцію.
    // Перевіряються саме можливості, а не назва браузера.
    console.info('Середовище Лілки', {
        crossOriginIsolated: globalThis.crossOriginIsolated,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        secureContext: globalThis.isSecureContext,
    });

    try {
        // Шрифт потрібен ще до рантайму — щоб було чим написати про помилку
        await loadFont('6x13');
        fontJson = await loadAllFontJson();
        await host.start(fontJson);
        await host.restore();
        // main.lua існує від початку — щоб зв'язок «програма це файл» був
        // видний ще до першого запуску
        if (!host.vfs.exists(`${ROOT}/main.lua`)) {
            await host.addFile(`${ROOT}/main.lua`, new TextEncoder().encode(editor.getCode()));
        } else {
            // Файл головніший за те, що в редакторі: він і є єдиним джерелом
            const saved = host.vfs.read(`${ROOT}/main.lua`);
            if (saved) editor.setCode(new TextDecoder().decode(saved));
        }
        editor.setFile(`${ROOT}/main.lua`);

        // Блоки, якщо їх колись складали
        const savedBlocks = host.vfs.read(`${ROOT}/main.blocks`);
        if (savedBlocks) editor.setBlocks(new TextDecoder().decode(savedBlocks));

        refreshFiles();
    } catch (error) {
        // Повідомлення має бути на екрані пристрою, а не лише в консолі:
        // інакше заставка виглядає як зависання, і причина лишається невідомою
        const message = error instanceof Error ? error.message : String(error);
        editor.print(message, 'err');
        editor.setState('Lua не запустилася', false);
        showFailure(message);
    }
})();

// Корисно для ручної перевірки з консолі браузера
Object.assign(globalThis as Record<string, unknown>, { surface, screen, controller, board });
