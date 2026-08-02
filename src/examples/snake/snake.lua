local snake = { { x = 8, y = 5 } } -- Початкова позиція змійки
local food = { x = 10, y = 10 } -- Початкова позиція їжі
local cell_size = 10 -- Розмір клітинки
local game_over = false -- Змінна для відстеження стану гри
local paused = false -- Змінна для відстеження стану паузи
local menu_index = 1 -- Індекс обраного пункту меню
local score = 0 -- Початковий рахунок
local high_score = 0 -- Початковий рекорд
local new_record_text = "НОВИЙ РЕКОРД!"

-- Ініціалізуємо об'єкт state для збереження даних між запусками
state = state or {}
-- Замість вкладених таблиць використовуємо прості ключі для кожного рекорду
-- Формат: state.score1, state.score2, state.score3, state.score4, state.score5
state.score_count = state.score_count or 0 -- Кількість збережених рекордів

-- Додаємо стан перегляду рекордів
local viewing_leaderboard = false
local leaderboard = {} -- Таблиця для локального використання рекордів
local max_leaderboard_entries = 5 -- Максимальна кількість записів у таблиці рекордів

-- Функція для завантаження рекордів зі state
local function load_leaderboard()
    -- Очищаємо поточну таблицю рекордів
    leaderboard = {}
    
    -- Завантажуємо рекорди з state за окремими ключами
    for i = 1, state.score_count or 0 do
        local score_key = "score" .. i
        if state[score_key] then
            table.insert(leaderboard, state[score_key])
        end
    end
    
    -- Сортуємо таблицю рекордів за спаданням
    table.sort(leaderboard, function(a, b) return a > b end)
    
    -- Обмежуємо кількість записів
    while #leaderboard > max_leaderboard_entries do
        table.remove(leaderboard)
    end
    
    -- Оновлюємо високий рекорд, якщо він є
    if #leaderboard > 0 then
        high_score = leaderboard[1]
    end
end

-- Функція для додавання нового рекорду
local function add_to_leaderboard(score_value)
    -- Додаємо рекорд до локальної таблиці
    table.insert(leaderboard, score_value)
    
    -- Сортуємо таблицю рекордів за спаданням
    table.sort(leaderboard, function(a, b) return a > b end)
    
    -- Обмежуємо кількість записів
    while #leaderboard > max_leaderboard_entries do
        table.remove(leaderboard)
    end
end

-- Безпечне збереження стану
-- Перевіряємо перед збереженням, чи всі дані у припустимому форматі
local function safe_save_state()
    -- Переконуємось, що score_count - це число
    if type(state.score_count) ~= "number" then
        state.score_count = 0
    end
    
    -- Перевіряємо всі поля рекордів
    for i = 1, max_leaderboard_entries do
        local key = "score" .. i
        if state[key] ~= nil and type(state[key]) ~= "number" then
            state[key] = nil -- Видаляємо невалідні значення
        end
    end
    
    -- Завершуємо програму, що автоматично збереже стан
    util.exit()
end

function lilka.init()
    -- Ініціалізація змійки та їжі
    snake = { { x = 5, y = 5 } }
    food = { x = 10, y = 10 }
    direction = "right" -- Початковий напрямок руху
    move_timer = 0 -- Скидаємо таймер руху
    move_interval = 0.2 -- Початковий інтервал руху
    game_over = false -- Скидаємо стан гри
    paused = false -- Скидаємо стан паузи
    viewing_leaderboard = false -- Скидаємо стан перегляду рекордів
    score = 0 -- Скидаємо рахунок
    
    -- Завантажуємо таблицю рекордів з state
    load_leaderboard()
end

local direction = "right" -- Початковий напрямок руху
local move_timer = 0 -- Таймер для руху змійки
local move_interval = 0.2 -- Інтервал руху (в секундах)

local function custom_max(a, b)
    if a > b then
        return a
    else
        return b
    end
end

