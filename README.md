# Lilka · web IDE

*[Читати українською](README.uk.md)*

A browser-based learning environment for the [Lilka](https://lilka.dev) game console.
Write a program, run it, take it away on the memory card — no installation
required.

**[▶ Try it](https://sverdlyuk.github.io/lilka-web-ide/)** ·
[Architecture](ARCHITECTURE.md) · [Lilka](https://lilka.dev)

---

## Goal

The program must behave in the browser **exactly like it does on hardware**.
Not "close enough" — pixel for pixel, frame for frame.

This isn't pedantry. The environment is meant for learning, and the costliest
mistake here is a student writing a program that works in the browser but
behaves differently on a real Lilka. That's why the emulator is ported from
the firmware line by line, including quirks that look like bugs.

## What it does

- **Lua 5.4** with the firmware's lifecycle: `init` / `update(delta)` / `draw`, 30 fps
- **280×240 screen** in RGB565 — primitives ported from `Arduino_GFX`, no Canvas 2D
- **Fonts** `u8g2_font_*_t_cyrillic`, all nine, with Cyrillic letters
- **Images** BMP and PNG, transforms, anchor point, transparent color
- **File system** `/sd`, `/spiffs`, `/tmp` persisted between sessions —
  both firmware namespaces, `fs.*` and the older `sdcard.*`
- **Sound** via WebAudio, with the same notes as the firmware
- **Buttons** from keyboard or mouse, with `just_pressed` semantics matching hardware
- **Export to card** — as an archive or written straight into a folder
- **Editor** with Lua syntax highlighting and autocompletion from 253 hints
- **Run on a real Lilka** over USB, plus a console for one-off commands
- **English and Ukrainian interface**, detected from the browser and switchable live
- **Widgets** `alertUI`, `keyboardUI` (with a Ukrainian layout), `progressUI`

Lua API coverage: **118 of 181 functions**; within scope — 118 of 119 (99%).
Missing: `audio.play` — playing audio files.
The rest of the gap is hardware namespaces that will never exist in a
browser: `gpio`, `spi`, `wifi`, `mqtt`, and others.

The best measure isn't the percentage — it's that real programs run without
edits. Bundled as examples: **Asteroids**, with four modules via `require`
and sixteen resources; **Snake**, with a high-score table via `state`; the
official `examples/LUA/cat`; and the community games "Dice" and "Repeat the
pattern".

## What's still missing

Importing and exporting via GitHub. See Issues.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:5173 — open in Chrome
```

Chrome is required because Lua runs in a Web Worker with `SharedArrayBuffer`,
which needs COOP/COEP headers. Locally these come from the Vite dev server;
in production, from `coi-serviceworker`. Firefox and Safari support them too,
but the environment hasn't been tested there yet.

All generated files are already in the repository — nothing to catch up on.

```bash
npm run check      # 124 automated checks
npm run build      # tsc --noEmit + vite build -> dist/
npm run test:e2e   # Playwright: does the editor work in a real browser
```

`test:e2e` needs a browser the first time: `npx playwright install chromium`.

<details>
<summary>Other commands</summary>

```bash
npm run check:primitives # geometry
npm run check:fonts      # fonts
npm run check:images     # raster and transforms
npm run check:vfs        # file system
npm run check:completions # autocompletion
npm run check:widgets    # UI widgets
npm run check:runtime    # Lua runtime
npm run gen:api          # regenerate lilka-api.json from keira
npm run gen:fonts        # regenerate fonts (pulls ~40 MB of source, cached)
npm run gen:fmath        # sine tables
npm run gen:notes        # note table
npm run gen:completions  # editor hints from firmware annotations
npm run gen:icons        # keyboard icons
npm run gen:coverage     # API coverage report
npm run render:testcard  # test-card PNG without a browser
```

Scripts ending in `.mts` run via `node --experimental-strip-types`, so
**Node 22+** is required.

</details>

## Deployment

`.github/workflows/deploy.yml` type-checks, runs `npm run check`, and only
then builds and publishes to GitHub Pages — broken code never reaches it.
`VITE_BASE` is filled in from the repository name automatically.

`.github/workflows/ci.yml` does the same plus `npm run test:e2e` and `npm run
build` — on every pull request and every push to `main`. Without it a PR
could be merged without any automated check at all: `deploy.yml` doesn't
react to pull requests.

`public/coi-serviceworker.js` must stay a separate file outside the bundle,
served from its own origin — otherwise there's no `SharedArrayBuffer`, and
without it the runtime won't start.

---

## How it all works

In short: Lua runs in a Web Worker and writes pixels straight into a
`SharedArrayBuffer`; the main thread only presents them on a canvas. The
worker sets the pace — 30 fps at a flat 33 ms, like `perfectDelta` in the
firmware.

Details, diagrams, and the reasoning behind it all — in
**[ARCHITECTURE.md](ARCHITECTURE.md)**. That's also where the catalog of
deliberately reproduced hardware quirks lives.

Rules for working with the code (including via AI) — in [CLAUDE.md](CLAUDE.md)
(Ukrainian; it's the project's internal contributor/AI convention document).

## Contributing

The most useful thing right now is **bringing real Lilka programs** and
checking whether they run. Every such attempt so far has found something:
that's how a missing `buzzer`, an unknown `notes` table, and namespaces that
turned out to be `userdata` instead of tables were found.

If a program doesn't run — **[file an Issue](https://github.com/sverdlyuk/lilka-web-ide/issues/new)**.
The cause could be the emulator (the most interesting case), the program
itself, or a capability that's fundamentally unreachable in a browser — like
networking or GPIO pins. Either way, it's worth digging into.

What to attach to the Issue:

- the program's code or a link to it
- the message from the environment's console, if there is one
- what should have happened and what happened instead

---

## Sources and licenses of third-party parts

| What | From | License |
|---|---|---|
| Raster primitives | `moononournation/Arduino_GFX` | BSD-3-Clause |
| `t_cyrillic` font data | `olikraus/u8g2` | BSD-2-Clause |
| Sine tables, pins, constants | `lilka-dev/sdk`, `lilka-dev/keira` | MIT |
| Lua runtime | `wasmoon` | MIT |
| COOP/COEP | `coi-serviceworker` | MIT |
| Examples | Lilka community programs | with authors' permission |

Fonts and primitives weren't copied as files: they're generated by `gen-*`
scripts from the source. But the derived data lives in the repository, so
attribution is worth keeping.

## License

GPL-2.0-or-later.
