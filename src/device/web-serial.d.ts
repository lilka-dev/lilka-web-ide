/**
 * Опис Web Serial для TypeScript.
 *
 * Ці типи ще не входять до стандартного набору, бо можливість підтримують не
 * всі браузери. Описано лише те, чим ми справді користуємось.
 */

interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
}

interface Serial {
    requestPort(): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
    readonly serial: Serial;
}
