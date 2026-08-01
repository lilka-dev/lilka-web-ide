ROOT = 'resources/'

data = {
    ASTEROID_16_SPRITES = { resources.load_image(ROOT .. "asteroid_16.bmp", MAGENTA) },
    ASTEROID_32_SPRITES = { resources.load_image(ROOT .. "asteroid_32.bmp", MAGENTA) },
    ASTEROID_48_SPRITES = { resources.load_image(ROOT .. "asteroid_48.bmp", MAGENTA) },
    ASTEROID_64_SPRITES = { resources.load_image(ROOT .. "asteroid_64.bmp", MAGENTA) },

    SHIP_SPRITE = resources.load_image(ROOT .. "ship.bmp", MAGENTA),
    SHIP_FORWARD_SPRITE = resources.load_image(ROOT .. "ship_forward.bmp", MAGENTA),
    SHIP_BACKWARD_SPRITE = resources.load_image(ROOT .. "ship_backward.bmp", MAGENTA),

    BANNER = {},
    PRESS_START = resources.load_image(ROOT .. "press_start.bmp"),
    YOU_ARE_DEAD = resources.load_image(ROOT .. "game_over.bmp"),

    SHOOT_SOUND = resources.load_audio(ROOT .. "shoot.mp3"),
    BOOM_SOUND = resources.load_audio(ROOT .. "boom.mp3"),
    DEATH_SOUND = resources.load_audio(ROOT .. "death.mp3"),

    SHOOT_MELODY = {
        { 880, 8 },
        { 784, 8 },
        { 698, 8 },
        { 659, 8 },
        { 587, 8 },
        { 523, 8 },
        { 440, 8 },
        { 392, 8 },
        { 349, 8 },
        { 330, 8 },
        { 294, 8 },
        { 262, 8 },
    },

    BOOM_MELODY = {
        { 440, 8 },
        { 392, 8 },
        { 349, 8 },
        { 330, 8 },
        { 294, 8 },
        { 262, 8 },
        { 220, 8 },
        { 196, 8 },
        { 175, 8 },
        { 165, 8 },
        { 147, 8 },
        { 131, 8 },
        { 123, 8 },
        { 110, 8 },
        { 98, 8 },
        { 88, 8 },
    },

    -- Low-pitch (100-200 Hz) noise.
    DEATH_MELODY = {
        { 200, 8 },
        { 100, 8 },
        { 150, 8 },
        { 200, 8 },
        { 100, 8 },
        { 150, 8 },
        { 100, 8 },
        { 150, 8 },
        { 100, 8 },
        { 150, 8 },
        { 50, 8 },
        { 100, 8 },
        { 50, 8 },
        { 100, 8 },
        { 50, 8 },
        { 100, 8 },
        { 50, 8 },
        { 100, 8 },
        { 50, 8 },
        { 100, 8 },
        { 50, 8 },
    },
}

for i = 2, 8 do
    data.ASTEROID_16_SPRITES[i] = resources.rotate_image(data.ASTEROID_16_SPRITES[1], i * 45, MAGENTA)
    data.ASTEROID_32_SPRITES[i] = resources.rotate_image(data.ASTEROID_32_SPRITES[1], i * 45, MAGENTA)
    data.ASTEROID_48_SPRITES[i] = resources.rotate_image(data.ASTEROID_48_SPRITES[1], i * 45, MAGENTA)
    data.ASTEROID_64_SPRITES[i] = resources.rotate_image(data.ASTEROID_64_SPRITES[1], i * 45, MAGENTA)
end

for i = 1, 4 do
    data.BANNER[i] = resources.load_image(ROOT .. "banner" .. i .. ".bmp")
end

return data