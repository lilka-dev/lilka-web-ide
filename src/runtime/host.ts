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
import { Vfs, PERSISTENT_MOUNTS } from '../emulator/vfs.ts';
import { detectFormat, readPngSize } from '../emulator/image-loader.ts';
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
    /** Файли змінилися — панель файлів має перемалюватися. */
    onFilesChange?(): void;
}

interface DecodedPng {
    width: number;
    height: number;
    rgba: Uint8Array;
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

    /**
     * Віртуальна карта пам'яті. Живе тут, а не у воркері, бо IndexedDB
     * асинхронний, а `resources.load_image` — синхронний. Перед запуском
     * уміст передається у воркер цілком.
     */
    readonly vfs = new Vfs();
    /** PNG розпаковуються заздалегідь: у воркері це зробити синхронно годі. */
    private readonly decodedPng = new Map<string, DecodedPng>();

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
            case 'file-write':
                this.vfs.write(message.path, message.data);
                void this.persist();
                this.events.onFilesChange?.();
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

    /**
     * Кладе файл у віртуальну карту. PNG одразу розпаковується в RGBA —
     * інакше програма не змогла б завантажити його синхронно.
     */
    async addFile(path: string, data: Uint8Array): Promise<void> {
        this.vfs.write(path, data);
        if (detectFormat(data) === 'png') {
            this.decodedPng.set(path, await decodePng(data));
        }
        await this.persist();
        this.events.onFilesChange?.();
    }

    /** Видаляє файл або теку з усім вмістом. */
    removeFile(path: string): void {
        const info = this.vfs.stat(path);
        if (info?.isDirectory) {
            for (const file of this.vfs.allFiles()) {
                if (file.path.startsWith(path + '/')) {
                    this.vfs.remove(file.path);
                    this.decodedPng.delete(file.path);
                }
            }
        }
        this.vfs.remove(path);
        this.decodedPng.delete(path);
        void this.persist();
        this.events.onFilesChange?.();
    }

    mkdir(path: string): void {
        this.vfs.mkdir(path);
        void this.persist();
        this.events.onFilesChange?.();
    }

    /** Перейменування й переміщення — одна операція, як у файловій системі. */
    movePath(from: string, to: string): boolean {
        const decoded = this.decodedPng.get(from);
        const moved = this.vfs.movePath(from, to);
        if (moved && decoded) {
            this.decodedPng.delete(from);
            this.decodedPng.set(to, decoded);
        }
        if (moved) {
            void this.persist();
            this.events.onFilesChange?.();
        }
        return moved;
    }

    duplicateFile(path: string): void {
        const data = this.vfs.read(path);
        if (!data) return;
        const dot = path.lastIndexOf('.');
        const base = dot > 0 ? path.slice(0, dot) : path;
        const extension = dot > 0 ? path.slice(dot) : '';
        let candidate = `${base} (2)${extension}`;
        let index = 2;
        while (this.vfs.exists(candidate)) {
            index++;
            candidate = `${base} (${index})${extension}`;
        }
        this.vfs.write(candidate, data);
        const decoded = this.decodedPng.get(path);
        if (decoded) this.decodedPng.set(candidate, decoded);
        void this.persist();
        this.events.onFilesChange?.();
    }

    run(code: string, name = 'main.lua', scriptPath = '/sd/main.lua'): void {
        if (!this.worker || this.state !== 'ready') return;
        const control = this.memory!.control;
        Atomics.store(control, CTRL.FRAME, 0);
        Atomics.store(control, CTRL.SKIPPED, 0);
        Atomics.store(control, CTRL.READY_INDEX, -1);
        Atomics.store(control, CTRL.PRESENTED, 0);
        this.lastFrameSeen = -1;
        this.lastProgressFrame = -1;
        this.lastProgressAt = performance.now();
        this.worker.postMessage({
            type: 'run',
            code,
            name,
            scriptPath,
            files: this.vfs.allFiles().map((entry) => [entry.path, this.vfs.read(entry.path)!] as [string, Uint8Array]),
            decodedPng: [...this.decodedPng.entries()],
        });
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

    /**
     * Зберігає віртуальну карту в IndexedDB.
     *
     * `/tmp` навмисно пропускається: на залізі це рамдиск у PSRAM, і після
     * перезавантаження він порожній. Постійний `/tmp` був би зручнішим, але
     * поводився б інакше, ніж залізо.
     */
    private async persist(): Promise<void> {
        try {
            const db = await openDb();
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            store.clear();
            for (const point of PERSISTENT_MOUNTS) {
                for (const [path, data] of this.vfs.mount(point).entries()) {
                    store.put(data, point + path);
                }
            }
            db.close();
        } catch (error) {
            this.events.onError(`Не вдалося зберегти файли: ${String(error)}`);
        }
    }

    /** Відновлює карту зі сховища. Викликається один раз під час запуску. */
    async restore(): Promise<void> {
        try {
            const db = await openDb();
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const keys = await promisify<IDBValidKey[]>(store.getAllKeys());
            const values = await promisify<Uint8Array[]>(store.getAll());
            db.close();

            for (let i = 0; i < keys.length; i++) {
                const path = String(keys[i]);
                const data = values[i];
                this.vfs.write(path, data);
                if (detectFormat(data) === 'png') this.decodedPng.set(path, await decodePng(data));
            }
            this.events.onFilesChange?.();
        } catch {
            // порожнє сховище — не помилка
        }
    }
}

/* ------------------------------------------------------------ сховище ------ */

const DB_NAME = 'lilka-web-ide';
const STORE = 'files';

function promisify<T>(request: IDBRequest): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
    });
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * Розпаковування PNG у RGBA.
 *
 * У воркері WebAudio немає, а тут немає синхронного декодера — тому PNG
 * розпаковується заздалегідь, ще на головному потоці, коли файл потрапляє
 * у віртуальну карту.
 */
async function decodePng(data: Uint8Array): Promise<DecodedPng> {
    const { width, height } = readPngSize(data);
    const bitmap = await createImageBitmap(new Blob([data.slice() as unknown as BlobPart], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Не вдалося розпакувати PNG');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height);
    return { width, height, rgba: new Uint8Array(pixels.data.buffer.slice(0)) };
}
