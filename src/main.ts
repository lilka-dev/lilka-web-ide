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
import splashUrl from './assets/splash.png?url';
import { createShell } from './ui/shell.ts';
import { createEditor, SAMPLE_CODE } from './ui/editor.ts';
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
 * Тека, у якій лежить поточна програма.
 *
 * Головне правило моделі: програма лежить ПОРУЧ зі своїми картинками. Тому
 * `main.lua` зберігається саме сюди, і відносні шляхи в `resources.load_image`
 * завжди працюють — файл шукається там само.
 */
let scriptDir = ROOT;

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

/** Віддає файл користувачу як завантаження. */
function downloadFile(path: string): void {
    const data = host.vfs.read(path);
    if (!data) return;
    const url = URL.createObjectURL(new Blob([data.slice() as unknown as BlobPart]));
    const link = document.createElement('a');
    link.href = url;
    link.download = basename(path);
    link.click();
    URL.revokeObjectURL(url);
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
    onDownload: downloadFile,
    onOpenLua: (path) => {
        const data = host.vfs.read(path);
        if (!data) return;
        editor.setCode(new TextDecoder().decode(data));
        scriptDir = dirname(path);
        editor.print(`Відкрито ${path}`);
    },
    onDirChange: (dir) => {
        scriptDir = dir;
    },
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
        const dir = `${ROOT}/${example.id}`;
        for (const file of host.vfs.allFiles()) {
            if (file.path.startsWith(dir + '/')) host.removeFile(file.path);
        }
        for (const [name, url] of Object.entries(example.assets ?? {})) {
            const response = await fetch(url);
            await host.addFile(`${dir}/${name}`, new Uint8Array(await response.arrayBuffer()));
        }
        await host.addFile(`${dir}/main.lua`, new TextEncoder().encode(example.code));
        scriptDir = dir;
        files.setDir(dir);
    })();
});

editor.onRun(() => {
    editor.clearConsole();
    surface.display.fillScreen(0);
    // Код зберігається у main.lua поточної теки — саме тому програма завжди
    // лежить поруч зі своїми картинками
    void host.addFile(`${scriptDir}/main.lua`, new TextEncoder().encode(editor.getCode()));
    host.run(editor.getCode(), 'main.lua', `${scriptDir}/main.lua`);
});
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
    try {
        fontJson = await loadAllFontJson();
        await host.start(fontJson);
        await host.restore();
        // main.lua існує від початку — щоб зв'язок «програма це файл» був
        // видний ще до першого запуску
        if (!host.vfs.exists(`${ROOT}/main.lua`)) {
            await host.addFile(`${ROOT}/main.lua`, new TextEncoder().encode(editor.getCode()));
        }
        refreshFiles();
    } catch (error) {
        editor.print(error instanceof Error ? error.message : String(error), 'err');
        editor.setState('рантайм недоступний', false);
    }
})();

// Корисно для ручної перевірки з консолі браузера
Object.assign(globalThis as Record<string, unknown>, { surface, screen, controller, board });
