/**
 * Які файли відкриваються в текстовому редакторі.
 *
 * `.lua` сюди не потрапляє: його відкриває головний редактор, бо Lua-файл —
 * це програма, яку запускають. Решта тексту (`.txt`, `.json`, `.md`, …) не
 * запускається, тож редагується в окремому вікні, щоб «Запустити» не спробував
 * виконати JSON як Lua.
 *
 * Без DOM — перевіряється під Node у `check-vfs.mts`.
 */

/** Розширення, які завжди текст — навіть порожній файл. */
const TEXT_EXTENSIONS = new Set([
    'txt', 'json', 'md', 'csv', 'tsv', 'ini', 'cfg', 'conf', 'toml', 'yaml', 'yml',
    'xml', 'html', 'css', 'js', 'mjs', 'log', 'py', 'c', 'h', 'cpp',
]);

/** Розширення, які точно не текст, хоч би що лежало всередині. */
const BINARY_EXTENSIONS = new Set(['png', 'bmp', 'jpg', 'jpeg', 'gif', 'bin', 'mp3', 'wav', 'aac', 'flac', 'mod', 'zip']);

function extension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Чи це текст, який можна редагувати.
 *
 * Невідоме розширення (чи його відсутність, як у `README`) — вирішує вміст:
 * валідний UTF-8 без нульових байтів. Нуль у тексті не трапляється, а в
 * двійкових форматах він майже в кожному заголовку.
 */
export function isEditableText(name: string, data: Uint8Array | null): boolean {
    const ext = extension(name);
    if (ext === 'lua' || BINARY_EXTENSIONS.has(ext)) return false;
    if (TEXT_EXTENSIONS.has(ext)) return true;
    if (!data) return false;

    const sample = data.subarray(0, 8192);
    if (sample.includes(0)) return false;
    try {
        // Обрізаний зразок може розрізати багатобайтовий символ навпіл —
        // `stream: true` не вважає незавершений хвіст помилкою
        new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
        return true;
    } catch {
        return false;
    }
}

export function isJsonName(name: string): boolean {
    return extension(name) === 'json';
}

/** Помилка JSON із номером рядка — або null, якщо все гаразд. */
export function jsonProblem(text: string): { message: string; line: number | null } | null {
    if (text.trim() === '') return null;
    try {
        JSON.parse(text);
        return null;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Різні рушії пишуть позицію по-різному: V8 — «at position 12»,
        // новіші V8 і SpiderMonkey — «line 2 column 5»
        const lineMatch = /line (\d+)/.exec(message);
        if (lineMatch) return { message, line: Number(lineMatch[1]) };
        const positionMatch = /position (\d+)/.exec(message);
        if (positionMatch) {
            const line = text.slice(0, Number(positionMatch[1])).split('\n').length;
            return { message, line };
        }
        return { message, line: null };
    }
}
