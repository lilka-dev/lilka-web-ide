/**
 * Рантайм Lua. Живе у воркері, але сам по собі від воркера не залежить —
 * тому його можна запустити й перевірити під Node.
 *
 * Захист від нескінченних циклів у два шари:
 *   1. `debug.sethook` з лічильником інструкцій — м'який шар. Він дозволяє
 *      Lua завершитися охайно, з трасуванням і зі збереженим станом
 *      середовища. Обходиться викликом `debug.sethook()` із самого скрипта,
 *      і це нормально: це навчальне середовище, а не пісочниця безпеки.
 *   2. `worker.terminate()` з головного потоку за пропущеними ударами
 *      серця — твердий шар. Працює завжди, бо не залежить ні від чого
 *      всередині Lua.
 */

import { LuaFactory } from 'wasmoon';
import type LuaEngine from 'wasmoon/dist/engine';
import type { FontJson } from '../emulator/font.ts';
import { CTRL, type SharedMemory } from './shared.ts';
import { LilkaDevice } from './device.ts';
import { createBindings, LuaExit, type BindingHooks } from './bindings.ts';
import { PRELUDE } from './prelude.lua.ts';

export interface RuntimeOptions {
    memory: SharedMemory;
    fonts: Record<string, FontJson>;
    statusBarHeight: number;
    defaultFont: string;
    /** Скільки інструкцій Lua дозволено між перевірками сторожа. */
    instructionBudget?: number;
    wasmUri?: string;
    onPrint(text: string): void;
    /** Головний потік зберігає те, що програма записала. */
    onFileWrite?: (path: string, data: Uint8Array) => void;
    /** Звук іде назовні: у воркері WebAudio немає. Необов'язковий — під Node звуку просто не буде. */
    onSound?: BindingHooks['sound'];
}

export interface RunResult {
    reason: 'exit' | 'no-loop' | 'stopped' | 'error';
    message?: string;
}

export class LuaRuntime {
    private engine: LuaEngine | null = null;
    private device: LilkaDevice | null = null;
    private readonly options: RuntimeOptions;
    private readonly startedAt = Date.now();
    private coverage: { implemented: string[]; stubs: string[] } = { implemented: [], stubs: [] };

    constructor(options: RuntimeOptions) {
        this.options = options;
    }

    get apiCoverage(): { implemented: string[]; stubs: string[] } {
        return this.coverage;
    }

    async prepare(): Promise<void> {
        const factory = new LuaFactory(this.options.wasmUri);
        this.engine = await factory.createEngine({ openStandardLibs: true, injectObjects: true });

        this.device = new LilkaDevice(
            this.options.memory,
            this.options.fonts,
            this.options.statusBarHeight,
            this.options.defaultFont,
        );

        const control = this.options.memory.control;
        const bindings = createBindings(this.device, {
            print: (text) => this.options.onPrint(text),
            now: () => Date.now() - this.startedAt,
            sleepMs: (ms) => this.sleep(ms),
            running: () => Atomics.load(control, CTRL.RUNNING) === 1,
            sound: (event) => this.options.onSound?.(event),
        });
        this.device.onFileWrite = (path, data) => this.options.onFileWrite?.(path, data);
        this.coverage = {
            implemented: [...bindings.implemented].sort(),
            stubs: [...bindings.stubs].sort(),
        };

        this.engine.global.set('__api', bindings.api);
        this.engine.doStringSync(PRELUDE);
    }

    /**
     * Сон, який справді блокує потік — як `vTaskDelay` на залізі.
     * Можливий лише поза головним потоком, і це одна з причин, чому рантайм
     * живе у воркері.
     */
    private sleep(ms: number): void {
        if (ms <= 0) return;
        const control = this.options.memory.control;
        Atomics.wait(control, CTRL.SLEEP, Atomics.load(control, CTRL.SLEEP), ms);
        Atomics.store(control, CTRL.HEARTBEAT, Date.now() - this.startedAt);
    }

    /** Наповнює віртуальну карту перед запуском. */
    loadFiles(
        scriptPath: string,
        files: Array<[string, Uint8Array]>,
        decodedPng: Array<[string, { width: number; height: number; rgba: Uint8Array }]> = [],
    ): void {
        const device = this.device;
        if (!device) throw new Error('Спершу треба викликати prepare()');
        device.scriptPath = scriptPath;
        for (const [path, data] of files) device.vfs.write(path, data);
        for (const [path, decoded] of decodedPng) device.decodedPng.set(path, decoded);
    }

