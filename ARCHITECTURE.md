# Architecture

*[Читати українською](ARCHITECTURE.uk.md)*

How the environment is built inside and **why it's built that way**. The file
list is visible without a document — what's valuable here is the reasoning
behind decisions, because that's what explains why something can't be
"simplified."

The project's main requirement: the program must behave in the browser
**exactly like it does on hardware**. Every decision below follows from that,
one way or another.

---

## The big picture

```
                     MAIN THREAD                        WORKER

  ┌──────────────┐   ┌──────────────┐         ┌──────────────────┐
  │   editor     │   │   LuaHost    │         │   LuaRuntime     │
  │   file       │──▶│              │         │                  │
  │   panel      │   │  virtual     │─files──▶│  wasmoon (Lua)   │
  └──────────────┘   │  card        │         │        │         │
                     │  (IndexedDB) │         │        ▼         │
  ┌──────────────┐   │              │         │  API bindings    │
  │   canvas     │◀──│   Screen     │         │        │         │
  │   280×240    │   └──────┬───────┘         │        ▼         │
  └──────────────┘          │                 │    emulator      │
                            │                 │   (drawing)       │
  ┌──────────────┐          │                 └────────┬─────────┘
  │   buttons    │──────────┤                          │
  └──────────────┘          │                          │
                            ▼                          ▼
                      ╔═══════════════════════════════════╗
                      ║        SharedArrayBuffer          ║
                      ║  two frame buffers + button state ║
                      ╚═══════════════════════════════════╝
```

The two halves live in different threads and talk through shared memory.
Messages between them are only for events: run, stop, print, play a sound.

---

## Why Lua runs in a worker, not the main thread

There's one decisive reason: **`util.sleep()` must actually block**.

On hardware, `util.sleep(0.1)` stops the program for 100 ms — that's
`vTaskDelay`. The only way to reproduce that in JavaScript is `Atomics.wait`,
and the browser won't let you call it on the main thread: that would freeze
the whole page.

Making `sleep` asynchronous instead would mean rewriting user code — and it
must stay unchanged. Hence the worker.

### This is why COOP/COEP are needed

`SharedArrayBuffer` is only available with the `Cross-Origin-Opener-Policy`
and `Cross-Origin-Embedder-Policy` headers set. GitHub Pages can't set them,
so `public/` carries `coi-serviceworker.js` — a service worker that installs
them itself. Because of this, the page reloads once on the first visit.

The file must stay **outside the bundle** and be served from its own origin.
If it were bundled with everything else, the runtime wouldn't start.

---

## Who sets the pace

**The worker**, not the browser.

```
worker:          update → draw → queue_draw → sleep(33 - elapsed)
                    │                  │
                    │                  └──▶ publishes the frame into shared memory
                    │
main thread:  requestAnimationFrame → present() → canvas
```

30 frames per second at a flat 33 ms — exactly like `perfectDelta` in
`AbstractLuaRunnerApp::execute()`. The main thread just presents whatever is
there, at its own rate (usually 60 Hz).

This isn't a simplification. On hardware, the display also refreshes
independently of how fast the program computes, so this decoupling reproduces
reality.

### Double buffering, with a trap

`queueDraw()` **swaps the buffers** and clears nothing. So next frame's
program draws over the frame that was **two frames ago**.

A Lua program without `display.fill_screen` won't see a trail — it'll see
flicker between two stale frames. This is firmware behavior, and it's
reproduced on purpose.

A less obvious consequence follows from the same fact: **text state belongs
to the canvas, and there are two canvases**. Cursor, font, and color in
Arduino_GFX are fields on the canvas object. So `display.set_cursor`, called
once, affects only **one** of the two frames. That's why the code keeps one
`TextRenderer` per buffer.

---

## Hang protection

Two independent layers, and the second deliberately doesn't rely on the
first.

**Soft: `debug.sethook`.** A Lua instruction counter. Lets the program
terminate cleanly, with a message and a line number.

The hook is installed **only around the script body** and removed right
after. Otherwise it would also count the main loop's instructions, and any
sufficiently long-running program would hit the limit simply for running for
a while.

**Hard: `worker.terminate()`.** If the frame counter hasn't grown in over 2
seconds, the worker is killed along with all of Lua's state. It doesn't
depend on anything inside Lua, so a script can't disable it. This layer
deliberately doesn't rely on `debug.sethook`: if a hole ever turns up in the
instruction counter, a hung program still won't freeze the page forever.

