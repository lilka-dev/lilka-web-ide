/**
 * Мережевий транспорт для `http.execute`.
 *
 * На залізі запит синхронний (`HTTPClient::sendRequest` блокує задачу Lua),
 * і код користувача розраховує саме на це. У браузері синхронний запит
 * можливий лише в одному місці — `XMLHttpRequest` з `async = false` усередині
 * воркера; у вікні він заборонений або застарілий. Тому транспорт живе тут, а
 * рантайм отримує його ззовні: під Node `scripts/check-runtime.mts` підставляє
 * підробний, і рантайм про воркери так і не дізнається.
 */

export interface HttpRequest {
    url: string;
    method: string;
    /** Тіло вже обрізане на першому нульовому байті — як `String(body)` у прошивці. */
    body: Uint8Array | null;
}

export type HttpOutcome =
    | { kind: 'response'; status: number; body: Uint8Array }
    /** Запит не відбувся: немає з'єднання, CORS, змішаний вміст, кривий URL. */
    | { kind: 'network-error' }
    | { kind: 'timeout' };

export type HttpTransport = (request: HttpRequest) => HttpOutcome;

/**
 * Коди помилок `HTTPClient` (arduino-esp32, `HTTPClient.h`). Прошивка кладе їх
 * у `result.code` як є — від'ємне число замість HTTP-коду.
 */
export const HTTPC_ERROR_CONNECTION_REFUSED = -1;
export const HTTPC_ERROR_READ_TIMEOUT = -11;

/**
 * `HTTPCLIENT_DEFAULT_TCP_TIMEOUT` із того ж `HTTPClient.h`. На залізі це
 * тайм-аут кожної окремої операції сокета, а `xhr.timeout` — на весь запит.
 * Для звичайних відповідей API різниці немає; дуже довге завантаження файлу
 * тут обірветься раніше, ніж на Лілці.
 */
const TIMEOUT_MS = 5000;

/**
 * Заголовок, яким локальний проксі (`public/lilka-proxy.mjs`) позначає власну
 * невдачу: цільовий сервер недоступний. Для скрипта це те саме, що невдале
 * з'єднання на залізі, тобто -1, а не HTTP-код 502 самого проксі.
 */
export const PROXY_ERROR_HEADER = 'X-Lilka-Proxy-Error';

/**
 * Адреса запиту через проксі. Цільовий URL іде параметром, а не шляхом:
 * у шляху браузер нормалізував би `//` і `..`, а параметр доходить як є.
 */
export function proxiedUrl(proxy: string, url: string): string {
    return `${proxy.replace(/\/+$/, '')}/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Синхронний запит через XHR. Працює лише у воркері.
 *
 * `getProxy` читається на кожен запит: адресу проксі воркер отримує разом із
 * командою запуску, а транспорт створюється один раз.
 */
export function createXhrTransport(getProxy: () => string | null): HttpTransport {
    return (request) => {
        const proxy = getProxy();
        const xhr = new XMLHttpRequest();
        try {
            xhr.open(request.method, proxy ? proxiedUrl(proxy, request.url) : request.url, false);
            xhr.responseType = 'arraybuffer';
            xhr.timeout = TIMEOUT_MS;
            // Копія, бо XHR не приймає вид на SharedArrayBuffer, а тіло може бути саме таким
            xhr.send(request.body ? request.body.slice() : null);
        } catch (error) {
            const name = (error as { name?: string } | null)?.name;
            return name === 'TimeoutError' ? { kind: 'timeout' } : { kind: 'network-error' };
        }
        // Статус 0 без винятку означає те саме, що й виняток: відповіді не було
        if (xhr.status === 0) return { kind: 'network-error' };
        if (proxy && xhr.getResponseHeader(PROXY_ERROR_HEADER)) return { kind: 'network-error' };
        const body = xhr.response instanceof ArrayBuffer ? new Uint8Array(xhr.response) : new Uint8Array(0);
        return { kind: 'response', status: xhr.status, body };
    };
}
