/**
 * Screen — виводить кадровий буфер RGB565 на <canvas>.
 *
 * Розмір backing store завжди дорівнює логічному екрану (280x240 для v2).
 * Збільшення робить браузер через CSS, і виключно цілим коефіцієнтом —
 * при дробовому масштабі піксель-арт розмивається навіть з `image-rendering`.
 */

import { RGB565_TO_RGBA } from './color.ts';
import type { Framebuffer } from './framebuffer.ts';

export class Screen {
    readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private readonly image: ImageData;
    private readonly rgba: Uint32Array;
    private scale = 1;
    private fb: Framebuffer;

    constructor(fb: Framebuffer) {
        this.fb = fb;
        this.canvas = document.createElement('canvas');
        this.canvas.width = fb.width;
        this.canvas.height = fb.height;
        this.canvas.className = 'lilka-screen';

        const ctx = this.canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Не вдалося отримати 2D-контекст');
        this.ctx = ctx;
        this.ctx.imageSmoothingEnabled = false;

        this.image = this.ctx.createImageData(fb.width, fb.height);
        this.rgba = new Uint32Array(this.image.data.buffer);
    }

    /** Переносить пікселі в canvas. Викликати раз на кадр. */
    present(force = false): void {
        if (!this.fb.dirty && !force) return;
        const src = this.fb.pixels;
        const dst = this.rgba;
        for (let i = 0; i < src.length; i++) dst[i] = RGB565_TO_RGBA[src[i]];
        this.ctx.putImageData(this.image, 0, 0);
        this.fb.dirty = false;
    }

    /**
     * Перепідключення до іншого буфера. Потрібне, коли змінюється режим
     * канви (`lilka.fullscreen`) і поверхня створюється заново.
     * Розміри видимого екрана при цьому не змінюються, тому canvas і ImageData
     * лишаються ті самі.
     */
    attach(fb: Framebuffer): void {
        if (fb.width !== this.canvas.width || fb.height !== this.canvas.height) {
            throw new Error(
                `Розмір буфера ${fb.width}x${fb.height} не збігається з екраном ${this.canvas.width}x${this.canvas.height}`,
            );
        }
        this.fb = fb;
        this.present(true);
    }

    /** Підбирає найбільший цілий масштаб, що вміщується у відведену область. */
    fit(availableWidth: number, availableHeight: number): number {
        const raw = Math.min(availableWidth / this.fb.width, availableHeight / this.fb.height);
        const next = Math.max(1, Math.floor(raw));
        if (next !== this.scale) {
            this.scale = next;
            this.canvas.style.width = `${this.fb.width * next}px`;
            this.canvas.style.height = `${this.fb.height * next}px`;
        }
        return this.scale;
    }

    get currentScale(): number {
        return this.scale;
    }

    /** Координата пікселя екрана під курсором — знадобиться для інспектора. */
    pixelAt(clientX: number, clientY: number): { x: number; y: number } | null {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.floor((clientX - rect.left) / this.scale);
        const y = Math.floor((clientY - rect.top) / this.scale);
        if (x < 0 || y < 0 || x >= this.fb.width || y >= this.fb.height) return null;
        return { x, y };
    }
}
