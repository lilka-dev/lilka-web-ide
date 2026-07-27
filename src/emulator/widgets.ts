/**
 * Віджети інтерфейсу — порт `lilka::Alert`, `lilka::InputDialog` і
 * `lilka::ProgressDialog` із `sdk/lib/lilka/src/lilka/{alert,inputdialog,
 * progressdialog}.cpp`.
 *
 * Спільне для `Alert` і `ProgressDialog`: вікно не має фіксованих розмірів, а
 * ділить екран на восьмі частини. Заголовок — шрифт 6x13 подвійним розміром на
 * темно-синьому, тіло — 9x15 на бірюзовому.
 *
 * `isFinished()` у первотворі — НЕ геттер: він скидає прапорець `done` у
 * `false`. Другий виклик поспіль поверне `false`. Поведінка збережена.
 */

import type { Framebuffer } from './framebuffer.ts';
import { TextRenderer } from './text.ts';
import type { Font } from './font.ts';
import { color565 } from './color.ts';
import { KEYBOARD_ICONS } from '../generated/icons.ts';
import type { ButtonName } from './controller.ts';
import type { ButtonSnapshot } from '../runtime/device.ts';

/** Кольори з `sdk/lib/lilka/src/lilka/colors565.h`. */
const WHITE = 0xffff;
const BLACK = 0x0000;
const MIDNIGHT_BLUE = 0x18ce;
const ORANGE_RED = 0xfb44;
const DARK_ORANGE = 0xfc60;
const PERSIAN_PLUM = 0x70e3;
/** `canvas->color565(32, 96, 96)` — колір тіла вікна. */
const BODY = color565(32, 96, 96);

export type FontResolver = (name: string) => Font;

/** Спільна геометрія вікна: екран ділиться на восьмі частини. */
function windowMetrics(fb: Framebuffer) {
    return {
        top: Math.trunc(fb.height / 8),
        mid: Math.trunc(fb.height / 8) * 2,
        bottom: Math.trunc(fb.height / 8) * 7,
        left: Math.trunc(fb.width / 8),
        right: Math.trunc(fb.width / 8) * 7,
        get width(): number {
            return this.right - this.left;
        },
        xMargin: 4,
    };
}

/** Малює заголовок і тіло — спільна частина `Alert` і `ProgressDialog`. */
function drawWindow(
    fb: Framebuffer,
    fonts: FontResolver,
    title: string,
    message: string,
    /**
     * `ProgressDialog` передає для тіла `top` замість `mid` — це, схоже,
     * помилка в первотворі, але вона відтворена навмисно.
     */
    bodyBoundTop: 'mid' | 'top',
): void {
    const m = windowMetrics(fb);
    const text = new TextRenderer(fb);
    text.setTextColor(WHITE);

    fb.fillRect(m.left, m.top, m.width, m.mid - m.top, MIDNIGHT_BLUE);
    text.setFont(fonts('6x13'));
    text.setTextSize(2);
    text.setTextBound(m.left + m.xMargin, m.top, m.width - m.xMargin * 2, m.mid - m.top);
    text.setCursor(m.left + m.xMargin, m.top + 13 * 2);
    text.write(title);

    fb.fillRect(m.left, m.mid, m.width, m.bottom - m.mid, BODY);
    text.setFont(fonts('9x15'));
    text.setTextSize(1);
    text.setTextBound(
        m.left + m.xMargin,
        bodyBoundTop === 'mid' ? m.mid : m.top,
        m.width - m.xMargin * 2,
        m.bottom - m.mid,
    );
    text.setCursor(m.left + m.xMargin, m.mid + 20);
    text.write(message);
}

/* --------------------------------------------------------------- Alert ---- */

export class Alert {
    title: string;
    message: string;

    private done = false;
    private button: ButtonName | null = null;
    /** Конструктор одразу додає A — ще до будь-якого `addActivationButton`. */
    private readonly activationButtons: ButtonName[] = ['a'];

    constructor(title: string, message: string) {
        this.title = title;
        this.message = message;
    }

    setTitle(title: string): void {
        this.title = title;
    }

    setMessage(message: string): void {
        this.message = message;
    }

    addActivationButton(button: ButtonName): void {
        if (this.activationButtons.includes(button)) return;
        this.activationButtons.push(button);
    }

