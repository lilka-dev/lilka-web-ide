/**
 * Піктограми файлів.
 *
 * Векторні, а не витягнуті з прошивки. Причина проста: на пристрої вони 24x24
 * пікселя й розраховані саме на той екран, а в браузері при збільшенні
 * розсипаються на квадратики.
 *
 * Родина будується так: файл — це аркуш із загнутим кутом, а всередині лежить
 * те, що визначає тип. Виняток навмисний — тека й картинка мають власні форми,
 * бо вони найчастіші й мають упізнаватися без розглядання.
 */

const TEAL = '#0e7c86';
const AMBER = '#f0a500';

/** Аркуш із загнутим кутом — спільна основа для всіх типів файлів. */
const SHEET = `
    <path d="M5.6 2.6h8L18.7 7.6v13.1a1.3 1.3 0 0 1-1.3 1.3H5.6a1.3 1.3 0 0 1-1.3-1.3V3.9a1.3 1.3 0 0 1 1.3-1.3z"
          fill="#edf3f0" stroke="#7a9188" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M13.6 2.6v5h5.1" fill="none" stroke="#7a9188" stroke-width="1.2" stroke-linejoin="round"/>
`;

const ICONS: Record<string, string> = {
    folder: `
        <path d="M2.5 6.2a1.7 1.7 0 0 1 1.7-1.7h4.6l1.9 2.2h7.6a1.7 1.7 0 0 1 1.7 1.7v9.9a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7z" fill="${AMBER}"/>
        <path d="M2.5 9.3h19v9a1.7 1.7 0 0 1-1.7 1.7H4.2a1.7 1.7 0 0 1-1.7-1.7z" fill="#ffc24d"/>
    `,
    // Місяць із планетою — як у справжньому знаку Lua
    lua: `${SHEET}
        <circle cx="11" cy="15.2" r="4.4" fill="#0b2a8a"/>
        <circle cx="12.7" cy="13.5" r="1.7" fill="#edf3f0"/>
        <circle cx="16.6" cy="10.6" r="1.5" fill="#0b2a8a"/>
    `,
    js: `${SHEET}
        <rect x="6.6" y="11.4" width="10.2" height="9" rx="1.6" fill="#e8b21c"/>
        <path d="M11.1 13.6v4.1a1 1 0 0 1-1.9.4M15.6 14.1a1.6 1.6 0 0 0-2.5.4c-.2 1.3 2.5 1 2.4 2.4a1.6 1.6 0 0 1-2.5.6"
              fill="none" stroke="#3a2a00" stroke-width="1.15" stroke-linecap="round"/>
    `,
    // Рамка з краєвидом: метафора галереї впізнається миттєво, тож тут родина
    // з аркушем поступається впізнаваності
    image: `
        <rect x="2.4" y="4.4" width="19.2" height="15.2" rx="2.2" fill="#dff0e7" stroke="#3f7d5b" stroke-width="1.3"/>
        <circle cx="8" cy="9.4" r="1.9" fill="${AMBER}"/>
        <path d="M3.4 17.4l4.9-5.3 3.5 3.6 3.3-4.2 5.5 5.9z" fill="#3f7d5b"/>
    `,
    text: `${SHEET}
        <path d="M7.2 11.6h8M7.2 14.6h8M7.2 17.6h5" stroke="#7a9188" stroke-width="1.4" stroke-linecap="round"/>
    `,
    // Дискета: старомодно, але «збережене» читається без слів
    state: `${SHEET}
        <path d="M7.4 12.4h8.2v7.4H7.4z" fill="#7c6ba8"/>
        <path d="M9.3 12.4h4.4v3.1H9.3z" fill="#edf3f0"/>
        <circle cx="11.5" cy="17.6" r="1.2" fill="#edf3f0"/>
    `,
    music: `${SHEET}
        <path d="M15.4 10.6v6.6" stroke="${TEAL}" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M15.4 10.6l-6 1.5v6" stroke="${TEAL}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
        <circle cx="7.7" cy="18.4" r="2.1" fill="${TEAL}"/>
        <circle cx="13.6" cy="17.2" r="2.1" fill="${TEAL}"/>
    `,
    // Мікросхема з ніжками: це прошивка, а не просто файл
    bin: `
        <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="1.6" fill="#4a5560"/>
        <rect x="9.2" y="9.2" width="5.6" height="5.6" rx="1" fill="#94a3ae"/>
        <path d="M9.2 6.4V4M12 6.4V4M14.8 6.4V4M9.2 20v-2.4M12 20v-2.4M14.8 20v-2.4M6.4 9.2H4M6.4 12H4M6.4 14.8H4M20 9.2h-2.4M20 12h-2.4M20 14.8h-2.4"
              stroke="#4a5560" stroke-width="1.4" stroke-linecap="round"/>
    `,
    // Перемикачі вигляду: чотири квадрати замість дев'яти — дев'ять на 15 px
    // зливаються в сіру пляму
    grid: `
        <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6" fill="currentColor"/>
        <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6" fill="currentColor"/>
        <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6" fill="currentColor"/>
        <rect x="13" y="13" width="7.5" height="7.5" rx="1.6" fill="currentColor"/>
    `,
    list: `
        <path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
    `,
};

/** Підбирає піктограму за іменем файлу. */
export function iconNameFor(name: string, isDirectory: boolean): string {
    if (isDirectory) return 'folder';

    const lower = name.toLowerCase();
    if (lower.endsWith('.lua')) return 'lua';
    if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'js';
    if (lower.endsWith('.bmp') || lower.endsWith('.png')) return 'image';
    if (lower.endsWith('.bin')) return 'bin';
    if (lower.endsWith('.mp3') || lower.endsWith('.wav')) return 'music';
    if (lower.endsWith('.state') || lower.endsWith('.json')) return 'state';
    return 'text';
}

/** Створює елемент із піктограмою. Векторний, тож будь-який розмір чіткий. */
export function iconElement(iconName: string, size: number): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    svg.innerHTML = ICONS[iconName] ?? ICONS.text;
    return svg;
}

/** Піктограма за іменем файлу — скорочення для найчастішого випадку. */
export function fileIcon(name: string, isDirectory: boolean, size: number): SVGElement {
    return iconElement(iconNameFor(name, isDirectory), size);
}
