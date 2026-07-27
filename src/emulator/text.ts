/**
 * Текстовий шар — стан і правила, за якими `display.print` малює рядки.
 *
 * Портовано з `Arduino_GFX::write()` для шрифтів u8g2:
 *   - `cursorY` — БАЗОВА ЛІНІЯ, а не верх рядка;
 *   - перенос рядка додає `scaleY * maxCharHeight` (саме max_char_height із
 *     заголовка шрифту, а не висоту з ascent/descent — це різні числа);
 *   - автоперенос спрацьовує ДО малювання символу, за умовою
 *     `cursorX + scaleX * glyphWidth - 1 > maxTextX`;
 *   - курсор зсувається на `scaleX * delta_x`, а не на ширину бітмапи;
 *   - `\r` ігнорується.
 *
 * Межі задає `display.set_text_bound(x, y, w, h)`.
 */

import type { Framebuffer } from './framebuffer.ts';
import { drawGlyph, type Font } from './font.ts';

export class TextRenderer {
    cursorX = 0;
    cursorY = 0;
    scaleX = 1;
    scaleY = 1;
    color = 0xffff;
    /** null — прозорий фон (у прошивці це стан, коли колір фону не заданий). */
    bgColor: number | null = null;
    wrap = true;

    private font: Font | null;
    private readonly fb: Framebuffer;
    private minTextX = 0;
    private maxTextX: number;
    private maxTextY: number;

    constructor(fb: Framebuffer, font: Font | null = null) {
        this.fb = fb;
        this.font = font;
        this.maxTextX = fb.width - 1;
        this.maxTextY = fb.height - 1;
    }

    setFont(font: Font): void {
        this.font = font;
    }

    get currentFont(): Font | null {
        return this.font;
    }

    setCursor(x: number, y: number): void {
        this.cursorX = x;
        this.cursorY = y;
    }

    setTextSize(size: number, sizeY: number = size): void {
        this.scaleX = Math.max(1, Math.trunc(size));
        this.scaleY = Math.max(1, Math.trunc(sizeY));
    }

    setTextColor(color: number, bgColor?: number): void {
        this.color = color;
        this.bgColor = bgColor === undefined ? null : bgColor;
    }

    setTextBound(x: number, y: number, w: number, h: number): void {
        this.minTextX = x;
        this.maxTextX = x + w - 1;
        this.maxTextY = y + h - 1;
    }

    /** Крок рядка в пікселях при поточному масштабі. */
    get lineAdvance(): number {
        return this.scaleY * (this.font?.maxCharHeight ?? 0);
    }

    newline(): void {
        this.cursorX = this.minTextX;
        this.cursorY += this.lineAdvance;
    }

    writeCodepoint(codepoint: number): void {
        if (codepoint === 0x0a) {
            this.newline();
            return;
        }
        if (codepoint === 0x0d) return;

        const glyph = this.font?.glyph(codepoint);
        if (!glyph) return;

        if (glyph.width > 0 && this.wrap) {
            if (this.cursorX + this.scaleX * glyph.width - 1 > this.maxTextX) {
                this.newline();
            }
        }

        if (this.cursorY - glyph.offsetY * this.scaleY <= this.maxTextY) {
            drawGlyph(this.fb, glyph, this.cursorX, this.cursorY, this.scaleX, this.scaleY, this.color, this.bgColor);
        }

        this.cursorX += this.scaleX * glyph.advance;
    }

    write(text: string): void {
        for (const ch of text) this.writeCodepoint(ch.codePointAt(0)!);
    }

    /** Відповідник `display.print(...)`: склеює аргументи без розділювача. */
    print(...values: unknown[]): void {
        for (const value of values) this.write(String(value ?? 'nil'));
    }

    /** Ширина рядка в пікселях з урахуванням масштабу. */
    measure(text: string): number {
        return (this.font?.measure(text) ?? 0) * this.scaleX;
    }

    /**
     * Порт `Arduino_GFX::getTextBounds`.
     *
     * Повертає обмежувальну рамку рядка відносно позиції курсора. Потрібен
     * віджетам: `ProgressDialog` центрує відсоток саме через нього, а
     * `InputDialog` — підписи на клавішах.
     *
     * Важлива тонкість первотвору: рамка рахується по РЕАЛЬНИХ пікселях
     * глифів, а не по `delta_x`. Тому ширина «100%» менша за суму зсувів
     * курсора, і центрування виходить трохи іншим, ніж дало б `measure()`.
     *
     * Перенос рядка враховується так само, як у `charBounds`: якщо ввімкнено
     * `wrap` і символ не влазить у межу, курсор переходить на новий рядок ще
     * до обчислення рамки.
     */
    textBounds(text: string, startX = 0, startY = 0): { x: number; y: number; width: number; height: number } {
        let x = startX;
        let y = startY;
        let minX = this.maxTextX;
        // У первотворі початкове minY — це _max_text_y, тобто нижня межа
        let minY = this.maxTextY;
        let maxX = this.minTextX;
        let maxY = Number.NEGATIVE_INFINITY;
        let any = false;

        for (const character of text) {
            const codepoint = character.codePointAt(0)!;
            if (codepoint === 0x0a) {
                x = this.minTextX;
                y += this.lineAdvance;
                continue;
            }
            if (codepoint === 0x0d) continue;

            const glyph = this.font?.glyph(codepoint);
            if (!glyph) continue;

            if (glyph.width > 0 && this.wrap && x + this.scaleX * glyph.width - 1 > this.maxTextX) {
                x = this.minTextX;
                y += this.lineAdvance;
            }

            const x1 = x + glyph.offsetX * this.scaleX;
            const y1 = y - glyph.offsetY * this.scaleY;
            const x2 = x1 + glyph.width * this.scaleX - 1;
            const y2 = y1 + glyph.height * this.scaleY - 1;

            if (x1 < minX) minX = x1;
            if (y1 < minY) minY = y1;
            if (x2 > maxX) maxX = x2;
            if (y2 > maxY) maxY = y2;
            any = true;

            x += this.scaleX * glyph.advance;
        }

        if (!any) return { x: startX, y: startY, width: 0, height: 0 };
        return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }
}