    /** Перша з активаційних кнопок, яку щойно натиснуто, завершує діалог. */
    update(state: Record<string, ButtonSnapshot>): void {
        for (const button of this.activationButtons) {
            if (state[button]?.just_pressed) {
                this.button = button;
                this.done = true;
                return;
            }
        }
    }

    draw(fb: Framebuffer, fonts: FontResolver): void {
        drawWindow(fb, fonts, this.title, this.message, 'mid');
    }

    /** Скидає прапорець при читанні — так само, як у первотворі. */
    isFinished(): boolean {
        if (this.done) {
            this.done = false;
            return true;
        }
        return false;
    }

    getButton(): ButtonName | null {
        return this.button;
    }
}

/* ------------------------------------------------------ ProgressDialog ---- */

export class ProgressDialog {
    title: string;
    message: string;

    private progress = 0;

    constructor(title: string, message: string) {
        this.title = title;
        this.message = message;
    }

    setTitle(title: string): void {
        this.title = title;
    }

    setMessage(message: string): void {
        this.message = message;
    }

    setProgress(progress: number): void {
        this.progress = Math.trunc(progress);
    }

    draw(fb: Framebuffer, fonts: FontResolver): void {
        // Особливість первотвору: межа тексту тіла рахується від `top`, а не
        // від `mid`, як в Alert
        drawWindow(fb, fonts, this.title, this.message, 'top');

        const m = windowMetrics(fb);
        const text = new TextRenderer(fb, fonts('9x15'));
        text.setTextColor(WHITE);
        text.setTextSize(1);

        const caption = `${this.progress}%`;
        // Ширина береться з getTextBounds, а не з суми зсувів курсора:
        // центрування в первотворі спирається саме на реальні пікселі глифів
        const bounds = text.textBounds(caption, 0, 0);

        const barMargin = 8;
        const barHeight = 8;
        const center = Math.trunc((m.left + m.right) / 2);

        fb.fillRect(
            m.left + barMargin,
            m.bottom - barMargin - barHeight,
            m.width - barMargin * 2,
            barHeight,
            PERSIAN_PLUM,
        );
        fb.fillRect(
            m.left + barMargin,
            m.bottom - barMargin - barHeight,
            Math.trunc(((m.width - barMargin * 2) * this.progress) / 100),
            barHeight,
            DARK_ORANGE,
        );

        text.setCursor(center - Math.trunc(bounds.width / 2), m.bottom - barMargin - barHeight - barMargin);
        text.setTextBound(0, 0, fb.width, fb.height);
        text.write(caption);
    }
}

/* --------------------------------------------------------- InputDialog ---- */

const KB_LANGS = 2;
const KB_LAYERS = 3;
const KB_ROWS = 4;
const KB_COLS = 12;

/** Службові коди клавіш із первотвору. */
const K_L0 = 1;
const K_L1 = 2;
const K_L2 = 3;
const K_BS = 8;

/**
 * Шість розкладок: англійська базова, з Shift, спецсимволи — і те саме
 * українською. Порядок і вміст точно як у `inputdialog.cpp`.
 */
