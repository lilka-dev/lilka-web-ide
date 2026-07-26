/**
 * Панель файлів — віртуальна карта пам'яті.
 *
 * Показує три монтування, як на пристрої: `/sd`, `/spiffs` і `/tmp`. Останній
 * позначений окремо, бо це рамдиск: після перезавантаження сторінки він
 * порожній, як і на залізі після вимкнення живлення.
 *
 * Перетягування приймає лише BMP і PNG — саме ці формати читає прошивка.
 * Відмовляти JPEG тут не примха: інакше картинка працювала б у браузері й не
 * працювала на справжній Лілці.
 */

import { MOUNT_POINTS, basename, dirname } from '../emulator/vfs.ts';
import { detectFormat } from '../emulator/image-loader.ts';

const TEXT_EXTENSIONS = ['.lua', '.js', '.mjs', '.txt', '.json', '.state', '.csv'];

export interface FilesPanel {
    root: HTMLElement;
    render(files: Array<{ path: string; size: number }>): void;
    onAdd(handler: (path: string, data: Uint8Array) => void): void;
    onRemove(handler: (path: string) => void): void;
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function isAccepted(name: string, data: Uint8Array): boolean {
    const lower = name.toLowerCase();
    if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
    return detectFormat(data) !== 'unknown';
}

export function createFilesPanel(defaultDir = '/sd'): FilesPanel {
    const root = document.createElement('section');
    root.className = 'files';

    const head = document.createElement('div');
    head.className = 'files__head';
    head.innerHTML = '<strong>Карта пам\'яті</strong>';

    const hint = document.createElement('span');
    hint.className = 'files__hint';
    hint.textContent = 'перетягніть BMP, PNG або .lua';
    head.append(hint);

    const list = document.createElement('div');
    list.className = 'files__list';

    root.append(head, list);

    let addHandler: (path: string, data: Uint8Array) => void = () => {};
    let removeHandler: (path: string) => void = () => {};

    const readFiles = async (fileList: FileList | null): Promise<void> => {
        if (!fileList) return;
        for (const file of Array.from(fileList)) {
            const data = new Uint8Array(await file.arrayBuffer());
            if (!isAccepted(file.name, data)) {
                hint.textContent = `${file.name}: прошивка читає лише BMP і PNG`;
                hint.classList.add('files__hint--error');
                continue;
            }
            hint.classList.remove('files__hint--error');
            hint.textContent = 'перетягніть BMP, PNG або .lua';
            addHandler(`${defaultDir}/${file.name}`, data);
        }
    };

    root.addEventListener('dragover', (event) => {
        event.preventDefault();
        root.classList.add('files--over');
    });
    root.addEventListener('dragleave', () => root.classList.remove('files--over'));
    root.addEventListener('drop', (event) => {
        event.preventDefault();
        root.classList.remove('files--over');
        void readFiles(event.dataTransfer?.files ?? null);
    });

    return {
        root,
        render(files) {
            list.textContent = '';

            for (const point of MOUNT_POINTS) {
                const own = files.filter((file) => file.path.startsWith(point + '/'));

                const group = document.createElement('div');
                group.className = 'files__group';

                const title = document.createElement('div');
                title.className = 'files__mount';
                title.textContent = point;
                if (point === '/tmp') {
                    const note = document.createElement('em');
                    note.textContent = 'рамдиск, не зберігається';
                    title.append(note);
                }
                group.append(title);

                if (own.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'files__empty';
                    empty.textContent = 'порожньо';
                    group.append(empty);
                } else {
                    for (const file of own) {
                        const row = document.createElement('div');
                        row.className = 'files__row';

                        const name = document.createElement('span');
                        name.className = 'files__name';
                        name.textContent = basename(file.path);
                        name.title = file.path;

                        const where = document.createElement('span');
                        where.className = 'files__dir';
                        const parent = dirname(file.path);
                        where.textContent = parent === point ? '' : parent.slice(point.length + 1);

                        const size = document.createElement('span');
                        size.className = 'files__size';
                        size.textContent = humanSize(file.size);

                        const remove = document.createElement('button');
                        remove.type = 'button';
                        remove.className = 'files__remove';
                        remove.textContent = '×';
                        remove.title = 'Видалити';
                        remove.addEventListener('click', () => removeHandler(file.path));

                        row.append(name, where, size, remove);
                        group.append(row);
                    }
                }
                list.append(group);
            }
        },
        onAdd: (handler) => {
            addHandler = handler;
        },
        onRemove: (handler) => {
            removeHandler = handler;
        },
    };
}
