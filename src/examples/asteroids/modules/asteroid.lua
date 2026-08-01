--
-- Астероїд, який рухається по екрану
--

local data = require("modules.data")

Asteroid = {
    x = 0,
    y = 0,
    speed_x = 0,
    speed_y = 0,
    size = 0,
    --- @type table|nil
    sprite = nil,
    offscreen = false,
    killed_at = -1,
    dead = false,
}

function Asteroid:new(x, y, speed_x, speed_y)
    local size = math.random(1, 4)
    local sprite
    if size == 1 then
        sprite = data.ASTEROID_16_SPRITES[math.random(1, 8)]
    elseif size == 2 then
        sprite = data.ASTEROID_32_SPRITES[math.random(1, 8)]
    elseif size == 3 then
        sprite = data.ASTEROID_48_SPRITES[math.random(1, 8)]
    else
        sprite = data.ASTEROID_64_SPRITES[math.random(1, 8)]
    end
    local o = {
        x = x,
        y = y,
        speed_x = speed_x,
        speed_y = speed_y,
        size = size,
        sprite = sprite,
        offscreen = x < sprite.width / 2 or x > display.width - sprite.width / 2 or y < sprite.width / 2 or
            y > display.height - sprite.height / 2,
    }
    setmetatable(o, self)
    self.__index = self
    return o
end

function Asteroid:update(delta)
    self.x = self.x + self.speed_x * delta
    self.y = self.y + self.speed_y * delta
    if self.offscreen then
        self.offscreen = self.x < self.sprite.width / 2 or self.x > display.width - self.sprite.width / 2 or
            self.y < self.sprite.width / 2 or self.y > display.height - self.sprite.height / 2
    else
        self.x = self.x % display.width
        self.y = self.y % display.height
    end
end

function Asteroid:kill()
    self.killed_at = util.time()
    self.dead = true
end

function Asteroid:draw()
    if self.dead then
        local time_since_death = util.time() - self.killed_at
        -- Малюємо коло, яке збільшується та зменшується впродовж 1 секунди
        if time_since_death < 1 then
            local radius = math.sin(time_since_death * 2 * math.pi) * self.sprite.width / 2
            display.fill_circle(self.x, self.y, radius, WHITE)
        end
    else
        local cx = self.x - self.sprite.width / 2
        local cy = self.y - self.sprite.height / 2
        display.draw_image(self.sprite, cx, cy)
        if not self.offscreen then
            if cx < 0 then
                display.draw_image(self.sprite, cx + display.width, cy)
            elseif cx + self.sprite.width > display.width then
                display.draw_image(self.sprite, cx - display.width, cy)
            end
            if cy < 0 then
                display.draw_image(self.sprite, cx, cy + display.height)
            elseif cy + self.sprite.height > display.height then
                display.draw_image(self.sprite, cx, cy - display.height)
            end
        end
    end
end

return Asteroid