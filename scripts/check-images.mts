/**
 * Перевірки растрового шару та перетворень.
 *
 * Тут важливі не «гарні» результати, а збіг із поведінкою прошивки —
 * включно з тією, що виглядає як помилка.
 */

import { Framebuffer } from '../src/emulator/framebuffer.ts';
import { Image, NO_TRANSPARENT_COLOR } from '../src/emulator/image.ts';
import { Transform } from '../src/emulator/transform.ts';
import { DisplaySurface } from '../src/emulator/surface.ts';
import { color565 } from '../src/emulator/color.ts';
import { fCos360, fSin360 } from '../src/emulator/fmath.ts';

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

const RED = color565(255, 0, 0);
const BLUE = color565(0, 0, 255);
const KEY = color565(255, 0, 255);

/** Однотонний квадрат зі заданою точкою привʼязки. */
function solid(size: number, color: number, transparent = NO_TRANSPARENT_COLOR, pivot = 0): Image {
    const img = new Image(size, size, transparent, pivot, pivot);
    img.pixels.fill(color);
    return img;
}

// 1. Точка привʼязки: draw_image кладе в (x, y) саме pivot, а не кут
{
    const fb = new Framebuffer(32, 32);
    const img = solid(8, RED, NO_TRANSPARENT_COLOR, 4);
    fb.drawImage(img, 16, 16);
    ok(fb.getPixel(12, 12) === RED, 'pivot: лівий верхній кут має бути в (12,12)');
    ok(fb.getPixel(19, 19) === RED, 'pivot: правий нижній кут має бути в (19,19)');
    ok(fb.getPixel(11, 12) === 0 && fb.getPixel(20, 19) === 0, 'pivot: за межами нічого не намальовано');
}

// 2. Прозорий колір не записується
{
    const fb = new Framebuffer(16, 16);
    fb.fillScreen(BLUE);
    const img = new Image(4, 4, KEY);
    img.pixels.fill(KEY);
    img.pixels[0] = RED;
    fb.drawImage(img, 0, 0);
    ok(fb.getPixel(0, 0) === RED, 'прозорість: непрозорий піксель записано');
    ok(fb.getPixel(1, 0) === BLUE, 'прозорість: прозорий піксель не записано');
}

// 3. Відсікання за межами буфера не має падати й не має «загортатися»
{
    const fb = new Framebuffer(8, 8);
    const img = solid(6, RED);
    fb.drawImage(img, -3, -3);
    ok(fb.getPixel(0, 0) === RED && fb.getPixel(2, 2) === RED, 'відсікання: видима частина намальована');
    ok(fb.getPixel(3, 3) === 0, 'відсікання: решта не зачеплена');
    fb.fillScreen(0);
    fb.drawImage(img, 6, 6);
    ok(fb.getPixel(7, 7) === RED && fb.getPixel(0, 7) === 0, 'відсікання: правий край без загортання');
}

// 4. Перетворення на 0 градусів = звичайне малювання
{
    const img = solid(9, RED, KEY, 4);
    const a = new Framebuffer(32, 32);
    const b = new Framebuffer(32, 32);
    a.drawImage(img, 16, 16);
    b.drawImageTransformed(img, 16, 16, new Transform());
    ok(a.pixels.every((p, i) => p === b.pixels[i]), 'transform(одиничне) == draw_image');
}

// 5. ОСОБЛИВІСТЬ ПРОШИВКИ: обертання без прозорого кольору дає білі кути.
//    Поза межами джерела пишеться transparentColor = -1, а це 0xFFFF.
{
    const fb = new Framebuffer(64, 64);
    fb.drawImageTransformed(solid(20, RED, NO_TRANSPARENT_COLOR, 10), 32, 32, new Transform().rotate(45));
    let white = 0;
    for (const p of fb.pixels) if (p === 0xffff) white++;
    ok(white > 0, 'особливість: обертання без прозорого кольору мусить давати білі кути (0xFFFF)');
}

