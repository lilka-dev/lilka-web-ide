/**
 * Framebuffer — програмна копія растрових примітивів Arduino_GFX.
 *
 * ЧОМУ НЕ Canvas 2D API:
 * `ctx.arc()`, `ctx.lineTo()` та інші методи Canvas 2D застосовують згладжування
 * і власні правила заповнення. Пікселі, які вони дають, НЕ збігаються з тим,
 * що малює Лілка. Для навчальної платформи розбіжність між віртуальним і
 * реальним екраном — найдорожча можлива помилка, тому всі примітиви тут
 * портовані з `Arduino_GFX/src/Arduino_GFX.cpp` рядок у рядок.
 *
 * Свідомо збережені особливості первотвору (не «виправляти»!):
 *   - `writeEllipseHelper` при ry == 0 використовує `(ry << 2) + 1` замість rx —
 *     це схоже на помилку в Arduino_GFX, але залізо поводиться саме так;
 *   - цілочисельне ділення в `fillTriangle` відкидає дріб У БІК НУЛЯ (як у C),
 *     тому тут `idiv`, а не `Math.floor`.
 *
 * Координати в Arduino_GFX — int16_t. Для типових значень різниці немає,
 * але переповнення int16 тут не відтворюється.
 */

import { NO_TRANSPARENT_COLOR, type Image } from './image.ts';
import type { Transform } from './transform.ts';

const DEG_TO_RAD = 0.017453292519943295769236907684886;

/** Цілочисельне ділення з відкиданням у бік нуля — семантика `/` для int у C. */
const idiv = (a: number, b: number): number => Math.trunc(a / b);

/** Абсолютна різниця — макрос `_diff` з Arduino_GFX.h */
const diff = (a: number, b: number): number => (a > b ? a - b : b - a);

/** Маски секторів для еліпсів: 1 = ↖, 2 = ↗, 4 = ↘, 8 = ↙ */
export const EllipseCorner = {
    TopLeft: 0x1,
    TopRight: 0x2,
    BottomRight: 0x4,
    BottomLeft: 0x8,
    All: 0xf,
} as const;

export class Framebuffer {
    readonly width: number;
    readonly height: number;
    /** Пікселі у форматі RGB565, рядок за рядком. */
    readonly pixels: Uint16Array;

    private readonly maxX: number;
    private readonly maxY: number;

    /** Стає true після будь-якого запису; `Screen` скидає його після виводу. */
    dirty = true;

    /**
     * `buffer` дозволяє покласти пікселі в SharedArrayBuffer — саме так
     * рантайм Lua у воркері пише прямо в той буфер, який головний потік виводить
     * на екран, без жодного копіювання між потоками.
     */
    constructor(width: number, height: number, buffer?: ArrayBufferLike, byteOffset = 0) {
        this.width = width;
        this.height = height;
        this.maxX = width - 1;
        this.maxY = height - 1;
        this.pixels = buffer
            ? new Uint16Array(buffer, byteOffset, width * height)
            : new Uint16Array(width * height);
    }

    // ---------------------------------------------------------------- пікселі

    /** Запис без перевірки меж. Викликати лише після власного відсікання. */
    writePixelPreclipped(x: number, y: number, color: number): void {
        this.pixels[y * this.width + x] = color;
        this.dirty = true;
    }

    writePixel(x: number, y: number, color: number): void {
        if (y >= 0 && y <= this.maxY && x >= 0 && x <= this.maxX) {
            this.writePixelPreclipped(x, y, color);
        }
    }

    drawPixel(x: number, y: number, color: number): void {
        this.writePixel(x, y, color);
    }

    getPixel(x: number, y: number): number {
        if (y < 0 || y > this.maxY || x < 0 || x > this.maxX) return 0;
        return this.pixels[y * this.width + x];
    }

    // ------------------------------------------------------------------ лінії

    writeFastVLine(x: number, y: number, h: number, color: number): void {
        for (let i = y; i < y + h; i++) this.writePixel(x, i, color);
    }

    writeFastHLine(x: number, y: number, w: number, color: number): void {
        for (let i = x; i < x + w; i++) this.writePixel(i, y, color);
    }

