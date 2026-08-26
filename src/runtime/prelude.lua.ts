/**
 * Преамбула, яка виконується перед скриптом користувача.
 *
 * Три речі, які принципово мусять бути на боці Lua, а не JS:
 *
 * 1. `display.print` формує рядок через `tostring`. У Lua 5.4 ціле 5 друкується
 *    як «5», а дробове 5.0 — як «5.0». JS цієї різниці не бачить, тож якби
 *    перетворення робилося там, віртуальний екран показував би не те, що екран
 *    справжній.
 * 2. `math` ЗАМІНЮЄТЬСЯ цілком. `lualilka_math_register` робить `luaL_newlib`
 *    і `lua_setglobal("math")`, тобто затирає стандартну таблицю. Отже на
 *    Лілці немає `math.huge`, `math.fmod`, `math.tointeger`, `math.type`.
 *    Скрипт із ними працює у звичайній Lua і падає на залізі — емулятор має
 *    падати так само.
 * 3. Головний цикл — порт `AbstractLuaRunnerApp::execute()`, включно з
 *    цілими 33 мс на кадр, збиранням сміття щокадру й тим, що `show_fps`
 *    лишає після себе зсунутий курсор і змінений колір тексту.
 */

export const PRELUDE = String.raw`
local api = __api

--[[
    Кожен простір імен збирається в СПРАВЖНЮ таблицю Lua.

    Пряме присвоєння state = api.state дало б userdata: об'єкти з боку JS
    приїжджають проксі-об'єктами. Індексування працює, але type() повертає
    "userdata", pairs поводиться інакше, і програма, написана під залізо,
    може на цьому спіткнутися. На Лілці всі ці простори — таблиці.
--]]
local function toTable(source, skip)
    local out = {}
    for name, value in pairs(source) do
        if name:sub(1, 2) ~= "__" and name ~= skip then out[name] = value end
    end
    return out
end

display = toTable(api.display)

-- display.width / display.height беруться з канви один раз, як і в прошивці
do
    local size = api.display.__size()
    display.width = size[1]
    display.height = size[2]
end

--[[
    Перетворення значення на текст правилами прошивки.

    display.print і console.print влаштовані однаково:
        lua_isstring(v) -> lua_tostring(v), інакше lua_typename(тип v)
    lua_isstring істинна і для чисел, тож числа проходять звичайним
    перетворенням Lua: ціле 5 дає "5", дробове 5.0 дає "5.0".

    А от усе інше друкується НАЗВОЮ ТИПУ. display.print(true) на залізі
    малює "boolean", а не "true"; таблиця стає "table" без адреси. Звичайний
    print цього не робить — він стандартний, з tostring.
--]]
local function keiraToString(value)
    local kind = type(value)
    if kind == "string" or kind == "number" then return tostring(value) end
    return kind
end

function display.print(...)
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = keiraToString((select(i, ...)))
    end
    api.display.__print(table.concat(parts))
end

controller = toTable(api.controller)
util = toTable(api.util)
buzzer = toTable(api.buzzer)
audio = toTable(api.audio)
geometry = { intersect_aabb = api.geometry.intersect_aabb }
function geometry.intersect_lines(ax, ay, bx, by, cx, cy, dx, dy)
    local r = api.geometry.__intersect_lines(ax, ay, bx, by, cx, cy, dx, dy)
    if r == nil then return nil end
    return r[1], r[2]
end
resources = toTable(api.resources)
sandbox = toTable(api.sandbox)

-- Файловий об'єкт sdcard.open() і fs.open(). У Lua немає close(): файл
-- закривається складальником сміття через __gc. У mJS close() є — це
-- розбіжність мов.
--
-- Метатаблиця одна на два простори імен, і це не спрощення: у прошивці
-- lualilka_fs.h і lualilka_sdcard.h оголошують FILE_OBJECT тим самим рядком
-- "File", тож другий luaL_newmetatable повертає вже створену таблицю.
local File = {}
File.__index = File
function File:size() return api.sdcard.__size(self.__id) end
function File:seek(position) return api.sdcard.__seek(self.__id, position) end
function File:read(maxBytes) return api.sdcard.__read(self.__id, maxBytes) end
function File:write(text) return api.sdcard.__write(self.__id, text) end
function File:exists() return api.sdcard.__exists(self.__id) end

sdcard = {
    ls = api.sdcard.ls,
    remove = api.sdcard.remove,
    rename = api.sdcard.rename,
    open = function(path, mode)
        return setmetatable({ __id = api.sdcard.__open(path, mode or "r") }, File)
    end,
}

--[[
    fs.* — те, чого емулятору бракувало цілком.

    Прошивка реєструє глобальний fs (lualilka_fs.cpp), анотації його
    описують, а специфікація його не бачила: lilka-api.json був знятий зі
    старішого зрізу keira, ще без fs.lua.

    Від sdcard відрізняється розв'язанням шляху: тут працює luapath_to_path
    (відносний шлях — від теки скрипта), а не склеювання з "/sd".
--]]
fs = {
    ls = api.fs.ls,
    remove = api.fs.remove,
    rename = api.fs.rename,
    joinpath = api.fs.joinpath,
    mkpath = api.fs.mkpath,
    open = function(path, mode)
        return setmetatable({ __id = api.fs.__open(path, mode or "r") }, File)
    end,
}

--[[
    Стан програми.

    Формат файлу дослівно повторює lualilka_state_save: по три рядки на
    значення — ключ, тип, саме значення. Виняток — nil, у якого рядка значення
    немає. Числа записуються через %lf, тобто з шістьма знаками після коми.

    Завдяки точному формату файл .state переноситься між браузером і залізом:
    рекорд, набраний у браузері, читається на справжній Лілці.

    Головне тут — те, чого емулятор раніше не робив: state НЕ завжди таблиця.
    Прошивка створює глобальну змінну лише тоді, коли поруч зі скриптом лежить
    файл .state; інакше state дорівнює nil, і програма мусить починати з
    "state = state or {}" — саме так написано в прикладі до анотації. Порожня
    таблиця замість nil зробила б браузер поблажливішим за залізо: програма без
    цього рядка працювала б тут і падала на Лілці при першому ж запуску.
--]]
local PROTECTED_STATE_KEYS = { save = true, reset = true, clear = true, path = true }
local state_mt

local function serializeState(data)
    local parts = {}
    for key, value in pairs(data) do
        local kind = type(value)
        if kind == "number" then
            parts[#parts + 1] = key .. "\nnumber\n" .. string.format("%f", value)
        elseif kind == "string" then
            parts[#parts + 1] = key .. "\nstring\n" .. value
        elseif kind == "boolean" then
            parts[#parts + 1] = key .. "\nboolean\n" .. (value and "1" or "0")
        end
        -- таблиці та функції прошивка мовчки пропускає; nil у таблиці не
        -- зберігається взагалі, тож гілки для нього немає і в lua_next
    end
    if #parts == 0 then return "" end
    return table.concat(parts, "\n") .. "\n"
end

local function parseState(text)
    local data = {}
    if text == nil or text == "" then return data end
    local lines = {}
    for line in (text .. "\n"):gmatch("(.-)\n") do lines[#lines + 1] = line end

    local i = 1
    while i <= #lines do
        local key = lines[i]
        local kind = lines[i + 1]
        if key == nil or key == "" or kind == nil then break end
        if kind == "nil" then
            i = i + 2
        else
            local raw = lines[i + 2]
            if kind == "number" then data[key] = tonumber(raw)
            elseif kind == "string" then data[key] = raw
            elseif kind == "boolean" then data[key] = raw == "1" end
            i = i + 3
        end
    end
    return data
end

--[[
    save / reset / clear — три різні дії, і плутати їх не можна:

      save()  — записати теперішній state у файл;
      reset() — ПЕРЕЧИТАТИ файл, відкинувши все незбережене
                (lualilka_state_reset_lua викликає lualilka_state_load);
      clear() — ВИДАЛИТИ файл і зробити state рівним nil.

    Усі три працюють із глобальною змінною, а не із замиканням: reset і clear
    її замінюють, і програма мусить побачити саме нове значення.
--]]
local function stateSave()
    local current = rawget(_G, "state")
    if type(current) ~= "table" then
        error("таблиця state не визначена", 2)
    end
    api.state.__save(serializeState(current))
end

local function stateReset()
    local data = {}
    if api.state.__exists() then data = parseState(api.state.__load()) end
    rawset(_G, "state", setmetatable(data, state_mt))
end

local function stateClear()
    api.state.__clear()
    rawset(_G, "state", nil)
end

state_mt = {
    __index = function(_, key)
        if key == "save" then return stateSave end
        if key == "reset" then return stateReset end
        if key == "clear" then return stateClear end
        if key == "path" then return api.state.__path() end
        return nil
    end,
    __newindex = function(t, key, value)
        if PROTECTED_STATE_KEYS[key] then
            error("неможливо перезаписати state." .. tostring(key), 2)
        end
        rawset(t, key, value)
    end,
}

--[[
    Читання стану на початку запуску.

    Глобальна змінна з'являється лише за наявності файлу: у прошивці
    lualilka_state_load викликається з LuaFileRunnerApp::run() під умовою, і
    саме тому на першому запуску state дорівнює nil.

    Чому це функція, а не просто рядок у преамбулі: преамбула виконується в
    prepare(), коли віртуальна карта ще порожня і шлях до скрипта невідомий.
    Читати файл там — те саме, що читати його до вставляння карти: раніше
    саме через це стан ніколи не відновлювався. Виклик іде з LuaRuntime.run(),
    де карта вже на місці — так само, як у прошивці стан читається перед
    luaL_loadfile.
--]]
function __lilka_load_state()
    if api.state.__exists() then
        rawset(_G, "state", setmetatable(parseState(api.state.__load()), state_mt))
    else
        rawset(_G, "state", nil)
    end
end

-- math замінюється ПОВНІСТЮ: так робить lualilka_math_register.
-- math.huge, math.fmod, math.tointeger, math.type на Лілці відсутні.
--[[
    Ціле чи дробове — це видно в результаті: tostring(0) дає "0", а tostring(0.0)
    дає "0.0". Прошивка віддає більшість функцій через lua_pushnumber, тобто
    ЗАВЖДИ дробовим, і лише sign/floor/ceil/round через lua_pushinteger.
    JS такої різниці не має, тому тип нав'язується тут: "+ 0.0" робить число
    дробовим.
--]]
local __m = {}
local FLOAT_RESULT = {
    "clamp", "lerp", "map", "abs", "sqrt", "pow",
    "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "log", "deg", "rad",
    "len", "dist",
}
local INTEGER_RESULT = { "sign", "floor", "ceil", "round" }

for _, name in ipairs(FLOAT_RESULT) do
    local fn = api.math[name]
    __m[name] = function(...) return fn(...) + 0.0 end
end
for _, name in ipairs(INTEGER_RESULT) do
    __m[name] = api.math[name]
end

--[[
    min / max / sum / avg беруть ОДНУ таблицю і читають лише її масивну
    частину: assert_table_arg перевіряє lua_rawlen, а далі йде lua_rawgeti від
    1 до довжини. Отже ключі-рядки туди не потрапляють — math.max{a=1, b=2} на
    залізі не рахує двійку, а падає, бо rawlen такої таблиці нуль.

    Послідовність збирається тут, у Lua: з боку JS видно вже готовий масив, і
    жодного здогадування про те, що вважати елементом.
--]]
local function numberSequence(value)
    if type(value) ~= "table" then
        error("аргумент має бути таблицею", 3)
    end
    local length = rawlen(value)
    if length == 0 then
        error("таблиця не може бути порожньою", 3)
    end
    local out = {}
    for i = 1, length do
        local item = tonumber(rawget(value, i))
        if item == nil then
            error("елемент " .. i .. " не є числом", 3)
        end
        out[i] = item
    end
    return out
end

for _, name in ipairs({ "min", "max", "sum", "avg" }) do
    local fn = api.math[name]
    __m[name] = function(value) return fn(numberSequence(value)) + 0.0 end
end

-- random без аргументів дає дробове 0..1, з аргументами — ціле,
-- причому верхня межа НЕ включається (семантика Arduino random(), не Lua)
function __m.random(a, b)
    if a == nil then return api.math.random() + 0.0 end
    return api.math.random(a, b)
end
__m.pi = 3.141592653589793
__m.e = 2.718281828459045
__m.tau = 6.283185307179586
function __m.norm(x, y)
    local r = api.math.__norm(x, y)
    return r[1] + 0.0, r[2] + 0.0
end
function __m.rotate(x, y, angle)
    local r = api.math.__rotate(x, y, angle)
    return r[1] + 0.0, r[2] + 0.0
end
math = __m

-- Іменовані кольори. У прошивці ця таблиця є, але в анотаціях LuaLS її немає.
colors = {
    black = 0x0000, white = 0xFFFF, red = 0xF800, green = 0x07E0, blue = 0x001F,
    cyan = 0x07FF, magenta = 0xF81F, yellow = 0xFFE0,
    midnight_blue = 0x18CE, orange_red = 0xFB44,
}

--[[
    Віджети інтерфейсу.

    У прошивці це userdata з метатаблицею, тож форма виклику така:
        local dialog = alertUI("Заголовок", "Повідомлення")
        dialog:update()
        if dialog:isFinished() then ... end

    Тут — таблиця з ідентифікатором і метатаблицею методів. Форма для програми
    та сама.

    ProgressDialog навмисно НЕ має update() та isFinished(): їх немає й у
    первотворі.
--]]
local Alert = {}
Alert.__index = Alert
function Alert:update() api.ui.__alert_update(self.__id) end
function Alert:draw() api.ui.__alert_draw(self.__id) end
function Alert:isFinished() return api.ui.__alert_isFinished(self.__id) end
function Alert:setTitle(title) api.ui.__alert_setTitle(self.__id, title) end
function Alert:setMessage(message) api.ui.__alert_setMessage(self.__id, message) end
function Alert:addActivationButton(button) api.ui.__alert_addActivationButton(self.__id, button) end
function Alert:getButton() return api.ui.__alert_getButton(self.__id) end

function alertUI(title, message)
    return setmetatable({ __id = api.ui.__new_alert(title, message) }, Alert)
end

local Keyboard = {}
Keyboard.__index = Keyboard
function Keyboard:update() api.ui.__kb_update(self.__id) end
function Keyboard:draw() api.ui.__kb_draw(self.__id) end
function Keyboard:isFinished() return api.ui.__kb_isFinished(self.__id) end
function Keyboard:setMasked(masked) api.ui.__kb_setMasked(self.__id, masked) end
function Keyboard:setValue(value) api.ui.__kb_setValue(self.__id, value) end
function Keyboard:getValue() return api.ui.__kb_getValue(self.__id) end

function keyboardUI(title)
    return setmetatable({ __id = api.ui.__new_keyboard(title) }, Keyboard)
end

local Progress = {}
Progress.__index = Progress
function Progress:draw() api.ui.__progress_draw(self.__id) end
function Progress:setMessage(message) api.ui.__progress_setMessage(self.__id, message) end
function Progress:setProgress(progress) api.ui.__progress_setProgress(self.__id, progress) end

function progressUI(title, message)
    return setmetatable({ __id = api.ui.__new_progress(title, message) }, Progress)
end

--[[
    require із віртуальної карти.

    Прошивка задає package.path = <тека скрипта>/?.lua, і стандартний require
    сам знаходить файл на SD-карті. У браузері диска немає, тож у package
    додається власний шукач: він питає вміст файлу в емулятора, компілює його
    й повертає результат.

    Кеш обов'язковий і не є оптимізацією: require має повертати ОДИН і той
    самий об'єкт при повторних викликах. Астероїди на це спираються —
    modules/ship.lua і modules/asteroid.lua обидва роблять
    require("modules.data") й очікують ті самі спрайти, а не завантажені
    вдруге.
--]]
package = package or {}
package.loaded = package.loaded or {}

function require(name)
    local cached = package.loaded[name]
    if cached ~= nil then return cached end

    local source = api.__read_module(name)
    if source == nil or source == "" then
        error("module '" .. tostring(name) .. "' not found", 2)
    end

    local chunk, message = load(source, "@" .. tostring(name):gsub("%.", "/") .. ".lua")
    if not chunk then error(message, 2) end

    local result = chunk(name)
    -- Модуль без return вважається завантаженим: так само поводиться Lua
    if result == nil then result = true end
    package.loaded[name] = result
    return result
end

-- Ноти для зумера. У прошивці ця таблиця теж є, і теж відсутня в анотаціях.
notes = api.__notes

-- Перетворення: об'єкт із методами поверх матриці з чотирьох чисел
local Transform = {}
Transform.__index = Transform

local function wrapTransform(m)
    return setmetatable({ __m = m }, Transform)
end

function Transform:rotate(angle) return wrapTransform(api.transforms.__rotate(self.__m, angle)) end
function Transform:scale(x, y) return wrapTransform(api.transforms.__scale(self.__m, x, y)) end
function Transform:multiply(other) return wrapTransform(api.transforms.__multiply(self.__m, other.__m)) end
function Transform:inverse() return wrapTransform(api.transforms.__inverse(self.__m)) end
function Transform:vtransform(x, y)
    local r = api.transforms.__apply(self.__m, x, y)
    return r[1], r[2]
end
function Transform:get()
    return { { self.__m[1], self.__m[2] }, { self.__m[3], self.__m[4] } }
end
function Transform:set(m)
    self.__m = { m[1][1], m[1][2], m[2][1], m[2][2] }
end

transforms = { new = function() return wrapTransform(api.transforms.__new()) end }

lilka = { fullscreen = true, show_fps = false }

-- Стандартний print іде в консоль середовища. Він саме стандартний: прошивка
-- його не перевизначає, тож тут працює tostring, а не правила прошивки.
local __console_print = api.console.print
function print(...)
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring((select(i, ...)))
    end
    __console_print(table.concat(parts, "\t"))
end

--[[
    console.print — це НЕ стандартний print.

    Значення перетворюються правилами lualilka_console_print (той самий
    keiraToString, що й у display.print), розділяються табуляцією, і в кінці
    йде перенос рядка. Тому console.print(true) друкує "boolean", а print(true)
    друкує "true".

    Простору імен console в анотаціях keira немає взагалі — хоча приклади в
    тих самих анотаціях ним користуються: console.print(state.path) у
    state.lua. Через це його не було ні в специфікації, ні в емуляторі, і
    програма з console.print падала в браузері, працюючи на залізі.
--]]
console = {
    print = function(...)
        local parts = {}
        for i = 1, select("#", ...) do
            parts[i] = keiraToString((select(i, ...)))
        end
        __console_print(table.concat(parts, "\t"))
    end,
}

--[[
    Головний цикл. Порт AbstractLuaRunnerApp::execute():
      - ціль 30 кадрів/с, perfectDelta = 33 мс (ціле!)
      - delta першого кадру завжди 33 мс
      - update отримує СЕКУНДИ (delta / 1000)
      - якщо немає update або draw — програма завершується
      - queue_draw після draw, збирання сміття щокадру
      - якщо не встигли — delta стає фактичним часом кадру
--]]
function __lilka_main()
    local perfect = 33
    local delta = perfect

    if lilka.init then
        lilka.init()
        api.__queue_draw()
    end

    if not lilka.update or not lilka.draw then
        return "no-loop"
    end

    while api.__running() do
        local now = api.__millis()
        api.__sample_buttons()

        lilka.update(delta / 1000.0)
        lilka.draw()

        if lilka.show_fps then
            -- Побічні дії первотвору збережено: курсор і колір лишаються зміненими
            display.set_cursor(24, 24)
            display.set_text_color(0xFFFF, 0)
            display.print("FPS: " .. math.floor(1000 / (delta > 0 and delta or 1)) .. "  ")
        end

        api.__set_fullscreen(lilka.fullscreen and true or false)
        api.__queue_draw()
        collectgarbage()

        local elapsed = api.__millis() - now
        if elapsed < perfect then
            api.__sleep_ms(perfect - elapsed)
            delta = perfect
        else
            delta = elapsed
        end
    end

    return "stopped"
end

--[[
    Збереження стану при завершенні програми.

    LuaFileRunnerApp::run() після execute() дивиться на глобальний state і,
    якщо це таблиця, сам пише її у файл — незалежно від того, чи викликала
    програма state.save(), і навіть якщо вона впала з помилкою. Гра, яка просто
    присвоює state.record і виходить, на залізі рекорд зберігає.

    Викликається з LuaRuntime.run() у finally, щоб збігтися з первотвором і за
    цією умовою теж.
--]]
function __lilka_save_state()
    local current = rawget(_G, "state")
    if type(current) ~= "table" then return end
    api.state.__save(serializeState(current))
end

--[[
    Перехоплення "state = {...}".

    lualilka_state_register вішає на глобальну таблицю __newindex, який
    помічає присвоєння в state і чіпляє метатаблицю зі save/reset/clear/path.
    Без цього документований рядок "state = state or {}" при першому запуску
    дав би звичайну таблицю — без save() і без збереження на диск.

    Тонкість, яка є і в прошивці: __newindex спрацьовує лише тоді, коли ключа в
    таблиці ще немає. Тому метатаблицю отримує ПЕРШЕ присвоєння, а наступні,
    коли глобальна змінна вже існує, проходять повз хук.

    Ставиться в самому кінці преамбули — як lualilka_state_register, який у
    luaSetup викликається останнім, уже після всіх інших реєстрацій.
--]]
do
    local meta = getmetatable(_G) or {}
    meta.__newindex = function(t, key, value)
        if key == "state" and type(value) == "table" then
            setmetatable(value, state_mt)
        end
        rawset(t, key, value)
    end
    setmetatable(_G, meta)
end
`;
