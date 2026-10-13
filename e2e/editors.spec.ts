import { test, expect, type Page } from '@playwright/test';

/**
 * Редактори картинок і тексту — так, як ними користується людина: через меню
 * «New», клік по плитці й кнопку «Save».
 *
 * Логіку полотна (заливка, лінії, RGB565) перевіряє `check-images.mts` під
 * Node. Тут — те, чого Node не бачить: що вікна відкриваються, малювання
 * мишею потрапляє в потрібний піксель, а збережений PNG справді лягає на
 * картку з тими кольорами, що були на полотні.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.files__bar')).toBeVisible();
});

/** Пікселі PNG із мініатюри плитки — тобто з того, що лежить на картці. */
async function tilePixels(page: Page, name: string): Promise<{ width: number; height: number; data: number[] }> {
    const image = page.locator('.tile', { hasText: name }).locator('img');
    await expect(image).toBeVisible();
    return image.evaluate(async (element: HTMLImageElement) => {
        const blob = await (await fetch(element.src)).blob();
        const bitmap = await createImageBitmap(blob);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const data = [...context.getImageData(0, 0, bitmap.width, bitmap.height).data];
        return { width: bitmap.width, height: bitmap.height, data };
    });
}

test('нова картинка: намальований піксель зберігається в PNG кольором прошивки', async ({ page }) => {
    await page.locator('.files__bar').getByRole('button', { name: 'New' }).click();
    await page.locator('.menu').getByRole('button', { name: 'Image…' }).click();

    const form = page.locator('.dialog--newimg');
    await form.locator('.newimg__name').fill('dot');
    await form.locator('input[type=number]').nth(0).fill('4');
    await form.locator('input[type=number]').nth(1).fill('4');
    await form.getByRole('button', { name: 'Create' }).click();

    const editor = page.locator('.dialog--pixel');
    await expect(editor).toBeVisible();

    await editor.locator('.pixed__chip[title^="colors.red "]').click();
    await expect(editor.locator('.pixed__color-text')).toContainText('0xF800');

    // Клік у лівий верхній квадрант полотна 4×4 — це піксель (0, 0)
    const canvas = editor.locator('.pixed__canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 8, box.y + box.height / 8);

    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toHaveCount(0);

    const png = await tilePixels(page, 'dot.png');
    expect(png.width).toBe(4);
    expect(png.height).toBe(4);
    expect(png.data.slice(0, 4)).toEqual([255, 0, 0, 255]);
    // Решта — повністю прозора: нова картинка починається з прозорості
    expect(png.data[15 * 4 + 3]).toBe(0);
    // Жодної напівпрозорості — прошивка її не знає
    expect(png.data.filter((_, index) => index % 4 === 3).every((alpha) => alpha === 0 || alpha === 255)).toBe(true);
});

test('нова картинка не перезаписує наявний файл', async ({ page }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
        await page.locator('.files__bar').getByRole('button', { name: 'New' }).click();
        await page.locator('.menu').getByRole('button', { name: 'Image…' }).click();
        await page.locator('.newimg__name').fill('twin.png');
        if (attempt === 0) {
            await page.locator('.dialog--newimg').getByRole('button', { name: 'Create' }).click();
            await page.locator('.dialog--pixel').getByRole('button', { name: 'Save' }).click();
            await expect(page.locator('.tile', { hasText: 'twin.png' })).toBeVisible();
        }
    }

    await expect(page.locator('.newimg__error')).toContainText('already exists');
    await expect(page.locator('.dialog--newimg').getByRole('button', { name: 'Create' })).toBeDisabled();
});

test('JSON редагується у власному вікні з перевіркою синтаксису', async ({ page }) => {
    await page.locator('.files__bar').getByRole('button', { name: 'New' }).click();
    await page.locator('.menu').getByRole('button', { name: 'File…' }).click();
    await page.locator('.dialog__input').fill('config.json');
    await page.locator('.dialog__input').press('Enter');

    await page.locator('.tile', { hasText: 'config.json' }).locator('.tile__box').click();

    const editor = page.locator('.dialog--text');
    await expect(editor).toBeVisible();

    await editor.locator('.cm-content').click();
    await page.keyboard.type('{"speed": 3,}');
    await expect(editor.locator('.texted__json--bad')).toContainText('JSON error');

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Backspace');
    await expect(editor.locator('.texted__json')).toHaveText('Valid JSON');

    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toHaveCount(0);

    // Повторне відкриття показує збережене, а головний редактор Lua не зачеплено
    await page.locator('.tile', { hasText: 'config.json' }).locator('.tile__box').click();
    await expect(page.locator('.dialog--text .cm-content')).toHaveText('{"speed": 3}');
    await expect(page.locator('.editor__code .cm-content')).not.toContainText('"speed": 3');
});

test('незбережені зміни не губляться від випадкового Escape', async ({ page }) => {
    await page.locator('.files__bar').getByRole('button', { name: 'New' }).click();
    await page.locator('.menu').getByRole('button', { name: 'File…' }).click();
    await page.locator('.dialog__input').fill('notes.txt');
    await page.locator('.dialog__input').press('Enter');
    await page.locator('.tile', { hasText: 'notes.txt' }).locator('.tile__box').click();

    await page.locator('.dialog--text .cm-content').click();
    await page.keyboard.type('draft');

    page.once('dialog', (dialog) => void dialog.dismiss());
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog--text')).toBeVisible();

    page.once('dialog', (dialog) => void dialog.accept());
    await page.keyboard.press('Escape');
    await expect(page.locator('.dialog--text')).toHaveCount(0);
});