    /** Брезенхем для похилих ліній (`writeSlashLine`). */
    private writeSlashLine(x0: number, y0: number, x1: number, y1: number, color: number): void {
        const steep = diff(y1, y0) > diff(x1, x0);
        if (steep) {
            [x0, y0] = [y0, x0];
            [x1, y1] = [y1, x1];
        }
        if (x0 > x1) {
            [x0, x1] = [x1, x0];
            [y0, y1] = [y1, y0];
        }

        const dx = x1 - x0;
        const dy = diff(y1, y0);
        let err = dx >> 1;
        const step = y0 < y1 ? 1 : -1;

        for (; x0 <= x1; x0++) {
            if (steep) this.writePixel(y0, x0, color);
            else this.writePixel(x0, y0, color);
            err -= dy;
            if (err < 0) {
                err += dx;
                y0 += step;
            }
        }
    }

    writeLine(x0: number, y0: number, x1: number, y1: number, color: number): void {
        if (x0 === x1) {
            if (y0 > y1) [y0, y1] = [y1, y0];
            this.writeFastVLine(x0, y0, y1 - y0 + 1, color);
        } else if (y0 === y1) {
            if (x0 > x1) [x0, x1] = [x1, x0];
            this.writeFastHLine(x0, y0, x1 - x0 + 1, color);
        } else {
            this.writeSlashLine(x0, y0, x1, y1, color);
        }
    }

    drawLine(x0: number, y0: number, x1: number, y1: number, color: number): void {
        this.writeLine(x0, y0, x1, y1, color);
    }

    // ----------------------------------------------------------- прямокутники

    private writeFillRectPreclipped(x: number, y: number, w: number, h: number, color: number): void {
        for (let row = y; row < y + h; row++) {
            const base = row * this.width;
            this.pixels.fill(color, base + x, base + x + w);
        }
        this.dirty = true;
    }

    /** Відсікання відтворює логіку `Arduino_GFX::writeFillRect`, включно з від'ємними w/h. */
    writeFillRect(x: number, y: number, w: number, h: number, color: number): void {
        if (!w || !h) return;
        if (w < 0) {
            x += w + 1;
            w = -w;
        }
        if (x > this.maxX) return;
        if (h < 0) {
            y += h + 1;
            h = -h;
        }
        if (y > this.maxY) return;

        const x2 = x + w - 1;
        if (x2 < 0) return;
        const y2 = y + h - 1;
        if (y2 < 0) return;

        if (x < 0) {
            x = 0;
            w = x2 + 1;
        }
        if (y < 0) {
            y = 0;
            h = y2 + 1;
        }
        if (x2 > this.maxX) w = this.maxX - x + 1;
        if (y2 > this.maxY) h = this.maxY - y + 1;

        this.writeFillRectPreclipped(x, y, w, h, color);
    }

    fillRect(x: number, y: number, w: number, h: number, color: number): void {
        this.writeFillRect(x, y, w, h, color);
    }

    drawRect(x: number, y: number, w: number, h: number, color: number): void {
        this.writeFastHLine(x, y, w, color);
        this.writeFastHLine(x, y + h - 1, w, color);
        this.writeFastVLine(x, y, h, color);
        this.writeFastVLine(x + w - 1, y, h, color);
    }

    fillScreen(color: number): void {
        this.pixels.fill(color);
        this.dirty = true;
    }

    // ------------------------------------------------------- кола та еліпси

    /** Контур квадранта еліпса. Порт `writeEllipseHelper`. */
    writeEllipseHelper(x: number, y: number, rx: number, ry: number, corners: number, color: number): void {
        if (rx < 0 || ry < 0 || (rx === 0 && ry === 0)) return;
        // Особливість первотвору: тут використано ry, хоча очікувався б rx.
        if (ry === 0) {
            this.writeFastHLine(x - rx, y, (ry << 2) + 1, color);
            return;
        }
        if (rx === 0) {
            this.writeFastVLine(x, y - ry, (rx << 2) + 1, color);
            return;
        }

        const rx2 = rx * rx;
        const ry2 = ry * ry;
        let xt: number, yt: number, s: number, i: number;

        i = -1;
        xt = 0;
        yt = ry;
        s = (ry2 << 1) + rx2 * (1 - (ry << 1));
        do {
            while (s < 0) s += ry2 * ((++xt << 2) + 2);
            if (corners & 0x1) this.writeFastHLine(x - xt, y - yt, xt - i, color);
            if (corners & 0x2) this.writeFastHLine(x + i + 1, y - yt, xt - i, color);
            if (corners & 0x4) this.writeFastHLine(x + i + 1, y + yt, xt - i, color);
            if (corners & 0x8) this.writeFastHLine(x - xt, y + yt, xt - i, color);
            i = xt;
            s -= (--yt * rx2) << 2;
        } while (ry2 * xt <= rx2 * yt);

        i = -1;
        yt = 0;
        xt = rx;
        s = (rx2 << 1) + ry2 * (1 - (rx << 1));
        do {
            while (s < 0) s += rx2 * ((++yt << 2) + 2);
            if (corners & 0x1) this.writeFastVLine(x - xt, y - yt, yt - i, color);
            if (corners & 0x2) this.writeFastVLine(x + xt, y - yt, yt - i, color);
            if (corners & 0x4) this.writeFastVLine(x + xt, y + i + 1, yt - i, color);
            if (corners & 0x8) this.writeFastVLine(x - xt, y + i + 1, yt - i, color);
            i = yt;
            s -= (--xt * ry2) << 2;
        } while (rx2 * yt <= ry2 * xt);
    }

