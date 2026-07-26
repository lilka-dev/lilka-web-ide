/**
 * Воркер із рантаймом Lua.
 *
 * Тонка обгортка: уся змістовна частина в `runtime.ts`, який навмисно нічого
 * не знає про воркери — тому його можна ганяти під Node (`npm run check:runtime`).
 *
 * Воркер потрібен не для швидкості, а через `Atomics.wait`: у головному потоці
 * браузер його не дозволяє, а без нього `util.sleep` не був би блокуючим і
 * поводився б інакше, ніж на залізі.
 */

import wasmUri from 'wasmoon/dist/glue.wasm?url';
import { LuaRuntime } from './runtime.ts';
import type { HostMessage, WorkerMessage } from './shared.ts';

let runtime: LuaRuntime | null = null;

function post(message: WorkerMessage): void {
    self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<HostMessage>) => {
    const message = event.data;

    try {
        if (message.type === 'init') {
            const board = message.board as {
                canvas: { statusBarHeight: number };
                defaultFont: string;
            };
            runtime = new LuaRuntime({
                memory: message.memory,
                fonts: message.fonts as never,
                statusBarHeight: board.canvas.statusBarHeight,
                defaultFont: board.defaultFont,
                wasmUri,
                onPrint: (text) => post({ type: 'print', text }),
                // WebAudio у воркері недоступний, тому звук грає головний потік
                onSound: (event) => post({ type: 'sound', event }),
                onFileWrite: (path, data) => post({ type: 'file-write', path, data }),
            });
            await runtime.prepare();
            post({ type: 'ready' });
            return;
        }

        if (message.type === 'run') {
            if (!runtime) throw new Error('Рантайм не готовий');
            runtime.loadFiles(message.scriptPath, message.files, message.decodedPng);
            post({ type: 'started' });
            const result = runtime.run(message.code, message.name);
            if (result.reason === 'error') {
                post({ type: 'error', message: result.message ?? 'невідома помилка' });
            } else {
                post({ type: 'finished', reason: result.reason });
            }
            return;
        }

        if (message.type === 'stop') {
            runtime?.stop();
            return;
        }
    } catch (error) {
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
