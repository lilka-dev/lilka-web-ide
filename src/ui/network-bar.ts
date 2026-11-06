/**
 * Смуга «мережевий запит заблоковано» під пристроєм.
 *
 * `http.execute`, який на Лілці працює, у браузері часто отримує -1: сервер не
 * дозволяє CORS або адреса `http://` зі сторінки `https://`. Скрипт при цьому
 * просто показує «не вдалося завантажити», і без пояснення здається, що
 * зламаний емулятор. Тому причина показується там, куди дивляться під час
 * запуску, — поруч зі смугою помилки, а не лише рядком у консолі.
 *
 * Тут же вмикається локальний проксі: саме він і є виходом із ситуації. Те
 * саме налаштування є й у вікні «Мережа» (`proxy.ts`) — для тих, хто хоче
 * ввімкнути проксі заздалегідь.
 */

import { t, bindText, onLangChange } from '../i18n/index.ts';
import { createProxySettings, type ProxyStore } from './proxy.ts';

export interface NetworkBar {
    root: HTMLElement;
    show(url: string, viaProxy: boolean): void;
    clear(): void;
}

export function createNetworkBar(store: ProxyStore): NetworkBar {
    const root = document.createElement('div');
    root.className = 'network-bar';
    root.setAttribute('role', 'status');
    root.hidden = true;

    const head = document.createElement('div');
    head.className = 'network-bar__head';
    const title = document.createElement('span');
    title.className = 'network-bar__title';
    bindText(title, 'network.title');
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'network-bar__close';
    close.textContent = '×';
    head.append(title, close);

    const text = document.createElement('p');
    text.className = 'network-bar__text';

    const settings = createProxySettings(store, 'network-bar');
    root.append(head, text, settings.root);

    let lastUrl = '';
    let lastViaProxy = false;

    function draw(): void {
        const proxy = store.get();
        text.textContent =
            lastViaProxy && proxy
                ? t('network.proxyFailed', { url: lastUrl, proxy })
                : t('network.blocked', { url: lastUrl });
        close.setAttribute('aria-label', t('network.dismiss'));
    }
    onLangChange(draw);

    function clear(): void {
        root.hidden = true;
    }
    close.addEventListener('click', clear);

    return {
        root,
        show(url, viaProxy) {
            lastUrl = url;
            lastViaProxy = viaProxy;
            // Якщо проксі вже ввімкнено, а запит усе одно впав — найімовірніше,
            // проксі не запущено; інструкцію варто показати одразу
            settings.reset({ showHowTo: viaProxy });
            draw();
            root.hidden = false;
        },
        clear,
    };
}
