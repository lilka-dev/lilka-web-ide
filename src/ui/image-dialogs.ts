/**
 * Два вікна для необоротних дій над картинкою.
 *
 * Поворот і дзеркало вікна не потребують: вони оборотні, тож достатньо пункту
 * меню. Розмір і обрізання незворотні — зменшені пікселі не повернути — і саме
 * тому їм потрібно показати результат до того, як людина погодиться.
 *
 * Обидва вікна одноразові: одна дія, тож «Скасувати» замінює історію правок.
 */

import { t } from '../i18n/index.ts';
import {
    clampCrop,
    nearestWholeScale,
    scaledSide,
    type Rect,
} from '../emulator/image-edit.ts';

/** Екран Лілки: 280×240, кути заокруглені радіусом 34 — як на платі. */
const SCREEN_WIDTH = 280;
const SCREEN_HEIGHT = 240;
const SCREEN_RADIUS = 34;

/** Спільний каркас: затемнення, вікно, заголовок і підвал із двома кнопками. */
function shell(title: string, fileName: string): {
    overlay: HTMLElement;
    dialog: HTMLElement;
    body: HTMLElement;
    footer: HTMLElement;
    close: () => void;
} {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog dialog--image';

    const head = document.createElement('div');
    head.className = 'dialog__title imgdlg__head';

    const heading = document.createElement('span');
    heading.textContent = title;

    const name = document.createElement('span');
    name.className = 'imgdlg__name';
    name.textContent = fileName;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'imgdlg__close';
    closeButton.textContent = '×';
    closeButton.title = t('files.cancel');

    head.append(heading, name, closeButton);

    const body = document.createElement('div');
    const footer = document.createElement('div');
    footer.className = 'dialog__footer';

    dialog.append(head, body, footer);
    overlay.append(dialog);

    const close = () => overlay.remove();
    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', function onKey(event) {
        if (event.key !== 'Escape') return;
        if (!overlay.isConnected) {
            document.removeEventListener('keydown', onKey);
            return;
        }
        close();
    });

    document.body.append(overlay);
    return { overlay, dialog, body, footer, close };
}

/** Дві кнопки підвалу. */
function actions(footer: HTMLElement, confirmLabel: string, onConfirm: () => void, onCancel: () => void): void {
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'button';
    cancel.textContent = t('files.cancel');
    cancel.addEventListener('click', onCancel);

    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'button button--primary';
    confirm.textContent = confirmLabel;
    confirm.addEventListener('click', onConfirm);

    footer.append(cancel, confirm);
}

/** Поле з підписом. Обидві сторони виглядають однаково — вводиться будь-яка. */
function field(labelText: string, value: number): { wrap: HTMLElement; input: HTMLInputElement } {
    const wrap = document.createElement('label');
    wrap.className = 'imgdlg__field';

    const label = document.createElement('span');
    label.textContent = labelText;

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.value = String(value);

    wrap.append(label, input);
    return { wrap, input };
}

/* ------------------------------------------------- зміна розміру ------- */

export interface ResizeResult {
    width: number;
    height: number;
}

/**
 * Вікно зміни розміру.
 *
 * Пропорції зв'язані в обидва боки: змінив ширину — підрахувалася висота, і
 * навпаки. Непропорційна зміна розтягує спрайт, і для піксель-арту це майже
 * завжди помилка, а не намір.
 */
export function openResizeDialog(
    fileName: string,
    bitmap: ImageBitmap,
    onApply: (result: ResizeResult) => void,
): void {
    const { body, footer, close } = shell(t('image.resizeTitle'), fileName);

    const source = { width: bitmap.width, height: bitmap.height };
    let current = { width: bitmap.width, height: bitmap.height };

    /* --- полотно */
    const stage = document.createElement('div');
    stage.className = 'imgdlg__stage';

    const screen = document.createElement('div');
    screen.className = 'imgdlg__screen';
    screen.style.width = `${SCREEN_WIDTH}px`;
    screen.style.height = `${SCREEN_HEIGHT}px`;
    screen.style.borderRadius = `${SCREEN_RADIUS}px`;
    screen.hidden = true;

    const frame = document.createElement('div');
    frame.className = 'imgdlg__frame';

    const canvas = document.createElement('canvas');
    canvas.className = 'imgdlg__canvas';

    frame.append(canvas);
    for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('span');
        handle.className = `imgdlg__handle imgdlg__handle--${corner}`;
        handle.dataset.corner = corner;
        frame.append(handle);
    }

    stage.append(screen, frame);

    /* --- керування */
    const controls = document.createElement('div');
    controls.className = 'imgdlg__controls';

    const widthField = field(t('image.width'), current.width);
    const heightField = field(t('image.height'), current.height);

    const screenToggle = document.createElement('button');
    screenToggle.type = 'button';
    screenToggle.className = 'button imgdlg__screen-toggle';
    screenToggle.textContent = t('image.lilkaScreen');
    screenToggle.addEventListener('click', () => {
        screen.hidden = !screen.hidden;
        screenToggle.classList.toggle('is-on', !screen.hidden);
        draw();
    });

    controls.append(widthField.wrap, heightField.wrap, screenToggle);
    body.append(stage, controls);

    /* --- малювання */
    const context = canvas.getContext('2d');

    function draw(): void {
        canvas.width = current.width;
        canvas.height = current.height;
        canvas.style.width = `${current.width}px`;
        canvas.style.height = `${current.height}px`;
        frame.style.width = `${current.width}px`;
        frame.style.height = `${current.height}px`;

        if (!context) return;
        context.imageSmoothingEnabled = false;
        context.clearRect(0, 0, current.width, current.height);
        context.drawImage(bitmap, 0, 0, current.width, current.height);
    }

    function setWidth(value: number): void {
        const width = Math.max(1, Math.round(value));
        current = { width, height: scaledSide(source.height, source.width, width) };
        heightField.input.value = String(current.height);
        draw();
    }

    function setHeight(value: number): void {
        const height = Math.max(1, Math.round(value));
        current = { width: scaledSide(source.width, source.height, height), height };
        widthField.input.value = String(current.width);
        draw();
    }

    widthField.input.addEventListener('input', () => setWidth(Number(widthField.input.value)));
    heightField.input.addEventListener('input', () => setHeight(Number(heightField.input.value)));

    /* --- перетягування кутика */
    let dragging: { startX: number; startWidth: number; sign: number } | null = null;

    frame.addEventListener('pointerdown', (event) => {
        const target = event.target as HTMLElement;
        const corner = target.dataset.corner;
        if (!corner) return;

        event.preventDefault();
        target.setPointerCapture(event.pointerId);
        dragging = {
            startX: event.clientX,
            startWidth: current.width,
            // Західні кутики ростуть у протилежний бік
            sign: corner.endsWith('w') ? -1 : 1,
        };
    });

    frame.addEventListener('pointermove', (event) => {
        if (!dragging) return;

        const raw = dragging.startWidth + (event.clientX - dragging.startX) * dragging.sign * 2;

        /*
         * Прилипання до цілої кратності.
         *
         * Перетягування дає довільний масштаб на кшталт 1,37×, а на такому
         * піксель-арт сходинкує: одні пікселі подвоюються, інші ні. Ціла
         * кратність лишає їх рівними, тож рамка до неї притягується.
         */
        const whole = nearestWholeScale(source.width, raw);
        const width = whole === null ? raw : Math.round(source.width * whole);
        setWidth(width);
        widthField.input.value = String(current.width);
    });

    const endDrag = () => {
        dragging = null;
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);

    actions(
        footer,
        t('image.save'),
        () => {
            close();
            onApply({ width: current.width, height: current.height });
        },
        close,
    );

    draw();
    widthField.input.focus();
    widthField.input.select();
}

