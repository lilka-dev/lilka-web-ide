/**
 * Налаштування локального проксі для `http.execute` (`public/lilka-proxy.mjs`).
 *
 * Один компонент на два місця: смугу «запит заблоковано» під пристроєм і
 * вікно «Мережа» з панелі дій. Смуга з'являється, коли щось уже зламалося;
 * вікно — щоб увімкнути проксі заздалегідь, перевірити його або вимкнути, не
 * чекаючи невдалого запиту.
 *
 * Адреса проксі живе лише в пам'яті, як і мова інтерфейсу (див. `lang.ts`):
 * сховище браузера для стану застосунку не використовується.
 */

import { t, bindText, getLang, onLangChange } from '../i18n/index.ts';

export const DEFAULT_PROXY = 'http://localhost:8787';

/** Сайти, які проксі пускає без `--origin`. Має збігатися з `DEFAULT_ORIGINS` у lilka-proxy.mjs. */
const PROXY_DEFAULT_ORIGINS = ['https://lilka-dev.github.io', 'https://sverdlyuk.github.io'];

const README_URL = {
    en: 'https://github.com/lilka-dev/lilka-web-ide/blob/main/README.md#network-requests-and-the-local-proxy',
    uk: 'https://github.com/lilka-dev/lilka-web-ide/blob/main/README.uk.md#мережеві-запити-й-локальний-проксі',
};

/** Спільний стан: адреса проксі і ті, кому треба знати про її зміну. */
export interface ProxyStore {
    get(): string | null;
    set(proxy: string | null): void;
    onChange(fn: () => void): void;
}

export function createProxyStore(target: { httpProxy: string | null }): ProxyStore {
    const listeners = new Set<() => void>();
    return {
        get: () => target.httpProxy,
        set(proxy) {
            target.httpProxy = proxy;
            for (const fn of listeners) fn();
        },
        onChange: (fn) => void listeners.add(fn),
    };
}

/**
 * Команда запуску з `--origin`, якщо сайт середовища не з тих, що проксі
 * знає сам: інакше проксі відповість 403, і людина не зрозуміє чому.
 */
export function proxyCommand(): string {
    const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    return local || PROXY_DEFAULT_ORIGINS.includes(location.origin)
        ? 'node lilka-proxy.mjs'
        : `node lilka-proxy.mjs --origin ${location.origin}`;
}

/**
 * Стан дозволу Chrome на доступ до цього комп'ютера (Local Network Access).
 *
 * Сайт з інтернету може звернутися до `localhost` лише з дозволу людини; без
 * нього запит відхиляється так само, як до вимкненого проксі. Назва дозволу
 * змінювалася між версіями Chrome, тож питаємо всі відомі; браузер, що не знає
 * жодної, такого обмеження й не має.
 */
async function localNetworkPermission(): Promise<PermissionState | 'unknown'> {
    const states: PermissionState[] = [];
    for (const name of ['local-network-access', 'loopback-network', 'local-network']) {
        try {
            states.push((await navigator.permissions.query({ name: name as PermissionName })).state);
        } catch {
            // Невідома назва в цій версії браузера
        }
    }
    if (states.includes('denied')) return 'denied';
    if (states.includes('prompt')) return 'prompt';
    return states.length ? 'granted' : 'unknown';
}

/**
 * Чи відповідає проксі цьому сайту. Запит іде з головного потоку, а не з
 * воркера Lua: лише зі сторінки Chrome може спитати дозволу на доступ до
 * localhost, і краще, щоб це сталося одразу після кліку людини.
 */
