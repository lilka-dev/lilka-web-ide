-- Кольорове коло, яке реагує на кнопки.
-- Стрілки — рух, A/B — обертання, START — вихід.

local x, y = 140, 120
local hue = 0

lilka.show_fps = true

function lilka.init()
    display.set_font("6x13")
    print("Привіт з Лілки!")
end

function lilka.update(delta)
    local state = controller.get_state()
    local speed = 120 * delta

    if state.left.pressed then x = x - speed end
    if state.right.pressed then x = x + speed end
    if state.up.pressed then y = y - speed end
    if state.down.pressed then y = y + speed end

    x = math.clamp(x, 0, display.width)
    y = math.clamp(y, 0, display.height)
    hue = hue + delta * 90

    if state.a.just_pressed then
        buzzer.play(notes.C5, 120)
    end

    if state.start.just_pressed then
        util.exit()
    end
end

function lilka.draw()
    display.fill_screen(colors.black)

    for i = 1, 8 do
        local angle = hue + i * 45
        local dx, dy = math.rotate(0, -50, angle)
        display.fill_circle(math.round(x + dx), math.round(y + dy), 6, colors.cyan)
    end

    display.fill_circle(math.round(x), math.round(y), 10, colors.yellow)

    display.set_cursor(6, 16)
    display.set_text_color(colors.white)
    display.print("START — вихід")
end
