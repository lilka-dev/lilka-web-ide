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

-- Стандартні функції захоплюються до того, як math і tostring буде
-- замінено: далі вони потрібні самій преамбулі.
local stock_type = math.type
local stock_floor = math.floor
local stock_tostring = tostring
local stock_format = string.format
local stock_pack = table.pack
local stock_unpack = table.unpack
local stock_getinfo = debug.getinfo
local stock_spack = string.pack
local stock_sunpack = string.unpack

-- Тексти luaL_error прошивки (src/generated/firmware-strings.ts)
local S = {}
for name, text in pairs(api.__strings) do S[name] = text end

--[[
    Перевірки аргументів — порт luaL_checknumber / luaL_checkinteger /
    luaL_checkstring.

    На залізі display.fill_rect("a") падає з
        bad argument #1 to 'fill_rect' (number expected, got string)
    а math.atan(1, 2) — з "Очікується 1 аргумент, отримано 2". Емулятор, що
    мовчки щось робить, приховує помилку, яка вилізе лише на Лілці.

    Опис аргументів — рядок, по символу на аргумент:
        n — число (рядок-число теж, як у lua_tonumberx)
        i — ціле (дробове без дробової частини теж: 3.0 підходить, 3.5 ні)
        s — рядок (число теж, воно перетворюється на рядок)
        . — не перевіряти
    Помилка кидається з рівнем 2, тобто з позицією виклику в скрипті — так
    само, як luaL_error підставляє позицію функції, що викликала C-функцію.
--]]
local function typeName(n, i, value)
    if i > n then return "no value" end
    return type(value)
end

local function checkArgs(fname, spec, n, args)
    for i = 1, #spec do
        local kind = spec:sub(i, i)
        local value = args[i]
        if kind == "n" then
            local number = type(value) == "number" and value or (type(value) == "string" and tonumber(value))
            if not number then
                error(stock_format("bad argument #%d to '%s' (number expected, got %s)", i, fname, typeName(n, i, value)), 3)
            end
            args[i] = number
        elseif kind == "i" then
            local number = type(value) == "number" and value or (type(value) == "string" and tonumber(value))
            if not number then
                error(stock_format("bad argument #%d to '%s' (number expected, got %s)", i, fname, typeName(n, i, value)), 3)
            end
            if stock_type(number) == "float" then
                if number ~= number or number == 1 / 0 or number == -1 / 0 or stock_floor(number) ~= number then
                    error(stock_format("bad argument #%d to '%s' (number has no integer representation)", i, fname), 3)
                end
                number = stock_floor(number)
            end
            args[i] = number
        elseif kind == "s" then
            if type(value) == "number" then
                args[i] = tostring(value)
            elseif type(value) ~= "string" then
                error(stock_format("bad argument #%d to '%s' (string expected, got %s)", i, fname, typeName(n, i, value)), 3)
            end
        end
    end
end

