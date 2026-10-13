/**
 * Піксельний редактор: створення нової картинки й малювання в наявній.
 *
 * Полотно — `PixelImage`, тобто RGB565 або «прозоро» в кожній клітинці.
 * Будь-який колір із вибору одразу зводиться до 5-6-5, і квадратик поточного
 * кольору показує вже зведений: на екрані редактора видно рівно те, що
 * покаже Лілка, а не відтінок, який вона не відтворить.
 *
 * Малювання — лише через `pixel-art.ts`, а канва тут тільки показує готові
 * пікселі через `putImageData`. Її власні `lineTo`/`fillRect` згладжували б
 * краї й давали напівпрозорі пікселі, яких прошивка не знає.
 */

import { t, type Key } from '../i18n/index.ts';
import { COLORS, getBoard } from '../board/board.ts';
import { toHex } from '../emulator/color.ts';
import {
    History,
    MAX_SIDE,
    TRANSPARENT,
    clonePixels,
    createPixels,
    drawLine,
    drawRect,
    floodFill,
    fromRgba,
    getPixel,
    inside,
    luaHex,
    toRgba,
    type PixelImage,
} from '../emulator/pixel-art.ts';
import { iconElement } from './icons.ts';
import { createColorPicker } from './color-picker.ts';
import { openModal, footerButton } from './modal.ts';

type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'rectFill' | 'picker';

/** Клавіші — як у більшості растрових редакторів, щоб руки не переучувати. */
const TOOLS: ReadonlyArray<{ id: Tool; icon: string; key: string }> = [
    { id: 'pencil', icon: 'pencil', key: 'b' },
    { id: 'eraser', icon: 'eraser', key: 'e' },
    { id: 'fill', icon: 'bucket', key: 'g' },
    { id: 'line', icon: 'line', key: 'l' },
    { id: 'rect', icon: 'rect', key: 'r' },
    { id: 'rectFill', icon: 'rectFill', key: 'u' },
    { id: 'picker', icon: 'picker', key: 'i' },
];

const ZOOMS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

/** Сітка з'являється лише там, де клітинка досить велика, щоб її розгледіти. */
const GRID_MIN_ZOOM = 4;

/** Ім'я кольору з таблиці `colors` прошивки — його зручніше писати в Lua. */
function firmwareName(color: number): string | null {
    for (const [name, value] of Object.entries(COLORS)) if (value === color) return `colors.${name}`;
    return null;
}

/** Кольори картинки, найчастіші першими — щоб продовжити малювати її ж палітрою. */
function usedColors(image: PixelImage, limit: number): number[] {
    const counts = new Map<number, number>();
    for (const value of image.pixels) {
        if (value !== TRANSPARENT) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value]) => value);
}

/** Розпаковує байти картинки силами браузера й зводить до полотна. */
export async function decodePixels(bytes: Uint8Array): Promise<PixelImage> {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]));
    try {
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Не вдалося створити полотно');
        context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
        return fromRgba(data, bitmap.width, bitmap.height);
    } finally {
        bitmap.close();
    }
}

async function encodePng(image: PixelImage): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не вдалося створити полотно');
    context.putImageData(new ImageData(toRgba(image), image.width, image.height), 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Не вдалося зберегти PNG');
    return new Uint8Array(await blob.arrayBuffer());
}

/* ------------------------------------------------------ нова картинка -- */

export interface NewImage {
    name: string;
    width: number;
    height: number;
}

/**
 * Вікно «Нова картинка»: назва й розмір.
 *
 * Готові розміри — типові для спрайтів і повний екран Лілки (з `board.json`).
 * Назва без розширення отримує `.png`: інших форматів редактор не пише.
 */