    /** Заповнений квадрант еліпса. Порт `writeFillEllipseHelper`. */
    writeFillEllipseHelper(
        x: number,
        y: number,
        rx: number,
        ry: number,
        corners: number,
        delta: number,
        color: number,
    ): void {
        if (rx < 0 || ry < 0 || (rx === 0 && ry === 0)) return;
        if (ry === 0) {
            this.writeFastHLine(x - rx, y, (ry << 2) + 1, color);
            return;
        }
        if (rx === 0) {
            this.writeFastVLine(x, y - ry, (rx << 2) + 1, color);
            return;
        }

        const rx2 = rx * rx;
        const ry2 = ry * ry;
        let xt: number, yt: number, i: number, s: number;

        this.writeFastHLine(x - rx, y, (rx << 1) + 1, color);

        i = 0;
        yt = 0;
        xt = rx;
        s = (rx2 << 1) + ry2 * (1 - (rx << 1));
        do {
            while (s < 0) s += rx2 * ((++yt << 2) + 2);
            if (corners & 1) this.writeFillRect(x - xt, y - yt, (xt << 1) + 1 + delta, yt - i, color);
            if (corners & 2) this.writeFillRect(x - xt, y + i + 1, (xt << 1) + 1 + delta, yt - i, color);
            i = yt;
            s -= (--xt * ry2) << 2;
        } while (rx2 * yt <= ry2 * xt);

        xt = 0;
        yt = ry;
        s = (ry2 << 1) + rx2 * (1 - (ry << 1));
        do {
            while (s < 0) s += ry2 * ((++xt << 2) + 2);
            if (corners & 1) this.writeFastHLine(x - xt, y - yt, (xt << 1) + 1 + delta, color);
            if (corners & 2) this.writeFastHLine(x - xt, y + yt, (xt << 1) + 1 + delta, color);
            s -= (--yt * rx2) << 2;
        } while (ry2 * xt <= rx2 * yt);
    }

    drawCircle(x: number, y: number, r: number, color: number): void {
        this.writeEllipseHelper(x, y, r, r, EllipseCorner.All, color);
    }

    fillCircle(x: number, y: number, r: number, color: number): void {
        this.writeFillEllipseHelper(x, y, r, r, 3, 0, color);
    }

    drawEllipse(x: number, y: number, rx: number, ry: number, color: number): void {
        this.writeEllipseHelper(x, y, rx, ry, EllipseCorner.All, color);
    }

    fillEllipse(x: number, y: number, rx: number, ry: number, color: number): void {
        this.writeFillEllipseHelper(x, y, rx, ry, 3, 0, color);
    }

    // -------------------------------------------------------------------- дуги

    /** Порт `writeFillArcHelper`. Обчислення тут у float — як у первотворі. */
    private writeFillArcHelper(
        cx: number,
        cy: number,
        oradius: number,
        iradius: number,
        start: number,
        end: number,
        color: number,
    ): void {
        if (start === 90 || start === 180 || start === 270 || start === 360) start -= 0.1;
        if (end === 90 || end === 180 || end === 270 || end === 360) end -= 0.1;

        const sCos = Math.cos(start * DEG_TO_RAD);
        const eCos = Math.cos(end * DEG_TO_RAD);
        const sslope = sCos / Math.sin(start * DEG_TO_RAD);
        const eslope = eCos / Math.sin(end * DEG_TO_RAD);
        const swidth = 0.5 / sCos;
        const ewidth = -0.5 / eCos;

        iradius -= 1;
        const ir2 = iradius * iradius + iradius;
        const or2 = oradius * oradius + oradius;

        const start180 = !(start < 180);
        const end180 = end < 180;
        const reversed = start + 180 < end || (end < start && start < end + 180);

        let xs = -oradius;
        let y = -oradius;
        let ye = oradius;
        let xe = oradius + 1;

        if (!reversed) {
            if ((end >= 270 || end < 90) && (start >= 270 || start < 90)) xs = 0;
            else if (end < 270 && end >= 90 && start < 270 && start >= 90) xe = 1;
            if (end >= 180 && start >= 180) ye = 0;
            else if (end < 180 && start < 180) y = 0;
        }

        do {
            const y2 = y * y;
            let x = xs;
            if (x < 0) {
                while (x * x + y2 >= or2) ++x;
                if (xe !== 1) xe = 1 - x;
            }
            const ysslope = (y + swidth) * sslope;
            const yeslope = (y + ewidth) * eslope;
            let len = 0;
            do {
                const flg1 = start180 !== (x <= ysslope);
                const flg2 = end180 !== (x <= yeslope);
                const distance = x * x + y2;
                if (distance >= ir2 && ((flg1 && flg2) || (reversed && (flg1 || flg2))) && x !== xe && distance < or2) {
                    ++len;
                } else {
                    if (len) {
                        this.writeFastHLine(cx + x - len, cy + y, len, color);
                        len = 0;
                    }
                    if (distance >= or2) break;
                    if (x < 0 && distance < ir2) x = -x;
                }
            } while (++x <= xe);
        } while (++y <= ye);
    }