-- Обгортка з перевіркою: count — точна кількість аргументів (або nil, якщо
-- прошивка її не перевіряє), countText — ключ тексту помилки з lang_uk.h.
local function checked(fname, spec, fn, count, countText)
    return function(...)
        local n = select("#", ...)
        if count and n ~= count then
            error(stock_format(S[countText], n), 2)
        end
        local args = stock_pack(...)
        checkArgs(fname, spec, n, args)
        -- Не хвостовий виклик: кадр обгортки має лишитися на стеку, інакше
        -- помилка з fn на рівні 3 не знайде позиції в скрипті
        local results = stock_pack(fn(stock_unpack(args, 1, n > #spec and n or #spec)))
        return stock_unpack(results, 1, results.n)
    end
end

--[[
    Перетворення числа на рядок, як у прошивці.

    Lua прошивки зібрана з LUA_32BITS, тож LUAI_NUMFFORMAT там "%.7g", а не
    "%.14g": print(math.pi) на Лілці дає 3.141593. Решта — як у
    tostringbuff: якщо результат схожий на ціле, дописується ".0".

    Конкатенацію (..) так не перехопити — це внутрішня операція віртуальної
    машини. Тому "x" .. 0.1 у браузері може дати більше знаків, ніж на залізі.
--]]
local function numberToString(value)
    if stock_type(value) == "integer" then return stock_format("%d", value) end
    -- Спершу число стає float, як lua_Number на залізі: 1e100 там — inf
    value = stock_sunpack("f", stock_spack("f", value))
    local text = stock_format("%.7g", value)
    if text:find("^%-?%d+$") then text = text .. ".0" end
    return text
end

function tostring(value)
    if type(value) == "number" then return numberToString(value) end
    return stock_tostring(value)
end

-- %s у string.format на залізі йде через luaL_tolstring, тобто тим самим
-- "%.7g". Решта специфікаторів працює з самим числом і не змінюється.
function string.format(fmt, ...)
    if type(fmt) ~= "string" or not fmt:find("%%") then return stock_format(fmt, ...) end
    local args = stock_pack(...)
    local index = 0
    local position = 1
    while true do
        local start = fmt:find("%%", position)
        if not start then break end
        if fmt:sub(start + 1, start + 1) == "%" then
            position = start + 2
        else
            local _, finish, conversion = fmt:find("^[-+ #0]*%d*%.?%d*(%a)", start + 1)
            if not finish then break end
            index = index + 1
            if conversion == "s" and type(args[index]) == "number" then
                args[index] = numberToString(args[index])
            end
            position = finish + 1
        end
    end
    local ok, result = pcall(stock_format, fmt, stock_unpack(args, 1, args.n))
    if ok then return result end
    -- Помилку треба віддати від імені string.format і з позицією виклику в
    -- скрипті, а не з цієї обгортки
    -- Виклик як методу (("%d"):format(x)) зсуває номер аргументу на один —
    -- так робить luaL_argerror, коли namewhat == "method"
    local method = stock_getinfo(1, "n").namewhat == "method"
    result = tostring(result):gsub("^bad argument #(%d+) to '[^']*'", function(number)
        return "bad argument #" .. (method and number - 1 or number) .. " to 'format'"
    end)
    error(result, 2)
end

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

-- Типи аргументів із lualilka_display.cpp: координати й розміри —
-- luaL_checknumber, кольори — luaL_checkinteger. Кількість не перевіряється.
do
    local DISPLAY_ARGS = {
        color565 = "nnn", fill_screen = "i", draw_pixel = "nni",
        draw_line = "nnnni", draw_rect = "nnnni", fill_rect = "nnnni",
        draw_circle = "nnni", fill_circle = "nnni",
        draw_ellipse = "nnnni", fill_ellipse = "nnnni",
        draw_triangle = "nnnnnni", fill_triangle = "nnnnnni",
        draw_arc = "nnnnnni", fill_arc = "nnnnnni",
        draw_image = ".nn", draw_image_transformed = ".nn",
        set_cursor = "nn", set_text_size = "n", set_text_bound = "nnnn",
    }
    for name, spec in pairs(DISPLAY_ARGS) do
        display[name] = checked(name, spec, api.display[name])
    end

    -- Другий колір перевіряється лише тоді, коли його передано:
    -- if (lua_gettop(L) > 1) у lualilka_display_setTextColor
    local setTextColor = api.display.set_text_color
    function display.set_text_color(...)
        local n = select("#", ...)
        local args = stock_pack(...)
        checkArgs("set_text_color", n > 1 and "ii" or "i", n, args)
        return setTextColor(args[1], n > 1 and args[2] or nil)
    end

    local setFont = api.display.set_font
    function display.set_font(...)
        local args = stock_pack(...)
        checkArgs("set_font", "s", select("#", ...), args)
        if not api.display.__has_font(args[1]) then
            error(stock_format(S.DISPLAY_UNKNOWN_FONT_FMT, args[1]), 2)
        end
        return setFont(args[1])
    end
end

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

-- Кожна кнопка на залізі — таблиця {pressed, just_pressed, just_released}.
-- Об'єкт із JS приїхав би userdata, і type(state.a) не був би "table".
controller = {
    get_state = function()
        local out = {}
        for name, button in pairs(api.controller.get_state()) do
            out[name] = {
                pressed = button.pressed,
                just_pressed = button.just_pressed,
                just_released = button.just_released,
            }
        end
        return out
    end,
}
util = toTable(api.util)
buzzer = toTable(api.buzzer)
audio = toTable(api.audio)
-- lua_pushnumber: гучність (gain плеєра) на залізі завжди дробова
function audio.get_volume() return api.audio.get_volume() + 0.0 end
-- Обидві функції вимагають рівно 8 аргументів (K_S_LUA_GEOMETRY_ARGS_8_FMT)
-- і повертають лише boolean — див. коментар у bindings.ts
geometry = {
    intersect_aabb = checked("intersect_aabb", "nnnnnnnn", api.geometry.intersect_aabb, 8, "GEOMETRY_ARGS_8_FMT"),
    intersect_lines = checked("intersect_lines", "nnnnnnnn", api.geometry.intersect_lines, 8, "GEOMETRY_ARGS_8_FMT"),
}
resources = toTable(api.resources)

--[[
    crypto — lualilka_crypto.cpp.

    Рядок Lua — це байти, а не текст: шифротекст і довільні дані не є UTF-8,
    і перетворення в рядок JS їх зіпсувало б. Тому сюди й назад вони
    передаються таблицями байтів.
--]]
local function stringToBytes(text)
    local out = {}
    for i = 1, #text, 4096 do
        local chunk = { text:byte(i, i + 4095) }
        for j = 1, #chunk do out[#out + 1] = chunk[j] end
    end
    return out
end

local function bytesToString(bytes)
    local parts = {}
    local length = #bytes
    for i = 1, length, 4096 do
        local last = i + 4095 < length and i + 4095 or length
        local chunk = {}
        for j = i, last do chunk[#chunk + 1] = bytes[j] end
        parts[#parts + 1] = string.char(stock_unpack(chunk))
    end
    return table.concat(parts)
end

local function checkKey(key)
    if #key ~= 16 and #key ~= 24 and #key ~= 32 then
        -- checkKey <- тіло функції <- обгортка checked <- скрипт
        error(stock_format(S.CRYPTO_KEY_SIZE_FMT, #key), 4)
    end
end

crypto = {
    crc32 = checked("crc32", "s", function(data) return api.crypto.crc32(stringToBytes(data)) end, 1, "CRYPTO_ARGS_1_FMT"),
    md5 = checked("md5", "s", function(data) return api.crypto.md5(stringToBytes(data)) end, 1, "CRYPTO_ARGS_1_FMT"),
    encrypt = checked("encrypt", "ss", function(data, key)
        checkKey(key)
        return api.crypto.encrypt(stringToBytes(data), stringToBytes(key))
    end, 2, "CRYPTO_ARGS_2_FMT"),
    decrypt = checked("decrypt", "ss", function(hex, key)
        checkKey(key)
        local result = api.crypto.decrypt(hex, stringToBytes(key))
        if type(result) == "string" then error(S[result], 3) end
        return bytesToString(result)
    end, 2, "CRYPTO_ARGS_2_FMT"),
}

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
local hidden = {}

function hidden.load_state()
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

-- Кількість аргументів кожної функції прошивка перевіряє ДО типів:
-- "if (n != 1) return luaL_error(L, K_S_LUA_MATH_ARGS_1_FMT, n)"
local MATH_ARITY = {
    clamp = 3, lerp = 3, map = 5, abs = 1, sign = 1, sqrt = 1, pow = 2,
    floor = 1, ceil = 1, round = 1, sin = 1, cos = 1, tan = 1, asin = 1,
    acos = 1, atan = 1, atan2 = 2, deg = 1, rad = 1, len = 2, dist = 4,
}

local function mathChecked(name, fn)
    local count = MATH_ARITY[name]
    return checked(name, string.rep("n", count), fn, count, "MATH_ARGS_" .. count .. "_FMT")
end

for _, name in ipairs(FLOAT_RESULT) do
    if name ~= "log" then
        local fn = api.math[name]
        __m[name] = mathChecked(name, function(...) return fn(...) + 0.0 end)
    end
end
for _, name in ipairs(INTEGER_RESULT) do
    __m[name] = mathChecked(name, api.math[name])
end

-- log — єдина з одним АБО двома аргументами
function __m.log(...)
    local n = select("#", ...)
    if n ~= 1 and n ~= 2 then error(stock_format(S.MATH_ARGS_1_OR_2_FMT, n), 2) end
    local args = stock_pack(...)
    checkArgs("log", string.rep("n", n), n, args)
    if n == 1 then return api.math.log(args[1]) + 0.0 end
    return api.math.log(args[1], args[2]) + 0.0
end

--[[
    min / max / sum / avg беруть ОДНУ таблицю і читають лише її масивну
    частину: assert_table_arg перевіряє lua_rawlen, а далі йде lua_rawgeti від
    1 до довжини. Отже ключі-рядки туди не потрапляють — math.max{a=1, b=2} на
    залізі не рахує двійку, а падає, бо rawlen такої таблиці нуль.

    Послідовність збирається тут, у Lua: з боку JS видно вже готовий масив, і
    жодного здогадування про те, що вважати елементом.
--]]
-- assert_table_arg із lualilka_math.cpp: рівно один аргумент, таблиця,
-- непорожня. Елемент читається luaL_checknumber(L, -1), тож у тексті помилки
-- номер аргументу — від'ємний: "bad argument #-1 to 'max' (...)".
local function numberSequence(name, n, value)
    if n ~= 1 then error(stock_format(S.MATH_ARGS_1_FMT, n), 3) end
    if type(value) ~= "table" then error(S.MATH_ARG_MUST_BE_TABLE, 3) end
    local length = rawlen(value)
    if length == 0 then error(S.MATH_TABLE_CANT_BE_EMPTY, 3) end
    local out = {}
    for i = 1, length do
        local item = rawget(value, i)
        local number = type(item) == "number" and item or (type(item) == "string" and tonumber(item))
        if not number then
            error(stock_format("bad argument #-1 to '%s' (number expected, got %s)", name, type(item)), 3)
        end
        out[i] = number
    end
    return out
end

for _, name in ipairs({ "min", "max", "sum", "avg" }) do
    local fn = api.math[name]
    __m[name] = function(...)
        return fn(numberSequence(name, select("#", ...), ...)) + 0.0
    end
end

-- random без аргументів дає дробове 0..1, з аргументами — ціле,
-- причому верхня межа НЕ включається (семантика Arduino random(), не Lua)
-- Межі random — luaL_checkinteger: math.random(1.5, 3.5) на залізі падає
function __m.random(...)
    local n = select("#", ...)
    if n > 2 then error(stock_format(S.MATH_ARGS_0_1_2_FMT, n), 2) end
    if n == 0 then return api.math.random() + 0.0 end
    local args = stock_pack(...)
    checkArgs("random", string.rep("i", n), n, args)
    return api.math.random(args[1], args[2])
end
do
    -- M_PI, M_E і M_PI * 2 — уже обрізані до float, як після lua_pushnumber
    local constants = api.math.__constants()
    __m.pi = constants[1] + 0.0
    __m.e = constants[2] + 0.0
    __m.tau = constants[3] + 0.0
end
__m.norm = checked("norm", "nn", function(x, y)
    local r = api.math.__norm(x, y)
    return r[1] + 0.0, r[2] + 0.0
end, 2, "MATH_ARGS_2_FMT")
__m.rotate = checked("rotate", "nnn", function(x, y, angle)
    local r = api.math.__rotate(x, y, angle)
    return r[1] + 0.0, r[2] + 0.0
end, 3, "MATH_ARGS_3_FMT")
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
notes = toTable(api.__notes)

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
-- get_matrix кладе елементи через lua_pushinteger: дріб відкидається
-- (приведення float -> int у C — у бік нуля). Після rotate(30) на залізі
-- get() повертає {{0, 0}, {0, 0}}.
local function truncate(value)
    if value >= 0 then return stock_floor(value) end
    return -stock_floor(-value)
end
function Transform:get()
    local m = self.__m
    return { { truncate(m[1]), truncate(m[2]) }, { truncate(m[3]), truncate(m[4]) } }
end
-- set_matrix: таблиця 2x2, кожен елемент — число (lua_isnumber).
-- Пласка таблиця {1, 2, 3, 4} на залізі не дає помилки, а валить прошивку
-- (lua_rawgeti на числі) — тут замість цього чесна помилка.
function Transform:set(m)
    if type(m) ~= "table" then error("Expected a table as the second argument", 2) end
    local values = {}
    for i = 1, 2 do
        local row = rawget(m, i)
        if type(row) ~= "table" then
            error(stock_format("рядок %d матриці має бути таблицею — на залізі це аварійне перезавантаження", i), 2)
        end
        for j = 1, 2 do
            local value = tonumber(rawget(row, j))
            if value == nil then error(stock_format("Element at (%d, %d) is not a number", i - 1, j - 1), 2) end
            values[#values + 1] = value
        end
    end
    self.__m = values
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
function hidden.main()
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
function hidden.save_state()
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
    -- Службові функції рантайму видно лише як __lilka.*: pairs(_G) їх не
    -- показує, бо на залізі таких глобальних змінних немає
    meta.__index = function(_, key)
        if key == "__lilka" then return hidden end
        return nil
    end
    meta.__newindex = function(t, key, value)
        if key == "state" and type(value) == "table" then
            setmetatable(value, state_mt)
        end
        rawset(t, key, value)
    end
    setmetatable(_G, meta)
end

-- Ін'єкції wasmoon і міст до JS — на залізі цих глобальних змінних немає
__api = nil
Promise = nil
null = nil
`;