/* ---------------------------------------------------- обрізання -------- */

/**
 * Вікно обрізання.
 *
 * Сама рамка й нічого більше: числа тут зайві, бо ділянку вибирають очима, а
 * не обчислюють. Розмір підписаний просто на рамці, щоб було видно, що вийде.
 */
export function openCropDialog(
    fileName: string,
    bitmap: ImageBitmap,
    onApply: (rect: Rect) => void,
): void {
    const { body, footer, close } = shell(t('image.cropTitle'), fileName);

    /** Типова рамка — середні дві третини: щось вибрано, але є куди тягнути. */
    let rect: Rect = clampCrop(
        {
            x: Math.round(bitmap.width / 6),
            y: Math.round(bitmap.height / 6),
            width: Math.round((bitmap.width * 2) / 3),
            height: Math.round((bitmap.height * 2) / 3),
        },
        bitmap.width,
        bitmap.height,
    );

    const stage = document.createElement('div');
    stage.className = 'imgdlg__stage';

    const holder = document.createElement('div');
    holder.className = 'imgdlg__crop-holder';
    holder.style.width = `${bitmap.width}px`;
    holder.style.height = `${bitmap.height}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'imgdlg__canvas';
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext('2d');
    if (context) {
        context.imageSmoothingEnabled = false;
        context.drawImage(bitmap, 0, 0);
    }

    const frame = document.createElement('div');
    frame.className = 'imgdlg__crop-frame';

    const size = document.createElement('span');
    size.className = 'imgdlg__crop-size';
    frame.append(size);

    for (const corner of ['nw', 'ne', 'sw', 'se']) {
        const handle = document.createElement('span');
        handle.className = `imgdlg__handle imgdlg__handle--${corner}`;
        handle.dataset.corner = corner;
        frame.append(handle);
    }

    holder.append(canvas, frame);
    stage.append(holder);
    body.append(stage);

    function place(): void {
        frame.style.left = `${rect.x}px`;
        frame.style.top = `${rect.y}px`;
        frame.style.width = `${rect.width}px`;
        frame.style.height = `${rect.height}px`;
        size.textContent = `${rect.width}×${rect.height}`;
    }

    /* --- тягання рамки й кутиків */
    let drag: { corner: string | null; x: number; y: number; start: Rect } | null = null;

    frame.addEventListener('pointerdown', (event) => {
        const target = event.target as HTMLElement;
        event.preventDefault();
        target.setPointerCapture(event.pointerId);
        drag = {
            corner: target.dataset.corner ?? null,
            x: event.clientX,
            y: event.clientY,
            start: { ...rect },
        };
    });

    frame.addEventListener('pointermove', (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const s = drag.start;

        if (drag.corner === null) {
            // Тягнемо всю рамку
            rect = clampCrop({ ...s, x: s.x + dx, y: s.y + dy }, bitmap.width, bitmap.height);
        } else {
            const west = drag.corner.endsWith('w');
            const north = drag.corner.startsWith('n');
            rect = clampCrop(
                {
                    x: west ? s.x + dx : s.x,
                    y: north ? s.y + dy : s.y,
                    width: west ? s.width - dx : s.width + dx,
                    height: north ? s.height - dy : s.height + dy,
                },
                bitmap.width,
                bitmap.height,
            );
        }
        place();
    });

    const endDrag = () => {
        drag = null;
    };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);

    actions(
        footer,
        t('image.save'),
        () => {
            close();
            onApply(rect);
        },
        close,
    );

    place();
}
