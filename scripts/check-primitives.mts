import { Framebuffer } from '../src/emulator/framebuffer.ts';
import { color565 } from '../src/emulator/color.ts';

const W = color565(255, 255, 255);
let fails = 0;
const ok = (cond: boolean, msg: string) => { if (!cond) { console.log('  ✖', msg); fails++; } };

// 1. Горизонтальна лінія: рівно задана довжина, без "витікання"
let fb = new Framebuffer(64, 32);
fb.drawLine(10, 5, 20, 5, W);
ok(fb.getPixel(9, 5) === 0 && fb.getPixel(21, 5) === 0, 'HLine не виходить за межі');
let n = 0; for (let x = 0; x < 64; x++) if (fb.getPixel(x, 5) === W) n++;
ok(n === 11, `HLine 10..20 = 11 пікселів (отримано ${n})`);

// 2. Симетрія кола
fb = new Framebuffer(64, 64);
fb.drawCircle(32, 32, 20, W);
let asym = 0;
for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
  if (fb.getPixel(x, y) !== fb.getPixel(63 - x + (64 - 64), y)) { /* skip */ }
}
for (let y = 0; y < 64; y++) for (let dx = 0; dx <= 20; dx++) {
  if (fb.getPixel(32 - dx, y) !== fb.getPixel(32 + dx, y)) asym++;
}
ok(asym === 0, `коло симетричне по X (розбіжностей: ${asym})`);

// 3. Заповнене коло не має дірок у центральному рядку
fb = new Framebuffer(64, 64);
fb.fillCircle(32, 32, 15, W);
let run = 0; for (let x = 0; x < 64; x++) if (fb.getPixel(x, 32) === W) run++;
ok(run === 31, `fillCircle r=15 центральний рядок = 31 (отримано ${run})`);

// 4. Відсікання від'ємних розмірів у fillRect
fb = new Framebuffer(16, 16);
fb.fillRect(10, 10, -6, -6, W);
ok(fb.getPixel(5, 5) === W && fb.getPixel(11, 11) === 0, 'fillRect з від\'ємними w/h');

// 5. Трикутник: цілочисельне ділення до нуля (а не floor)
fb = new Framebuffer(32, 32);
fb.fillTriangle(2, 2, 29, 8, 10, 29, W);
let filled = 0; for (const p of fb.pixels) if (p === W) filled++;
ok(filled > 200 && filled < 400, `fillTriangle площа розумна (${filled})`);

// 6. fillScreen задає рівно один колір
fb = new Framebuffer(8, 8);
fb.fillScreen(0x1234);
ok(new Set(fb.pixels).size === 1 && fb.getPixel(7, 7) === 0x1234, 'fillScreen');

// 7. color565 відповідає Arduino_GFX
ok(color565(255, 0, 0) === 63488, `color565(255,0,0) = 63488 (документація Лілки), отримано ${color565(255,0,0)}`);
ok(color565(0, 0, 0) === 0 && color565(255, 255, 255) === 0xffff, 'чорний і білий точні');

console.log(fails === 0 ? '✔ усі перевірки пройдено' : `✖ ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