const KEYBOARD: readonly (readonly number[])[] = [
    // Шар 0: англійська базова
    [
        ...'!1234567890-'.split('').map((c) => c.charCodeAt(0)),
        ...'?qwertyuiop='.split('').map((c) => c.charCodeAt(0)),
        K_L1, ...'asdfghjkl;'.split('').map((c) => c.charCodeAt(0)), K_BS,
        K_L2, ...'zxcvbnm,./ '.split('').map((c) => c.charCodeAt(0)),
    ],
    // Шар 1: англійська з Shift
    [
        0, ...'!@#$%^&*()_'.split('').map((c) => c.charCodeAt(0)),
        0, ...'QWERTYUIOP+'.split('').map((c) => c.charCodeAt(0)),
        K_L0, ...'ASDFGHJKL:'.split('').map((c) => c.charCodeAt(0)), K_BS,
        K_L2, ...'ZXCVBNM<>? '.split('').map((c) => c.charCodeAt(0)),
    ],
    // Шар 2: спецсимволи
    [
        0, ...'{}[]|\\:;\'"`'.split('').map((c) => c.charCodeAt(0)),
        0, ...'<>?/!@#$%^~'.split('').map((c) => c.charCodeAt(0)),
        0, ...'()-_=+:;\'"'.split('').map((c) => c.charCodeAt(0)), K_BS,
        K_L0, ...'<>?/'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, 0, 0, 0x20,
    ],
    // Шар 3: українська базова
    [
        ...'1234567890'.split('').map((c) => c.charCodeAt(0)), 0x0454, 0x0491,
        0x27, 0x0439, 0x0446, 0x0443, 0x043a, 0x0435, 0x043d, 0x0433, 0x0448, 0x0449, 0x0437, 0x0445,
        K_L1, 0x0444, 0x0456, 0x0432, 0x0430, 0x043f, 0x0440, 0x043e, 0x043b, 0x0434, 0x0436, K_BS,
        K_L2, 0x044f, 0x0447, 0x0441, 0x043c, 0x0438, 0x0442, 0x044c, 0x0431, 0x044e, 0x0457, 0x20,
    ],
    // Шар 4: українська з Shift
    [
        ...'!"#;%:?*()'.split('').map((c) => c.charCodeAt(0)), 0x0404, 0x0490,
        0x27, 0x0419, 0x0426, 0x0423, 0x041a, 0x0415, 0x041d, 0x0413, 0x0428, 0x0429, 0x0417, 0x0425,
        K_L0, 0x0424, 0x0406, 0x0412, 0x0410, 0x041f, 0x0420, 0x041e, 0x041b, 0x0414, 0x0416, K_BS,
        K_L2, 0x042f, 0x0427, 0x0421, 0x041c, 0x0418, 0x0422, 0x042c, 0x0411, 0x042e, 0x0407, 0x20,
    ],
    // Шар 5: спецсимволи (українська мова)
    [
        0, ...'{}[]|\\:;\'"`'.split('').map((c) => c.charCodeAt(0)),
        0, ...'<>?/!@#$%^~'.split('').map((c) => c.charCodeAt(0)),
        0, ...'()-_=+:;\'"'.split('').map((c) => c.charCodeAt(0)), K_BS,
        K_L0, ...'<>?/'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...'.,'.split('').map((c) => c.charCodeAt(0)), 0x20,
    ],
];

export class InputDialog {
    title: string;

    private value = '';
    private masked = false;
    private done = false;
    private layer = 0;
    private language = 0;
    private cx = 0;
    private cy = 0;
    private lastBlink = 0;
    private blinkPhase = true;

    constructor(title: string) {
        this.title = title;
    }

    setTitle(title: string): void {
        this.title = title;
    }

    setMasked(masked: boolean): void {
        this.masked = masked;
    }

    setValue(value: string): void {
        this.value = value;
    }

    getValue(): string {
        return this.value;
    }

    isFinished(): boolean {
        if (this.done) {
            this.done = false;
            return true;
        }
        return false;
    }

    private get keys(): readonly number[] {
        return KEYBOARD[this.language * KB_LAYERS + this.layer];
    }

    private resetBlink(now: number): void {
        this.lastBlink = now;
        this.blinkPhase = true;
    }

    /**
     * Керування: A натискає, B стирає, C міняє шар, D міняє мову,
     * START завершує. Курсор при переміщенні ПЕРЕСТРИБУЄ порожні клітинки —
     * у первотворі це цикл `while`, який шукає наступну непорожню.
     */
    update(state: Record<string, ButtonSnapshot>, now: number): void {
        if (now - this.lastBlink > 300) {
            this.lastBlink = now;
            this.blinkPhase = !this.blinkPhase;
        }

        const keys = this.keys;

        if (state.a?.just_pressed) {
            const key = keys[this.cy * KB_COLS + this.cx];
            if (key === K_L0) this.layer = 0;
            else if (key === K_L1) this.layer = 1;
            else if (key === K_L2) this.layer = 2;
            else if (key === K_BS) this.removeLastChar();
            else if (key) this.value += String.fromCodePoint(key);
            this.resetBlink(now);
        } else if (state.d?.just_pressed) {
            this.language = (this.language + 1) % KB_LANGS;
        } else if (state.c?.just_pressed) {
            this.layer = (this.layer + 1) % KB_LAYERS;
        } else if (state.b?.just_pressed) {
            this.removeLastChar();
            this.resetBlink(now);
        } else if (state.start?.just_pressed) {
            this.done = true;
        } else if (state.up?.just_pressed) {
            do {
                this.cy = this.cy - 1 < 0 ? KB_ROWS - 1 : this.cy - 1;
            } while (!keys[this.cy * KB_COLS + this.cx]);
        } else if (state.down?.just_pressed) {
            do {
                this.cy = this.cy + 1 > KB_ROWS - 1 ? 0 : this.cy + 1;
            } while (!keys[this.cy * KB_COLS + this.cx]);
        } else if (state.left?.just_pressed) {
            do {
                this.cx = this.cx - 1 < 0 ? KB_COLS - 1 : this.cx - 1;
            } while (!keys[this.cy * KB_COLS + this.cx]);
        } else if (state.right?.just_pressed) {
            do {
                this.cx = this.cx + 1 > KB_COLS - 1 ? 0 : this.cx + 1;
            } while (!keys[this.cy * KB_COLS + this.cx]);
        }
    }

