/**
 * Еталонна тест-карта.
 *
 * Задіює кожен примітив і кожен шрифт рівно один раз, з фіксованими
 * координатами. Призначення подвійне:
 *   1. під час розробки видно, що рендерер живий;
 *   2. згодом ту саму карту можна намалювати на справжній Лілці, зняти екран і
 *      порівняти піксель у піксель.
 *
 * Тому координати тут не варто змінювати без потреби, а Lua-відповідник має
 * лежати поруч і давати ідентичний результат.
 */

import { color565 } from './color.ts';
import type { Framebuffer } from './framebuffer.ts';
import type { Font } from './font.ts';
import { TextRenderer } from './text.ts';

const BG = color565(8, 12, 24);
const WHITE = color565(255, 255, 255);
const RED = color565(255, 0, 0);
const GREEN = color565(0, 255, 0);
const BLUE = color565(0, 80, 255);
const YELLOW = color565(255, 220, 0);
const MAGENTA = color565(255, 0, 200);
const CYAN = color565(0, 220, 220);

/** Рядки навмисно містять літери, яких немає в російській абетці. */
const SAMPLE_UA = 'Привіт, Лілко!';
const SAMPLE_GLYPHS = 'ҐґЄєІіЇїЙй 0123456789';

export function drawTestCard(fb: Framebuffer, fonts: Record<string, Font> = {}): void {
    fb.fillScreen(BG);
    fb.drawRect(0, 0, fb.width, fb.height, WHITE);

    // --- ряд 1: лінії, прямокутники, кола -------------------------------
    for (let i = 0; i <= 8; i++) {
        fb.drawLine(8, 8, 8 + i * 7, 62, CYAN);
    }
    fb.drawLine(8, 68, 72, 68, WHITE);
    fb.drawLine(76, 8, 76, 68, WHITE);

    fb.drawRect(88, 8, 52, 26, GREEN);
    fb.fillRect(88, 40, 52, 28, GREEN);

    fb.drawCircle(178, 38, 28, YELLOW);
    fb.fillCircle(240, 38, 22, YELLOW);

    // --- ряд 2: трикутники, еліпси, дуги --------------------------------
    fb.drawTriangle(10, 78, 66, 86, 30, 126, RED);
    fb.fillTriangle(76, 78, 132, 90, 96, 126, RED);

    fb.drawEllipse(180, 100, 32, 20, MAGENTA);
    fb.fillEllipse(246, 100, 22, 15, MAGENTA);

    fb.drawArc(40, 150, 22, 13, 0, 135, BLUE);
    fb.fillArc(100, 150, 22, 12, 210, 330, BLUE);
    fb.drawArc(160, 150, 22, 13, 45, 315, BLUE);

    // --- ряд 3: текст ---------------------------------------------------
    const text = new TextRenderer(fb);
    text.setTextColor(WHITE);

    if (fonts['6x13']) {
        text.setFont(fonts['6x13']);
        text.setTextSize(1);
        text.setCursor(8, 182);
        text.print(SAMPLE_UA);
    }

    if (fonts['5x7']) {
        text.setFont(fonts['5x7']);
        text.setTextSize(1);
        text.setCursor(8, 194);
        text.setTextColor(CYAN);
        text.print(SAMPLE_GLYPHS);
    }

    if (fonts['10x20']) {
        text.setFont(fonts['10x20']);
        text.setTextSize(1);
        text.setCursor(8, 214);
        text.setTextColor(YELLOW);
        text.print('Лілка');
    }

    // масштаб 2 — перевірка, що зсуви теж множаться
    if (fonts['5x7']) {
        text.setFont(fonts['5x7']);
        text.setTextSize(2);
        text.setCursor(120, 214);
        text.setTextColor(GREEN);
        text.print('x2 Тест');
    }

    // --- градієнт: контроль квантування 5-6-5 ---------------------------
    // на 280 пікселях мають бути видні рівно 32 сходинки по каналу R
    // і 64 по сірому — це властивість формату, а не помилка
    for (let x = 0; x < fb.width; x++) {
        const v = Math.round((x / (fb.width - 1)) * 255);
        fb.writeFastVLine(x, fb.height - 20, 9, color565(v, 0, 0));
        fb.writeFastVLine(x, fb.height - 11, 9, color565(v, v, v));
    }

    // --- кути: по одному пікселю, щоб зловити помилки відсікання ---------
    fb.drawPixel(0, 0, RED);
    fb.drawPixel(fb.width - 1, 0, GREEN);
    fb.drawPixel(0, fb.height - 1, BLUE);
    fb.drawPixel(fb.width - 1, fb.height - 1, YELLOW);
}