async function checkProxy(proxy: string): Promise<'ok' | 'refused' | 'blocked' | 'down'> {
    try {
        const response = await fetch(`${proxy}/`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
        if (response.ok) return 'ok';
        return response.status === 403 ? 'refused' : 'down';
    } catch {
        return (await localNetworkPermission()) === 'denied' ? 'blocked' : 'down';
    }
}

type StateKey =
    | 'on'
    | 'off'
    | 'invalid'
    | 'checking'
    | 'check-ok'
    | 'check-refused'
    | 'check-blocked'
    | 'check-down';

export interface ProxySettings {
    root: HTMLElement;
    /** Скинути повідомлення під полем і підставити поточну адресу. */
    reset(options?: { showHowTo?: boolean }): void;
}

export function createProxySettings(store: ProxyStore, idPrefix: string): ProxySettings {
    const root = document.createElement('div');
    root.className = 'proxy';

    const form = document.createElement('form');
    form.className = 'proxy__form';
    const label = document.createElement('label');
    label.className = 'proxy__label';
    bindText(label, 'network.proxyLabel');
    const input = document.createElement('input');
    input.type = 'url';
    input.className = 'proxy__input';
    input.placeholder = DEFAULT_PROXY;
    input.spellcheck = false;
    input.id = `${idPrefix}-proxy`;
    label.htmlFor = input.id;
    const use = document.createElement('button');
    use.type = 'submit';
    use.className = 'proxy__btn';
    bindText(use, 'network.proxyUse');
    const check = document.createElement('button');
    check.type = 'button';
    check.className = 'proxy__btn';
    bindText(check, 'network.check');
    const off = document.createElement('button');
    off.type = 'button';
    off.className = 'proxy__btn';
    bindText(off, 'network.proxyOff');
    form.append(label, input, use, check, off);

    const current = document.createElement('p');
    current.className = 'proxy__current';

    const state = document.createElement('p');
    state.className = 'proxy__state';

    const howTo = document.createElement('details');
    howTo.className = 'proxy__howto';
    const summary = document.createElement('summary');
    bindText(summary, 'network.howTo');
    const steps = document.createElement('ol');
    const docs = document.createElement('a');
    docs.target = '_blank';
    docs.rel = 'noopener';
    howTo.append(summary, steps, docs);

    root.append(form, current, state, howTo);

    let stateKey: StateKey | null = null;
    /** Адреса, яку перевіряли, — для тексту результату. */
    let checked = '';

    const code = (value: string): HTMLElement => {
        const el = document.createElement('code');
        el.textContent = value;
        return el;
    };

    function drawSteps(): void {
        const download = document.createElement('a');
        download.href = `${import.meta.env.BASE_URL}lilka-proxy.mjs`;
        download.download = 'lilka-proxy.mjs';
        download.textContent = 'lilka-proxy.mjs';

        const items: Array<Array<string | Node>> = [
            [t('network.step1')],
            [t('network.step2'), ' ', download],
            [t('network.step3'), ' ', code(proxyCommand())],
            [t('network.step4', { proxy: DEFAULT_PROXY })],
            [t('network.step5')],
        ];
        steps.replaceChildren(
            ...items.map((parts) => {
                const li = document.createElement('li');
                li.append(...parts);
                return li;
            }),
        );
        docs.href = README_URL[getLang()];
        docs.textContent = t('network.docs');
    }

    function draw(): void {
        const proxy = store.get();
        off.hidden = proxy === null;
        current.textContent = proxy ? t('network.viaProxy', { proxy }) : t('network.direct');
        current.classList.toggle('proxy__current--on', proxy !== null);

        state.hidden = stateKey === null;
        state.className = 'proxy__state';
        if (stateKey === 'on') state.textContent = t('network.proxyOn');
        else if (stateKey === 'off') state.textContent = t('network.proxyOffDone');
        else if (stateKey === 'invalid') state.textContent = t('network.proxyInvalid', { proxy: DEFAULT_PROXY });
        else if (stateKey === 'checking') state.textContent = t('network.checking');
        else if (stateKey === 'check-ok') state.textContent = t('network.checkOk', { proxy: checked });
        else if (stateKey === 'check-refused')
            state.textContent = t('network.checkRefused', { proxy: checked, command: proxyCommand() });
        else if (stateKey === 'check-blocked') state.textContent = t('network.checkBlocked');
        else if (stateKey === 'check-down') state.textContent = t('network.checkDown', { proxy: checked });
        if (
            stateKey === 'invalid' ||
            stateKey === 'check-refused' ||
            stateKey === 'check-blocked' ||
            stateKey === 'check-down'
        ) {
            state.classList.add('proxy__state--bad');
        } else if (stateKey === 'check-ok') {
            state.classList.add('proxy__state--good');
        }
        drawSteps();
    }
    onLangChange(draw);
    store.onChange(draw);

    /** Адреса з поля, зведена до вигляду `http://host:port[/шлях]`, або null. */
    function readInput(): string | null {
        const value = input.value.trim() || DEFAULT_PROXY;
        try {
            const parsed = new URL(value);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            return parsed.origin + parsed.pathname.replace(/\/+$/, '');
        } catch {
            return null;
        }
    }

    /**
     * Перевірка проксі. Після «Увімкнути» вона йде сама: саме цей запит зі
     * сторінки і викликає питання Chrome про дозвіл, а без дозволу запити
     * програми з воркера мовчки відхилялися б.
     */
    async function runCheck(proxy: string, savedFirst: boolean): Promise<void> {
        checked = proxy;
        stateKey = 'checking';
        draw();
        const result = await checkProxy(proxy);
        // Людина могла тим часом натиснути щось інше — тоді результат уже не про те
        if (stateKey !== 'checking' || checked !== proxy) return;
        if (result === 'ok') {
            stateKey = savedFirst ? 'on' : 'check-ok';
        } else {
            stateKey = result === 'refused' ? 'check-refused' : result === 'blocked' ? 'check-blocked' : 'check-down';
            howTo.open = true;
        }
        draw();
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const proxy = readInput();
        if (!proxy) {
            stateKey = 'invalid';
            draw();
            return;
        }
        input.value = proxy;
        store.set(proxy);
        void runCheck(proxy, true);
    });

    check.addEventListener('click', () => {
        const proxy = readInput();
        if (!proxy) {
            stateKey = 'invalid';
            draw();
            return;
        }
        void runCheck(proxy, false);
    });

    off.addEventListener('click', () => {
        store.set(null);
        stateKey = 'off';
        draw();
    });

    return {
        root,
        reset(options = {}) {
            stateKey = null;
            input.value = store.get() ?? DEFAULT_PROXY;
            howTo.open = options.showHowTo ?? false;
            draw();
        },
    };
}

