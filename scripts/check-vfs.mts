/**
 * Перевірки файлової системи та завантаження зображень.
 *
 * Особливу увагу приділено квіркам прошивки: якщо котрийсь із них раптом
 * «виправлять», зламається саме тут.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Vfs, joinPath, normalizePath, MOUNT_POINTS } from '../src/emulator/vfs.ts';
import { loadImageBMP, detectFormat, imageFromRgba } from '../src/emulator/image-loader.ts';
import { color565 } from '../src/emulator/color.ts';
import { NO_TRANSPARENT_COLOR } from '../src/emulator/image.ts';
import { inspectImage } from '../src/emulator/image-info.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

// 1. Корінь — плаский перелік монтувань, лише читання (порт RootVFS)
{
    const vfs = new Vfs();
    ok(vfs.list('/').join(',') === 'sd,spiffs,tmp', `корінь: ${vfs.list('/').join(',')}`);
    ok(vfs.stat('/')?.isDirectory === true, 'корінь — каталог');
    let threw = false;
    try {
        vfs.mkdir('/games');
    } catch {
        threw = true;
    }
    ok(threw, 'створення в корені заборонене, як і в первотворі');
}

// 2. Три монтування, і /tmp серед них
{
    ok(MOUNT_POINTS.join(',') === '/sd,/spiffs,/tmp', 'монтування як у registerFileSystems()');
}

// 3. joinPath — порт FileUtils::joinPath
{
    ok(joinPath('/sd', 'a.txt') === '/sd/a.txt', 'joinPath додає роздільник');
    ok(joinPath('/sd/', '/a.txt') === '/sd/a.txt', 'joinPath не подвоює роздільник');
    ok(joinPath('', 'a.txt') === 'a.txt', 'порожній лівий шлях');
}

// 4. Запис, читання, перелік, вкладені каталоги
{
    const vfs = new Vfs();
    vfs.write('/sd/games/cat/cat.lua', new TextEncoder().encode('print("hi")'));
    ok(vfs.exists('/sd/games/cat/cat.lua'), 'файл існує після запису');
    ok(vfs.exists('/sd/games/cat'), 'проміжні каталоги створені');
    ok(vfs.list('/sd').join(',') === 'games', `перелік /sd: ${vfs.list('/sd').join(',')}`);
    ok(vfs.list('/sd/games/cat').join(',') === 'cat.lua', 'перелік вкладеного каталогу');
    ok(vfs.stat('/sd/games/cat/cat.lua')?.size === 11, 'розмір файлу');
}

// 5. Перейменування між монтуваннями
{
    const vfs = new Vfs();
    vfs.write('/tmp/a.txt', new Uint8Array([1, 2, 3]));
    ok(vfs.rename('/tmp/a.txt', '/sd/b.txt'), 'перенесення між монтуваннями');
    ok(!vfs.exists('/tmp/a.txt') && vfs.exists('/sd/b.txt'), 'старого немає, новий є');
}

// 6. normalizePath прибирає зайве
{
    ok(normalizePath('/sd//games/./cat') === '/sd/games/cat', 'подвійні риски й крапка');
    ok(normalizePath('/sd/games/../x') === '/sd/x', 'дві крапки піднімають рівень');
}

// 7. Формат визначається за ПІДПИСОМ, а не за розширенням
{
    ok(detectFormat(new Uint8Array([0x42, 0x4d, 0, 0])) === 'bmp', 'підпис BM');
    ok(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47])) === 'png', 'підпис PNG');
    ok(detectFormat(new Uint8Array([1, 2, 3, 4])) === 'unknown', 'невідомий підпис');
}

// 8. Справжній BMP із прикладу: значення пікселів звірені окремим розрахунком
{
    const bytes = new Uint8Array(readFileSync(join(root, 'src/examples/cat/no.bmp')));
    const image = loadImageBMP(bytes);
    ok(image.width === 280 && image.height === 240, `розмір ${image.width}x${image.height}`);

    // Очікувані значення пораховані незалежно, прямо з байтів файлу
    const expected: Array<[number, number, number]> = [
        [0, 0, 0xffff],
        [139, 119, 0xf7bf],
        [279, 239, 0x69a1],
        [50, 200, 0x69a1],
        [200, 50, 0xffff],
    ];
    for (const [x, y, want] of expected) {
        const got = image.pixels[y * image.width + x];
        ok(got === want, `піксель (${x},${y}) = 0x${got.toString(16)}, очікувалось 0x${want.toString(16)}`);
    }
}

// 9. КВІРК: альфа в BMP відкидається, у PNG — враховується
{
    // 32-бітний BMP: піксель повністю прозорий (alpha = 0), але колір лишається
    const width = 1;
    const height = 1;
    const bytes = new Uint8Array(138 + 4);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    new DataView(bytes.buffer).setUint32(10, 138, true); // зміщення даних
    new DataView(bytes.buffer).setUint32(18, width, true);
    new DataView(bytes.buffer).setUint32(22, height, true);
    new DataView(bytes.buffer).setUint16(28, 32, true);
    bytes.set([0, 0, 255, 0], 138); // BGRA: червоний, альфа 0

    const bmp = loadImageBMP(bytes, { transparentColor: 0x1234 });
    ok(bmp.pixels[0] === color565(255, 0, 0), `BMP ігнорує альфу: 0x${bmp.pixels[0].toString(16)}`);

    const png = imageFromRgba(new Uint8Array([255, 0, 0, 0]), 1, 1, { transparentColor: 0x1234 });
    ok(png.pixels[0] === 0x1234, `PNG враховує альфу: 0x${png.pixels[0].toString(16)}`);
}

// 10. КВІРК: BMP «згори вниз» (від'ємна висота) не завантажується взагалі
{
    const bytes = new Uint8Array(138 + 4);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    const view = new DataView(bytes.buffer);
    view.setUint32(10, 138, true);
    view.setUint32(18, 1, true);
    view.setInt32(22, -1, true); // від'ємна висота
    view.setUint16(28, 32, true);

    let threw = false;
    try {
        loadImageBMP(bytes);
    } catch {
        threw = true;
    }
    ok(threw, 'BMP «згори вниз» відхиляється, як і на залізі');
}

// 11. КВІРК: немає вирівнювання рядків на 4 байти.
//     24-бітний BMP шириною 3 має рядок 9 байтів, вирівняний до 12.
//     Прошивка читає 9 — і другий рядок «їде». Емулятор має їхати так само.
{
    const width = 3;
    const height = 2;
    const bytes = new Uint8Array(138 + 24);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    const view = new DataView(bytes.buffer);
    view.setUint32(10, 138, true);
    view.setUint32(18, width, true);
    view.setUint32(22, height, true);
    view.setUint16(28, 24, true);

    // нижній рядок: три сині пікселі, далі 3 байти вирівнювання
    bytes.set([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0], 138);
    // верхній рядок: три зелені
    bytes.set([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0], 150);

    const image = loadImageBMP(bytes);
    const blue = color565(0, 0, 255);
    const green = color565(0, 255, 0);
    // Через відсутність вирівнювання верхній рядок читається зі зсувом на 3
    // байти й НЕ буде чисто зеленим — це і є відтворений дефект
    const topRow = [image.pixels[0], image.pixels[1], image.pixels[2]];
    ok(
        image.pixels[width] === blue && image.pixels[width + 1] === blue,
        'нижній рядок прочитано правильно',
    );
    ok(
        !(topRow[0] === green && topRow[1] === green && topRow[2] === green),
        'верхній рядок «їде» — вирівнювання рядків не виконується, як і в прошивці',
    );
}

// 12. Точка привʼязки за замовчуванням 0,0 — попри те, що документація каже «центр»
{
    const bytes = new Uint8Array(readFileSync(join(root, 'src/examples/cat/no.bmp')));
    const image = loadImageBMP(bytes);
    ok(image.pivotX === 0 && image.pivotY === 0, 'pivot за замовчуванням 0,0');
    ok(image.transparentColor === NO_TRANSPARENT_COLOR, 'прозорого кольору за замовчуванням немає');
}

// 13. Переміщення теки переносить увесь вміст
{
    const vfs = new Vfs();
    vfs.write('/sd/ігри/кіт/main.lua', new Uint8Array([1]));
    vfs.write('/sd/ігри/кіт/cat.bmp', new Uint8Array([2]));
    ok(vfs.movePath('/sd/ігри/кіт', '/sd/кіт'), 'тека переміщується');
    ok(vfs.exists('/sd/кіт/main.lua') && vfs.exists('/sd/кіт/cat.bmp'), 'вміст переїхав');
    ok(!vfs.exists('/sd/ігри/кіт/main.lua'), 'на старому місці порожньо');
}

// 14. Тека не може переїхати сама в себе
{
    const vfs = new Vfs();
    vfs.write('/sd/ігри/рівні/a.txt', new Uint8Array([1]));
    ok(!vfs.movePath('/sd/ігри', '/sd/ігри/рівні/ігри'), 'переміщення в себе відхилено');
    ok(vfs.exists('/sd/ігри/рівні/a.txt'), 'вміст на місці після відмови');
}

// 15. Перелік тек для вікна переміщення
{
    const vfs = new Vfs();
    vfs.mkdir('/sd/ігри');
    vfs.mkdir('/sd/ігри/кіт');
    vfs.write('/sd/герой.png', new Uint8Array([1]));
    const dirs = vfs.allDirectories('/sd');
    ok(dirs.join(',') === '/sd/ігри,/sd/ігри/кіт', `лише теки: ${dirs.join(',')}`);
}

// 16. Розпізнавання пасток прошивки в картинках
{
    const makeBmp = (width: number, height: number, bpp: number, alpha?: number[]) => {
        const rowSize = Math.ceil((width * (bpp >> 3)) / 4) * 4;
        const bytes = new Uint8Array(138 + rowSize * Math.abs(height));
        bytes[0] = 0x42;
        bytes[1] = 0x4d;
        const view = new DataView(bytes.buffer);
        view.setUint32(10, 138, true);
        view.setUint32(18, width, true);
        view.setInt32(22, height, true);
        view.setUint16(28, bpp, true);
        if (alpha) {
            for (let i = 0; i < alpha.length; i++) bytes[138 + i * 4 + 3] = alpha[i];
        }
        return bytes;
    };

    ok(inspectImage(makeBmp(2, -2, 32))?.problems.includes('top-down'), 'BMP «догори низом» розпізнано');
    ok(inspectImage(makeBmp(2000, 10, 32))?.problems.includes('too-large'), 'завелика картинка розпізнана');
    ok(inspectImage(makeBmp(3, 2, 24))?.problems.includes('row-padding'), 'ширина не кратна 4 розпізнана');

    // Альфа «використовується» лише коли є і прозорі, і непрозорі пікселі:
    // суцільні нулі — це просто невикористаний канал, і переводити такий файл
    // у PNG не можна, бо він став би цілком невидимим
    ok(
        inspectImage(makeBmp(2, 2, 32, [0, 255, 255, 255]))?.problems.includes('alpha-lost'),
        'справжня прозорість розпізнана',
    );
    ok(
        !inspectImage(makeBmp(2, 2, 32, [0, 0, 0, 0]))?.problems.includes('alpha-lost'),
        'суцільні нулі в альфі не вважаються прозорістю',
    );
}

// 17. Справжній BMP із прикладу не має жодної проблеми
{
    const info = inspectImage(new Uint8Array(readFileSync(join(root, 'src/examples/cat/no.bmp'))));
    ok(info?.problems.length === 0, `cat/no.bmp без зауважень: ${info?.problems.join(',')}`);
    ok(info?.width === 280 && info?.height === 240, 'розміри визначено правильно');
}

console.log(fails === 0 ? '✔ файлова система: усі перевірки пройдено' : `✖ файлова система: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