// 6. Та сама операція з прозорим кольором білих кутів НЕ дає
{
    const fb = new Framebuffer(64, 64);
    fb.drawImageTransformed(solid(20, RED, KEY, 10), 32, 32, new Transform().rotate(45));
    let white = 0;
    for (const p of fb.pixels) if (p === 0xffff) white++;
    ok(white === 0, 'з прозорим кольором білих кутів бути не має');
}

// 7. Тригонометрія — з таблиць прошивки, не з Math.sin
{
    ok(fSin360(30) === Math.fround(0.5), `fSin360(30) = ${fSin360(30)}, очікується float(0.5)`);
    ok(fCos360(0) === 1 && fSin360(0) === 0, 'fSin360(0) = 0, fCos360(0) = 1');
    ok(fSin360(-90) === -1, `fSin360(-90) = ${fSin360(-90)}, очікується -1`);
    ok(fSin360(370) === fSin360(10), 'кут за межами 360 приводиться до діапазону');
    // Таблиця має шість знаків, тому вона НЕ дорівнює Math.sin — це і перевіряємо
    ok(fSin360(1) !== Math.sin(Math.PI / 180), 'таблиця свідомо відрізняється від Math.sin');
}

// 8. Обертання зображення: 0 градусів нічого не змінює, 360 теж
{
    const img = solid(7, RED, NO_TRANSPARENT_COLOR);
    img.pixels[0] = BLUE;
    ok(img.rotate(0, 0).pixels.every((p, i) => p === img.pixels[i]), 'rotate(0) не змінює зображення');
    ok(img.rotate(360, 0).pixels.every((p, i) => p === img.pixels[i]), 'rotate(360) не змінює зображення');
}

// 9. Дзеркалення двічі повертає початкове зображення
{
    const img = new Image(5, 4);
    for (let i = 0; i < img.pixels.length; i++) img.pixels[i] = i + 1;
    ok(img.flipX().flipX().pixels.every((p, i) => p === img.pixels[i]), 'flipX двічі == початкове');
    ok(img.flipY().flipY().pixels.every((p, i) => p === img.pixels[i]), 'flipY двічі == початкове');
    ok(img.flipX().pixels[0] === 5, 'flipX справді дзеркалить рядок');
}

// 10. Подвійна буферизація: кадр видно лише після queue_draw
{
    const surface = new DisplaySurface(280, 240, { x: 0, y: 24, width: 280, height: 216 });
    surface.canvas.fillScreen(RED);
    ok(surface.present() === false, 'без queue_draw переносити нічого');
    ok(surface.display.getPixel(0, 24) === 0, 'до queue_draw екран не змінено');

    surface.queueDraw();
    ok(surface.present() === true, 'після queue_draw кадр готовий');
    ok(surface.display.getPixel(0, 24) === RED, 'кадр перенесено зі зсувом y = 24');
    ok(surface.display.getPixel(0, 23) === 0, 'смуга статусбару не зачеплена');
    ok(surface.frame === 1, 'номер кадру збільшився');

    // обмін буферів: після queue_draw програма малює в ІНШИЙ буфер
    surface.canvas.fillScreen(BLUE);
    surface.queueDraw();
    surface.present();
    ok(surface.display.getPixel(0, 24) === BLUE, 'другий кадр перенесено');

    // пропущений кадр: два queue_draw без present
    const before = surface.skippedFrames;
    surface.queueDraw();
    surface.queueDraw();
    ok(surface.skippedFrames === before + 1, 'пропущений кадр зафіксовано');
}

// 11. Обмін буферів справді повертає кадр, що був два кадри тому
{
    const surface = new DisplaySurface(16, 16, { x: 0, y: 0, width: 16, height: 16 });
    surface.canvas.fillScreen(RED);
    surface.queueDraw();
    surface.canvas.fillScreen(BLUE);
    surface.queueDraw();
    ok(surface.canvas.getPixel(0, 0) === RED, 'програма малює поверх кадру, що був два кадри тому');
}

console.log(fails === 0 ? '✔ зображення: усі перевірки пройдено' : `✖ зображення: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