    /** Запускає скрипт і крутить головний цикл до зупинки. */
    run(code: string, name = 'main.lua'): RunResult {
        const engine = this.engine;
        if (!engine) throw new Error('Спершу треба викликати prepare()');

        const control = this.options.memory.control;
        Atomics.store(control, CTRL.RUNNING, 1);
        Atomics.store(control, CTRL.HEARTBEAT, Date.now() - this.startedAt);

        const budget = this.options.instructionBudget ?? 20_000_000;

        const device = this.device;
        if (!device) throw new Error('Пристрій не ініціалізовано');

        // Натискання, зроблені до запуску, програмі не належать
        device.resetButtons();

        // Стан читається перед скриптом — як у LuaFileRunnerApp::run(), де
        // lualilka_state_load викликається ще до luaL_loadfile. Раніше це
        // робила преамбула, тобто на етапі prepare(), коли віртуальної карти
        // ще немає, і збережений стан не відновлювався ніколи.
        engine.doStringSync('__lilka_load_state()');

        try {
            // Послідовність узята з AbstractLuaRunnerApp::execute():
            //   очистити канву -> виконати тіло скрипта -> queueDraw ->
            //   очистити канву -> lilka.init -> queueDraw -> головний цикл.
            // Два очищення тут не зайві: після обміну буферів друге припадає
            // вже на інший буфер.
            device.canvas.fillScreen(0);
            engine.doStringSync(wrapWithGuard(code, name, budget));
            device.queueDraw();
            device.canvas.fillScreen(0);

            const reason = engine.doStringSync('return __lilka_main()') as string;
            return { reason: reason === 'no-loop' ? 'no-loop' : 'stopped' };
        } catch (error) {
            if (isExit(error)) return { reason: 'exit' };
            return { reason: 'error', message: describe(error) };
        } finally {
            Atomics.store(control, CTRL.RUNNING, 0);
            this.saveState();
        }
    }

    /**
     * Збереження `state` при завершенні програми.
     *
     * `LuaFileRunnerApp::run()` робить це після `execute()` безумовно: і після
     * `util.exit`, і після помилки, і після звичайного виходу з циклу. Тому
     * виклик стоїть у `finally`, а не поруч з успішним поверненням.
     *
     * Помилка самого збереження не має підмінити собою помилку програми: її
     * має побачити той, хто пише код, тому вона йде в консоль окремим рядком.
     */
    private saveState(): void {
        try {
            this.engine?.doStringSync('__lilka_save_state()');
        } catch (error) {
            this.options.onPrint('⚠ не вдалося зберегти state: ' + describe(error));
        }
    }

    stop(): void {
        Atomics.store(this.options.memory.control, CTRL.RUNNING, 0);
        Atomics.notify(this.options.memory.control, CTRL.SLEEP);
    }

    close(): void {
        this.engine?.global.close();
        this.engine = null;
    }
}

/**
 * Обгортає код користувача лічильником інструкцій.
 *
 * Хук ставиться перед виконанням і знімається одразу після: інакше він
 * рахував би й інструкції головного циклу, і будь-яка достатньо довга
 * програма впиралася б у ліміт просто тому, що працює довго.
 */
function wrapWithGuard(code: string, name: string, budget: number): string {
    return [
        `local __chunk = assert(load(${JSON.stringify(code)}, ${JSON.stringify('@' + name)}))`,
        `debug.sethook(function() error("перевищено ліміт інструкцій (${budget}) — схоже на нескінченний цикл", 2) end, "", ${budget})`,
        'local __ok, __err = pcall(__chunk)',
        'debug.sethook()',
        'if not __ok then error(__err, 0) end',
    ].join('\n');
}

function isExit(error: unknown): boolean {
    if (error instanceof LuaExit) return true;
    return typeof (error as Error)?.message === 'string' && (error as Error).message.includes('__lilka_exit__');
}

/**
 * Прибирає з повідомлення службовий префікс обгортки.
 *
 * Код користувача виконується всередині `load(...)`, тому Lua додає до помилки
 * назву зовнішнього шматка: `[string "local __chunk = assert(load(..."]:1:`.
 * Для того, хто пише програму, це шум — потрібне лише `main.lua:3: ...`.
 */
function describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^\[string "[\s\S]*?"\]:\d+:\s*/, '');
}
