/**
 * Піктограми файлів — ті самі, що на екрані Лілки.
 *
 * Дані витягнуті з `keira/src/apps/icons/*.h` скриптом `gen-icons.mjs`. Це
 * зображення 24x24 у форматі RGB565, які файловий менеджер прошивки малює
 * через `draw16bitRGBBitmapWithTranColor` із чорним як прозорим кольором.
 *
 * Тут вони перетворюються на data-URL один раз і кешуються: піктограма
 * малюється в кожному рядку списку, тож щоразу будувати полотно було б марно.
 */

import { KEYBOARD_ICONS, type IconData } from '../generated/icons.ts';
import { toRgb888 } from '../emulator/color.ts';

const cache = new Map<string, string>();

/**
 * Перетворює RGB565 на data-URL.
 *
 * Чорний піксель стає прозорим — так само, як його трактує прошивка. Інакше
 * піктограма мала б чорний прямокутник довкола, бо на пристрої тло екрана й
 * так чорне, а в браузері воно світле.
 */
function toDataUrl(icon: IconData): string {
    const canvas = document.createElement('canvas');
    canvas.width = icon.width;
    canvas.height = icon.height;

    const context = canvas.getContext('2d');
    if (!context) return '';

    const image = context.createImageData(icon.width, icon.height);
    for (let i = 0; i < icon.pixels.length; i++) {
        const pixel = icon.pixels[i];
        const [r, g, b] = toRgb888(pixel);
        const at = i * 4;
        image.data[at] = r;
        image.data[at + 1] = g;
        image.data[at + 2] = b;
        image.data[at + 3] = pixel === 0 ? 0 : 255;
    }
    context.putImageData(image, 0, 0);
    return canvas.toDataURL();
}

export function iconUrl(name: string): string | null {
    const cached = cache.get(name);
    if (cached !== undefined) return cached || null;

    const icon = KEYBOARD_ICONS[name];
    if (!icon) {
        cache.set(name, '');
        return null;
    }

    const url = toDataUrl(icon);
    cache.set(name, url);
    return url || null;
}

/** Підбирає піктограму за іменем файлу — так само, як менеджер на пристрої. */
export function iconForFile(name: string, isDirectory: boolean): string | null {
    if (isDirectory) return iconUrl('folder');

    const lower = name.toLowerCase();
    if (lower.endsWith('.lua')) return iconUrl('lua');
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return iconUrl('js');
    if (lower.endsWith('.bin')) return iconUrl('bin');
    if (lower.endsWith('.nes')) return iconUrl('nes');
    if (lower.endsWith('.mp3') || lower.endsWith('.wav')) return iconUrl('music');
    if (lower.endsWith('.state') || lower.endsWith('.json')) return iconUrl('settings');
    return iconUrl('app');
}

/** Створює готовий елемент із піктограмою потрібного розміру. */
export function iconElement(name: string, isDirectory: boolean, size: number): HTMLElement {
    const url = iconForFile(name, isDirectory);
    const element = document.createElement('img');
    element.className = 'icon';
    element.width = size;
    element.height = size;
    element.alt = '';
    if (url) element.src = url;
    return element;
}
