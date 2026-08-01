--[[

       mm                                                      mm mm                          mm
      ####                                                                                    ##
      ####     m#####m  ######   m####m   ##m###m    m####m    ####      ####### ##   m##     ##
     ##  ##   ##          ##    ##mmmm##  ##    ##  ##    ##     ##      ##   ## ##  ####     ##
     ######   ##          ##    ##        ##    ##  ##    ##     ##      ##   ## ##m#  ##
    m##  ##m   ##mmmm#    ##     ##mmmm#  ###mm##    ##mm##   mmm##mmm  m##mmm## ###   ##     mm
                                          ##                            ##     #
                                          ##
    Автор: Андрій "and3rson" Дунай
    Ідея: Asteroids (1979) від Atari
    Шрифти, використані в графіці: https://ukrfonts.com/info/index.php?v=20&id=5730

--]]

WHITE = display.color565(255, 255, 255)
BLACK = display.color565(0, 0, 0)
MAGENTA = display.color565(255, 0, 255)

--lilka.show_fps = true

-------------------------------------------------------------------------------
-- Загальні константи
-------------------------------------------------------------------------------

ANGLE_COUNT = 60
ANGLE_STEP = 360 / ANGLE_COUNT

display.fill_screen(BLACK)
display.set_cursor(8, display.height / 2 - 8)
display.print("Завантаження...")
display.queue_draw()

data = require("modules.data")
Ship = require("modules.ship")
Bullet = require("modules.bullet")
Asteroid = require("modules.asteroid")

-------------------------------------------------------------------------------
-- Змінні, які зберігають стан гри та всіх ігрових об'єктів.
-------------------------------------------------------------------------------

--- @type table
local ship = nil -- Ship:new()
local bullets = {}
local asteroids = {}

-- Час, коли наступний астероїд з'явиться на екрані
local next_asteroid_spawn_time = 0

-- Перелік станів гри
STATES = {
    HELLO = 0,     -- Початковий екран
    IN_GAME = 1,   -- Гра
    GAME_OVER = 2, -- Кінець гри
}
local game_state = STATES.HELLO

-- Варіанти звуку
SOUND_MODES = {
    None = 0,      -- Немає
    Buzzer = 1,    -- Використовуємо buzzer для відтворення мелодій
    Audio = 2,     -- Використовуємо аудіо для відтворення звуків
}
local sound_mode = SOUND_MODES.Buzzer
local sound_mode_name = 'Buzzer'
-------------------------------------------------------------------------------
-- Головні цикли гри
-------------------------------------------------------------------------------

