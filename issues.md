# Emulator vs real Lilka — hardware comparison findings

Found on 2026-10-09 by running the same Lua scripts on a real Lilka v2
(KeiraOS dev build, LilkaSDK v2.5.16, "Lua live" app) and in the emulator
runtime under Node, and comparing the frames captured from the ST7789 bus with
an lcdtap pixel by pixel.

What already matches: every drawing primitive (lines, rects, circles,
ellipses, triangles, arcs, clipping, fractional coordinates) and all 9 fonts
including Cyrillic, colored backgrounds, text size and text bounds — 0
differing pixels once the number-precision issue (#1) is taken out.

Status: `[ ]` open · `[x]` fixed in the web IDE · `[fw]` firmware bug, to
report upstream (the emulator reproduces it, or cannot).

## Web IDE

- [x] **1. Lua numbers are 32-bit on the device.** *(partly — see below)*
  Keira's `mischief/lua@0.1.1` has `#define LUA_32BITS 1`: `lua_Number` is
  `float`, `lua_Integer` is `int32`. On the device `math.pi` is
  `3.1415927410125732`, `1 << 63` is `0`, `-1 >> 1` is `2147483647`,
  `tostring(2^63)` is `"9.223372e+18"` (`%.7g`). The emulator runs stock
  64-bit Lua (double + int64).
  Visible effect: `math.round(35 * math.cos(math.rad(60)))` is 17 on the
  device and 18 in the emulator, so a line ends one pixel off.
  Fix in two parts:
  - (a) every `math.*` result and constant follows the firmware exactly:
    float arithmetic per C operation, then rounded to float32 on push
    (verified against 26 of 27 device values; `sin(1)` is 1 ulp off on the
    device — newlib `sinf`, not reproduced);
  - (b) `tostring`/`print` format floats with `%.7g` like the device.
  Not fixable without a 32-bit Lua build: user arithmetic (`0.1 + 0.2`),
  string concatenation of numbers, int32 overflow.
  **Done:** (a) and (b), plus `string.format("%s")`. The `sin(1)` outlier
  turned out to be real: the device's trig is newlib's fdlibm `sinf`/`cosf`,
  not correctly rounded, with GCC fusing `c ± a*b` into `madd.s`/`msub.s`.
  Ported in `src/emulator/libm.ts` (constants from `npm run gen:libm`) for
  sin, cos, tan, asin, acos, atan, atan2, log — 774 device values match bit
  for bit (`npm run check:libm`). Still open:
  - `math.pow`: 54 of 60 device values match; the other 6 are 1 ulp off and
    neither fdlibm `powf` nor correct rounding reproduces them.
  - The three items above — they need Lua compiled with `LUA_32BITS` to wasm.
  - Not yet re-verified on the device after the libm port: the shapes scene
    (it was 30 px off at the 210° line before, which this port explains).

- [x] **2. `geometry.intersect_lines` returns a point; the firmware returns a
  boolean.** `lualilka_geometry_intersectLines` pushes only `true`/`false`,
  and its formula has a sign error in `u`, so on the device it returned
  `false` for every case tested, including two clearly crossing diagonals.
  The emulator returns `(x, y)` or `nil`. Reproduce the firmware (see #F2).

- [x] **3. `Transform:get()` returns floats; the firmware returns integers.**
  `lualilka_imageTransform_get_matrix` uses `lua_pushinteger`, so
  `transforms.new():rotate(30):get()` is `{{0,0},{0,0}}` on the device and
  `scale(2,3):rotate(45)` gives `{{1,-2},{1,2}}`.

- [x] **4. Argument checks are looser than the firmware.**
  | Call | Device | Emulator |
  |---|---|---|
  | `math.atan(1, 2)` | error `Очікується 1 аргумент, отримано 2` | returns `atan(1)` |
  | `math.max(1, 5, 3)` / `math.min(...)` | error `Очікується 1 аргумент, отримано 3` | error `аргумент має бути таблицею` |
  | `math.clamp()` | error `Очікується 3 аргументи, отримано 0` | returns `nan` |
  | `math.random(1.5, 3.5)` | error `number has no integer representation` | returns an integer |
  | `display.color565(255)` | error `bad argument #2 to 'color565' (number expected, got no value)` | returns `63488` |
  | `display.color565("x", 1, 2)` | error `bad argument #1 …` | returns `0` |
  | `display.fill_rect("a")` | error `bad argument #1 to 'fill_rect' (number expected, got string)` | silently does nothing |
  | `math.avg({})` | `Таблиця не може бути пустою` | `таблиця не може бути порожньою` |
  Fix: firmware-style argument count checks (`K_S_LUA_MATH_ARGS_*`) and
  `luaL_checknumber` / `luaL_checkinteger` semantics with the same messages.
  **Done** for `math`, `display`, `geometry`, `crypto`, `string.format`;
  texts generated from `lang_uk.h` (`npm run gen:strings`). All messages
  re-checked on the device. Known gap: in a tail call
  (`return display.fill_rect("a")`) the emulator's message has no
  `main.lua:N:` prefix. Not yet covered: `resources`, `fs`/`sdcard`, `util`,
  `buzzer`, UI widgets.

- [x] **5. `crypto` module is missing.** Device has `crypto.crc32`,
  `crypto.md5`, `crypto.encrypt`, `crypto.decrypt` (AES-CBC, PKCS7, random
  IV prepended, hex output; key must be 16/24/32 bytes).

- [x] **6. `controller.get_state()` buttons are userdata.** On the device each
  button is a table `{pressed, just_pressed, just_released}`; in the emulator
  `type(state.up)` is `"userdata"`.

- [x] **7. `notes` is userdata, not a table.** `pairs(notes)` fails in the
  emulator.

- [x] **8. `audio.get_volume()`** returns float `-1` on the device right after
  start (and pushes with `lua_pushnumber`, so it is always a float); the
  emulator returns integer `100`.

- [x] **9. Emulator leaks internals into `_G`:** `Promise`, `null`, `__api`,
  `__lilka_main`, `__lilka_load_state`, `__lilka_save_state`, and
  `sandbox` has extra functions. A script iterating `_G` sees things the
  device does not have. **Done:** all removed; `sandbox` deleted (unused, and
  `fs` now covers what it was for).

- [ ] **10. Hardware modules are absent:** `gpio`, `spi`, `i2c`, `pwm`,
  `serial`, `ws2812`, `wifi`, `http`, `httpserver`, `net`, `mqtt`, `service`.
  Out of scope for emulation, but their constants (`gpio.HIGH`,
  `spi.MODE0`, `serial.SERIAL_8N1`, `http.HTTP_CODE_OK`, …) could exist so
  that scripts load; calls would raise "not available in the emulator".
  **Not started** — needs a generator for the constant values from
  arduino-esp32 headers (they must not be written by hand).

## Firmware (to report to the Keira team)

- [fw] **F1. `Transform:set` with a flat table crashes the device.**
  `transforms.new():set({1, 2, 3, 4})` → Guru Meditation (LoadProhibited,
  EXCVADDR 0x9) and reboot. `lualilka_imageTransform_set_matrix` calls
  `lua_rawgeti(L, -1, j + 1)` on whatever `m[i]` is without checking it is a
  table. Expected: a Lua error.
- [fw] **F2. `geometry.intersect_lines` sign error.** In
  `lualilka_geometry_intersectLines`, `u` has the wrong sign, so crossing
  segments return `false`. The annotation in `addons/lualilka/library`
  documents a different return value as well.
- [fw] **F3. `Transform:get()` truncates the matrix to integers**
  (`lua_pushinteger` on float elements), which makes it useless after
  `rotate`.
- [fw] **F4. Lua live leaks canvas state into scripts:** text bound
  `(8, 0, width - 16, height)`, font 10x20 and the previous script's text
  color stay active, so the same script renders differently in Lua live and
  when run from a file.
- [fw] **F5. Device serial output drops ~20-byte chunks under bursts** and the
  log wrapper treats printed text as a printf format (`%` disappears) and cuts
  lines at ~250 characters.
