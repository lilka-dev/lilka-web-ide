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

/*
 * Обчислення редактора картинок.
 *
 * Канви під Node немає, тож саме малювання перевіряється очима в браузері. Але
 * помилки живуть не в `drawImage`, а в арифметиці навколо нього — округленні
 * пропорцій і заганянні рамки в межі. Саме вона й перевіряється тут.
 */
{
    const edit = await import('../src/emulator/image-edit.ts');

    // Поворот на 90° міняє сторони місцями
    const rotated = edit.rotatedSize(256, 64);
    ok(rotated.width === 64 && rotated.height === 256, `поворот міняє сторони: ${rotated.width}×${rotated.height}`);

    // Пропорція: квадрат лишається квадратом
    ok(edit.scaledSide(96, 96, 192) === 192, 'подвоєння квадрата');

    // Неточна пропорція округлюється до найближчого, а не відкидається
    ok(edit.scaledSide(50, 100, 75) === 38, `50 при 100→75 дає 38, а не 37: ${edit.scaledSide(50, 100, 75)}`);

    // Найтонша картинка не зникає: щонайменше піксель
    ok(edit.scaledSide(3, 100, 10) === 1, `дуже тонка сторона лишається 1: ${edit.scaledSide(3, 100, 10)}`);

    // Прилипання до цілої кратності — щоб піксель-арт не сходинкував
    ok(edit.nearestWholeScale(96, 190) === 2, 'майже подвоєння прилипає до ×2');
    ok(edit.nearestWholeScale(96, 48) === 0.5, 'майже половина прилипає до ½');
    ok(edit.nearestWholeScale(96, 150) === null, 'проміжний масштаб не прилипає');

    // Рамка обрізання не виїжджає за межі картинки
    const out = edit.clampCrop({ x: -10, y: -10, width: 999, height: 999 }, 64, 48);
    ok(
        out.x === 0 && out.y === 0 && out.width === 64 && out.height === 48,
        `рамка заганяється в межі: ${out.x},${out.y} ${out.width}×${out.height}`,
    );

    // Рамка біля правого краю вкорочується, а не вилазить
    const edge = edit.clampCrop({ x: 60, y: 40, width: 30, height: 30 }, 64, 48);
    ok(edge.width === 4 && edge.height === 8, `рамка біля краю вкорочується: ${edge.width}×${edge.height}`);

    // Порожньої рамки не буває
    const tiny = edit.clampCrop({ x: 10, y: 10, width: 0, height: -5 }, 64, 48);
    ok(tiny.width === 1 && tiny.height === 1, `найменша рамка — піксель: ${tiny.width}×${tiny.height}`);

    // Результат завжди PNG, хоч би яким був первотвір
    ok(edit.pngName('ship.bmp') === 'ship.png', 'BMP стає PNG');
    ok(edit.pngName('photo.jpg') === 'photo.png', 'JPEG стає PNG');
    ok(edit.pngName('no-extension') === 'no-extension.png', 'файл без розширення теж');
}

