#!/usr/bin/env node
/**
 * Локальний проксі для `http.execute` у браузерному середовищі Лілки.
 *
 * Навіщо: браузер дає сторінці читати відповідь лише від серверів, які
 * дозволяють це заголовком CORS, і не пускає `http://` зі сторінки `https://`.
 * Справжня Лілка таких обмежень не має, тож скрипт, який працює на залізі
 * (наприклад, з Yahoo Finance), у браузері отримує -1. Цей проксі робить запит
 * сам, з комп'ютера, і віддає відповідь середовищу вже з дозволом CORS.
 *
 * Запуск (потрібен Node.js 18 або новіший, залежностей немає):
 *
 *     node lilka-proxy.mjs
 *     node lilka-proxy.mjs --port 9000 --origin https://my-fork.github.io
 *
 * Потім у середовищі відкрити «Network» / «Мережа» в панелі дій, вписати
 * http://localhost:8787 і натиснути «Use» / «Увімкнути».
 *
 * Безпека. Проксі слухає лише 127.0.0.1, тобто з інших комп'ютерів він
 * недоступний. Але браузер на цьому ж комп'ютері може звернутися до нього з
 * будь-якої відкритої вкладки, тож запити приймаються лише від дозволених
 * сайтів (`--origin`): інакше чужа сторінка могла б ходити через проксі у
 * локальну мережу від імені користувача.
 */

import { createServer } from 'node:http';

const DEFAULT_PORT = 8787;

/** Сайти середовища, яким проксі відповідає без додаткових прапорців. */
const DEFAULT_ORIGINS = ['https://lilka-dev.github.io', 'https://sverdlyuk.github.io'];

/**
 * Прошивка ставить `Lilka/<версія>` (`defaultUserAgent` у lualilka_http.cpp).
 * Деякі API за User-Agent розрізняють клієнтів, тож проксі не видає себе за
 * браузер, а підписується так само, як залізо.
 */
const USER_AGENT = 'Lilka/web-ide-proxy';

/**
 * `HTTPClient` за замовчуванням не йде за переспрямуваннями, і скрипт бачить
 * код 3xx. Тож і проксі їх не виконує. Заголовок Location не пересилається:
 * інакше браузер виконав би переспрямування сам, уже без проксі.
 */
const DROP_RESPONSE_HEADERS = new Set([
    'location',
    'content-encoding',
    'content-length',
    'transfer-encoding',
    'connection',
    'set-cookie',
]);

const TARGET_TIMEOUT_MS = 15000;

function parseArgs(argv) {
    const options = { port: DEFAULT_PORT, origins: [...DEFAULT_ORIGINS] };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--port') options.port = Number(argv[++i]);
        else if (arg === '--origin') options.origins.push(String(argv[++i]).replace(/\/+$/, ''));
        else if (arg === '--help' || arg === '-h') options.help = true;
        else {
            console.error(`Unknown argument: ${arg}`);
            options.help = true;
        }
    }
    return options;
}

const options = parseArgs(process.argv.slice(2));
if (options.help || !Number.isInteger(options.port)) {
    console.log(`Usage: node lilka-proxy.mjs [--port ${DEFAULT_PORT}] [--origin https://site.example]...

Local CORS proxy for http.execute in the Lilka web IDE.
--origin may be repeated; localhost pages are always allowed.`);
    process.exit(options.help ? 0 : 1);
}

/** Сторінки з localhost дозволені завжди: це dev-сервер середовища. */
function isAllowedOrigin(origin) {
    if (options.origins.includes(origin)) return true;
    try {
        const url = new URL(origin);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'X-Lilka-Proxy-Error',
        // Chrome питає дозволу, коли сайт з інтернету звертається до localhost
        'Access-Control-Allow-Private-Network': 'true',
        Vary: 'Origin',
    };
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    // Запит без Origin іде не з браузерної сторінки (curl тощо) — йому CORS не потрібен
    if (origin !== undefined && !isAllowedOrigin(origin)) {
        console.warn(`403 blocked origin ${origin} (add it with --origin ${origin})`);
        // Заголовок CORS і на відмові: інакше сторінка бачить лише «немає
        // відповіді» й не може підказати, що треба додати --origin
        res.writeHead(403, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Content-Type': 'text/plain' });
        res.end(`Origin ${origin} is not allowed. Restart the proxy with --origin ${origin}\n`);
        return;
    }
    const cors = origin ? corsHeaders(origin) : {};

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            ...cors,
            'Access-Control-Allow-Methods': req.headers['access-control-request-method'] ?? 'GET, POST',
            'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] ?? '',
            'Access-Control-Max-Age': '600',
        });
        res.end();
        return;
    }

    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== '/proxy') {
        res.writeHead(200, { ...cors, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Lilka proxy is running.\n');
        return;
    }

    const target = requestUrl.searchParams.get('url') ?? '';
    let parsed;
    try {
        parsed = new URL(target);
    } catch {
        parsed = null;
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        res.writeHead(502, { ...cors, 'X-Lilka-Proxy-Error': 'bad-url', 'Content-Type': 'text/plain' });
        res.end(`Not an http(s) URL: ${target}\n`);
        return;
    }

    const method = req.method ?? 'GET';
    try {
        const body = await readBody(req);
        const response = await fetch(parsed, {
            method,
            headers: { 'User-Agent': USER_AGENT },
            // fetch не дозволяє тіла в GET/HEAD; прошивка його надіслала б, але
            // такі запити на практиці не трапляються
            body: method === 'GET' || method === 'HEAD' || body.length === 0 ? undefined : body,
            redirect: 'manual',
            signal: AbortSignal.timeout(TARGET_TIMEOUT_MS),
        });
        const payload = Buffer.from(await response.arrayBuffer());
        const headers = { ...cors };
        response.headers.forEach((value, name) => {
            if (!DROP_RESPONSE_HEADERS.has(name) && !name.startsWith('access-control-')) headers[name] = value;
        });
        res.writeHead(response.status, headers);
        res.end(payload);
        console.log(`${response.status} ${method} ${target} (${payload.length} B)`);
    } catch (error) {
        // fetch ховає справжню причину (ECONNREFUSED, ENOTFOUND) у cause
        const cause = error instanceof Error ? error.cause : undefined;
        const reason = cause?.code ?? cause?.errors?.[0]?.code ?? (error instanceof Error ? error.name : String(error));
        console.warn(`ERR ${method} ${target}: ${reason}`);
        res.writeHead(502, { ...cors, 'X-Lilka-Proxy-Error': String(reason), 'Content-Type': 'text/plain' });
        res.end(`Request failed: ${reason}\n`);
    }
});

server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${options.port} is busy. Try --port ${options.port + 1}` : error);
    process.exit(1);
});

server.listen(options.port, '127.0.0.1', () => {
    console.log(`Lilka proxy: http://localhost:${options.port}`);
    console.log(`Allowed sites: localhost, ${options.origins.join(', ')}`);
    console.log('In the IDE: Network -> paste the address above -> Use, then run the program.');
    console.log('Press Ctrl+C to stop.');
});