export function openNewImageDialog(exists: (name: string) => boolean, onCreate: (image: NewImage) => void): void {
    const display = getBoard().display;
    const presets = [
        { label: '16×16', width: 16, height: 16 },
        { label: '32×32', width: 32, height: 32 },
        { label: '64×64', width: 64, height: 64 },
        { label: t('pixel.presetScreen', { w: display.width, h: display.height }), width: display.width, height: display.height },
    ];

    const modal = openModal({ title: t('pixel.newTitle'), fileName: '', className: 'dialog--newimg', isDirty: () => false });

    const form = document.createElement('div');
    form.className = 'newimg';

    const nameLabel = document.createElement('label');
    nameLabel.className = 'newimg__label';
    nameLabel.textContent = t('pixel.name');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'dialog__input newimg__name';
    nameInput.value = 'sprite.png';
    nameLabel.append(nameInput);

    const sizes = document.createElement('div');
    sizes.className = 'newimg__sizes';
    const sideInput = (label: string, value: number) => {
        const wrap = document.createElement('label');
        wrap.className = 'imgdlg__field';
        const span = document.createElement('span');
        span.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '1';
        input.max = String(MAX_SIDE);
        input.value = String(value);
        wrap.append(span, input);
        sizes.append(wrap);
        return input;
    };
    const widthInput = sideInput(t('image.width'), 32);
    const heightInput = sideInput(t('image.height'), 32);

    const chips = document.createElement('div');
    chips.className = 'newimg__presets';
    for (const preset of presets) {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'newimg__preset';
        chip.textContent = preset.label;
        chip.addEventListener('click', () => {
            widthInput.value = String(preset.width);
            heightInput.value = String(preset.height);
            validate();
        });
        chips.append(chip);
    }

    const error = document.createElement('div');
    error.className = 'newimg__error';

    form.append(nameLabel, sizes, chips, error);
    modal.body.append(form);

    const fileName = () => {
        const raw = nameInput.value.trim();
        return /\.png$/i.test(raw) ? raw : `${raw.replace(/\.[^.]*$/, '')}.png`;
    };

    const create = footerButton(t('pixel.create'), true, submit);
    modal.footer.append(footerButton(t('files.cancel'), false, modal.close), create);

    function validate(): boolean {
        const width = Number(widthInput.value);
        const height = Number(heightInput.value);
        let problem = '';
        if (!nameInput.value.trim() || nameInput.value.includes('/')) problem = t('pixel.badName');
        // Межа з прошивки: більшу картинку `loadImage` відкине
        else if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
            problem = t('pixel.badSize', { max: MAX_SIDE });
        } else if (exists(fileName())) problem = t('pixel.exists', { name: fileName() });
        error.textContent = problem;
        create.disabled = problem !== '';
        return problem === '';
    }

    function submit(): void {
        if (!validate()) return;
        modal.close();
        onCreate({ name: fileName(), width: Number(widthInput.value), height: Number(heightInput.value) });
    }

    for (const input of [nameInput, widthInput, heightInput]) {
        input.addEventListener('input', validate);
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') submit();
        });
    }

    validate();
    nameInput.focus();
    nameInput.setSelectionRange(0, nameInput.value.lastIndexOf('.'));
}

/* ------------------------------------------------------------ редактор -- */

