--[[
    Повтори комбінацію (Simon Says)
    A — почати / ще раз  |  B — вихід
]]

local BLACK = display.color565(0,0,0)
local WHITE = display.color565(255,255,255)
local GRAY  = display.color565(100,100,100)
local GREEN = display.color565(60,255,100)

local W, H  = display.width, display.height
local cx, cy = W/2, H/2 - 10

local buttons = {
    up    = { x=cx,    y=cy-55, note=notes.E5,
              dim=display.color565(0,0,100),   bright=display.color565(80,160,255),
              draw=function(x,y,c) display.fill_circle(x,y,28,c) end },
    down  = { x=cx,    y=cy+55, note=notes.G5,
              dim=display.color565(0,80,0),    bright=display.color565(60,255,100),
              draw=function(x,y,c) display.fill_rect(x-25,y-25,50,50,c) end },
    left  = { x=cx-55, y=cy,    note=notes.C5,
              dim=display.color565(100,80,0),  bright=display.color565(255,220,50),
              draw=function(x,y,c) display.fill_triangle(x-28,y+22,x+28,y+22,x,y-28,c) end },
    right = { x=cx+55, y=cy,    note=notes.B4,
              dim=display.color565(100,0,60),  bright=display.color565(255,80,180),
              draw=function(x,y,c)
                  display.fill_triangle(x,y-28,x+28,y,x,y+28,c)
                  display.fill_triangle(x,y-28,x-28,y,x,y+28,c)
              end },
}
local order = {"up","down","left","right"}

local IDLE, SHOW, INPUT, LOSE, WIN = 1,2,3,4,5
local SHOW_ON, SHOW_OFF = 0.5, 0.25

local state, sequence, step, score, best, lit, timer

local function reset()
    state=IDLE; sequence={}; step=1; score=0; lit=nil; timer=0
end

local function start_show()
    state=SHOW; step=1; lit=nil; timer=0.4
end

local function txt(col, x, y, s)
    display.set_text_color(col)
    display.set_cursor(x, y)
    display.print(s)
end

function lilka.init()
    reset()
    best = best or 0
end

function lilka.update(delta)
    local btn = controller.get_state()
    if btn.b.just_pressed then util.exit() end

    if state == IDLE then
        if btn.a.just_pressed then
            reset()
            table.insert(sequence, order[math.random(1,4)])
            start_show()
        end

    elseif state == SHOW then
        timer = timer - delta
        if timer > 0 then return end
        if lit then
            lit=nil; step=step+1; timer=SHOW_OFF
        elseif step > #sequence then
            state=INPUT; step=1; lit=nil
        else
            lit=sequence[step]; timer=SHOW_ON
            buzzer.play(buttons[lit].note, 400)
        end

    elseif state == INPUT then
        for _, name in ipairs(order) do
            if btn[name].just_pressed then
                lit=name; timer=0.15
                buzzer.play(buttons[name].note, 200)
                if name ~= sequence[step] then
                    score=#sequence-1
                    if score > best then best=score end
                    state=LOSE; timer=2.0
                else
                    step=step+1
                    if step > #sequence then state=WIN; timer=0.6 end
                end
                break
            end
        end
        if lit and state==INPUT then
            timer=timer-delta
            if timer<=0 then lit=nil end
        end

    elseif state == WIN then
        timer=timer-delta
        if timer<=0 then
            table.insert(sequence, order[math.random(1,4)])
            start_show()
        end

    elseif state == LOSE then
        timer=timer-delta
        if timer<=0 then reset() end
    end
end

function lilka.draw()
    display.fill_screen(BLACK)
    display.set_font("9x15")

    for _, name in ipairs(order) do
        local b = buttons[name]
        local col = (state==WIN) and GREEN
                 or (lit==name)  and b.bright
                 or b.dim
        b.draw(b.x, b.y, col)
    end

    if state == IDLE then
        txt(WHITE, cx-75, H-32, "Repeat the sequence!")
        txt(GRAY,  25,    H-10, "B: exit")
        txt(GRAY,  170,   H-10, "A: start")
    elseif state == SHOW then
        txt(GRAY, cx-54, H-28, "Watch!")
    elseif state == INPUT then
        txt(GRAY, cx-48, H-28, "Repeat!")
    elseif state == WIN then
        txt(GREEN, cx-48, H-28, "Correct!")
    elseif state == LOSE then
        txt(display.color565(255,80,80), cx-48, H-48, "Wrong!")
        txt(GRAY, cx-60, H-28, "Score: "..score.."  Best: "..best)
    end
end