---

## Three layers and the boundary between them

```
  src/ui/          interface: editor, file panel, drawn board
        │
  src/runtime/     Lua bindings, worker, shared memory
        │
  src/emulator/    drawing, fonts, images, file system
```

**`src/emulator/` knows nothing about Lua at all.** Drawing, fonts, and the
file system are a separate layer from the runtime, which they coordinate with
only through the thin bindings in `src/runtime/`.

That's easy to verify: `scripts/render-testcard.mts` draws a test card under
Node, without a browser and without Lua.

`src/runtime/runtime.ts` is also deliberately **not dependent on the Web
Worker** — so the runtime can be run under Node, which is exactly how the
checks in `check-runtime.mts` work.

---

## Interface language

`src/i18n/` follows the same "thin layer, kept separate" pattern as the
three layers above — it's not a fourth layer of its own, just a boundary
inside `src/ui/`.

**Translated:** app chrome — buttons, panels, menus, dialogs, status and
error messages, and the autocompletion tooltips pulled from
`lilka-api.json` (see below).

**Not translated, on purpose:**

- **The drawn board's silkscreen** (`src/ui/shell.ts`) — the logo and motto
  are a reproduction of what's physically printed on a real Lilka. Translating
  them would break hardware fidelity, the same principle that governs
  everything else in this document.
- **Widget content** (`alertUI`, `keyboardUI`, `progressUI`) — titles and
  messages there come from the Lua program itself, not from the environment.
  It's program content, like console output; the environment has no business
  translating what a script chose to print.
- **Internal exception messages** in `src/runtime/` and `src/emulator/` —
  rare "this should never happen" paths that don't go through the UI layer.
  Threading i18n through them would compromise the "doesn't know about the UI"
  property that makes those layers testable under Node in the first place.

State lives **only in memory** (`src/i18n/lang.ts`): the default comes from
`navigator.language`, and a visible toggle can switch it for the session.
This is deliberate, not an oversight — `localStorage`/`sessionStorage` aren't
used for application state in the emulator's code until a proper virtual
file system storage layer exists for settings.

### English descriptions for the API can't live in the generated file

`lilka-api.json` is extracted from the firmware's Lua annotations, and
Lilka is a Ukrainian community project — those annotations are written in
Ukrainian. Editing the generated JSON by hand to add English text isn't an
option: it would be silently lost on the next `gen-api-spec.mjs` run.

So the English text lives in a separate, hand-maintained file,
`scripts/completions-i18n-en.mjs`, keyed by the **fully qualified** name
(`display.fill_screen`, `alertUI.draw`) — not by the completion `label` a
user sees, because several widget classes (`alertUI`, `keyboardUI`,
`progressUI`) have same-named methods (`draw`, `setMessage`) with different
meanings, and the label alone can't tell them apart. `gen-completions.mjs`
looks up each entry by that qualified name and emits both `info` (Ukrainian)
and `infoEn` (English) into `completions.ts`; `check-completions.mts` fails
the build if a Ukrainian description has no English counterpart.

---

## What's generated, and what's handwritten

The project's most important rule: **no hardware numbers written by hand in
the code**.

| What | Script | Source |
|---|---|---|
| `board.json` — screen, buttons, pins, constants | `gen-*`, assembled by hand | `sdk/config.h`, `boards/lilka_v2.json` |
| `lilka-api.json` — 181 functions with types and descriptions | `gen-api-spec.mjs` | `keira/addons/lualilka/library/*.lua` |
| `fonts/*.json` — 9 fonts with glyph bitmaps | `gen-fonts.mjs` | `u8g2/csrc/u8g2_fonts.c` |
| `fmath-tables.ts` — sin360, sin32 | `gen-fmath.mjs` | `sdk/lilka/fmath.cpp` |
| `notes.ts` — 97 notes | `gen-notes.mjs` | `sdk/lilka/buzzer.h` |
| `icons.ts` — 12 icons: keyboard and files | `gen-icons.mjs` | `sdk/lilka/icons/*.h`, `keira/src/apps/icons/*.h` |
| `coverage.json` — API coverage report | `gen-coverage.mts` | running the real runtime |
| `completions.ts` — 253 editor hints | `gen-completions.mjs` | `lilka-api.json` |

