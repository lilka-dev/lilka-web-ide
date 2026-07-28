/**
 * Спільна пам'ять між головним потоком і воркером Lua.
 *
 * Кадровий буфер лежить у SharedArrayBuffer, тому воркер пише пікселі прямо в
 * ту пам'ять, яку головний потік виводить на екран — без копіювання й без
 * повідомлень. Саме заради цього в проєкті є `coi-serviceworker`: без
 * COOP/COEP браузер не дасть SharedArrayBuffer.
 *
 * Буферів два, як і в KeiraOS: один програма малює, другий чекає на вивід.
 */

/** Індекси у керуючому Int32Array. */
export const CTRL = {
    /** 1, поки програма виконується. Головний потік скидає в 0, щоб зупинити. */
    RUNNING: 0,
    /** Індекс буфера з готовим кадром: 0, 1 або -1, якщо кадру ще немає. */
    READY_INDEX: 1,
    /** Лічильник кадрів (queue_draw). */
    FRAME: 2,
    /** Слово для Atomics.wait — на ньому воркер спить між кадрами і в util.sleep. */
    SLEEP: 3,
    /** Поточне значення lilka.fullscreen. */
    FULLSCREEN: 4,
    /** Розмір канви програми — змінюється разом із fullscreen. */
    CANVAS_WIDTH: 5,
    CANVAS_HEIGHT: 6,
    /** Зсув канви по вертикалі (0 або висота статусбару). */
    CANVAS_Y: 7,
    /** Скільки кадрів головний потік не встиг забрати. */
    SKIPPED: 8,
    /** Номер кадру, який головний потік уже вивів на екран. */
    PRESENTED: 11,
    /** Час останнього кадру у воркері, мс — для сторожового таймера. */
    HEARTBEAT: 9,
    /** Скільки інструкцій Lua виконано (лічильник з debug.sethook). */
    INSTRUCTIONS: 10,
    /** Початок слотів кнопок: по одному int на кнопку, 0 або 1. */
    BUTTONS: 16,
} as const;

export const CTRL_LENGTH = 32;

/** Порядок кнопок у спільній пам'яті. Має збігатися з board.json. */
export const SHARED_BUTTONS = [
    'up', 'down', 'left', 'right', 'a', 'b', 'c', 'd', 'select', 'start',
] as const;

export type SharedButton = (typeof SHARED_BUTTONS)[number];

export interface SharedMemory {
    control: Int32Array;
    /** Два кадрові буфери підряд; кожен розміром maxWidth * maxHeight. */
    pixels: SharedArrayBuffer;
    maxWidth: number;
    maxHeight: number;
}

export function createSharedMemory(maxWidth: number, maxHeight: number): SharedMemory {
    /*
     * Правильна ознака — саме `crossOriginIsolated`, а не наявність
     * SharedArrayBuffer. У деяких браузерах конструктор існує, але без
     * ізоляції передати буфер у воркер не вийде, і помилка спливе пізніше й
     * у незрозумілому місці.
     */
    // У браузері ознака ізоляції обов'язкова; під Node її не існує, і там
    // спільна пам'ять доступна без жодних заголовків
    const inBrowser = typeof window !== 'undefined';
    if (typeof SharedArrayBuffer === 'undefined' || (inBrowser && !globalThis.crossOriginIsolated)) {
        throw new Error(
            'Цей браузер не дав спільної пам\'яті, тож Lua запустити не вдалося.\n' +
                'Потрібні заголовки COOP/COEP: у продакшені їх підставляє coi-serviceworker, ' +
                'локально — dev-сервер Vite.\n' +
                'Найнадійніше працює Chrome. Спробуйте також перезавантажити сторінку: ' +
                'на першому візиті service worker ще не встиг стати до роботи.',
        );
    }
    const control = new Int32Array(new SharedArrayBuffer(CTRL_LENGTH * 4));
    const pixels = new SharedArrayBuffer(2 * maxWidth * maxHeight * 2);
    return { control, pixels, maxWidth, maxHeight };
}

/** Зсув у байтах для буфера з індексом 0 або 1. */
export function bufferOffset(index: number, maxWidth: number, maxHeight: number): number {
    return index * maxWidth * maxHeight * 2;
}

/** Подія звуку. Зумер у прошивці не блокує, тому й тут лише повідомлення. */
export type SoundEvent =
    | { kind: 'tone'; frequency: number; durationMs: number | null }
    | { kind: 'melody'; tones: Array<{ frequency: number; size: number }>; tempo: number }
    | { kind: 'stop' };

/** Повідомлення воркера до головного потоку. */
export type WorkerMessage =
    | { type: 'ready' }
    | { type: 'started' }
    | { type: 'print'; text: string }
    | { type: 'sound'; event: SoundEvent }
    | { type: 'file-write'; path: string; data: Uint8Array }
    | { type: 'error'; message: string; traceback?: string }
    | { type: 'finished'; reason: 'exit' | 'no-loop' | 'stopped' };

/** Повідомлення головного потоку до воркера. */
export type HostMessage =
    | { type: 'init'; memory: SharedMemory; fonts: Record<string, unknown>; board: unknown }
    | {
          type: 'run';
          code: string;
          name: string;
          /** Повний шлях скрипта: від нього рахуються відносні шляхи resources.*. */
          scriptPath: string;
          /** Уміст віртуальної карти. Передається цілком перед запуском, бо
           *  resources.load_image синхронний і довантажити файл посеред кадру
           *  неможливо. */
          files: Array<[string, Uint8Array]>;
          /** RGBA для PNG: розпакування в браузері асинхронне, тож заздалегідь. */
          decodedPng: Array<[string, { width: number; height: number; rgba: Uint8Array }]>;
      }
    | { type: 'stop' };
