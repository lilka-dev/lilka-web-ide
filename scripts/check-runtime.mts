/**
 * Перевірки рантайму Lua.
 *
 * Рантайм навмисно не залежить від Web Worker, тому його можна ганяти під
 * Node — з тією ж спільною пам'яттю і тим самим блокуючим `Atomics.wait`.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LuaRuntime } from '../src/runtime/runtime.ts';
import { createSharedMemory, CTRL, bufferOffset } from '../src/runtime/shared.ts';
import { color565 } from '../src/emulator/color.ts';
import type { FontJson } from '../src/emulator/font.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const board = JSON.parse(readFileSync(join(root, 'src/generated/board.json'), 'utf8'));
const profile = board.boards[board.defaultBoard];

const fonts: Record<string, FontJson> = {};
for (const f of board.fonts) {
    fonts[f.name] = JSON.parse(readFileSync(join(root, 'src/generated/fonts', `${f.name}.json`), 'utf8'));
}

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

const W = profile.display.width;
const H = profile.display.height;

async function runScript(code: string, options: { budget?: number } = {}) {
    const memory = createSharedMemory(W, H);
    const output: string[] = [];
    const runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        instructionBudget: options.budget,
        onPrint: (t) => output.push(t),
    });
    await runtime.prepare();
    const result = runtime.run(code);
    const frame = Atomics.load(memory.control, CTRL.FRAME);
    const ready = Atomics.load(memory.control, CTRL.READY_INDEX);
    const pixels =
        ready >= 0 ? new Uint16Array(memory.pixels, bufferOffset(ready, W, H), W * H) : new Uint16Array(W * H);
    const coverage = runtime.apiCoverage;
    runtime.close();
    return { result, output, frame, pixels, memory, coverage };
}

// 1. Скрипт без циклу: тіло виконується, кадр публікується
{
    const { result, pixels, frame } = await runScript(`
        display.fill_screen(display.color565(255, 0, 0))
        display.fill_rect(10, 10, 20, 20, colors.green)
    `);
    ok(result.reason === 'no-loop', `без lilka.update очікується "no-loop", отримано "${result.reason}"`);
    ok(frame >= 1, 'кадр опубліковано навіть без циклу');
    ok(pixels[0] === color565(255, 0, 0), 'fill_screen записав пікселі у спільну пам\'ять');
    ok(pixels[15 + 15 * W] === 0x07e0, 'colors.green доступний і fill_rect працює');
}

// 2. Життєвий цикл: init -> update/draw, вихід через util.exit
{
    const { result, output, frame } = await runScript(`
        local n = 0
        function lilka.init() print("init") end
        function lilka.update(delta)
            n = n + 1
            print("delta=" .. delta)
            if n >= 3 then util.exit() end
        end
        function lilka.draw() display.fill_screen(colors.blue) end
    `);
    ok(result.reason === 'exit', `util.exit має завершити програму, отримано "${result.reason}"`);
    ok(output[0] === 'init', 'lilka.init викликано першим');
    ok(output[1] === 'delta=0.033', `перший delta має бути 0.033 (33 мс), отримано "${output[1]}"`);
    ok(frame >= 4, `кадрів має бути щонайменше 4 (init + 3 оновлення), отримано ${frame}`);
}

// 3. display.print бере форматування з Lua: 5 і 5.0 різні
{
    const { output } = await runScript(`
        print(5, 5.0, 1/2, "текст")
    `);
    ok(output[0] === '5\t5.0\t0.5\tтекст', `форматування чисел Lua: отримано "${output[0]}"`);
}

// 4. math ЗАМІНЕНО цілком: стандартних полів немає, типи як у прошивці
{
    const { output } = await runScript(`
        print(math.sin(0), math.floor(2.7), math.clamp(15, 0, 10), math.round(2.5))
        print(math.huge, math.fmod, math.tointeger, math.type)
        print(math.round(-2.5), math.max({3, 9, 4}), math.pi)
    `);
    ok(
        output[0] === '0.0\t2\t10.0\t3',
        `типи результатів: sin -> float, floor -> int, clamp -> float, round -> int: "${output[0]}"`,
    );
    ok(
        output[1] === 'nil\tnil\tnil\tnil',
        `на Лілці math замінено, стандартних полів немає: "${output[1]}"`,
    );
    ok(
        output[2] === '-3\t9.0\t3.1415926535898',
        `round(-2.5) = -3 (roundf, від нуля), max бере таблицю: "${output[2]}"`,
    );
}

// 5. Перетворення з методами
{
    const { output } = await runScript(`
        local t = transforms.new():rotate(90)
        local x, y = t:vtransform(10, 0)
        print(x, y)
        local m = t:get()
        print(#m, #m[1])
    `);
    ok(output[0] === '0\t10', `обертання на 90° точки (10,0) має дати (0,10), отримано "${output[0]}"`);
    ok(output[1] === '2\t2', 'Transform:get повертає матрицю 2x2');
}

// 6. Нескінченний цикл переривається лічильником інструкцій
{
    const { result } = await runScript(`while true do end`, { budget: 200000 });
    ok(result.reason === 'error', 'нескінченний цикл має завершитися помилкою');
    ok(
        (result.message ?? '').includes('ліміт інструкцій'),
        `повідомлення про ліміт: "${result.message}"`,
    );
}

// 7. Помилка в скрипті доходить нагору з номером рядка
{
    const { result } = await runScript(`\nlocal x = nil\nx.field = 1\n`);
    ok(result.reason === 'error', 'помилка виконання має бути повідомлена');
    ok((result.message ?? '').includes('main.lua:3'), `номер рядка в помилці: "${result.message}"`);
}

// 8. Помилки файлової системи називають повний шлях, а не лише ім'я
{
    const { result } = await runScript(`resources.load_image("x.bmp")`);
    ok(
        (result.message ?? '').includes('/sd/x.bmp'),
        `помилка називає повний шлях: "${result.message}"`,
    );
}

// 9. Текстовий стан у кожної канви свій — як на залізі
{
    const { output } = await runScript(`
        local n = 0
        display.set_cursor(100, 100)
        function lilka.update() n = n + 1 if n >= 2 then util.exit() end end
        function lilka.draw()
            display.print("A")
        end
    `);
    ok(output.length === 0, 'скрипт відпрацював без помилок');
}

// 10. lilka.fullscreen доїжджає до спільної пам'яті
{
    const { memory } = await runScript(`
        lilka.fullscreen = false
        local n = 0
        function lilka.update() n = n + 1 if n >= 2 then util.exit() end end
        function lilka.draw() end
    `);
    ok(Atomics.load(memory.control, CTRL.FULLSCREEN) === 0, 'fullscreen = false передано в спільну пам\'ять');
    ok(
        Atomics.load(memory.control, CTRL.CANVAS_Y) === profile.canvas.statusBarHeight,
        'канва зсунулася на висоту статусбару',
    );
}

// 11. Покриття API рахується
{
    const { coverage } = await runScript('');
    ok(coverage.implemented.length > 40, `реалізованих прив'язок: ${coverage.implemented.length}`);
    ok(coverage.stubs.length > 0, 'заглушки обліковуються окремо');
}

// 12. Зупинка ззовні: прапорець RUNNING виводить цикл із роботи.
//     У браузері його скидає головний потік; тут — колбек друку, який
//     викликається синхронно з того ж циклу, тобто шлях у коді той самий.
{
    const memory = createSharedMemory(W, H);
    let runtime: LuaRuntime;
    runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        onPrint: (text) => {
            if (text === 'stop') runtime.stop();
        },
    });
    await runtime.prepare();
    const result = runtime.run(`
        local n = 0
        function lilka.update()
            n = n + 1
            if n == 3 then print("stop") end
        end
        function lilka.draw() end
    `);
    const frames = Atomics.load(memory.control, CTRL.FRAME);
    runtime.close();
    ok(result.reason === 'stopped', `зупинка ззовні дає "stopped", отримано "${result.reason}"`);
    ok(frames >= 3 && frames <= 6, `цикл спинився одразу після сигналу, кадрів: ${frames}`);
}

// 13. Темп кадрів: ціль 30/с, як vTaskDelay у прошивці
{
    const started = Date.now();
    const { frame } = await runScript(`
        local n = 0
        function lilka.update() n = n + 1 if n >= 15 then util.exit() end end
        function lilka.draw() end
    `);
    const elapsed = Date.now() - started;
    const fps = frame / (elapsed / 1000);
    ok(fps > 24 && fps < 38, `темп має бути близько 30 к/с, отримано ${fps.toFixed(1)}`);
}

// 14. Простори імен мають бути СПРАВЖНІМИ таблицями, а не userdata.
//     Пряме присвоєння об'єкта з боку JS дає проксі: індексування працює,
//     але type() повертає "userdata", і програма під залізо може спіткнутися.
{
    const { output } = await runScript(`
        print(type(display), type(controller), type(util), type(buzzer))
        print(type(audio), type(state), type(resources), type(math))
    `);
    ok(output[0] === 'table\ttable\ttable\ttable', `простори імен — таблиці: "${output[0]}"`);
    ok(output[1] === 'table\ttable\ttable\ttable', `простори імен — таблиці: "${output[1]}"`);
}

// 15. Зумер: мелодія виходить назовні з правильними нотами, не блокуючи цикл
{
    const memory = createSharedMemory(W, H);
    const sounds: string[] = [];
    const runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        onPrint: () => {},
        onSound: (event) => sounds.push(JSON.stringify(event)),
    });
    await runtime.prepare();
    runtime.run(`
        buzzer.play(notes.C4, 100)
        buzzer.play_melody({ {440, 8}, {0, 8}, {880, -4} }, 400)
        buzzer.stop()
    `);
    runtime.close();
    ok(sounds.length === 3, `три звукові події, отримано ${sounds.length}`);
    ok(sounds[0].includes('"frequency":262'), `notes.C4 = 262 Гц: ${sounds[0]}`);
    ok(sounds[1].includes('"tempo":400') && sounds[1].includes('"size":-4'), `мелодія з нотою з крапкою: ${sounds[1]}`);
    ok(sounds[2].includes('stop'), 'buzzer.stop доходить назовні');
}

// 16. Таблиця notes існує і має ноти з обох країв діапазону
{
    const { output } = await runScript('print(notes.B0, notes.C4, notes.A4, notes.B8)');
    ok(output[0] === '31\t262\t440\t7902', `таблиця нот із прошивки: "${output[0]}"`);
}

// 17. Повідомлення про помилку без службового префікса обгортки
{
    const { result } = await runScript('local x = nil\nx.y = 1');
    ok(
        (result.message ?? '').startsWith('main.lua:'),
        `повідомлення має починатися з назви файлу: "${result.message}"`,
    );
}

// 18. Віджет не має публікувати кадр самостійно.
//     У прошивці draw() віджета викликає queueDraw(), і головний цикл робить
//     це ще раз — виходить два обміни буферів на кадр, а екран поперемінно
//     показує віджет і застарілий буфер. Тут другий виклик прибрано, і ця
//     перевірка стежить, щоб він не повернувся.
{
    const { frame } = await runScript(`
        local kb = keyboardUI("Ім'я")
        local n = 0
        function lilka.update(d) n = n + 1 if n >= 5 then util.exit() end end
        function lilka.draw() kb:draw() end
    `);
    ok(frame === 5, `рівно один кадр на оновлення, отримано ${frame} на 5 оновлень`);
}

// 19. Обидва буфери містять намальований віджет — інакше буде мерехтіння
{
    const memory = createSharedMemory(W, H);
    const runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        onPrint: () => {},
    });
    await runtime.prepare();
    runtime.run(`
        local d = alertUI("Увага", "Текст")
        local n = 0
        function lilka.update(dt) n = n + 1 if n >= 6 then util.exit() end end
        function lilka.draw() d:draw() end
    `);
    const filled = [0, 1].map((index) => {
        const view = new Uint16Array(memory.pixels, bufferOffset(index, W, H), W * H);
        return view.reduce((n, value) => n + (value !== 0 ? 1 : 0), 0);
    });
    runtime.close();
    ok(filled[0] > 0 && filled[1] > 0, `обидва буфери намальовані: ${filled.join(' і ')}`);
    ok(filled[0] === filled[1], `буфери однакові: ${filled.join(' проти ')}`);
}

// 20. require бере модуль із віртуальної карти.
//     Прошивка задає package.path = <тека скрипта>/?.lua, а стандартний
//     пошук Lua дивиться на справжній диск, якого в браузері немає.
{
    const memory = createSharedMemory(W, H);
    const output: string[] = [];
    const runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        onPrint: (text) => output.push(text),
    });
    await runtime.prepare();
    runtime.loadFiles('/sd/гра/main.lua', [
        ['/sd/гра/modules/data.lua', new TextEncoder().encode('return { value = 42 }')],
    ]);
    runtime.run(`
        local data = require("modules.data")
        print(data.value)
        -- повторний виклик має дати ТОЙ САМИЙ об'єкт, а не завантажити вдруге
        print(require("modules.data") == data)
    `);
    runtime.close();
    ok(output[0] === '42', `модуль завантажено: "${output[0]}"`);
    ok(output[1] === 'true', `повторний require повертає той самий об'єкт: "${output[1]}"`);
}

// 21. Відсутній модуль дає зрозумілу помилку, а не мовчазний nil
{
    const { result } = await runScript('require("modules.немає")');
    ok(
        (result.message ?? '').includes("module 'modules.немає' not found"),
        `зрозуміла помилка: "${result.message}"`,
    );
}

// 22. Дробові координати приводяться до цілих, як `int16_t x = luaL_checknumber()`.
//     Без цього гра з фізикою (координати з прискорення майже завжди дробові)
//     не малює НІЧОГО — саме на цьому спіткнулися астероїди.
{
    const { pixels } = await runScript(`
        display.fill_screen(0)
        display.fill_circle(100.7, 80.3, 10.9, colors.white)
    `);
    let painted = 0;
    for (const value of pixels) if (value !== 0) painted++;
    ok(painted > 200, `дробові координати малюють: ${painted} пікселів`);
    ok(pixels[80 * W + 100] === 0xffff, 'центр кола на місці після відкидання дробу');
}

// 23. state зберігається між запусками через файл поруч зі скриптом
{
    const memory = createSharedMemory(W, H);
    const runtime = new LuaRuntime({
        memory,
        fonts,
        statusBarHeight: profile.canvas.statusBarHeight,
        defaultFont: board.defaultFont,
        onPrint: () => {},
    });
    await runtime.prepare();
    runtime.loadFiles('/sd/гра.lua', []);
    runtime.run(`
        state.score = 42
        state.name = "Богдан"
        state.save()
    `);

    // Файл .state має з'явитися поруч зі скриптом
    const device = (runtime as unknown as { device: { vfs: { read(path: string): Uint8Array | null } } }).device;
    const saved = device.vfs.read('/sd/гра.state');
    runtime.close();

    ok(saved !== null, 'файл стану створено поруч зі скриптом');
    const text = saved ? new TextDecoder().decode(saved) : '';
    // Формат дослівно як у прошивці: по три рядки на значення
    ok(text.includes('number'), `формат прошивки: ключ, тип, значення`);
    ok(text.includes('Богдан'), 'рядкові значення зберігаються');
}

// 24. Прошивка вимагає ОБИДВА колбеки: без `update` цикл не стартує навіть
//     за наявності `draw`. Для блоків це пастка — людина складає лише
//     «малювати» й нічого не бачить, тому генератор дописує відсутній.
{
    const onlyDraw = await runScript(`
        function lilka.draw(delta)
            display.fill_screen(colors.blue)
        end
    `);
    ok(onlyDraw.result.reason === 'no-loop', `лише draw — цикл не стартує: "${onlyDraw.result.reason}"`);

    const both = await runScript(`
        local n = 0
        function lilka.draw(delta)
            display.fill_screen(colors.blue)
        end
        function lilka.update(delta)
            n = n + 1
            if n >= 3 then util.exit() end
        end
    `);
    let painted = 0;
    for (const value of both.pixels) if (value !== 0) painted++;
    ok(painted > 60000, `з обома колбеками екран залито: ${painted} пікселів`);
}

console.log(fails === 0 ? '✔ рантайм: усі перевірки пройдено' : `✖ рантайм: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