    private static normalizeArc(r1: number, r2: number, start: number, end: number) {
        if (r1 < r2) [r1, r2] = [r2, r1];
        if (r1 < 1) r1 = 1;
        if (r2 < 1) r2 = 1;
        const equal = Math.abs(start - end) < Number.EPSILON;
        start %= 360;
        end %= 360;
        if (start < 0) start += 360;
        if (end < 0) end += 360;
        return { r1, r2, start, end, equal };
    }

    drawArc(x: number, y: number, r1: number, r2: number, startDeg: number, endDeg: number, color: number): void {
        let { r1: ro, r2: ri, start, end, equal } = Framebuffer.normalizeArc(r1, r2, startDeg, endDeg);
        this.writeFillArcHelper(x, y, ro, ri, start, start, color);
        this.writeFillArcHelper(x, y, ro, ri, end, end, color);
        if (!equal && Math.abs(start - end) <= 0.0001) {
            start = 0;
            end = 360;
        }
        this.writeFillArcHelper(x, y, ro, ro, start, end, color);
        this.writeFillArcHelper(x, y, ri, ri, start, end, color);
    }

    fillArc(x: number, y: number, r1: number, r2: number, startDeg: number, endDeg: number, color: number): void {
        let { r1: ro, r2: ri, start, end, equal } = Framebuffer.normalizeArc(r1, r2, startDeg, endDeg);
        if (!equal && Math.abs(start - end) <= 0.0001) {
            start = 0;
            end = 360;
        }
        this.writeFillArcHelper(x, y, ro, ri, start, end, color);
    }


    // ------------------------------------------------------- растрові дані

    /** Порт `draw16bitRGBBitmap`: піксель за пікселем, відсікання — у writePixel. */
    draw16bitRGBBitmap(x: number, y: number, bitmap: Uint16Array, w: number, h: number): void {
        let offset = 0;
        for (let j = 0; j < h; j++, y++) {
            for (let i = 0; i < w; i++) {
                this.writePixel(x + i, y, bitmap[offset++]);
            }
        }
    }

    /** Порт `draw16bitRGBBitmapWithTranColor`. */
    draw16bitRGBBitmapWithTranColor(
        x: number,
        y: number,
        bitmap: Uint16Array,
        transparentColor: number,
        w: number,
        h: number,
    ): void {
        let offset = 0;
        for (let j = 0; j < h; j++, y++) {
            for (let i = 0; i < w; i++) {
                const color = bitmap[offset++];
                if (color !== transparentColor) this.writePixel(x + i, y, color);
            }
        }
    }

    /** Порт `GFX::drawImage`. Координата — це точка привʼязки, не кут. */
    drawImage(image: Image, x: number, y: number): void {
        const left = x - image.pivotX;
        const top = y - image.pivotY;
        if (image.transparentColor === NO_TRANSPARENT_COLOR) {
            this.draw16bitRGBBitmap(left, top, image.pixels, image.width, image.height);
        } else {
            this.draw16bitRGBBitmapWithTranColor(
                left,
                top,
                image.pixels,
                image.transparentColor,
                image.width,
                image.height,
            );
        }
    }

