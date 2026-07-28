/**
 * Перевірки віджетів.
 *
 * Найважливіше тут — розкладка клавіатури: 6 шарів по 48 клітинок, і кожна
 * має відповідати первотвору. Помилка в одній клітинці означає, що літера в
 * браузері й на залізі опиниться в різних місцях.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Framebuffer } from '../src/emulator/framebuffer.ts';
import { Alert, ProgressDialog, InputDialog } from '../src/emulator/widgets.ts';
import { fontFromJson, type FontJson, type Font } from '../src/emulator/font.ts';
import { KEYBOARD_ICONS } from '../src/generated/icons.ts';
import type { ButtonSnapshot } from '../src/runtime/device.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const board = JSON.parse(readFileSync(join(root, 'src/generated/board.json'), 'utf8'));
const fontCache = new Map<string, Font>();
for (const f of board.fonts) {
    fontCache.set(
        f.name,
        fontFromJson(JSON.parse(readFileSync(join(root, 'src/generated/fonts', `${f.name}.json`), 'utf8')) as FontJson),
    );
}
const fonts = (name: string): Font => {
    const font = fontCache.get(name);
    if (!font) throw new Error(`Немає шрифту ${name}`);
    return font;
};

let fails = 0;
const ok = (cond: boolean, msg: string) => {
    if (!cond) {
        console.log('  ✖', msg);
        fails++;
    }
};

const idle = (): Record<string, ButtonSnapshot> => {
    const state: Record<string, ButtonSnapshot> = {};
    for (const name of ['up', 'down', 'left', 'right', 'a', 'b', 'c', 'd', 'select', 'start']) {
        state[name] = { pressed: false, just_pressed: false, just_released: false };
    }
    return state;
};
const press = (button: string) => {
    const state = idle();
    state[button] = { pressed: true, just_pressed: true, just_released: false };
    return state;
};

const W = board.boards.v2.display.width;
const H = board.boards.v2.display.height;

// 1. Alert від початку реагує на A — конструктор додає її сам
{
    const alert = new Alert('Заголовок', 'Повідомлення');
    alert.update(press('a'));
    ok(alert.isFinished(), 'A завершує Alert без addActivationButton');
    ok(alert.getButton() === 'a', `getButton = ${alert.getButton()}`);
}

// 2. isFinished скидає прапорець при читанні — це не геттер
{
    const alert = new Alert('t', 'm');
    alert.update(press('a'));
    ok(alert.isFinished() === true, 'перший виклик — true');
    ok(alert.isFinished() === false, 'другий виклик — false, прапорець скинуто');
}

// 3. Додаткова кнопка активації
{
    const alert = new Alert('t', 'm');
    alert.addActivationButton('start');
    alert.update(press('start'));
    ok(alert.isFinished() && alert.getButton() === 'start', 'START завершує після addActivationButton');
    alert.addActivationButton('start');
    alert.update(press('b'));
    ok(!alert.isFinished(), 'кнопка поза переліком не завершує');
}

// 4. Геометрія вікна: восьмі частини екрана
{
    const fb = new Framebuffer(W, H);
    const alert = new Alert('Заголовок', 'Текст');
    alert.draw(fb, fonts);

    const left = Math.trunc(W / 8);
    const top = Math.trunc(H / 8);
    const mid = top * 2;

    ok(fb.getPixel(left + 2, top + 2) === 0x18ce, 'смуга заголовка — Midnight_blue');
    ok(fb.getPixel(left + 2, mid + 2) === 0x230c, `тіло — color565(32,96,96) = 0x230c, отримано 0x${fb.getPixel(left + 2, mid + 2).toString(16)}`);
    ok(fb.getPixel(left - 2, top + 2) === 0, 'ліворуч від вікна нічого не намальовано');
}

// 5. Смуга поступу: заповнена частина пропорційна відсотку
{
    const fb = new Framebuffer(W, H);
    const dialog = new ProgressDialog('Заголовок', 'Текст');
    dialog.setProgress(50);
    dialog.draw(fb, fonts);

    const left = Math.trunc(W / 8);
    const right = Math.trunc(W / 8) * 7;
    const bottom = Math.trunc(H / 8) * 7;
    const barMargin = 8;
    const barHeight = 8;
    const width = right - left;
    const barY = bottom - barMargin - barHeight + 2;

    const filledEnd = left + barMargin + Math.trunc(((width - barMargin * 2) * 50) / 100);
    ok(fb.getPixel(left + barMargin + 2, barY) === 0xfc60, 'заповнена частина — Dark_orange');
    ok(fb.getPixel(filledEnd + 4, barY) === 0x70e3, 'порожня частина — Persian_plum');
}

// 6. Набір символів: A додає символ під курсором
{
    const dialog = new InputDialog('Ім\'я');
    dialog.update(press('a'), 0);
    ok(dialog.getValue() === '!', `курсор на початку — це «!», отримано "${dialog.getValue()}"`);
    dialog.update(press('right'), 0);
    dialog.update(press('a'), 0);
    ok(dialog.getValue() === '!1', `після кроку праворуч — «1», отримано "${dialog.getValue()}"`);
}

// 7. Українська розкладка перемикається кнопкою D
{
    const dialog = new InputDialog('t');
    dialog.update(press('a'), 0);
    const english = dialog.getValue();
    dialog.setValue('');
    dialog.update(press('d'), 0);
    dialog.update(press('a'), 0);
    const ukrainian = dialog.getValue();
    ok(english !== ukrainian, `D міняє мову: "${english}" -> "${ukrainian}"`);
}

// 8. B стирає символ, і саме символ, а не байт
{
    const dialog = new InputDialog('t');
    dialog.setValue('їжак');
    dialog.update(press('b'), 0);
    ok(dialog.getValue() === 'їжа', `стирання UTF-8: "${dialog.getValue()}"`);
}

// 9. START завершує, і isFinished теж скидається
{
    const dialog = new InputDialog('t');
    dialog.update(press('start'), 0);
    ok(dialog.isFinished() === true, 'START завершує');
    ok(dialog.isFinished() === false, 'прапорець скинуто');
}

// 10. Маскування показує зірочки замість символів
{
    const fb = new Framebuffer(W, H);
    const dialog = new InputDialog('Пароль');
    dialog.setValue('abc');
    dialog.setMasked(true);
    dialog.draw(fb, fonts);
    let painted = 0;
    for (const pixel of fb.pixels) if (pixel !== 0) painted++;
    ok(painted > 0, 'замаскований діалог малюється');
}

// 11. Піктограми витягнуті з прошивки
{
    for (const name of ['shift', 'shifted', 'backspace', 'whitespace']) {
        const icon = KEYBOARD_ICONS[name];
        ok(icon.width === 20 && icon.height === 20, `${name}: ${icon.width}x${icon.height}`);
        ok(icon.pixels.length === 400, `${name}: ${icon.pixels.length} пікселів`);
        ok(icon.pixels.some((p) => p !== 0), `${name}: не порожня`);
    }
}

// 12. Курсор перестрибує порожні клітинки
{
    const dialog = new InputDialog('t');
    // у шарі 1 перша клітинка порожня (0), тож курсор не має на ній зупинятися
    dialog.update(press('c'), 0); // шар 1
    dialog.update(press('left'), 0);
    dialog.update(press('a'), 0);
    ok(dialog.getValue().length > 0, 'курсор не застряг на порожній клітинці');
}

// 13. Файлові піктограми — з keira, розміром 24x24
{
    const { FILE_ICONS } = await import('../src/generated/icons.ts');
    ok(FILE_ICONS.length === 8, `файлових піктограм ${FILE_ICONS.length}`);
    for (const name of FILE_ICONS) {
        const icon = KEYBOARD_ICONS[name];
        ok(icon !== undefined, `${name}: піктограма є`);
        if (!icon) continue;
        ok(icon.width === 24 && icon.height === 24, `${name}: ${icon.width}x${icon.height}, очікується 24x24`);
        ok(icon.pixels.length === 576, `${name}: ${icon.pixels.length} пікселів`);
        // Чорний у прошивці — прозорий колір, тож піктограма не має бути суцільно чорною
        ok(icon.pixels.some((pixel) => pixel !== 0), `${name}: не порожня`);
    }
}

console.log(fails === 0 ? '✔ віджети: усі перевірки пройдено' : `✖ віджети: ${fails} перевірок не пройдено`);
process.exit(fails ? 1 : 0);
