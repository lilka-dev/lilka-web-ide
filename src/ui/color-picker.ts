/**
 * Вибір кольору для піксельного редактора.
 *
 * Системний `<input type="color">` пропонує 16 мільйонів відтінків, а екран
 * Лілки показує 65 536: решта мовчки зводиться до найближчого 5-6-5. Тут
 * вибір іде одразу в тих кроках, що є на залізі:
 *
 *   - квадрат насиченості/яскравості й смуга відтінку малюються вже зведеними
 *     до RGB565 кольорами — видно справжні сходинки, а не гладкий градієнт,
 *     якого екран не покаже;
 *   - повзунки R/G/B мають рівно 32/64/32 положення — по одному на рівень
 *     каналу, тож жоден рух повзунка не «губиться»;
 *   - текстове поле приймає запис із Lua (`0xF800`, `colors.red`).
 *
 * Канва тут — лише показ готових пікселів через `putImageData`, як і в
 * самому редакторі.
 */

import { RGB565_TO_RGBA, color565, toHex, toRgb888 } from '../emulator/color.ts';
import { hsvToRgb, join565, luaHex, parseColor, rgbToHsv, split565 } from '../emulator/pixel-art.ts';
import { t } from '../i18n/index.ts';

const SQUARE_WIDTH = 172;
const SQUARE_HEIGHT = 112;
const HUE_HEIGHT = 12;

export interface ColorPicker {
    root: HTMLElement;
    /** Показати колір ззовні (палітра, піпетка) без виклику onChange. */
    set(color: number): void;
}