    /**
     * Порт `GFX::drawImageTransformed`.
     *
     * Обчислює обмежувальну рамку з чотирьох кутів, збирає проміжне зображення
     * зворотним перетворенням (найближчий сусід) і малює його звичайним
     * `drawImage`.
     *
     * ОСОБЛИВІСТЬ ЗАЛІЗА, яку тут відтворено: пікселі поза межами джерела
     * заповнюються значенням `transparentColor`. Якщо прозорого кольору немає
     * (-1), у Uint16Array це перетворюється на 0xFFFF — і кути обернутого
     * зображення стають БІЛИМИ. Виглядає як помилка, але саме так поводиться
     * прошивка, тому «виправляти» не варто.
     */
    drawImageTransformed(image: Image, destX: number, destY: number, transform: Transform): void {
        const corners = [
            transform.apply(-image.pivotX, -image.pivotY),
            transform.apply(image.width - image.pivotX, -image.pivotY),
            transform.apply(-image.pivotX, image.height - image.pivotY),
            transform.apply(image.width - image.pivotX, image.height - image.pivotY),
        ];

        const left = Math.min(...corners.map((c) => c.x));
        const top = Math.min(...corners.map((c) => c.y));
        const right = Math.max(...corners.map((c) => c.x));
        const bottom = Math.max(...corners.map((c) => c.y));

        const width = right - left;
        const height = bottom - top;
        if (width === 0 || height === 0) return;

        const dest = new Uint16Array(width * height);
        const inverse = transform.inverse();

        for (let py = top; py < bottom; py++) {
            for (let px = left; px < right; px++) {
                const v = inverse.apply(px, py);
                const sx = v.x + image.pivotX;
                const sy = v.y + image.pivotY;
                const at = px - left + (py - top) * width;
                dest[at] =
                    sx >= 0 && sx < image.width && sy >= 0 && sy < image.height
                        ? image.pixels[sx + sy * image.width]
                        : image.transparentColor;
            }
        }

        const x = destX + left;
        const y = destY + top;
        if (image.transparentColor === NO_TRANSPARENT_COLOR) {
            this.draw16bitRGBBitmap(x, y, dest, width, height);
        } else {
            this.draw16bitRGBBitmapWithTranColor(x, y, dest, image.transparentColor, width, height);
        }
    }

    /** Порт `GFX::drawCanvas`: інший буфер малюється як звичайна растрова карта. */
    drawFramebuffer(other: Framebuffer, x: number, y: number): void {
        this.draw16bitRGBBitmap(x, y, other.pixels, other.width, other.height);
    }

    // -------------------------------------------------------------- трикутники

    drawTriangle(
        x0: number, y0: number,
        x1: number, y1: number,
        x2: number, y2: number,
        color: number,
    ): void {
        this.writeLine(x0, y0, x1, y1, color);
        this.writeLine(x1, y1, x2, y2, color);
        this.writeLine(x2, y2, x0, y0, color);
    }

    fillTriangle(
        x0: number, y0: number,
        x1: number, y1: number,
        x2: number, y2: number,
        color: number,
    ): void {
        // сортування за y: y2 >= y1 >= y0
        if (y0 > y1) {
            [y0, y1] = [y1, y0];
            [x0, x1] = [x1, x0];
        }
        if (y1 > y2) {
            [y2, y1] = [y1, y2];
            [x2, x1] = [x1, x2];
        }
        if (y0 > y1) {
            [y0, y1] = [y1, y0];
            [x0, x1] = [x1, x0];
        }

        let a: number, b: number, y: number, last: number;

        if (y0 === y2) {
            // виродок: усі три точки на одному рядку
            a = b = x0;
            if (x1 < a) a = x1;
            else if (x1 > b) b = x1;
            if (x2 < a) a = x2;
            else if (x2 > b) b = x2;
            this.writeFastHLine(a, y0, b - a + 1, color);
            return;
        }

        const dx01 = x1 - x0;
        const dy01 = y1 - y0;
        const dx02 = x2 - x0;
        const dy02 = y2 - y0;
        const dx12 = x2 - x1;
        const dy12 = y2 - y1;
        let sa = 0;
        let sb = 0;

        last = y1 === y2 ? y1 : y1 - 1;

        for (y = y0; y <= last; y++) {
            a = x0 + idiv(sa, dy01);
            b = x0 + idiv(sb, dy02);
            sa += dx01;
            sb += dx02;
            if (a > b) [a, b] = [b, a];
            this.writeFastHLine(a, y, b - a + 1, color);
        }

        sa = dx12 * (y - y1);
        sb = dx02 * (y - y0);
        for (; y <= y2; y++) {
            a = x1 + idiv(sa, dy12);
            b = x0 + idiv(sb, dy02);
            sa += dx12;
            sb += dx02;
            if (a > b) [a, b] = [b, a];
            this.writeFastHLine(a, y, b - a + 1, color);
        }
    }
}
