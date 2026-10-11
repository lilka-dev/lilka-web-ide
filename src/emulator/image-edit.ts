/**
 * Операції над картинками: поворот, дзеркало, розмір, обрізання.
 *
 * Усе малюється через канву браузера з **вимкненим згладжуванням**. Для
 * піксель-арту це не налаштування, а вимога: згладжування розмиває чіткі межі,
 * а прошивка знає лише «видно» і «не видно» (`loadImagePNG` зводить альфу до
 * одного біта), тож розмиті краї перетворилися б на брудну облямівку навколо
 * спрайта.
 *
 * Найближчий сусід ще й зручний тим, що кожен піксель результату — копія
 * одного пікселя первотвору. Тобто жодних нових напівпрозорих значень не
 * виникає, і те, що було чітким, лишається чітким.
 *
 * Результат завжди PNG: BMP має чотири пастки прошивки (вирівнювання рядків,
 * беззнакова висота, відкинута альфа, обмеження розміру), і перезаписувати в
 * нього означало б повертати ті пастки назад.
 *
 * Чисті обчислення винесені окремо від канви — канви під Node немає, а саме в
 * обчисленнях і живуть помилки округлення.
 */

/** Куди повертати. */
export type RotateDirection = 'left' | 'right';

/** Розмір після повороту на 90°: сторони міняються місцями. */
export function rotatedSize(width: number, height: number): { width: number; height: number } {
    return { width: height, height: width };
}

/**
 * Друга сторона при пропорційній зміні.
 *
 * `Math.round`, а не `Math.trunc`: тут не йдеться про відтворення поведінки C,
 * а про найближчий до справжніх пропорцій розмір. Нуль неможливий — навіть
 * найтонша картинка лишається завширшки й заввишки хоча б у піксель.
 */
export function scaledSide(side: number, from: number, to: number): number {
    if (from <= 0) return Math.max(1, Math.round(side));
    return Math.max(1, Math.round((side * to) / from));
}

/** Чи є масштаб цілою кратністю — до неї прилипає перетягування кутика. */
export function nearestWholeScale(from: number, to: number): number | null {
    if (from <= 0) return null;
    const scale = to / from;

    // Збільшення цілою кратністю лишає пікселі квадратними; зменшення
    // кратністю ділить їх націло. Між цими значеннями піксель-арт сходинкує.
    for (const candidate of [1, 2, 3, 4, 5, 6, 8]) {
        if (Math.abs(scale - candidate) < 0.12) return candidate;
        if (Math.abs(scale - 1 / candidate) < 0.06) return 1 / candidate;
    }
    return null;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Заганяє рамку обрізання в межі картинки.
 *
 * Рамку тягають мишею, тож вона легко виїжджає за край. Порожня рамка теж
 * неможлива: щонайменше один піксель.
 */
export function clampCrop(rect: Rect, imageWidth: number, imageHeight: number): Rect {
    const x = Math.max(0, Math.min(Math.round(rect.x), imageWidth - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), imageHeight - 1));
    const width = Math.max(1, Math.min(Math.round(rect.width), imageWidth - x));
    const height = Math.max(1, Math.min(Math.round(rect.height), imageHeight - y));
    return { x, y, width, height };
}

/* --------------------------------------------------- робота з канвою ---- */

/** Розбирає байти силами браузера: PNG, BMP і JPEG він знає сам. */
export async function decodeImage(bytes: Uint8Array): Promise<ImageBitmap> {
    const copy = new Uint8Array(bytes);
    const blob = new Blob([copy.buffer as ArrayBuffer]);
    return createImageBitmap(blob);
}

/** Спільна частина: готує канву потрібного розміру й віддає PNG. */
async function render(
    width: number,
    height: number,
    paint: (context: CanvasRenderingContext2D) => void,
): Promise<Uint8Array> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не вдалося створити полотно');

    // Найближчий сусід — див. пояснення у шапці файлу
    context.imageSmoothingEnabled = false;
    paint(context);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Не вдалося зберегти PNG');
    return new Uint8Array(await blob.arrayBuffer());
}

/** Ім'я з розширенням `.png`: результат завжди PNG. */
export function pngName(name: string): string {
    return name.replace(/\.[^.]*$/, '') + '.png';
}

/**
 * Поворот на 90°.
 *
 * Без втрат: пікселі лише переставляються, жодного нового значення не
 * з'являється. Саме тому дія оборотна — повернути назад дає точно той самий
 * файл, і саме тому вона не потребує вікна з переглядом.
 */
export async function rotateImage(bytes: Uint8Array, direction: RotateDirection): Promise<Uint8Array> {
    const bitmap = await decodeImage(bytes);
    const size = rotatedSize(bitmap.width, bitmap.height);

    try {
        return await render(size.width, size.height, (context) => {
            context.translate(size.width / 2, size.height / 2);
            context.rotate(((direction === 'right' ? 90 : -90) * Math.PI) / 180);
            context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
        });
    } finally {
        bitmap.close();
    }
}

/** Дзеркало по горизонталі. Теж без втрат і теж оборотне. */
export async function mirrorImage(bytes: Uint8Array): Promise<Uint8Array> {
    const bitmap = await decodeImage(bytes);

    try {
        return await render(bitmap.width, bitmap.height, (context) => {
            context.translate(bitmap.width, 0);
            context.scale(-1, 1);
            context.drawImage(bitmap, 0, 0);
        });
    } finally {
        bitmap.close();
    }
}

/** Зміна розміру. Необоротна: зменшені пікселі не повернути. */
export async function resizeImage(bytes: Uint8Array, width: number, height: number): Promise<Uint8Array> {
    const bitmap = await decodeImage(bytes);

    try {
        return await render(Math.max(1, width), Math.max(1, height), (context) => {
            context.drawImage(bitmap, 0, 0, Math.max(1, width), Math.max(1, height));
        });
    } finally {
        bitmap.close();
    }
}

/** Обрізання. Пікселі беруться як є — ділянка просто вирізається. */
export async function cropImage(bytes: Uint8Array, rect: Rect): Promise<Uint8Array> {
    const bitmap = await decodeImage(bytes);
    const safe = clampCrop(rect, bitmap.width, bitmap.height);

    try {
        return await render(safe.width, safe.height, (context) => {
            context.drawImage(
                bitmap,
                safe.x,
                safe.y,
                safe.width,
                safe.height,
                0,
                0,
                safe.width,
                safe.height,
            );
        });
    } finally {
        bitmap.close();
    }
}
