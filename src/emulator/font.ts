/**
 * Шрифти u8g2.
 *
 * Дані готує `scripts/gen-fonts.mjs`: він розпаковує масиви
 * `u8g2_font_*_t_cyrillic` у JSON з бітмапами глифів. У рантаймі декодера немає.
 *
 * Розміщення глифа повторює `Arduino_GFX::drawChar` для шрифтів u8g2:
 *   target_x = cursorX + charX * scaleX
 *   target_y = cursorY - (charHeight + charY) * scaleY
 * тобто `cursorY` — це БАЗОВА ЛІНІЯ, а не верх рядка. `oy` у JSON уже містить
 * готову суму `charHeight + charY`.
 */

import type { Framebuffer } from './framebuffer.ts';

export interface Glyph {
    /** Ширина бітмапи в пікселях. */
    width: number;
    /** Висота бітмапи в пікселях. */
    height: number;
    /** Зсув бітмапи вправо від позиції курсора. */
    offsetX: number;
    /** Відстань від базової лінії вгору до верхнього рядка бітмапи. */
    offsetY: number;
    /** На скільки зсунути курсор після символу (delta_x у u8g2). */
    advance: number;
    /** По одному біту на піксель, рядок за рядком, старший біт — лівий. */
    bitmap: Uint8Array;
}

export interface Font {
    readonly name: string;
    readonly u8g2: string;
    /**
     * Крок рядка при переносі. Arduino_GFX використовує саме `max_char_height`,
     * а не висоту з ascent/descent — тут та сама величина.
     */
    readonly maxCharHeight: number;
    readonly maxCharWidth: number;
    readonly ascent: number;
    glyph(codepoint: number): Glyph | null;
    /** Ширина рядка в пікселях при масштабі 1 (сума delta_x). */
    measure(text: string): number;
}

/** Формат, який видає gen-fonts.mjs. */
export interface FontJson {
    name: string;
    u8g2: string;
    lineHeight: number;
    ascent: number;
    header: {
        maxCharWidth: number;
        maxCharHeight: number;
        ascentA: number;
    };
    glyphs: Record<string, { w: number; h: number; ox: number; oy: number; adv: number; bits: string }>;
}

function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

export function fontFromJson(json: FontJson): Font {
    const cache = new Map<number, Glyph | null>();

    const font: Font = {
        name: json.name,
        u8g2: json.u8g2,
        maxCharHeight: json.header.maxCharHeight,
        maxCharWidth: json.header.maxCharWidth,
        ascent: json.header.ascentA,

        glyph(codepoint: number): Glyph | null {
            if (cache.has(codepoint)) return cache.get(codepoint)!;
            const raw = json.glyphs[String(codepoint)];
            const glyph: Glyph | null = raw
                ? {
                      width: raw.w,
                      height: raw.h,
                      offsetX: raw.ox,
                      offsetY: raw.oy,
                      advance: raw.adv,
                      bitmap: base64ToBytes(raw.bits),
                  }
                : null;
            cache.set(codepoint, glyph);
            return glyph;
        },

        measure(text: string): number {
            let total = 0;
            for (const ch of text) {
                const g = font.glyph(ch.codePointAt(0)!);
                if (g) total += g.advance;
            }
            return total;
        },
    };

    return font;
}

/**
 * Малює глиф у кадровий буфер.
 * `baselineY` — базова лінія, як у Arduino_GFX. `bgColor === null` означає
 * прозорий фон (у прошивці це стан, коли колір фону не заданий).
 */
export function drawGlyph(
    fb: Framebuffer,
    glyph: Glyph,
    penX: number,
    baselineY: number,
    scaleX: number,
    scaleY: number,
    color: number,
    bgColor: number | null,
): void {
    if (glyph.width === 0) return;

    const bytesPerRow = Math.ceil(glyph.width / 8);
    const originX = penX + glyph.offsetX * scaleX;
    const originY = baselineY - glyph.offsetY * scaleY;

    for (let row = 0; row < glyph.height; row++) {
        for (let col = 0; col < glyph.width; col++) {
            const byte = glyph.bitmap[row * bytesPerRow + (col >> 3)];
            const on = (byte >> (7 - (col & 7))) & 1;
            const paint = on ? color : bgColor;
            if (paint === null) continue;
            if (scaleX === 1 && scaleY === 1) {
                fb.writePixel(originX + col, originY + row, paint);
            } else {
                fb.writeFillRect(originX + col * scaleX, originY + row * scaleY, scaleX, scaleY, paint);
            }
        }
    }
}
