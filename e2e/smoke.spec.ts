import { test, expect } from '@playwright/test';

/**
 * Димові перевірки редактора у справжньому браузері.
 *
 * `npm run check` ганяє рантайм Lua під Node і звіряє малювання з незалежно
 * порахованими числами — але нічого не каже про те, чи працює саме те, що
 * бачить людина: чи вантажиться редактор, чи натискається «Run», чи справді
 * щось відбувається на екрані. Це тут.
 *
 * Мова тестів — англійська, бо це типова мова середовища (браузер у
 * `playwright.config.ts` навмисно `en-US`). Приклади й код Lua лишаються
 * українськими незалежно від мови інтерфейсу: це вміст програми, а не текст
 * середовища. Переклад інтерфейсу як такий перевіряє окремий блок нижче.
 */

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.cm-content')).toBeVisible();
    // Рантайм Lua піднімається асинхронно й окремо від редактора: клік по
    // «Run» до готовності просто не має ефекту (`host.run` поверне false).
    // Тести чекають на «ready», як зробила б людина, а не на кнопку.
    await expect(page.locator('.editor__status')).toHaveText('ready', { timeout: 15_000 });
});

test('немає вкладок мов: редактор Lua — єдиний і одразу видимий', async ({ page }) => {
    await expect(page.locator('.tabs, .tab')).toHaveCount(0);
    await expect(page.locator('.editor__code')).toBeVisible();
});

test('редактор показує зразковий код і кнопки в очікуваному стані', async ({ page }) => {
    await expect(page.locator('.cm-content')).toContainText('Кольорове коло');
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeDisabled();
});

test('кнопка підключення Лілки стоїть у панелі дій', async ({ page }) => {
    // У Chromium Web Serial є, тож або кнопка «Connect Lilka», або, якщо
    // API з якоїсь причини недоступне в цьому середовищі — тихий підпис.
    const slot = page.locator('.editor__device');
    await expect(slot).not.toBeEmpty();
});

test('«Run» справді виконує програму', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));

    await page.getByRole('button', { name: 'Run' }).click();

    await expect(page.locator('.editor__status')).toHaveText('running');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Run' })).toBeDisabled();
    await expect(page.locator('.editor__console')).toContainText('Привіт з Лілки!');

    expect(errors).toEqual([]);
});

test('«Stop» повертає середовище в стан «ready»', async ({ page }) => {
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.locator('.editor__status')).toHaveText('running');

    await page.getByRole('button', { name: 'Stop' }).click();

    await expect(page.locator('.editor__status')).toHaveText('ready', { timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Run' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Stop' })).toBeDisabled();
});

test('вибір прикладу зі списку підміняє код у редакторі', async ({ page }) => {
    const before = await page.locator('.cm-content').innerText();

    await page.locator('.editor__picker').selectOption('dice');

    await expect(page.locator('.cm-content')).not.toContainText('Кольорове коло');
    const after = await page.locator('.cm-content').innerText();
    expect(after).not.toBe(before);
});

test.describe('i18n', () => {
    test('типова мова — англійська, перемикач одразу оновлює статичні написи', async ({ page }) => {
        await expect(page.locator('.editor__lang-btn--on')).toHaveText('EN');

        await page.locator('.editor__lang-btn', { hasText: 'УКР' }).click();

        await expect(page.getByRole('button', { name: 'Запустити' })).toBeVisible();
        await expect(page.locator('.editor__lang-btn--on')).toHaveText('УКР');
    });

    test('перемикач оновлює й уже намальований вміст файлової панелі', async ({ page }) => {
        // «Files» — рядок, який малює drawCrumbs() із власного стану панелі,
        // а не статична кнопка: якщо підписка на зміну мови загубиться,
        // саме тут лишиться старий текст
        await expect(page.locator('.files__crumbs')).toContainText('Files');

        await page.locator('.editor__lang-btn', { hasText: 'УКР' }).click();
        await expect(page.locator('.files__crumbs')).toContainText('Файли');

        await page.locator('.editor__lang-btn', { hasText: 'EN' }).click();
        await expect(page.locator('.files__crumbs')).toContainText('Files');
    });

    test('фізична шовкографія плати не перекладається', async ({ page }) => {
        // Це відтворення реального напису на залізі, а не текст середовища —
        // мова інтерфейсу на нього не впливає навіть після перемикання
        await page.locator('.editor__lang-btn', { hasText: 'УКР' }).click();
        await expect(page.locator('.device__logo')).toHaveText('ЛІЛКА');
        await expect(page.locator('.device__motto')).toContainText('Борітеся');
    });
});