/**
 * Вікно «Мережа» з панелі дій: проксі можна ввімкнути, перевірити чи вимкнути
 * будь-коли, а не лише після невдалого запиту.
 */
export function openNetworkDialog(store: ProxyStore): void {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const dialog = document.createElement('div');
    dialog.className = 'dialog dialog--network';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', t('network.dialogTitle'));

    const head = document.createElement('div');
    head.className = 'dialog__title';
    head.textContent = t('network.dialogTitle');

    const body = document.createElement('div');
    body.className = 'network-dialog__body';
    const intro = document.createElement('p');
    intro.className = 'network-dialog__intro';
    intro.textContent = t('network.dialogIntro');
    const settings = createProxySettings(store, 'network-dialog');
    settings.reset({ showHowTo: store.get() === null });
    body.append(intro, settings.root);

    const footer = document.createElement('div');
    footer.className = 'dialog__footer';
    const done = document.createElement('button');
    done.type = 'button';
    done.className = 'button button--primary';
    done.textContent = t('network.close');
    footer.append(done);

    dialog.append(head, body, footer);
    overlay.append(dialog);

    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    function onKey(event: KeyboardEvent): void {
        if (event.key === 'Escape') close();
    }
    done.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);

    document.body.append(overlay);
    settings.root.querySelector('input')?.focus();
}