--
-- Цикл обробки введення та оновлення стану гри
--
function lilka.update(delta)
    -- Отримуємо стан контролера та обробляємо введення
    local keyboard = controller.get_state()

    if game_state == STATES.HELLO then
        -- Якщо гравець натиснув кнопку "Старт", то починаємо гру
        if keyboard.start.just_pressed then
            game_state = STATES.IN_GAME
            ship = Ship:new()
            bullets = {}
            asteroids = {}
        end
        if keyboard.select.just_pressed then
            sound_mode = (sound_mode + 1) % 3
            for name, value in pairs(SOUND_MODES) do
                if sound_mode == value then
                    sound_mode_name = name
                    break
                end
            end
        end
    else
        -- Оновлюємо стан корабля, куль та астероїдів
        ship:update(delta)
        for _, bullet in ipairs(bullets) do
            bullet:update(delta)
        end
        for _, asteroid in ipairs(asteroids) do
            asteroid:update(delta)
        end
        -- Видаляємо мертві кулі
        for i = #bullets, 1, -1 do
            if bullets[i].dead then
                table.remove(bullets, i)
            end
        end
        -- Видаляємо мертві астероїди
        for i = #asteroids, 1, -1 do
            if asteroids[i].dead and util.time() - asteroids[i].killed_at > 1 then
                table.remove(asteroids, i)
            end
        end

        -- Керуємо кораблем, якщо він не мертвий
        if not ship.dead then
            -- Рух вперед та назад
            if keyboard.up.pressed then
                ship:set_forward_acceleration(100)
            elseif keyboard.down.pressed then
                ship:set_forward_acceleration(-100)
            else
                ship:set_forward_acceleration(0)
            end

            -- Поворот корабля
            if keyboard.left.pressed then
                ship:set_angular_speed(-180)
            elseif keyboard.right.pressed then
                ship:set_angular_speed(180)
            else
                ship:set_angular_speed(0)
            end

            -- Стрільба
            if keyboard.a.just_pressed then
                local dir_x, dir_y = math.rotate(1, 0, ship.rotation)
                local bullet = Bullet:new(ship.x + dir_x * ship.width / 2, ship.y + dir_y * ship.height / 2)
                bullet.speed_x = ship.speed_x / 2 + display.width * dir_x
                bullet.speed_y = ship.speed_y / 2 + display.width * dir_y
                table.insert(bullets, bullet)
                playsound(data.SHOOT_MELODY, data.SHOOT_SOUND)
            end

            -- Вихід з гри
            if keyboard.start.just_pressed then
                util.exit()
            end
        end

        -- Перевіряємо, чи потрібно додати новий астероїд
        -- Якщо минув визначений час і якщо на екрані менше 8 астероїдів, то додаємо новий
        if next_asteroid_spawn_time < util.time() and #asteroids < 8 then
            local x, y
            -- Вибираємо випадкову точку за межами екрану
            if math.random() < 0.5 then
                -- Лівий або правий край екрану
                x = math.random() > 0.5 and -100 or display.width + 100
                y = math.random(0, display.height)
            else
                -- Верхній або нижній край екрану
                x = math.random(0, display.width)
                y = math.random() > 0.5 and -100 or display.height + 100
            end
            -- Вибираємо випадкову точку в межах екрану, куди буде рухатися астероїд
            local target_x = math.random(0, display.width)
            local target_y = math.random(0, display.height)

            -- Обчислюємо вектор швидкості астероїда
            local dir_x = target_x - x
            local dir_y = target_y - y
            dir_x, dir_y = math.norm(dir_x, dir_y)

            -- Додаємо астероїд
            table.insert(asteroids, Asteroid:new(x, y, dir_x * 50, dir_y * 50))
            next_asteroid_spawn_time = util.time() + math.random(1, 3)
        end

        -- Перевіряємо колізії: чи корабель зіштовхнувся з астероїдом або чи куля влучила в астероїд
        for _, asteroid in ipairs(asteroids) do
            -- Пропускаємо мертві астероїди
            if not asteroid.dead then
                -- Перевіряємо кулі
                for _, bullet in ipairs(bullets) do
                    if math.dist(asteroid.x, asteroid.y, bullet.x, bullet.y) < asteroid.sprite.width / 2 then
                        -- Якщо куля влучила в астероїд, то вони обидвоє вмирають
                        asteroid:kill()
                        bullet:kill()
                        playsound(data.BOOM_MELODY, data.BOOM_SOUND)
                    end
                end
                if math.dist(asteroid.x, asteroid.y, ship.x, ship.y) < (asteroid.sprite.width / 3 + ship.width / 2) then
                    -- Коли корабель зіштовхується з астероїдом. Якщо корабель не мертвий, то вони обидвоє вмирають
                    -- Якщо гравець не мертвий, то він вмирає і гра переходить в стан GAME_OVER
                    if not ship.dead then
                        asteroid:kill()
                        ship:kill()
                        game_state = STATES.GAME_OVER
                        playsound(data.DEATH_MELODY, data.DEATH_SOUND)
                    end
                end
            end
        end
        if game_state == STATES.GAME_OVER then
            -- Якщо гравець мертвий, то він може натиснути кнопку "Старт", щоб почати гру знову
            if keyboard.start.just_pressed then
                game_state = STATES.HELLO
            end
        end
    end
end

--
-- Цикл малювання гри
--
function lilka.draw()
    display.fill_screen(BLACK)
    if game_state == STATES.HELLO then
        -- Виводимо початковий екран
        local banner = data.BANNER[math.random(1, #data.BANNER)]
        display.draw_image(
            banner,
            display.width / 2 - banner.width / 2,
            display.height / 2 - banner.height / 2
        )
        display.draw_image(
            data.PRESS_START,
            display.width / 2 - data.PRESS_START.width / 2,
            display.height - data.PRESS_START.height - 32
        )

        display.set_font("9x15")
        display.set_text_color(WHITE);
        display.set_cursor(32, 16)
        display.print(string.format("Звук: %s", sound_mode_name))
    else
        -- Малюємо корабель, кулі та астероїди
        ship:draw()
        for _, bullet in ipairs(bullets) do
            bullet:draw()
        end
        for _, asteroid in ipairs(asteroids) do
            asteroid:draw()
        end
        if game_state == STATES.GAME_OVER then
            -- Якщо гравець мертвий, то виводимо повідомлення про кінець гри
            display.draw_image(
                data.YOU_ARE_DEAD,
                display.width / 2 - data.YOU_ARE_DEAD.width / 2,
                display.height / 2 - data.YOU_ARE_DEAD.height / 2
            )
            display.draw_image(
                data.PRESS_START,
                display.width / 2 - data.PRESS_START.width / 2,
                display.height - data.PRESS_START.height - 32
            )
        end
    end

    -- Виводимо інформацію про вільну та загальну пам'ять
    -- display.set_font("9x15")
    -- display.set_text_color(WHITE);
    -- display.set_cursor(128, 24)
	-- display.print(string.format("%dkB/%dkB", math.floor(util.free_ram() / 1024), math.floor(util.total_ram() / 1024)))
end

function playsound(melody, sound)
    if sound_mode == SOUND_MODES.Buzzer then
        buzzer.play_melody(melody, 600)
    elseif sound_mode == SOUND_MODES.Audio then
        audio.play(sound)
    end
end