/**
 * Друга еталонна карта — растрові зображення та перетворення.
 *
 * Винесена окремо від геометричної, щоб координати тієї лишалися незмінними.
 *
 * Спрайт створюється ПРОЦЕДУРНО, без файлів. Це навмисно: той самий спрайт
 * можна побудувати в Lua кількома рядками, тож карту легко відтворити на
 * справжній Лілці й порівняти піксель у піксель, не морочячись із SD-картою.
 */

import { color565 } from './color.ts';
import type { Framebuffer } from './framebuffer.ts';
import { Image, NO_TRANSPARENT_COLOR } from './image.ts';
import { Transform } from './transform.ts';
import { TextRenderer } from './text.ts';
import type { Font } from './font.ts';

const BG = color565(8, 12, 24);
const WHITE = color565(255, 255, 255);
const MAGENTA = color565(255, 0, 255);
const GREY = color565(90, 96, 110);

/**
 * Спрайт 24x24: рамка, шахівниця, діагональ і кутова мітка.
 * Мітка робить очевидним, куди повернулося зображення.
 */
export function makeSprite(transparentColor: number): Image {
    const size = 24;
    const image = new Image(size, size, transparentColor, 12, 12);
    const put = (x: number, y: number, c: number) => {
        image.pixels[x + y * size] = c;
    };

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
            const checker = ((x >> 2) + (y >> 2)) % 2 === 0;
            if (border) put(x, y, WHITE);
            else if (x === y) put(x, y, color565(255, 200, 0));
            else if (checker) put(x, y, color565(0, 140, 255));
            else put(x, y, transparentColor === NO_TRANSPARENT_COLOR ? color565(20, 30, 60) : transparentColor);
        }
    }
    // мітка у лівому верхньому куті
    for (let y = 2; y < 7; y++) for (let x = 2; x < 7; x++) put(x, y, color565(255, 0, 0));
    return image;
}

export function drawImageTestCard(fb: Framebuffer, fonts: Record<string, Font> = {}): void {
    fb.fillScreen(BG);
    fb.drawRect(0, 0, fb.width, fb.height, GREY);

    const text = new TextRenderer(fb);
    if (fonts['5x7']) {
        text.setFont(fonts['5x7']);
        text.setTextColor(WHITE);
    }
    const label = (x: number, y: number, s: string) => {
        if (!fonts['5x7']) return;
        text.setCursor(x, y);
        text.print(s);
    };

    const opaque = makeSprite(NO_TRANSPARENT_COLOR);
    const keyed = makeSprite(MAGENTA);

    // --- ряд 1: без перетворень -----------------------------------------
    label(8, 16, 'draw_image');
    fb.fillRect(8, 22, 24, 24, color565(60, 0, 0));
    fb.drawImage(opaque, 20, 34);

    label(48, 16, 'transparent');
    fb.fillRect(48, 22, 24, 24, color565(60, 0, 0));
    fb.drawImage(keyed, 60, 34);

    label(88, 16, 'flip x / y');
    fb.drawImage(opaque.flipX(), 100, 34);
    fb.drawImage(opaque.flipY(), 130, 34);

    label(160, 16, 'rotate_image 30');
    fb.drawImage(opaque.rotate(30, BG), 172, 34);
    fb.drawImage(keyed.rotate(30, MAGENTA), 202, 34);

    // --- ряд 2: перетворення --------------------------------------------
    label(8, 74, 'transform: rotate');
    let x = 20;
    for (const angle of [0, 15, 30, 45, 60, 90]) {
        fb.drawImageTransformed(keyed, x, 96, new Transform().rotate(angle));
        x += 34;
    }

    label(8, 132, 'transform: scale + rotate');
    fb.drawImageTransformed(keyed, 24, 156, new Transform().scale(2, 2));
    fb.drawImageTransformed(keyed, 76, 156, new Transform().scale(2, 1));
    fb.drawImageTransformed(keyed, 124, 156, new Transform().scale(1, 2));
    fb.drawImageTransformed(keyed, 170, 156, new Transform().scale(1.5, 1.5).rotate(30));
    fb.drawImageTransformed(keyed, 230, 156, new Transform().rotate(30).scale(1.5, 1.5));

    // --- ряд 3: особливість первотвору ----------------------------------
    // Обертання зображення БЕЗ прозорого кольору дає білі кути: поза межами
    // джерела прошивка пише transparentColor, тобто -1, а це 0xFFFF.
    label(8, 194, 'no transparent color -> white corners');
    fb.drawImageTransformed(opaque, 24, 216, new Transform().rotate(30));
    fb.drawImageTransformed(opaque, 64, 216, new Transform().rotate(45));

    label(110, 216, 'pivot 12,12');
    fb.drawPixel(24, 216, color565(0, 255, 0));
    fb.drawPixel(64, 216, color565(0, 255, 0));
}
