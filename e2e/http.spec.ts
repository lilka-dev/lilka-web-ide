/**
 * `http.execute` у справжньому браузері.
 *
 * `check-runtime` перевіряє відтворення прошивки з підробним транспортом, бо
 * під Node синхронного XHR немає. Тут перевіряється те, чого Node не бачить:
 * що синхронний XHR справді працює у воркері під COOP/COEP, що CORS дає -1, а
 * не падіння, і що сторож не вбиває програму, поки запит чекає на відповідь.
 */

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';

test('http.execute: CORS-відповідь, відмова без CORS і довгий запит', async ({ page }) => {
    const server = createServer((req, res) => {
        const cors = { 'Access-Control-Allow-Origin': '*' };
        if (req.url === '/nocors') {
            res.end('secret');
            return;
        }
        // Довше за 2 с сторожа: програма має дочекатися, а не бути вбитою
        if (req.url === '/slow') {
            setTimeout(() => {
                res.writeHead(200, cors);
                res.end('late');
            }, 3000);
            return;
        }
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
            res.writeHead(200, cors);
            res.end(`${req.method}:${body}:привіт`);
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
        await page.goto('/');
        await expect(page.locator('.editor__status')).toHaveText('ready', { timeout: 15_000 });
        await page.locator('.cm-content').click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.press('Delete');
        await page.keyboard.insertText(
            [
                `local a = http.execute({ url = "${base}/ok", body = "x" })`,
                'print("A", a.code, a.response)',
                `local b = http.execute({ url = "${base}/nocors" })`,
                'print("B", b.code, b.response)',
                `local c = http.execute({ url = "${base}/slow" })`,
                'print("C", c.code, c.response)',
            ].join('\n'),
        );
        await page.getByRole('button', { name: 'Run' }).click();

        const output = page.locator('.editor__console');
        await expect(output).toContainText('C\t200.0\tlate', { timeout: 15_000 });
        await expect(output).toContainText('A\t200.0\tPOST:x:привіт');
        await expect(output).toContainText('B\t-1.0\tnil');
        await expect(output).toContainText('⚠ http.execute');
        // Пояснення не лише в консолі: смуга під пристроєм з полем проксі
        const bar = page.locator('.network-bar');
        await expect(bar).toBeVisible();
        await expect(bar).toContainText(`${base}/nocors`);
        await expect(bar.locator('.proxy__input')).toHaveValue('http://localhost:8787');
    } finally {
        server.close();
    }
});

/** Запускає справжній lilka-proxy.mjs на випадковому порту. */
async function startProxy(): Promise<{ port: number; stop(): void }> {
    const port = 18000 + Math.floor(Math.random() * 1000);
    const proxy = spawn(process.execPath, ['public/lilka-proxy.mjs', '--port', String(port)], { stdio: 'pipe' });
    await new Promise<void>((resolve, reject) => {
        proxy.stdout.on('data', (chunk) => String(chunk).includes('Lilka proxy') && resolve());
        proxy.on('exit', (code) => reject(new Error(`проксі завершився з кодом ${code}`)));
    });
    return { port, stop: () => proxy.kill() };
}

/** Набирає код у редакторі замість зразкового. */
async function setCode(page: import('@playwright/test').Page, code: string): Promise<void> {
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Delete');
    await page.keyboard.insertText(code);
}

test('локальний проксі: сервер без CORS стає доступним', async ({ page }) => {
    // Ціль без CORS і з переспрямуванням — як Yahoo Finance і більшість API
    const target = createServer((req, res) => {
        if (req.url === '/moved') {
            res.writeHead(301, { Location: '/elsewhere' });
            res.end();
            return;
        }
        res.end(`ua=${req.headers['user-agent']}`);
    });
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;

    const proxy = await startProxy();
    const port = proxy.port;

    try {
        await page.goto('/');
        await expect(page.locator('.editor__status')).toHaveText('ready', { timeout: 15_000 });
        await setCode(
            page,
            [
                `local a = http.execute({ url = "${base}/data" })`,
                'print("A", a.code, a.response)',
                `local b = http.execute({ url = "${base}/moved" })`,
                'print("B", b.code, b.response)',
            ].join('\n'),
        );
        const output = page.locator('.editor__console');
        await page.getByRole('button', { name: 'Run' }).click();
        await expect(output).toContainText('A\t-1.0\tnil');

        const bar = page.locator('.network-bar');
        await bar.locator('.proxy__input').fill(`http://localhost:${port}`);
        await bar.locator('.proxy__btn', { hasText: 'Use' }).click();
        await expect(bar.locator('.proxy__current')).toContainText(`http://localhost:${port}`);

        await page.getByRole('button', { name: 'Run' }).click();
        // User-Agent — як у прошивки, а переспрямування не виконується, як у HTTPClient
        await expect(output).toContainText('A\t200.0\tua=Lilka/web-ide-proxy');
        await expect(output).toContainText('B\t301.0\tnil');
        await expect(bar).toBeHidden();
    } finally {
        proxy.stop();
        target.close();
    }
});

test('вікно «Мережа»: проксі вмикається заздалегідь, до першого невдалого запиту', async ({ page }) => {
    const target = createServer((_req, res) => res.end('no-cors-data'));
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
    const proxy = await startProxy();

    try {
        await page.goto('/');
        await expect(page.locator('.editor__status')).toHaveText('ready', { timeout: 15_000 });

        const button = page.locator('.editor__network');
        await expect(button.locator('.editor__network-dot')).toBeHidden();
        await button.click();

        const dialog = page.locator('.dialog--network');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.proxy__current')).toContainText('directly');

        // Спершу — на порт, де нічого немає: перевірка має сказати, що проксі не відповідає
        await dialog.locator('.proxy__input').fill('http://localhost:1');
        await dialog.locator('.proxy__btn', { hasText: 'Check' }).click();
        await expect(dialog.locator('.proxy__state')).toContainText('No answer');

        await dialog.locator('.proxy__input').fill(`http://localhost:${proxy.port}`);
        await dialog.locator('.proxy__btn', { hasText: 'Check' }).click();
        await expect(dialog.locator('.proxy__state')).toContainText('responds');
        await dialog.locator('.proxy__btn', { hasText: 'Use' }).click();
        await expect(dialog.locator('.proxy__current')).toContainText(`http://localhost:${proxy.port}`);
        await dialog.getByRole('button', { name: 'Close' }).click();
        await expect(dialog).toHaveCount(0);
        await expect(button.locator('.editor__network-dot')).toBeVisible();

        await setCode(page, `local r = http.execute({ url = "${base}/" })\nprint("R", r.code, r.response)`);
        await page.getByRole('button', { name: 'Run' }).click();
        await expect(page.locator('.editor__console')).toContainText('R\t200.0\tno-cors-data');
        await expect(page.locator('.network-bar')).toBeHidden();

        // Вимкнення з того ж вікна прибирає позначку
        await button.click();
        await dialog.locator('.proxy__btn', { hasText: 'Turn off' }).click();
        await expect(dialog.locator('.proxy__current')).toContainText('directly');
        await page.keyboard.press('Escape');
        await expect(button.locator('.editor__network-dot')).toBeHidden();
    } finally {
        proxy.stop();
        target.close();
    }
});