All of this lives in `src/generated/` and **is never hand-edited**. When the
firmware changes, rerun the script instead of fixing twenty places in the
code.

A side benefit: `gen-api-spec.mjs` cross-checks the annotations against the
functions' actual signatures. That's how some of the mismatches between the
documentation and the firmware code were found.

**The annotations aren't the final authority.** The source of truth is what
the firmware actually registers in `lua_State`; the annotations sometimes
disagree with it, and silently inheriting the error isn't an option: both
autocompletion and the emulator's completeness check grow out of this
specification. That's why `gen-api-spec.mjs` has two explicit lists, each
entry linked to a spot in the C++:

- `FIRMWARE_RENAMES` — the annotation names a function differently than the
  firmware does. There's currently one such case: `display.draw_elipse` /
  `fill_elipse` with a single "l", while `lualilka_display.cpp` registers
  `draw_ellipse` / `fill_ellipse` and never registered anything else. While
  the error lived in the spec, the browser offered a name that doesn't exist
  on hardware — and vice versa.
- `FIRMWARE_EXTRAS` — the firmware registers something the annotations don't
  describe at all. Right now that's `console.print`: a global function used
  by the examples inside the annotations themselves
  (`console.print(state.path)` in `state.lua`).

A namespace declared more than once isn't treated as an error; the
descriptions are merged instead: `lualilka_fs.h` and `lualilka_sdcard.h` both
define `FILE_OBJECT` with the same string, `"File"`, so the metatable in the
firmware is literally one and the same — just described in two annotation
files. A mismatch between the two remains an error.

---

## Drawing: why not Canvas 2D

`ctx.arc()`, `ctx.lineTo()`, `ctx.fillRect()` antialias edges and produce
**different pixels** than the ST7789. For a learning environment, that's the
most expensive possible mistake: the virtual screen would show something
other than what a real one shows.

That's why `src/emulator/framebuffer.ts` is a line-by-line port of
`Arduino_GFX.cpp`'s raster primitives, into its own `Uint16Array` in RGB565
format.

The frame buffer is RGB565 itself, not RGB888 with later quantization:
otherwise the program could show shades the panel physically can't
reproduce. Expansion to 24 bits happens once, via a 65536-entry table, right
when presenting to the canvas.

Scale is **integer only**. At a fractional scale the browser blurs pixel art
even with `image-rendering: pixelated`.

Trigonometry is taken from the firmware's tables, not from `Math.sin`:
`fmath.cpp` contains `sin360[360]` with values to six decimal places,
declared as `float`. A deviation of up to 5.3e-7 is nothing — until you
remember the `static_cast<int32_t>` after the multiplication. Then it shifts
a pixel.

---

## Fonts

The nine `u8g2_font_*_t_cyrillic` fonts are unpacked **at build time**, not
at runtime. The browser has neither a u8g2 format decoder nor WASM for it —
just ready-made bitmaps by codepoint, in separate 2–5 KB gzip chunks.

Positioning is taken from `Arduino_GFX::write()`, because that's what runs
on the Lilka: `cursorY` is the **baseline**, a line break adds
`scaleY * max_char_height` (not the height from ascent/descent — those are
different numbers), and the cursor moves by `delta_x`, not by the bitmap
width.

---

## File system

Modeled after the new VFS in KeiraOS (`src/keira/vfs/`), not the old Arduino
wrappers — the firmware's `vfs.h` header says so directly: "if possible, just
stick to a well documented/tested/used POSIX file api."

```
/          RootFs    read-only, flat list of mounts
/sd        MemoryFs  memory card      ← persisted in IndexedDB
/spiffs    MemoryFs  internal flash   ← persisted
/tmp       MemoryFs  PSRAM ramdisk    ← NOT persisted
```

`/tmp` deliberately never reaches persistent storage: on hardware it's a
ramdisk, and it's empty after a reboot.

### Why files are handed to the worker whole

`resources.load_image` is **synchronous**, and IndexedDB is asynchronous.
There's no way to read a file at the moment of the call.

So the virtual card lives on the main thread, and its entire contents are
handed to the worker before the program starts. Same with PNG: it's unpacked
to RGBA ahead of time, because there's no synchronous decoder in the browser.

### Two different path rules

This isn't our quirk — it's firmware behavior:

- `resources.*` and `fs.*` — a path relative to the **script's folder**
  (`luapath_to_path`); an empty string means the root
