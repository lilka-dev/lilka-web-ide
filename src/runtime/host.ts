/**
 * Головний потік: створює воркер, годує його кнопками й забирає кадри.
 *
 * Розподіл обов'язків навмисно такий:
 *   - темп задає ВОРКЕР, 30 кадрів/с із цілими 33 мс, як `vTaskDelay` у прошивці;
 *   - головний потік лише виводить те, що є, зі своєю частотою (зазвичай 60 Гц).
 * Дисплей на залізі теж оновлюється незалежно від того, як швидко рахує
 * програма, тож розв'язка тут не спрощення, а відтворення.
 */

import { Framebuffer } from '../emulator/framebuffer.ts';
import type { Controller } from '../emulator/controller.ts';
import type { FontJson } from '../emulator/font.ts';
import { BuzzerAudio } from './buzzer-audio.ts';
import {
    CTRL,
    SHARED_BUTTONS,
    bufferOffset,
    createSharedMemory,
    type SharedMemory,
    type WorkerMessage,
} from './shared.ts';

export interface HostEvents {
    onPrint(text: string): void;
    onError(message: string): void;
    onStateChange(state: LuaHostState): void;
}

export type LuaHostState = 'idle' | 'loading' | 'ready' | 'running' | 'stopping';

/** Скільки мілісекунд без ознак життя вважати зависанням. */
const WATCHDOG_TIMEOUT_MS = 2000;

export class LuaHost {
    private worker: Worker | null = null;
    private memory: SharedMemory | null = null;
    private views: [Uint16Array, Uint16Array] | null = null;
    private state: LuaHostState = 'idle';
    private lastFrameSeen = -1;
    /** Окремі лічильники для сторожа: вивід кадру й ознака поступу — різні речі. */
    private lastProgressFrame = -1;
    private lastProgressAt = 0;
    private readonly buzzer = new BuzzerAudio();

    constructor(
        private readonly board: {
            display: { width: number; height: number };
            canvas: { statusBarHeight: number };
        },
        private readonly defaultFont: string,
        private readonly events: HostEvents,
    ) {}

    get currentState(): LuaHostState {
        return this.state;
    }

    get frame(): number {
        return this.memory ? Atomics.load(this.memory.control, CTRL.FRAME) : 0;
    }

    private setState(state: LuaHostState): void {
        this.state = state;
        this.events.onStateChange(state);
    }

    /** Створює воркер і завантажує в нього шрифти. Викликається один раз. */
    async start(fonts: Record<string, FontJson>): Promise<void> {
        this.setState('loading');

        const { width, height } = this.board.display;
        const memory = createSharedMemory(width, height);
        this.memory = memory;
        this.views = [
            new Uint16Array(memory.pixels, bufferOffset(0, width, height), width * height),
            new Uint16Array(memory.pixels, bufferOffset(1, width, height), width * height),
        ];

        const worker = new Worker(new URL('./lua-worker.ts', import.meta.url), {
            type: 'module',
            name: 'lilka-lua',
        });
        this.worker = worker;

        worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.handle(event.data);
        worker.onerror = (event) => {
            this.events.onError(event.message || 'помилка у воркері');
            this.setState('ready');
        };

        worker.postMessage({
            type: 'init',
            memory,
            fonts,
            board: { canvas: this.board.canvas, defaultFont: this.defaultFont },
        });
    }

    private handle(message: WorkerMessage): void {
        switch (message.type) {
            case 'ready':
                this.setState('ready');
                break;
            case 'started':
                this.setState('running');
                break;
            case 'print':
                this.events.onPrint(message.text);
                break;
            case 'sound':
                this.buzzer.handle(message.event);
                break;
            case 'error':
                this.buzzer.silence();
                this.events.onError(message.message);
                this.setState('ready');
                break;
            case 'finished':
                this.buzzer.silence();
                this.setState('ready');
                break;
        }
    }

