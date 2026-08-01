--
-- Корабель, яким керує гравець
--

local data = require("modules.data")


Ship = {
    x = display.width / 2,
    y = display.height / 2,
    width = data.SHIP_SPRITE.width, -- Розмір спрайту
    height = data.SHIP_SPRITE.height,
    sprite = data.SHIP_SPRITE,
    forward_sprite = data.SHIP_FORWARD_SPRITE,
    backward_sprite = data.SHIP_BACKWARD_SPRITE,
    current_sprite = nil,
    current_rotation_index = nil,
    current_sprite_set_index = nil,
    rotation = 270, -- Кут обороту корабля в градусах за годинниковою стрілкою
    speed_x = 0,
    speed_y = 0,
    accel_forward = 0,
    angular_speed = 0,
    max_speed_x = display.width / 2,
    max_speed_y = display.height / 2,
    killed_at = -1,
    dead = false,
    -- accel_y = 0,
}
function Ship:new(o)
    o = o or {}
    setmetatable(o, self)
    self.__index = self
    return o
end

function Ship:set_forward_acceleration(accel)
    self.accel_forward = accel
end

function Ship:set_angular_speed(speed)
    self.angular_speed = speed
end

function Ship:kill()
    self.killed_at = util.time()
    self.dead = true
end

function Ship:update(delta)
    local dir_x, dir_y = math.rotate(1, 0, self.rotation)

    self.speed_x = self.speed_x + self.accel_forward * delta * dir_x
    self.speed_y = self.speed_y + self.accel_forward * delta * dir_y

    self.speed_x = math.clamp(self.speed_x, -self.max_speed_x, self.max_speed_x)
    self.speed_y = math.clamp(self.speed_y, -self.max_speed_y, self.max_speed_y)

    self.x = self.x + self.speed_x * delta
    self.y = self.y + self.speed_y * delta

    self.x = self.x % display.width
    self.y = self.y % display.height

    self.rotation = (self.rotation + self.angular_speed * delta) % 360
end

function Ship:draw()
    if self.dead then
        local time_since_death = util.time() - self.killed_at
        -- Малюємо коло, яке збільшується та зменшується впродовж 1 секунди
        if time_since_death < 1 then
            local radius = math.sin(time_since_death * 2 * math.pi) * 32
            display.fill_circle(self.x, self.y, radius, WHITE)
        end
    else
        local rotation_index = math.floor(self.rotation / ANGLE_STEP) + 1
        -- Координати верхнього лівого кута спрайту
        local cx = self.x - self.width / 2
        local cy = self.y - self.height / 2

        local sprite_set_index
        if self.accel_forward > 0 then
            sprite_set_index = 1
        elseif self.accel_forward < 0 then
            sprite_set_index = -1
        else
            sprite_set_index = 0
        end

        if self.current_sprite_set_index ~= sprite_set_index or self.current_rotation_index ~= rotation_index then
            if self.current_sprite ~= nil then
                resources.delete(self.current_sprite)
            end

            self.current_sprite_set_index = sprite_set_index
            self.current_rotation_index = rotation_index

            local angle = (rotation_index - 1) * ANGLE_STEP
            if sprite_set_index == 1 then
                self.current_sprite = resources.rotate_image(self.forward_sprite, angle, MAGENTA)
            elseif sprite_set_index == -1 then
                self.current_sprite = resources.rotate_image(self.backward_sprite, angle, MAGENTA)
            else
                self.current_sprite = resources.rotate_image(self.sprite, angle, MAGENTA)
            end
        end

        display.draw_image(self.current_sprite, cx, cy)
        -- Якщо ми біля краю екрану, малюємо корабель ще раз на протилежному боці
        if cx < 0 then
            display.draw_image(self.current_sprite, cx + display.width, cy)
        elseif cx + self.width > display.width then
            display.draw_image(self.current_sprite, cx - display.width, cy)
        end
        if cy < 0 then
            display.draw_image(self.current_sprite, cx, cy + display.height)
        elseif cy + self.height > display.height then
            display.draw_image(self.current_sprite, cx, cy - display.height)
        end
    end
end

return Ship