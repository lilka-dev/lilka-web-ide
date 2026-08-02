/**
 * Зв'язок зі справжньою Лілкою через USB-кабель.
 *
 * Web Serial є лише в браузерах на Chromium: у Firefox і Safari доступу до
 * кабелю з веб-сторінки немає взагалі. Тому кнопка підключення там просто не
 * показується — неактивна кнопка лише збиває з пантелику.
 *
 * Прошивка має два режими, і вони різні:
 *
 *   Live Lua (у нас — «На пристрої»)
 *     Лілка чекає на екрані, комп'ютер надсилає текст програми, мовчання
 *     довше за секунду означає «код закінчився». Ніякого протоколу, просто
 *     текст.
 *
 *   REPL (у нас — «Спробувати команду»)
 *     Лілка приймає по рядку, виконує й повертає те, що програма надрукувала
 *     через `print`. Вираз сам по собі нічого не поверне — потрібен саме
 *     `print`.
 *
 * В обох випадках на самій Лілці спершу треба відкрити відповідний пункт у
 * меню «Розробка». Через кабель це не вмикається, і про це варто казати
 * прямо.
 */

/** `SERIAL_BAUD_RATE` у прошивці. */
const BAUD_RATE = 115200;

/**
 * Пауза, після якої прошивка вважає код завершеним.
 *
 * У `LuaLiveRunnerApp` це `SERIAL_DELAY` = 1000 мс, а таймаут читання —
 * половина від нього. Тому після відправлення коду треба помовчати трохи
 * довше за цей поріг.
 */
const CODE_END_SILENCE_MS = 700;

export interface DeviceEvents {
    /** Рядок, який надійшов від Лілки. */
    onLine(text: string): void;
    onConnect(): void;
    onDisconnect(): void;
    onError(message: string): void;
}

/** Чи вміє цей браузер працювати з кабелем. */
export function isSerialSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export class LilkaDevice {
    private port: SerialPort | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private readonly events: DeviceEvents;
    private buffer = '';

    constructor(events: DeviceEvents) {
        this.events = events;
    }

    get connected(): boolean {
        return this.port !== null;
    }

    /**
     * Підключення.
     *
     * Браузер сам показує список пристроїв — обрати потрібний має людина, і
     * обійти це вікно неможливо. Це вимога безпеки, а не наше рішення.
     */
    async connect(): Promise<boolean> {
        if (!isSerialSupported()) {
            this.events.onError('Цей браузер не вміє працювати з USB. Потрібен Chrome або Edge.');
            return false;
        }

        try {
            const port = await navigator.serial.requestPort();
            await port.open({ baudRate: BAUD_RATE });

            this.port = port;
            this.writer = port.writable?.getWriter() ?? null;
            this.events.onConnect();
            void this.readLoop();
            return true;
        } catch (error) {
            // Відмова у вікні вибору — не помилка, людина просто передумала
            if (error instanceof DOMException && error.name === 'NotFoundError') return false;
            this.events.onError(`Не вдалося підключитися: ${describe(error)}`);
            return false;
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.reader?.cancel();
            this.reader?.releaseLock();
            this.writer?.releaseLock();
            await this.port?.close();
        } catch {
            // Кабель могли висмикнути — тоді закривати вже нічого
        }
        this.port = null;
        this.writer = null;
        this.reader = null;
        this.buffer = '';
        this.events.onDisconnect();
    }

    /** Читає потік і віддає його рядками. */
    private async readLoop(): Promise<void> {
        if (!this.port?.readable) return;
        const reader = this.port.readable.getReader();
        this.reader = reader;
        const decoder = new TextDecoder();

        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                if (!value) continue;

                this.buffer += decoder.decode(value, { stream: true });

                // Прошивка шле і \r, і \n, і обидва разом — зводимо до одного
                const lines = this.buffer.split(/\r\n|\r|\n/);
                this.buffer = lines.pop() ?? '';
                for (const line of lines) this.events.onLine(line);
            }
        } catch (error) {
            this.events.onError(`Зв'язок із Лілкою обірвався: ${describe(error)}`);
            void this.disconnect();
        }
    }

    private async write(text: string): Promise<void> {
        if (!this.writer) throw new Error('Лілка не підключена');
        await this.writer.write(new TextEncoder().encode(text));
    }

    /**
     * Надсилає програму цілком і запускає її — режим Live Lua.
     *
     * Прошивка чекає на мовчання, щоб зрозуміти, де кінець коду. Тому після
     * відправлення просто мовчимо трохи довше за поріг.
     */
    async runProgram(code: string): Promise<void> {
        await this.write(code);
        await new Promise((resolve) => setTimeout(resolve, CODE_END_SILENCE_MS));
    }

    /** Надсилає один рядок у консоль — режим REPL. */
    async sendCommand(line: string): Promise<void> {
        await this.write(line + '\n');
    }
}

function describe(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}