-- Генеруємо нову їжу
local function generate_food()
    local valid_position = false
    while not valid_position do
        -- Генеруємо випадкову позицію
        food.x = math.random(0, display.width // cell_size - 1)
        food.y = math.random(0, display.height // cell_size - 1)

        -- Перевіряємо, чи їжа не знаходиться всередині тіла змійки
        valid_position = true
        for _, segment in ipairs(snake) do
            if segment.x == food.x and segment.y == food.y then
                valid_position = false
                break
            end
        end
    end
end

function lilka.update(delta)
    local state_controller = controller.get_state()

    if game_over then
        -- Обробка кнопки "Нова гра" (A)
        if state_controller.a.just_pressed then
            lilka.init() -- Почати нову гру
            game_over = false -- Скидаємо стан програшу
            return
        end
        
        -- Обробка кнопки "Вийти" (B)
        if state_controller.b.just_pressed then
            -- Зберігаємо стан перед виходом
            safe_save_state()
            util.exit()
        end
        
        return -- Повертаємося, щоб не виконувати іншу логіку
    end
    
    -- Якщо відображається таблиця рекордів
    if viewing_leaderboard then
        if state_controller.b.just_pressed or state_controller.a.just_pressed then
            viewing_leaderboard = false -- Повертаємося до меню паузи
        end
        return
    end

    if state_controller.d.just_pressed then
        paused = not paused -- Перемикаємо стан паузи
    end

    if paused then
        -- Обробка меню паузи
        if state_controller.up.just_pressed then
            menu_index = menu_index - 1
            if menu_index < 1 then
                menu_index = 4 -- Повертаємося до останнього пункту (тепер 4 пункти)
            end
        elseif state_controller.down.just_pressed then
            menu_index = menu_index + 1
            if menu_index > 4 then
                menu_index = 1 -- Повертаємося до першого пункту
            end
        elseif state_controller.a.just_pressed then
            if menu_index == 1 then
                paused = false -- Продовжити гру
            elseif menu_index == 2 then
                lilka.init() -- Нова гра
                paused = false
            elseif menu_index == 3 then
                viewing_leaderboard = true -- Перегляд таблиці рекордів
            elseif menu_index == 4 then
                -- Зберігаємо дані в правильному форматі перед виходом
                state.score_count = #leaderboard
                for j = 1, #leaderboard do
                    state["score" .. j] = leaderboard[j]
                end
                safe_save_state() -- Використовуємо безпечну функцію збереження
                util.exit() -- Вихід із гри
            end
        end
        return -- Якщо гра на паузі, не оновлюємо гру
    end

    -- Обробляємо введення користувача:
    if state_controller.up.just_pressed and direction ~= "down" then
        direction = "up"
    elseif state_controller.down.just_pressed and direction ~= "up" then
        direction = "down"
    elseif state_controller.left.just_pressed and direction ~= "right" then
        direction = "left"
    elseif state_controller.right.just_pressed and direction ~= "left" then
        direction = "right"
    end

    -- Оновлюємо таймер
    move_timer = move_timer + delta
    if move_timer >= move_interval then
        move_timer = 0 -- Скидаємо таймер

        -- Рухаємо змійку
        local head = snake[1]
        local new_head = { x = head.x, y = head.y }

        if direction == "up" then
            new_head.y = new_head.y - 1
        elseif direction == "down" then
            new_head.y = new_head.y + 1
        elseif direction == "left" then
            new_head.x = new_head.x - 1
        elseif direction == "right" then
            new_head.x = new_head.x + 1
        end

        -- Перевірка виходу за межі екрану
        if new_head.x < 0 then
            new_head.x = display.width // cell_size - 1 -- Перехід на правий край
        elseif new_head.x >= display.width // cell_size then
            new_head.x = 0 -- Перехід на лівий край
        end

        if new_head.y < 0 then
            new_head.y = display.height // cell_size - 1 -- Перехід на нижній край
        elseif new_head.y >= display.height // cell_size then
            new_head.y = 0 -- Перехід на верхній край
        end

        -- Перевірка, чи змійка з'їла себе
        for i = 1, #snake do
            if snake[i].x == new_head.x and snake[i].y == new_head.y then
                game_over = true -- Завершуємо гру
                -- Додаємо результат до таблиці рекордів, якщо це кінець гри
                if score > 0 then
                    add_to_leaderboard(score)
                    -- Оновлюємо state вручну тут
                    state.score_count = #leaderboard
                    for j = 1, #leaderboard do
                        state["score" .. j] = leaderboard[j]
                    end
                end
                return
            end
        end

        -- Додаємо нову голову до змійки
        table.insert(snake, 1, new_head)

        -- Перевірка, чи з'їла змійка їжу
        if new_head.x == food.x and new_head.y == food.y then
            score = score + 1 -- Збільшуємо рахунок
            generate_food() -- Викликаємо функцію для генерації їжі
        else
            -- Видаляємо хвіст, якщо їжа не з'їдена
            table.remove(snake)
        end

        move_interval = custom_max(0.05, 0.2 - #snake * 0.005) -- Швидкість залежить від довжини змійки
    end
end

-- Зареєструємо формат стану Kiera OS
lilka.get_state_format = function()
    -- Створюємо і повертаємо формат state
    local format = {}
    
    -- Додаємо поле для кількості рекордів
    format.score_count = true
    
    -- Додаємо поля для кожного рекорду
    for i = 1, max_leaderboard_entries do
        format["score" .. i] = true
    end
    
    return format
end

function lilka.draw()
    -- Малюємо чорний фон
    display.fill_screen(display.color565(0, 0, 0))
    
    -- Відображення таблиці рекордів
    if viewing_leaderboard then
        -- Створюємо екран таблиці рекордів
        local title = "ТАБЛИЦЯ РЕКОРДІВ"
        local back_text = "НАТИСНІТЬ A/B ДЛЯ ПОВЕРНЕННЯ"
        
        -- Встановлюємо ширину рамки з полями
        local box_width = display.width - 40 -- Поля по 20 пікселів з кожного боку
        local box_height = 200 -- Висота прямокутника
        local box_x = (display.width - box_width) // 2
        local box_y = (display.height - box_height) // 2
        
        -- Малюємо фон для таблиці
        display.fill_rect(box_x, box_y, box_width, box_height, display.color565(25, 25, 112)) -- Темно-синій фон
        
        -- Малюємо рамку для таблиці
        display.draw_rect(box_x, box_y, box_width, box_height, display.color565(255, 215, 0)) -- Золотиста рамка
        
        -- Малюємо заголовок "ТАБЛИЦЯ РЕКОРДІВ"
        local title_x = display.width // 2 - (#title * 5) // 2 -- Центруємо текст
        display.set_cursor(title_x, box_y + 25) -- Посуваємо текст трохи нижче
        display.set_text_color(display.color565(255, 255, 255)) -- Білий текст
        display.print(title)
        
        -- Малюємо лінію під заголовком
        display.draw_line(box_x + 10, box_y + 35, box_x + box_width - 10, box_y + 35, display.color565(255, 215, 0))
        
        -- Малюємо рекорди
        local entries_y = box_y + 60 -- Опускаємо початок списку трохи нижче
        if #leaderboard == 0 then
            local no_records = "НЕМАЄ ЗАПИСІВ"
            display.set_cursor(display.width // 2 - (#no_records * 5) // 2, entries_y + 30)
            display.print(no_records)
        else
            for i, score_value in ipairs(leaderboard) do
                -- Форматуємо число, щоб прибрати ".0", якщо воно ціле
                local formatted_score = string.format("%.0f", score_value)
                local rank_text = i .. ". " .. formatted_score
                display.set_cursor(box_x + 30, entries_y + (i - 1) * 25)
                display.print(rank_text)
            end
        end
        
        -- Малюємо текст внизу (розділений на два рядки)
        local back_text_line1 = "НАТИСНІТЬ A/B"
        local back_text_line2 = "ДЛЯ ПОВЕРНЕННЯ"

        -- Перший рядок
        local back_x1 = display.width // 2 - (#back_text_line1 * 5) // 2 -- Центруємо текст
        display.set_cursor(back_x1, box_y + box_height - 40) -- Опускаємо трохи нижче
        display.print(back_text_line1)

        -- Другий рядок
        local back_x2 = display.width // 2 - (#back_text_line2 * 5) // 2 -- Центруємо текст
        display.set_cursor(back_x2, box_y + box_height - 20) -- Опускаємо трохи нижче
        display.print(back_text_line2)
        
        return
    end

    if paused then
        -- Оновлене меню паузи
        local menu_items = { "ПРОДОВЖИТИ", "НОВА ГРА", "РЕКОРДИ", "ВИХІД" }
        local menu_x = display.width // 2 -- Центруємо текст
        local menu_y = (display.height - (#menu_items * 40)) // 2 -- Відцентровуємо меню по вертикалі
        local box_width = 200 -- Ширина прямокутника
        local box_height = #menu_items * 40 + 20 -- Висота залежить від кількості пунктів меню
        
        -- Малюємо фон для меню
        local box_x = (display.width - box_width) // 2
        local box_y = menu_y - 20 -- Додаємо відступ зверху
        display.fill_rect(box_x, box_y, box_width, box_height, display.color565(25, 25, 112)) -- Темно-синій фон
        
        -- Малюємо рамку для меню
        display.draw_rect(box_x, box_y, box_width, box_height, display.color565(255, 215, 0)) -- Золотиста рамка
        
        -- Малюємо пункти меню
        for i, item in ipairs(menu_items) do
            -- Визначаємо вертикальну позицію тексту відносно рамки
            local item_y = menu_y + (i - 1) * 45 -- Зменшено відстань між пунктами меню
            if i == menu_index then
                -- Малюємо залитий прямокутник за текстом
                local highlight_x = box_x + 20 -- Відступ зліва для обводки
                local highlight_width = box_width - 40 -- Ширина обводки
                display.fill_rect(highlight_x, item_y - 12, highlight_width, 30, display.color565(70, 130, 180)) -- Світло-синій фон
            end
            -- Центруємо текст пункту меню
            local item_x = display.width // 2 - (#item * 5) // 2 -- Центруємо текст
            display.set_cursor(item_x, item_y)
            display.set_text_color(display.color565(255, 255, 255)) -- Білий текст
            display.print(item)
        end
        return
    end

    if game_over then
        -- Виводимо повідомлення про завершення гри
        local text = "ТИ ПРОГРАВ!"
        local score_text = "ТВІЙ РАХУНОК: " .. tostring(score)
        local is_high_score = false
        
        -- Перевіряємо, чи це новий рекорд
        if score > high_score then
            high_score = score -- Оновлюємо рекорд
            is_high_score = true
        end
        
        local repeat_text = "НОВА ГРА (A), ВИЙТИ (B)"
        
        -- Встановлюємо ширину рамки з полями
        local box_width = display.width - 40 -- Поля по 20 пікселів з кожного боку
        local box_height = is_high_score and 180 or 150 -- Висота прямокутника - ВИПРАВЛЕНО 'і' НА 'and'
        local box_x = (display.width - box_width) // 2
        local box_y = (display.height - box_height) // 2
        
        -- Малюємо фон для повідомлення
        display.fill_rect(box_x, box_y, box_width, box_height, display.color565(25, 25, 112)) -- Темно-синій фон
        
        -- Малюємо рамку для повідомлення
        display.draw_rect(box_x, box_y, box_width, box_height, display.color565(255, 215, 0)) -- Золотиста рамка
        
        -- Малюємо текст "ТИ ПРОГРАВ!"
        local text_x = display.width // 2 - (#text * 5) // 2 -- Центруємо текст
        local text_y = box_y + 30 -- Опускаємо текст нижче
        display.set_cursor(text_x, text_y)
        display.set_text_color(display.color565(255, 255, 255)) -- Білий текст
        display.print(text)
        
        -- Малюємо текст "ТВІЙ РАХУНОК"
        local score_x = display.width // 2 - (#score_text * 5) // 2 -- Центруємо текст
        local score_y = text_y + 30
        display.set_cursor(score_x, score_y)
        display.print(score_text)
        
        -- Якщо це новий рекорд, виводимо повідомлення про це
        if is_high_score then
            local record_x = display.width // 2 - (#new_record_text * 5) // 2 -- Центруємо текст
            local record_y = score_y + 30
            display.set_cursor(record_x, record_y)
            display.set_text_color(display.color565(255, 255, 0)) -- Жовтий текст для рекорду
            display.print(new_record_text)
        end
        
        -- Малюємо текст "НОВА ГРА (A), ВИЙТИ (B)"
        local repeat_x = box_x + 6 -- Зсуваємо текст ще лівіше
        local repeat_y = box_y + box_height - 20 -- Опускаємо текст нижче
        display.set_text_color(display.color565(255, 255, 255)) -- Повертаємо білий текст
        display.set_cursor(repeat_x, repeat_y)
        display.print(repeat_text)
        
        return
    end
    
    -- Відображення поточного рахунку під час гри
    -- Закоментовано, щоб приховати рахунок
    -- local current_score_text = "РАХУНОК: " .. tostring(score)
    -- display.set_cursor(10, 10)
    -- display.set_text_color(display.color565(255, 255, 255))
    -- display.print(current_score_text)
    
    -- Відображення рекорду під час гри
    -- Закоментовано, щоб приховати рекорд
    -- local high_score_text = "РЕКОРД: " .. tostring(high_score)
    -- display.set_cursor(display.width - (#high_score_text * 10), 10)
    -- display.print(high_score_text)

    -- Малюємо змійку
    for _, segment in ipairs(snake) do
        -- Додаємо проміжки між сегментами
        local segment_size = cell_size - 2 -- Зменшуємо розмір сегмента для створення проміжків
        local segment_x = segment.x * cell_size + 1 -- Додаємо відступ зліва
        local segment_y = segment.y * cell_size + 1 -- Додаємо відступ зверху
        display.fill_rect(segment_x, segment_y, segment_size, segment_size, display.color565(0, 255, 0)) -- Малюємо сегмент
    end

    -- Малюємо їжу у вигляді яблука
    local function draw_apple(x, y, size)
        -- Листочок (зелений) - по діагоналі та більший
        local leaf_width = size // 2
        local leaf_height = size // 3
        display.fill_rect(x + size // 2, y - leaf_height, leaf_width, leaf_height, display.color565(0, 128, 0)) -- Листочок по діагоналі

        -- Яблуко (червоне) - створюємо круглу форму
        local radius = size // 2
        for i = -radius, radius do
            for j = -radius, radius do
                if i * i + j * j <= radius * radius then -- Перевірка, чи точка належить колу
                    display.fill_rect(x + radius + i, y + radius + j, 1, 1, display.color565(255, 0, 0)) -- Малюємо піксель яблука
                end
            end
        end
    end

    -- Використовуємо функцію для малювання їжі
    draw_apple(food.x * cell_size, food.y * cell_size, cell_size)
end