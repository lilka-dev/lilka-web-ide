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
import { preloadFonts, getLoadedFont } from './emulator/fonts.ts';
import { TextRenderer } from './emulator/text.ts';
import { drawTestCard } from './emulator/testcard.ts';
import { drawImageTestCard, makeSprite } from './emulator/testcard-images.ts';
import { Transform } from './emulator/transform.ts';
import { color565 } from './emulator/color.ts';
import { createShell } from './ui/shell.ts';
import { createEditor, SAMPLE_CODE } from './ui/editor.ts';
import { createFilesPanel, ROOT, type FileEntry } from './ui/files.ts';
import { basename, dirname } from './emulator/vfs.ts';
import { LuaHost } from './runtime/host.ts';
import { loadAllFontJson } from './emulator/fonts.ts';
import type { Font, FontJson } from './emulator/font.ts';

const board = getBoard();

/** true — канва на весь екран; false — зі смугою статусбару, як у KeiraOS. */
let fullscreen = true;

let surface = new DisplaySurface(board.display.width, board.display.height, board.canvas.fullscreen);
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

// -------------------------------------------------------------- демо-сценарій

const WHITE = color565(255, 255, 255);
const STATUSBAR = color565(24, 28, 40);

const TESTCARD_FONTS = ['5x7', '6x13', '10x20'];
const MODES = ['geometry', 'images', 'sandbox'] as const;
type Mode = (typeof MODES)[number];
const MODE_TITLES: Record<Mode, string> = {
    geometry: 'геометрія',
    images: 'зображення',
    sandbox: 'пісочниця',
};

let mode: Mode = 'geometry';
let fonts: Record<string, Font> = {};
let x = board.canvas.fullscreen.width / 2;
let y = board.canvas.fullscreen.height / 2;
let angle = 0;
let frames = 0;
let fpsWindow = 0;
let fps = 0;

const sprite = makeSprite(color565(255, 0, 255));

/** Перестворює поверхню при зміні режиму статусбару (`lilka.fullscreen`). */
function rebuildSurface(): void {
    const rect = fullscreen ? board.canvas.fullscreen : board.canvas.windowed;
    surface = new DisplaySurface(board.display.width, board.display.height, rect);
    screen.attach(surface.display);
    if (!fullscreen) {
        // Смуга статусбару малюється поза канвою програми — як у KeiraOS
        surface.display.fillRect(0, 0, board.display.width, board.canvas.statusBarHeight, STATUSBAR);
    }
    x = Math.min(x, rect.width - 1);
    y = Math.min(y, rect.height - 1);
    drawCurrentCard();
}

function drawCurrentCard(): void {
    const fb = surface.canvas;
    if (mode === 'geometry') drawTestCard(fb, fonts);
    else if (mode === 'images') drawImageTestCard(fb, fonts);
    else fb.fillScreen(0);
    surface.queueDraw();
}

function update(delta: number): void {
    const state = controller.readState();

    if (state.start.just_pressed) {
        mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
        drawCurrentCard();
        // друге малювання: через обмін буферів перший кадр після перемикання
        // лишався б у другому буфері зі старим вмістом
        drawCurrentCard();
    }

    if (state.select.just_pressed) {
        fullscreen = !fullscreen;
        rebuildSurface();
        drawCurrentCard();
    }

    if (mode !== 'sandbox') return;

    const speed = 90 * delta;
    if (state.left.pressed) x -= speed;
    if (state.right.pressed) x += speed;
    if (state.up.pressed) y -= speed;
    if (state.down.pressed) y += speed;
    x = Math.max(0, Math.min(surface.canvas.width - 1, x));
    y = Math.max(0, Math.min(surface.canvas.height - 1, y));

    if (state.a.pressed) angle += 180 * delta;
    if (state.b.pressed) angle -= 180 * delta;
}

function draw(): void {
    if (mode !== 'sandbox') return;

    const fb = surface.canvas;
    fb.fillScreen(0);
    fb.drawRect(0, 0, fb.width, fb.height, WHITE);

    // обертання зображення навколо точки привʼязки, керується A / B
    fb.drawImageTransformed(sprite, Math.round(x), Math.round(y), new Transform().rotate(Math.round(angle)));

    const font = getLoadedFont(DEFAULT_FONT);
    if (font) {
        const text = new TextRenderer(fb, font);
        text.setTextColor(WHITE, 0);
        text.setCursor(4, 12);
        text.print(`(${Math.round(x)}, ${Math.round(y)})  ${Math.round(angle) % 360}°`);
    }

    surface.queueDraw();
}

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
    } else {
        update(delta);
        draw();
        surface.present();
    }
    screen.present();

    frames++;
    fpsWindow += delta;
    if (fpsWindow >= 0.5) {
        fps = Math.round(frames / fpsWindow);
        frames = 0;
        fpsWindow = 0;
        hud.textContent = luaRunning
            ? `${fps} к/с виводу · кадр Lua ${host.frame} · пропущено ${host.skippedFrames} · ` +
              `масштаб ${screen.currentScale}×`
            : `${fps} к/с · масштаб ${screen.currentScale}× · кадр ${surface.frame} · ` +
              `${MODE_TITLES[mode]}${fullscreen ? '' : ' · статусбар'} · ` +
              `START — режим, SELECT — статусбар, A/B — обертання`;
    }
    shell.syncButtons();

    requestAnimationFrame(frame);
}

window.addEventListener('resize', () => shell.layout());
shell.layout();

// Шрифти вантажаться окремими чанками, тож перші кадри малюються без них,
// а після завантаження карта перемальовується.
drawCurrentCard();
surface.present();
screen.present(true);
requestAnimationFrame(frame);

void (async () => {
    await preloadFonts([...new Set([...TESTCARD_FONTS, DEFAULT_FONT])]);
    fonts = Object.fromEntries(
        TESTCARD_FONTS.map((name) => [name, getLoadedFont(name)]).filter(([, f]) => f),
    ) as Record<string, Font>;
    drawCurrentCard();
    drawCurrentCard();

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
