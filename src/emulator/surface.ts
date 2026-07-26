/**
 * Подвійна буферизація — модель того, як кадри влаштовані в KeiraOS.
 *
 * У прошивці програма має два буфери: `canvas` (малює програма) і `backCanvas`
 * (готовий кадр). `App::queueDraw()` МІНЯЄ їх місцями, збільшує номер кадру й
 * піднімає прапорець перемалювання; окреме завдання виводить `backCanvas` на
 * дисплей.
 *
 * З цього випливає наслідок, який дивує, але його треба зберегти: буфери НЕ
 * очищаються, а через обмін програма щоразу малює поверх кадру, який був ДВА
 * кадри тому. Тому Lua-програма, яка не викликає `display.fill_screen`, побачить
 * не «слід», а мерехтіння між двома старими кадрами. Це не помилка емулятора.
 *
 * Ще з первотвору: `queueDraw` рахує пропущені кадри — якщо попередній кадр ще
 * не забрали, це вважається пропуском.
 */

import { Framebuffer } from './framebuffer.ts';

export interface SurfaceRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class DisplaySurface {
    /** Те, що фізично видно на екрані: 280x240 для v2. */
    readonly display: Framebuffer;
    /** Область, яку займає канва програми (зі статусбаром y = 24). */
    readonly rect: SurfaceRect;

    frame = 0;
    skippedFrames = 0;

    private front: Framebuffer;
    private back: Framebuffer;
    private redraw = false;

    constructor(displayWidth: number, displayHeight: number, rect: SurfaceRect) {
        this.display = new Framebuffer(displayWidth, displayHeight);
        this.rect = rect;
        this.front = new Framebuffer(rect.width, rect.height);
        this.back = new Framebuffer(rect.width, rect.height);
    }

    /** Буфер, у який малює програма (у прошивці — `canvas`). */
    get canvas(): Framebuffer {
        return this.front;
    }

    /** Порт `App::queueDraw`. */
    queueDraw(): void {
        if (this.frame && this.redraw) this.skippedFrames++;
        const buffer = this.front;
        this.front = this.back;
        this.back = buffer;
        this.frame++;
        this.redraw = true;
    }

    /**
     * Переносить готовий кадр у видимий буфер. Повертає true, якщо було що
     * переносити. Викликається раз на кадр із головного циклу.
     */
    present(): boolean {
        if (!this.redraw) return false;
        this.display.drawFramebuffer(this.back, this.rect.x, this.rect.y);
        this.redraw = false;
        return true;
    }

    /** Скидає обидва буфери — потрібно при перезапуску програми. */
    reset(color = 0): void {
        this.front.fillScreen(color);
        this.back.fillScreen(color);
        this.display.fillScreen(color);
        this.frame = 0;
        this.skippedFrames = 0;
        this.redraw = false;
    }
}