export function openPixelEditor(options: {
    fileName: string;
    image: PixelImage;
    /** Нова картинка вважається зміненою: її ще немає на картці. */
    isNew: boolean;
    onSave: (data: Uint8Array) => void;
    onError: (error: unknown) => void;
}): void {
    const image = options.image;
    const history = new History();
    let dirty = options.isNew;
    let tool: Tool = 'pencil';
    let color = 0x0000;
    let showGrid = true;

    const modal = openModal({
        title: options.isNew ? t('pixel.newTitle') : t('pixel.editTitle'),
        fileName: `${options.fileName} · ${image.width}×${image.height}`,
        className: 'dialog--pixel',
        isDirty: () => dirty,
        onKey,
    });

    /* --- панель інструментів */
    const toolbar = document.createElement('div');
    toolbar.className = 'pixed__tools';

    const toolButtons = new Map<Tool, HTMLButtonElement>();
    for (const item of TOOLS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pixed__tool';
        button.title = `${t(`pixel.tool.${item.id}` as Key)} (${item.key.toUpperCase()})`;
        button.setAttribute('aria-label', t(`pixel.tool.${item.id}` as Key));
        button.append(iconElement(item.icon, 18));
        button.addEventListener('click', () => setTool(item.id));
        toolButtons.set(item.id, button);
        toolbar.append(button);
    }

    const separator = () => {
        const line = document.createElement('span');
        line.className = 'pixed__sep';
        toolbar.append(line);
    };

    const iconButton = (icon: string, title: string, run: () => void) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pixed__tool';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.append(iconElement(icon, 18));
        button.addEventListener('click', run);
        toolbar.append(button);
        return button;
    };

    separator();
    const undoButton = iconButton('undo', `${t('pixel.undo')} (Ctrl+Z)`, () => undo());
    const redoButton = iconButton('redo', `${t('pixel.redo')} (Ctrl+Shift+Z)`, () => redo());
    separator();
    const gridButton = iconButton('gridLines', `${t('pixel.grid')} (#)`, () => {
        showGrid = !showGrid;
        layout();
    });
    iconButton('zoomOut', `${t('pixel.zoomOut')} (−)`, () => stepZoom(-1));
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'pixed__zoom';
    toolbar.append(zoomLabel);
    iconButton('zoomIn', `${t('pixel.zoomIn')} (+)`, () => stepZoom(1));

    /* --- полотно */
    const stage = document.createElement('div');
    stage.className = 'pixed__stage';

    const board = document.createElement('div');
    board.className = 'pixed__board';

    const canvas = document.createElement('canvas');
    canvas.className = 'pixed__canvas';
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');

    const grid = document.createElement('div');
    grid.className = 'pixed__grid';

    board.append(canvas, grid);
    stage.append(board);

    /* --- бічна панель кольорів */
    const side = document.createElement('div');
    side.className = 'pixed__side';

    const current = document.createElement('div');
    current.className = 'pixed__current';
    const swatch = document.createElement('div');
    swatch.className = 'pixed__swatch';
    const colorText = document.createElement('div');
    colorText.className = 'pixed__color-text';
    current.append(swatch, colorText);

    // Будь-який колір — у кроках RGB565, а не системним вибором на 16 млн
    const picker = createColorPicker(COLORS, (value) => {
        setColor(value, false);
        if (tool === 'eraser' || tool === 'picker') setTool('pencil');
    });

    const paletteTitle = document.createElement('div');
    paletteTitle.className = 'pixed__label';
    paletteTitle.textContent = t('pixel.firmwareColors');
    const palette = document.createElement('div');
    palette.className = 'pixed__palette';

    const usedTitle = document.createElement('div');
    usedTitle.className = 'pixed__label';
    usedTitle.textContent = t('pixel.imageColors');
    const used = document.createElement('div');
    used.className = 'pixed__palette';

    const hint = document.createElement('div');
    hint.className = 'pixed__hint';
    hint.textContent = t('pixel.hint565');

    side.append(current, picker.root, paletteTitle, palette, usedTitle, used, hint);

    const main = document.createElement('div');
    main.className = 'pixed';
    const center = document.createElement('div');
    center.className = 'pixed__center';
    const status = document.createElement('div');
    status.className = 'pixed__status';
    center.append(stage, status);
    main.append(toolbar, center, side);
    modal.body.append(main);

    const saveButton = footerButton(t('image.save'), true, () => void save());
    modal.footer.append(footerButton(t('files.cancel'), false, modal.requestClose), saveButton);

    function swatchButton(value: number, label: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'pixed__chip';
        button.style.background = toHex(value);
        button.title = label;
        button.dataset.color = String(value);
        button.addEventListener('click', () => {
            setColor(value);
            if (tool === 'eraser' || tool === 'picker') setTool('pencil');
        });
        return button;
    }

    for (const [name, value] of Object.entries(COLORS)) palette.append(swatchButton(value, `colors.${name} = ${luaHex(value)}`));

    function drawUsed(): void {
        used.textContent = '';
        const colors = usedColors(image, 24);
        usedTitle.hidden = colors.length === 0;
        for (const value of colors) used.append(swatchButton(value, luaHex(value)));
        markChips();
    }

    function markChips(): void {
        for (const chip of side.querySelectorAll<HTMLElement>('.pixed__chip')) {
            chip.classList.toggle('is-on', Number(chip.dataset.color) === color);
        }
    }

    /* --- стан */
    function setTool(next: Tool): void {
        tool = next;
        for (const [id, button] of toolButtons) button.classList.toggle('is-on', id === tool);
        board.dataset.tool = tool;
    }

    /** `syncPicker: false` — колір прийшов із самого вибору, і йому не треба відлуння. */
    function setColor(value: number, syncPicker = true): void {
        color = value;
        // Показується вже зведений до 5-6-5 колір — саме його покаже Лілка
        if (syncPicker) picker.set(value);
        swatch.style.background = toHex(value);
        const name = firmwareName(value);
        colorText.textContent = '';
        const code = document.createElement('code');
        code.textContent = luaHex(value);
        colorText.append(code);
        if (name) {
            const named = document.createElement('span');
            named.textContent = name;
            colorText.append(named);
        }
        markChips();
    }

    /** Початковий масштаб — найбільший цілий, за якого картинка вміщається. */
    let zoom = (() => {
        // На телефоні поле вужче за вікно на відступи й рамки
        const fit = Math.min(Math.min(560, window.innerWidth - 80) / image.width, 420 / image.height);
        let best = 1;
        for (const z of ZOOMS) if (z <= fit) best = z;
        return best;
    })();

    function stepZoom(direction: number): void {
        const index = ZOOMS.indexOf(zoom);
        zoom = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, index + direction))];
        layout();
    }

    function layout(): void {
        const width = image.width * zoom;
        const height = image.height * zoom;
        board.style.width = `${width}px`;
        board.style.height = `${height}px`;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        grid.hidden = !showGrid || zoom < GRID_MIN_ZOOM;
        grid.style.backgroundSize = `${zoom}px ${zoom}px`;
        gridButton.classList.toggle('is-on', showGrid);
        zoomLabel.textContent = `${zoom}×`;
    }

    function paint(): void {
        context?.putImageData(new ImageData(toRgba(image), image.width, image.height), 0, 0);
        undoButton.disabled = !history.canUndo;
        redoButton.disabled = !history.canRedo;
    }

    function changed(): void {
        dirty = true;
        paint();
    }

    function undo(): void {
        if (history.undo(image)) changed();
        drawUsed();
    }

    function redo(): void {
        if (history.redo(image)) changed();
        drawUsed();
    }

    /* --- малювання вказівником */
    function cellAt(event: PointerEvent): { x: number; y: number } {
        const box = canvas.getBoundingClientRect();
        return {
            x: Math.floor(((event.clientX - box.left) / box.width) * image.width),
            y: Math.floor(((event.clientY - box.top) / box.height) * image.height),
        };
    }

    function showCursor(cell: { x: number; y: number } | null): void {
        const where = cell && inside(image, cell.x, cell.y) ? `x ${cell.x}, y ${cell.y}` : '';
        const value = cell ? getPixel(image, cell.x, cell.y) : TRANSPARENT;
        const under = where ? ` · ${value === TRANSPARENT ? t('pixel.transparent') : luaHex(value)}` : '';
        status.textContent = `${image.width}×${image.height}${where ? ' · ' + where : ''}${under}`;
    }

    /** Знімок до початку фігури: лінія й прямокутник перемальовуються з нього. */
    let stroke: { start: { x: number; y: number }; last: { x: number; y: number }; base: PixelImage | null } | null = null;

    canvas.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const cell = cellAt(event);

        if (tool === 'picker') {
            const value = getPixel(image, cell.x, cell.y);
            if (value === TRANSPARENT) setTool('eraser');
            else {
                setColor(value);
                setTool('pencil');
            }
            return;
        }

        if (tool === 'fill') {
            if (!inside(image, cell.x, cell.y)) return;
            history.push(image);
            floodFill(image, cell.x, cell.y, color);
            changed();
            drawUsed();
            return;
        }

        canvas.setPointerCapture(event.pointerId);
        history.push(image);
        const ink = tool === 'eraser' ? TRANSPARENT : color;
        stroke = { start: cell, last: cell, base: tool === 'pencil' || tool === 'eraser' ? null : clonePixels(image) };
        if (!stroke.base) drawLine(image, cell.x, cell.y, cell.x, cell.y, ink);
        else drawShape(cell);
        changed();
    });

    function drawShape(end: { x: number; y: number }): void {
        if (!stroke?.base) return;
        image.pixels.set(stroke.base.pixels);
        const { x, y } = stroke.start;
        if (tool === 'line') drawLine(image, x, y, end.x, end.y, color);
        else drawRect(image, x, y, end.x, end.y, color, tool === 'rectFill');
    }

    canvas.addEventListener('pointermove', (event) => {
        const cell = cellAt(event);
        showCursor(cell);
        if (!stroke) return;
        if (cell.x === stroke.last.x && cell.y === stroke.last.y) return;

        if (stroke.base) drawShape(cell);
        else drawLine(image, stroke.last.x, stroke.last.y, cell.x, cell.y, tool === 'eraser' ? TRANSPARENT : color);
        stroke.last = cell;
        paint();
    });

    const endStroke = () => {
        if (!stroke) return;
        stroke = null;
        drawUsed();
    };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', () => showCursor(null));

    /* --- клавіші */
    function onKey(event: KeyboardEvent): void {
        const target = event.target as HTMLElement | null;
        if (target && target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'color') return;
        const mod = event.ctrlKey || event.metaKey;
        const key = event.key.toLowerCase();

        if (mod && key === 'z') {
            event.preventDefault();
            if (event.shiftKey) redo();
            else undo();
            return;
        }
        if (mod && key === 'y') {
            event.preventDefault();
            redo();
            return;
        }
        if (mod && key === 's') {
            event.preventDefault();
            void save();
            return;
        }
        if (mod || event.altKey) return;

        const item = TOOLS.find((candidate) => candidate.key === key);
        if (item) setTool(item.id);
        else if (key === '+' || key === '=') stepZoom(1);
        else if (key === '-') stepZoom(-1);
        else if (key === '#') {
            showGrid = !showGrid;
            layout();
        } else return;
        event.preventDefault();
    }

    async function save(): Promise<void> {
        saveButton.disabled = true;
        try {
            const data = await encodePng(image);
            dirty = false;
            modal.close();
            options.onSave(data);
        } catch (error) {
            saveButton.disabled = false;
            options.onError(error);
        }
    }

    setTool('pencil');
    setColor(usedColors(image, 1)[0] ?? 0x0000);
    layout();
    paint();
    drawUsed();
    showCursor(null);
}

/** Порожнє полотно для нової картинки — повністю прозоре. */
export function blankImage(width: number, height: number): PixelImage {
    return createPixels(width, height, TRANSPARENT);
}
