import { test, expect } from '@playwright/test';

/**
 * Димові перевірки редактора у справжньому браузері.
 *
 * `npm run check` ганяє рантайм Lua під Node і звіряє малювання з незалежно
 * порахованими числами — але нічого не каже про те, чи працює саме те, що
 * бачить людина: чи вантажиться редактор, чи натискається «Запустити», чи
 * справді щось відбувається на екрані. Це тут.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.cm-content')).toBeVisible();
    // Рантайм Lua піднімається асинхронно й окремо від редактора: клік по
    // «Запустити» до готовності просто не має ефекту (`host.run` поверне
    // false). Тести чекають на «готово», як зробила б людина, а не на кнопку.
    await expect(page.locator('.editor__status')).toHaveText('готово', { timeout: 15_000 });
});

test('немає вкладок мов: редактор Lua — єдиний і одразу видимий', async ({ page }) => {
    await expect(page.locator('.tabs, .tab')).toHaveCount(0);
    await expect(page.locator('.editor__code')).toBeVisible();
});

test('редактор показує зразковий код і кнопки в очікуваному стані', async ({ page }) => {
    await expect(page.locator('.cm-content')).toContainText('Кольорове коло');
    await expect(page.getByRole('button', { name: 'Запустити' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Зупинити' })).toBeDisabled();
});

test('кнопка підключення Лілки стоїть у панелі дій', async ({ page }) => {
    // У Chromium Web Serial є, тож або кнопка «Під'єднати Лілку», або, якщо
    // API з якоїсь причини недоступне в цьому середовищі — тихий підпис.
    const slot = page.locator('.editor__device');
    await expect(slot).not.toBeEmpty();
});

test('«Запустити» справді виконує програму', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.getByRole('button', { name: 'Запустити' }).click();

    await expect(page.locator('.editor__status')).toHaveText('виконується');
    await expect(page.getByRole('button', { name: 'Зупинити' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Запустити' })).toBeDisabled();
    await expect(page.locator('.editor__console')).toContainText('Привіт з Лілки!');

    expect(errors).toEqual([]);
});

test('«Зупинити» повертає середовище в стан «готово»', async ({ page }) => {
    await page.getByRole('button', { name: 'Запустити' }).click();
    await expect(page.locator('.editor__status')).toHaveText('виконується');

    await page.getByRole('button', { name: 'Зупинити' }).click();

    await expect(page.locator('.editor__status')).toHaveText('готово', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Запустити' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Зупинити' })).toBeDisabled();
});

test('вибір прикладу зі списку підміняє код у редакторі', async ({ page }) => {
    const before = await page.locator('.cm-content').innerText();

    await page.locator('.editor__picker').selectOption({ label: 'Гра «Кубики»' });

    await expect(page.locator('.cm-content')).not.toContainText('Кольорове коло');
    const after = await page.locator('.cm-content').innerText();
    expect(after).not.toBe(before);
});