    /** Стирає останній символ, а не байт — рядок може бути UTF-8. */
    private removeLastChar(): void {
        const characters = [...this.value];
        characters.pop();
        this.value = characters.join('');
    }

    draw(fb: Framebuffer, fonts: FontResolver): void {
        const kbTop = Math.trunc(fb.height / 2) - 32;
        const kbHeight = Math.trunc(fb.height / 2);
        const kbWidth = fb.width;
        const kbTextWidth = kbWidth - 32;
        const kbTextHeight = 40;

        fb.fillRect(0, 0, fb.width, fb.height, BLACK);

        const text = new TextRenderer(fb, fonts('10x20'));
        text.setTextColor(WHITE);
        text.setTextSize(1);

        text.setTextBound(4, 4, fb.width - 8, fb.height - 8);
        text.setCursor(16, 20);
        text.write(this.title);

        // Показується лише хвіст значення — стільки символів, скільки влазить
        // у два рядки. Первотвір відрізає з початку, доки висота не влізе.
        text.setTextBound(16, 16, kbTextWidth, fb.height - 32);
        text.setCursor(16, 48);

        const characters = [...this.value];
        let from = characters.length;
        while (from > 0) {
            const candidate = characters.slice(from - 1).join('');
            if (text.textBounds(candidate, 16, 48).height > kbTextHeight) {
                from = Math.min(from + 1, characters.length);
                break;
            }
            from--;
        }
        const visible = characters.slice(from).join('');

        text.setTextBound(16, 16, kbTextWidth, kbTextHeight + 16);
        text.write(this.masked ? '*'.repeat([...visible].length) : visible);
        if (this.blinkPhase) text.write('|');

        // --- клавіатура
        const keys = this.keys;
        const buttonWidth = Math.trunc(kbWidth / KB_COLS);
        const buttonHeight = Math.trunc(kbHeight / KB_ROWS);

        text.setTextBound(0, 0, fb.width, fb.height);

        for (let y = 0; y < KB_ROWS; y++) {
            for (let x = 0; x < KB_COLS; x++) {
                if (y === this.cy && x === this.cx) {
                    fb.fillRect(x * buttonWidth, kbTop + y * buttonHeight, buttonWidth, buttonHeight, ORANGE_RED);
                }
                const key = keys[y * KB_COLS + x];
                if (!key) continue;

                if (key === K_L0 || key === K_L1 || key === K_BS || key === 0x20) {
                    const icon =
                        key === K_L0 || key === K_L1
                            ? this.layer === 0
                                ? KEYBOARD_ICONS.shift
                                : KEYBOARD_ICONS.shifted
                            : key === K_BS
                              ? KEYBOARD_ICONS.backspace
                              : KEYBOARD_ICONS.whitespace;

                    // Чорний — прозорий колір, як у draw16bitRGBBitmapWithTranColor
                    const iconX = x * buttonWidth + Math.trunc(buttonWidth / 2) - Math.trunc(icon.width / 2);
                    const iconY = kbTop + y * buttonHeight + Math.trunc(buttonHeight / 2) - Math.trunc(icon.height / 2);
                    let at = 0;
                    for (let row = 0; row < icon.height; row++) {
                        for (let col = 0; col < icon.width; col++) {
                            const pixel = icon.pixels[at++];
                            if (pixel !== BLACK) fb.writePixel(iconX + col, iconY + row, pixel);
                        }
                    }
                    continue;
                }

                const caption = key === K_L2 ? '!@' : String.fromCodePoint(key);
                const bounds = text.textBounds(caption, 0, 0);
                text.setCursor(
                    x * buttonWidth + Math.trunc((buttonWidth - bounds.width) / 2),
                    kbTop + y * buttonHeight + Math.trunc((buttonHeight - bounds.height) / 2) - bounds.y,
                );
                text.write(caption);
            }
        }
    }
}
