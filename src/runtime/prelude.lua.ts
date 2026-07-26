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

function display.print(...)
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring((select(i, ...)))
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

-- Файловий об'єкт sdcard.open(). У Lua немає close(): файл закривається
-- складальником сміття через __gc. У mJS close() є — це розбіжність мов.
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
    Стан програми.

    Формат файлу дослівно повторює lualilka_state_save: по три рядки на
    значення — ключ, тип, саме значення. Виняток — nil, у якого рядка значення
    немає. Числа записуються через %lf, тобто з шістьма знаками після коми.

    Завдяки точному формату файл .state переноситься між браузером і залізом:
    рекорд, набраний у браузері, читається на справжній Лілці.
--]]
local stateData = {}

local function serializeState()
    local parts = {}
    for key, value in pairs(stateData) do
        local kind = type(value)
        if kind == "number" then
            parts[#parts + 1] = key .. "\nnumber\n" .. string.format("%f", value)
        elseif kind == "string" then
            parts[#parts + 1] = key .. "\nstring\n" .. value
        elseif kind == "boolean" then
            parts[#parts + 1] = key .. "\nboolean\n" .. (value and "1" or "0")
        elseif kind == "nil" then
            parts[#parts + 1] = key .. "\nnil"
        end
        -- таблиці та функції прошивка мовчки пропускає
    end
    if #parts == 0 then return "" end
    return table.concat(parts, "\n") .. "\n"
end

local function deserializeState(text)
    stateData = {}
    if text == nil or text == "" then return end
    local lines = {}
    for line in (text .. "\n"):gmatch("(.-)\n") do lines[#lines + 1] = line end

    local i = 1
    while i <= #lines do
        local key = lines[i]
        local kind = lines[i + 1]
        if key == nil or key == "" or kind == nil then break end
        if kind == "nil" then
            stateData[key] = nil
            i = i + 2
        else
            local raw = lines[i + 2]
            if kind == "number" then stateData[key] = tonumber(raw)
            elseif kind == "string" then stateData[key] = raw
            elseif kind == "boolean" then stateData[key] = raw == "1" end
            i = i + 3
        end
    end
end

state = setmetatable({}, {
    __index = function(_, key)
        if key == "save" then
            return function() api.state.__save(serializeState()) end
        elseif key == "reset" then
            return function() stateData = {} api.state.__reset() end
        elseif key == "clear" then
            return function() stateData = {} end
        elseif key == "path" then
            return api.state.__path()
        end
        return stateData[key]
    end,
    __newindex = function(_, key, value)
        stateData[key] = value
    end,
})

deserializeState(api.state.__load())

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
    "clamp", "lerp", "map", "abs", "sqrt", "pow", "min", "max", "sum", "avg",
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

-- Стандартний print іде в консоль середовища
local __console_print = api.console.print
function print(...)
    local parts = {}
    for i = 1, select("#", ...) do
        parts[i] = tostring((select(i, ...)))
    end
    __console_print(table.concat(parts, "\t"))
end

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
`;
