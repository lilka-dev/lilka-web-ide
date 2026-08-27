import { defineConfig, devices } from '@playwright/test';

/**
 * Порт відрізняється від типового 5173, щоб e2e не заважав звичайному
 * `npm run dev`, якщо той уже запущений поруч.
 */
const PORT = 4173;

export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never' }]]
        : [['list'], ['html', { open: 'never' }]],
    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    /**
     * Піднімає справжній dev-сервер Vite: рантайм Lua потребує
     * SharedArrayBuffer, а той з'являється лише за заголовків COOP/COEP, які
     * видає сам сервер (див. vite.config.ts). Статичний `vite preview` цих
     * заголовків не має.
     */
    webServer: {
        command: `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