- `sdcard.*` — glued onto `"/sd"` by **plain concatenation**, with no
  separator

Because of the second rule, `sdcard.open("a.txt")` looks for `/sda.txt` and
finds nothing. We reproduce that, but add a hint in the environment's
console — there's no console on hardware, so the explanation breaks nothing.

---

## Hardware quirks, reproduced on purpose

The project's most valuable knowledge. Every item here was found by reading
the firmware's code and locked down with a check — so a "fix" doesn't slip
through unnoticed.

**The screen is 280×240, not 240×280.** The panel really is 240×280, but
`config.h` sets `ROTATION 3`, and Arduino_GFX swaps width and height on a 1/3
rotation.

**Arduino_GFX draws circles differently from Adafruit_GFX.** `drawCircle`
calls an ellipse helper, not the classic midpoint algorithm. Arcs don't exist
in Adafruit at all.

**`writeEllipseHelper` uses `ry` where `rx` would be expected, when
`ry == 0`.** Looks like a bug, but that's exactly how the hardware behaves.

**Integer division truncates toward zero** — `Math.trunc`, not
`Math.floor`. With `floor`, filled triangles with a negative slope and
flipped sprites shift by a pixel.

**Rotating an image with no transparent color gives WHITE corners.** Outside
the source's bounds, `transparentColor` is written, i.e. `-1`, and as a
`uint16_t` that's `0xFFFF`.

**`math` is replaced wholesale, not extended.** Lilka has no `math.huge`,
`math.fmod`, `math.tointeger`, `math.type`.

**`math.random(a, b)` doesn't include the upper bound** — that's Arduino
`random()`'s semantics. **`math.round`** rounds half away from zero.

**Whether a result is integer or float is visible in the output.** The
firmware returns almost all math through `lua_pushnumber`, so `math.sin(0)`
prints as `0.0`, and `math.floor(2.7)` as `2`.

**BMP drops alpha, PNG keeps it.** Only the first three bytes of a BMP pixel
are read.

**BMP doesn't align rows to 4 bytes** — a 24-bit file with a width that isn't
a multiple of 4 skews diagonally. **A "top-down" BMP** doesn't load at all,
because the height is read as unsigned.

**`sdcard.ls` throws on an empty directory**, but `fs.ls` doesn't: there,
only a failed `opendir` is an error. **`file.exists()`** means "could it be
opened." **`file.write`** stops at a null byte, even though `file.read` is
binary-safe. **`fopen` in `"w"` mode truncates** an existing file to zero,
and `"a"` sets the position straight to the end.

**`state` on the first run is `nil`, not an empty table.** The global
variable only appears once a `.state` file sits next to the script, so a
program starts with `state = state or {}` — that's exactly what the example
next to the annotation says. A metatable with `save`/`reset`/`clear`/`path`
is attached by the global table's `__newindex`, and it only fires on the
**first** assignment.

**`state` saves itself** when the program ends — `LuaFileRunnerApp::run()`
writes the file after `execute()` unconditionally, even after an error.
**`clear()` deletes the file** and sets `state` to `nil`; **`reset()` doesn't
touch the file**, it rereads it, discarding anything unsaved. Numbers go
through `%lf`, so a saved `42` comes back as `42.0`.

**`display.print` and `console.print` print the type name** for anything
that isn't a string or a number: `display.print(true)` draws `boolean`. The
plain `print` doesn't do this — the firmware doesn't override it.

**`math.sign` truncates the fraction before comparing** (`int value =
luaL_checknumber(...)`), so `math.sign(0.5)` equals `0`. **`math.min`,
`max`, `sum`, `avg`** only read a table's array part, via `lua_rawlen` and
`lua_rawgeti`: `math.max{a = 1, b = 2}` doesn't skip the two, it crashes.

**A short tap isn't lost.** On hardware, `justPressed` is set by a
controller interrupt handler — right at the edge — and `getState()` merely
clears the flag. So a press shorter than a frame is still visible there. In
the browser, a level-based reading of the button wouldn't show such a tap at
all, so shared memory holds not just levels but press/release counters too;
the worker compares them, rather than taking an instant snapshot. For the
same reason, `controller.get_state()` snapshots the state itself — on
hardware it can be read both from the script body and from a script's own
loop, `while true do ... util.sleep() end`, where the environment's main loop
isn't running.