    run(code: string, name = 'main.lua'): void {
        if (!this.worker || this.state !== 'ready') return;
        const control = this.memory!.control;
        Atomics.store(control, CTRL.FRAME, 0);
        Atomics.store(control, CTRL.SKIPPED, 0);
        Atomics.store(control, CTRL.READY_INDEX, -1);
        Atomics.store(control, CTRL.PRESENTED, 0);
        this.lastFrameSeen = -1;
        this.lastProgressFrame = -1;
        this.lastProgressAt = performance.now();
        this.worker.postMessage({ type: 'run', code, name });
    }

    /** М'яка зупинка: воркер вийде з циклу на наступній ітерації. */
    stop(): void {
        if (!this.worker || !this.memory) return;
        this.setState('stopping');
        this.buzzer.silence();
        Atomics.store(this.memory.control, CTRL.RUNNING, 0);
        Atomics.notify(this.memory.control, CTRL.SLEEP);
        this.worker.postMessage({ type: 'stop' });
    }

    /**
     * Твердий шар захисту: якщо воркер не подає ознак життя, його вбивають
     * разом із усім станом Lua. На відміну від хука лічильника інструкцій,
     * цей шлях не залежить ні від чого всередині Lua — його не можна вимкнути
     * з користувацького скрипта.
     */
    private async terminateAndRestart(reason: string, fonts: Record<string, FontJson>): Promise<void> {
        this.worker?.terminate();
        this.worker = null;
        this.buzzer.silence();
        this.setState('idle');
        this.events.onError(reason);
        await this.start(fonts);
    }

    /**
     * Виводить готовий кадр у видимий буфер. Повертає true, якщо кадр був новий.
     * Викликається з циклу requestAnimationFrame головного потоку.
     */
    present(display: Framebuffer): boolean {
        const memory = this.memory;
        if (!memory || !this.views) return false;

        const control = memory.control;
        const ready = Atomics.load(control, CTRL.READY_INDEX);
        const frame = Atomics.load(control, CTRL.FRAME);
        if (ready < 0 || frame === this.lastFrameSeen) return false;
        this.lastFrameSeen = frame;

        const canvasY = Atomics.load(control, CTRL.CANVAS_Y);
        const canvasHeight = Atomics.load(control, CTRL.CANVAS_HEIGHT);
        const width = memory.maxWidth;
        const source = this.views[ready];

        // Копіювання рядками: канва може бути нижчою за екран (статусбар)
        for (let row = 0; row < canvasHeight; row++) {
            const target = (row + canvasY) * display.width;
            if (target < 0 || row + canvasY >= display.height) continue;
            display.pixels.set(source.subarray(row * width, row * width + width), target);
        }
        display.dirty = true;
        Atomics.store(control, CTRL.PRESENTED, frame);
        return true;
    }

    /** Переносить стан кнопок у спільну пам'ять. Раз на кадр головного потоку. */
    pushButtons(controller: Controller): void {
        if (!this.memory) return;
        const control = this.memory.control;
        for (let i = 0; i < SHARED_BUTTONS.length; i++) {
            Atomics.store(control, CTRL.BUTTONS + i, controller.isPressed(SHARED_BUTTONS[i]) ? 1 : 0);
        }
    }

    /**
     * Перевірка ознак життя. Викликати раз на кадр головного потоку.
     *
     * Ознакою поступу вважається зростання лічильника кадрів. Якщо він стоїть
     * довше за таймаут, воркер убивається — це єдиний шлях, який не залежить
     * від того, що робиться всередині Lua.
     */
    checkWatchdog(fonts: Record<string, FontJson>): void {
        if (this.state !== 'running' || !this.memory) return;
        const control = this.memory.control;
        if (Atomics.load(control, CTRL.RUNNING) !== 1) return;

        const now = performance.now();
        const frame = Atomics.load(control, CTRL.FRAME);

        if (frame !== this.lastProgressFrame) {
            this.lastProgressFrame = frame;
            this.lastProgressAt = now;
            return;
        }

        if (now - this.lastProgressAt > WATCHDOG_TIMEOUT_MS) {
            this.lastProgressAt = now;
            void this.terminateAndRestart(
                `Програма не відповідає понад ${WATCHDOG_TIMEOUT_MS} мс — виконання перервано.`,
                fonts,
            );
        }
    }

    get skippedFrames(): number {
        return this.memory ? Atomics.load(this.memory.control, CTRL.SKIPPED) : 0;
    }
}
