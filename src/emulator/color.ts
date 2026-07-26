/**
 * Кольори RGB565.
 *
 * Дисплей Лілки (ST7789) працює з 16-бітним кольором 5-6-5. Емулятор зберігає
 * кадровий буфер саме в цьому форматі, а не в RGB888 — інакше програма могла б
 * показати на віртуальному екрані відтінки, яких залізо фізично не відтворює.
 */

/** Порт `Arduino_GFX::color565` — саме так працює `display.color565` у Lua. */
export function color565(r: number, g: number, b: number): number {
    return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

/**
 * Розширення 5/6 біт до 8 через повторення старших біт (r << 3 | r >> 2).
 * Це поширений спосіб показати RGB565 на 24-бітному екрані; він зберігає
 * і чорний, і білий точними.
 */
function expand5(v: number): number {
    return (v << 3) | (v >> 2);
}

function expand6(v: number): number {
    return (v << 2) | (v >> 4);
}

/**
 * Таблиця з 65536 записів: RGB565 -> ABGR (порядок байтів для Uint32Array
 * на little-endian, що відповідає RGBA в ImageData). Будується один раз.
 */
export const RGB565_TO_RGBA = (() => {
    const lut = new Uint32Array(0x10000);
    for (let c = 0; c < 0x10000; c++) {
        const r = expand5((c >> 11) & 0x1f);
        const g = expand6((c >> 5) & 0x3f);
        const b = expand5(c & 0x1f);
        lut[c] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
    return lut;
})();

/** Розкладає RGB565 на компоненти 0..255 — для інспектора та тестів. */
export function toRgb888(c: number): [number, number, number] {
    return [expand5((c >> 11) & 0x1f), expand6((c >> 5) & 0x3f), expand5(c & 0x1f)];
}

export function toHex(c: number): string {
    const [r, g, b] = toRgb888(c);
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