**Startup sequence:** clear the canvas → script body → `queueDraw` →
clear **again** → `lilka.init` → `queueDraw` → the loop.

**`isFinished()` on widgets isn't a getter:** it clears the `done` flag. A
second call in a row returns `false`.

**`ProgressDialog::draw` passes `top` for the body instead of `mid`** — the
text boundary starts an eighth higher than in `Alert`. Looks like a firmware
defect.

**Alert reacts to A even before `addActivationButton`** — the constructor
adds it itself.

**The one deliberate departure from the original: a widget doesn't publish
its own frame.** In the firmware, a widget's `draw()` calls `queueDraw()`,
and the main loop does it again — that's two buffer swaps per frame, and the
screen alternates between the widget and a stale buffer. The defect has been
reported to the firmware team (D5); until it's fixed, the emulator publishes
a frame only from the main loop, because otherwise widgets are unusable.
Locked down by checks 18 and 19 in `check-runtime`.

**Windows are divided into eighths of the screen** (`height/8`), rather than
having fixed sizes. The title uses 6x13 at double size, the body 9x15.

---

## Talking to a real Lilka

Over Web Serial, which means Chromium-based browsers only. Firefox and
Safari have no access to the cable from a web page at all, so the button
isn't shown there — an inactive button would just be confusing.

The firmware has two modes, and both are switched on **on the Lilka itself**,
in the "Development" menu:

**Live Lua** — Lilka waits, the computer sends the program's text, and
silence longer than `SERIAL_DELAY` (1000 ms) means "the code has ended." No
protocol, just text at 115200 baud.

**REPL** — accepts a line at a time and returns whatever the program printed
via `print`. An expression on its own returns nothing.

Both modes send **only code**. A program using `require` or `load_image`
needs the files to already be on the card — we warn about that before
running, rather than after a confusing error on the device.

## How this is checked

**124 automated checks**, `npm run check`:

| Suite | What it checks |
|---|---|
| `check-primitives` | geometry: circle symmetry, clipping, `color565` |
| `check-fonts` | fonts against independently derived header values |
| `check-images` | raster, transforms, double buffering |
| `check-vfs` | file system and the BMP loader's quirks |
| `check-widgets` | widgets: keyboard layout, window geometry |
| `check-completions` | editor autocompletion against `lilka-api.json` |
| `check-runtime` | Lua runtime under Node |

All of this runs under Node, without a browser. Whether what a person
actually sees works (tabs, the Run/Stop buttons, picking an example) is
checked separately by `npm run test:e2e` — Playwright under headless
Chromium, `e2e/smoke.spec.ts`.

Both suites are wired into CI. `deploy.yml` runs `typecheck` and `check`
before every publish on push to `main`. `ci.yml` adds `test:e2e` and `build`
on top of that — on every pull request and every push to `main`. For a PR,
that's the only automated check the code sees before merging, since
`deploy.yml` doesn't react to pull requests.

The main principle for the Node-side checks: compare against
**independently computed** numbers, not against the code's own output.
Examples:

- fonts: the letter "A"'s `delta_x` from the bitstream, against the cell
  width from the font's name; the height of "A" against `ascent_A` from byte
  13 of the header. These are different fields, and if the bitstream is read
  with an offset, they'll disagree
- BMP: expected pixel values are computed by a separate script, directly from
  the file's bytes
- the shape of the letter "A" in 6x13 is checked against an X11 sample known
  outside this format

Plus real programs: "Dice", "Repeat the pattern", and the official
`examples/LUA/cat` are bundled as examples. If any of them stops running,
that's a bug in the emulator, not in the example.

---

## API coverage

```
111 of 174 functions (64%)
within scope: 107 of 108 (99%)
```

The gap between 174 and 108 is hardware namespaces that will never exist in a
browser: `gpio`, `i2c`, `spi`, `pwm`, `wifi`, `mqtt`, `net`, `serial`,
`ws2812`.

The number isn't a guess: `gen-coverage.mts` runs the real runtime, captures
the list of bindings, and checks it against the spec extracted from the
firmware's annotations.

Missing: `audio.play` — playing audio files.

---

## Build sizes

```
main bundle          ~22 KB gzip
fonts                 9 chunks of 2–5 KB, on demand
glue.wasm (Lua)      265 KB, a separate file
"Cat" example         4 BMPs of 269 KB each, on demand
```

Examples with files deliberately don't end up in the main bundle.