export function createColorPicker(names: Record<string, number>, onChange: (color: number) => void): ColorPicker {
    /*
     * HSV зберігається окремо від кольору: у сірого відтінок не визначений,
     * і без власного стану смуга відтінку стрибала б у червоний щоразу, як
     * насиченість доходить до нуля.
     */
    let hue = 0;
    let saturation = 0;
    let brightness = 0;
    let color = 0;

    const root = document.createElement('div');
    root.className = 'cpick';

    /* --- квадрат насиченості/яскравості */
    const squareWrap = document.createElement('div');
    squareWrap.className = 'cpick__square';
    const square = document.createElement('canvas');
    square.width = SQUARE_WIDTH;
    square.height = SQUARE_HEIGHT;
    const squareKnob = document.createElement('span');
    squareKnob.className = 'cpick__knob';
    squareWrap.append(square, squareKnob);

    /* --- смуга відтінку */
    const hueWrap = document.createElement('div');
    hueWrap.className = 'cpick__hue';
    const hueStrip = document.createElement('canvas');
    hueStrip.width = SQUARE_WIDTH;
    hueStrip.height = HUE_HEIGHT;
    const hueKnob = document.createElement('span');
    hueKnob.className = 'cpick__knob cpick__knob--hue';
    hueWrap.append(hueStrip, hueKnob);

    /* --- повзунки каналів у кроках RGB565 */
    const channels = (['r', 'g', 'b'] as const).map((channel) => {
        const row = document.createElement('label');
        row.className = 'cpick__channel';
        const name = document.createElement('span');
        name.className = 'cpick__channel-name';
        name.textContent = channel.toUpperCase();
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = channel === 'g' ? '63' : '31';
        slider.step = '1';
        slider.className = 'cpick__slider';
        const value = document.createElement('span');
        value.className = 'cpick__channel-value';
        row.append(name, slider, value);
        return { channel, row, slider, value };
    });

    /* --- текстове поле */
    const code = document.createElement('input');
    code.type = 'text';
    code.className = 'cpick__code';
    code.spellcheck = false;
    code.title = t('pixel.colorCodeHint');
    code.setAttribute('aria-label', t('pixel.colorCodeHint'));

    root.append(squareWrap, hueWrap, ...channels.map((item) => item.row), code);

    const squareContext = square.getContext('2d');
    const hueContext = hueStrip.getContext('2d');

    /** Кожен піксель — уже зведений до 5-6-5 колір, тобто такий, як на Лілці. */
    function paintSquare(): void {
        if (!squareContext) return;
        const data = new ImageData(SQUARE_WIDTH, SQUARE_HEIGHT);
        const words = new Uint32Array(data.data.buffer);
        for (let y = 0; y < SQUARE_HEIGHT; y++) {
            const v = 1 - y / (SQUARE_HEIGHT - 1);
            for (let x = 0; x < SQUARE_WIDTH; x++) {
                const [r, g, b] = hsvToRgb(hue, x / (SQUARE_WIDTH - 1), v);
                words[y * SQUARE_WIDTH + x] = RGB565_TO_RGBA[color565(r, g, b)];
            }
        }
        squareContext.putImageData(data, 0, 0);
    }

    function paintHue(): void {
        if (!hueContext) return;
        const data = new ImageData(SQUARE_WIDTH, HUE_HEIGHT);
        const words = new Uint32Array(data.data.buffer);
        for (let x = 0; x < SQUARE_WIDTH; x++) {
            const [r, g, b] = hsvToRgb((x / (SQUARE_WIDTH - 1)) * 360, 1, 1);
            const pixel = RGB565_TO_RGBA[color565(r, g, b)];
            for (let y = 0; y < HUE_HEIGHT; y++) words[y * SQUARE_WIDTH + x] = pixel;
        }
        hueContext.putImageData(data, 0, 0);
    }

    /** Усе, крім квадрата: його перемальовує лише зміна відтінку. */
    function drawControls(): void {
        squareKnob.style.left = `${saturation * 100}%`;
        squareKnob.style.top = `${(1 - brightness) * 100}%`;
        squareKnob.style.background = toHex(color);
        hueKnob.style.left = `${(hue / 360) * 100}%`;

        const parts = split565(color);
        for (const item of channels) {
            item.slider.value = String(parts[item.channel]);
            item.value.textContent = String(parts[item.channel]);
            // Доріжка показує, куди поведе саме цей канал за поточних інших
            const low = { ...parts, [item.channel]: 0 };
            const high = { ...parts, [item.channel]: item.channel === 'g' ? 63 : 31 };
            item.slider.style.background = `linear-gradient(to right, ${toHex(join565(low.r, low.g, low.b))}, ${toHex(join565(high.r, high.g, high.b))})`;
        }

        if (document.activeElement !== code) code.value = luaHex(color);
        code.classList.remove('is-bad');
    }

    /** Колір прийшов не з квадрата — HSV виводиться з нього. */
    function adoptColor(next: number): void {
        color = next;
        const [r, g, b] = toRgb888(next);
        const hsv = rgbToHsv(r, g, b);
        // Відтінок сірого не визначений — лишається попередній
        const hueChanged = hsv.s > 0 && Math.abs(hsv.h - hue) > 0.5;
        if (hsv.s > 0) hue = hsv.h;
        saturation = hsv.s;
        brightness = hsv.v;
        if (hueChanged) paintSquare();
        drawControls();
    }

    function fromHsv(): void {
        const [r, g, b] = hsvToRgb(hue, saturation, brightness);
        color = color565(r, g, b);
        drawControls();
        onChange(color);
    }

    /* --- перетягування */
    function drag(target: HTMLElement, move: (fx: number, fy: number) => void): void {
        const handle = (event: PointerEvent) => {
            const box = target.getBoundingClientRect();
            const fx = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
            const fy = Math.min(1, Math.max(0, (event.clientY - box.top) / box.height));
            move(fx, fy);
        };
        target.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            target.setPointerCapture(event.pointerId);
            handle(event);
        });
        target.addEventListener('pointermove', (event) => {
            if (target.hasPointerCapture(event.pointerId)) handle(event);
        });
    }

    drag(squareWrap, (fx, fy) => {
        saturation = fx;
        brightness = 1 - fy;
        fromHsv();
    });

    drag(hueWrap, (fx) => {
        hue = fx * 360;
        paintSquare();
        fromHsv();
    });

    for (const item of channels) {
        item.slider.addEventListener('input', () => {
            const parts = split565(color);
            parts[item.channel] = Number(item.slider.value);
            adoptColor(join565(parts.r, parts.g, parts.b));
            onChange(color);
        });
    }

    const applyCode = () => {
        const parsed = parseColor(code.value, names);
        if (parsed === null) {
            code.classList.add('is-bad');
            return;
        }
        adoptColor(parsed);
        code.value = luaHex(parsed);
        onChange(color);
    };
    code.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            applyCode();
            code.select();
        }
    });
    code.addEventListener('change', applyCode);

    paintHue();
    paintSquare();
    drawControls();

    return {
        root,
        set: adoptColor,
    };
}