/*
 * Піксельний редактор.
 *
 * Головне — полотно не може містити того, чого залізо не покаже: колір
 * зводиться до RGB565, альфа — до одного біта, як у `loadImagePNG`. І
 * збереження мусить бути без втрат: PNG із полотна прочитається прошивкою
 * рівно тими самими значеннями.
 */
{
    const art = await import('../src/emulator/pixel-art.ts');
    const { imageFromRgba } = await import('../src/emulator/image-loader.ts');

    // Усі 65536 кольорів переживають збереження в RGBA і читання прошивкою
    const all = art.createPixels(256, 256);
    for (let i = 0; i < 0x10000; i++) all.pixels[i] = i;
    all.pixels[123] = art.TRANSPARENT;
    const rgba = art.toRgba(all);
    const back = art.fromRgba(rgba, 256, 256);
    let lost = 0;
    for (let i = 0; i < 0x10000; i++) if (back.pixels[i] !== all.pixels[i]) lost++;
    ok(lost === 0, `полотно → RGBA → полотно без втрат: розбіжностей ${lost}`);

    // І те саме читає порт loadImagePNG: прозорий стає transparentColor
    const loaded = imageFromRgba(rgba, 256, 256, { transparentColor: 0x1234 });
    ok(loaded.pixels[0xf800] === 0xf800 && loaded.pixels[123] === 0x1234, 'PNG із редактора прошивка читає тими самими кольорами');

    // Напівпрозорість, як у прошивці: лише alpha == 0 прозоре
    const semi = art.fromRgba(new Uint8Array([255, 0, 0, 1, 0, 255, 0, 0]), 2, 1);
    ok(semi.pixels[0] === 0xf800 && semi.pixels[1] === art.TRANSPARENT, 'alpha 1 — непрозоро, alpha 0 — прозоро');

    ok(art.hexTo565('#ff0000') === 0xf800, 'червоний #ff0000 — 0xF800');
    ok(art.hexTo565('#070307') === 0x0000, 'відтінок, якого Лілка не розрізнить, стає чорним');
    ok(art.luaHex(0x1f) === '0x001F', `запис для Lua: ${art.luaHex(0x1f)}`);

    // Лінія включає обидва кінці й не має розривів
    const line = art.createPixels(8, 8);
    art.drawLine(line, 0, 0, 7, 3, 1);
    const painted = [...line.pixels].filter((value) => value === 1).length;
    ok(painted === 8 && art.getPixel(line, 0, 0) === 1 && art.getPixel(line, 7, 3) === 1, `лінія 8 пікселів з кінцями: ${painted}`);

    // Лінія за межами полотна не падає і не пише за край
    const edge = art.createPixels(4, 4);
    art.drawLine(edge, -5, 1, 10, 1, 2);
    ok([...edge.pixels].filter((value) => value === 2).length === 4, 'лінія за край обрізається');

    // Прямокутник у будь-якому порядку кутів
    const rect = art.createPixels(6, 6);
    art.drawRect(rect, 4, 4, 1, 1, 3, false);
    ok([...rect.pixels].filter((value) => value === 3).length === 12 && art.getPixel(rect, 2, 2) === art.TRANSPARENT, 'контур 4×4 — 12 пікселів, середина порожня');
    art.drawRect(rect, 1, 1, 4, 4, 3, true);
    ok([...rect.pixels].filter((value) => value === 3).length === 16, 'зафарбований 4×4 — 16 пікселів');

    // Заливка не просочується крізь діагональ — чотири сусіди, а не вісім
    const fill = art.createPixels(5, 5);
    for (let i = 0; i < 5; i++) art.setPixel(fill, i, 4 - i, 7);
    art.floodFill(fill, 0, 0, 9);
    ok(art.getPixel(fill, 0, 0) === 9 && art.getPixel(fill, 4, 4) === art.TRANSPARENT, 'заливка зупиняється на діагоналі');

    // Заливка великого полотна не переповнює стек
    const big = art.createPixels(art.MAX_SIDE, art.MAX_SIDE);
    art.floodFill(big, 0, 0, 5);
    ok(big.pixels.every((value) => value === 5), 'заливка 1024×1024 без переповнення стека');

    // Історія: скасування й повтор повертають точно ті самі пікселі
    const canvas = art.createPixels(3, 3);
    const history = new art.History();
    history.push(canvas);
    art.setPixel(canvas, 1, 1, 0xffff);
    history.undo(canvas);
    ok(art.getPixel(canvas, 1, 1) === art.TRANSPARENT && history.canRedo, 'скасування повертає стан');
    history.redo(canvas);
    ok(art.getPixel(canvas, 1, 1) === 0xffff, 'повтор повертає зміну');
    history.push(canvas);
    ok(!history.canRedo, 'нова зміна обриває гілку повтору');
}

console.log(fails === 0 ? '✔ зображення: усі перевірки пройдено' : `✖ зображення: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
