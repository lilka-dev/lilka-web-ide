--
-- Куля, якою стріляє корабель
--

Bullet = {
    x = 0,
    y = 0,
    speed_x = 0,
    speed_y = 0,
    distance_traveled = 0,
    dead = false,

    radius = 1,
    max_distance = math.sqrt(display.width * display.width + display.height * display.height) / 2,
}

function Bullet:new(x, y)
    local o = { x = x, y = y }
    setmetatable(o, self)
    self.__index = self
    return o
end

function Bullet:update(delta)
    if self.dead then
        return
    end
    local dx = self.speed_x * delta
    local dy = self.speed_y * delta
    self.x = self.x + dx
    self.y = self.y + dy
    -- Якщо куля виходить за межі екрану, вона з'являється на протилежному боці
    self.x = self.x % display.width
    self.y = self.y % display.height

    -- Коли куля долає велику відстань, вона вмирає
    self.distance_traveled = self.distance_traveled + math.sqrt(dx * dx + dy * dy)
    if self.distance_traveled > self.max_distance then
        self.dead = true
    end
end

function Bullet:kill()
    self.dead = true
end

function Bullet:draw()
    display.fill_circle(self.x, self.y, self.radius, WHITE)
end

return Bullet