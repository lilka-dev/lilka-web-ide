/**
 * Файловий менеджер.
 *
 * Головне правило: **одна логіка на всіх пристроях**. Тому тут немає дій «при
 * наведенні», немає правої кнопки й немає довгого дотику — усе, що можна
 * зробити мишею, робиться пальцем так само. Це і зрозуміліше, і коду менше.
 *
 * Показується лише `/sd` під назвою «Файли». Розділи `/spiffs` і `/tmp` існують
 * у файловій системі, бо існують на залізі, але для створення програм не
 * потрібні, і порожні недосяжні розділи лише збивають з пантелику.
 *
 * Модель: **програма лежить поруч зі своїми картинками**. Тому в кожній теці
 * своя `main.lua`, і відносні шляхи в `resources.load_image` завжди працюють.
 */

import { basename, dirname, normalizePath } from '../emulator/vfs.ts';
import { detectFormat } from '../emulator/image-loader.ts';
import { inspectImage, PROBLEM_TEXT, type ImageInfo } from '../emulator/image-info.ts';
import { fileIcon, iconElement } from './icons.ts';

/** Корінь менеджера. У шляхах лишається `/sd`, бо так на залізі. */
export const ROOT = '/sd';
const ROOT_TITLE = 'Файли';

const TEXT_EXTENSIONS = ['.lua', '.js', '.mjs', '.txt', '.json', '.state', '.csv'];

export interface FileEntry {
    path: string;
    name: string;
    isDirectory: boolean;
    size: number;
    /** Дані потрібні для мініатюр і для перевірки картинок. */
    data: Uint8Array | null;
}

export interface FilesPanelEvents {
    onAdd(path: string, data: Uint8Array): void;
    onRemove(path: string): void;
    onMkdir(path: string): void;
    onMove(from: string, to: string): void;
    onDuplicate(path: string): void;
    onOpenLua(path: string): void;
    onDownload(path: string): void;
    onDirChange(dir: string): void;
}

export interface FilesPanel {
    root: HTMLElement;
    render(list: () => FileEntry[], directories: () => string[]): void;
    currentDir(): string;
    setDir(dir: string): void;
}

function humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function isAccepted(name: string, data: Uint8Array): boolean {
    const lower = name.toLowerCase();
    if (TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension))) return true;
    return detectFormat(data) !== 'unknown';
}

/** Мініатюра з даних картинки. Показує саме зображення, а не значок формату. */
function thumbnailUrl(data: Uint8Array, format: string): string {
    const type = format === 'png' ? 'image/png' : 'image/bmp';
    return URL.createObjectURL(new Blob([data.slice() as unknown as BlobPart], { type }));
}

export function createFilesPanel(events: FilesPanelEvents): FilesPanel {
    const root = document.createElement('section');
    root.className = 'files';

    let dir = ROOT;
    let view: 'grid' | 'list' = (localStorage.getItem('lilka-web-ide:view') as 'grid' | 'list') ?? 'grid';
    let selection = new Set<string>();
    let getList: () => FileEntry[] = () => [];
    let getDirs: () => string[] = () => [];
    const objectUrls: string[] = [];

    // --- панель дій
    const bar = document.createElement('div');
    bar.className = 'files__bar';

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'button button--primary files__add';
    addButton.textContent = '+ Додати файли';

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.hidden = true;
    addButton.addEventListener('click', () => picker.click());
    picker.addEventListener('change', () => {
        void readFiles(picker.files);
        picker.value = '';
    });

    const mkdirButton = document.createElement('button');
    mkdirButton.type = 'button';
    mkdirButton.className = 'button';
    mkdirButton.textContent = 'Нова тека';
    mkdirButton.addEventListener('click', () => {
        const name = prompt('Назва теки');
        if (!name) return;
        events.onMkdir(`${dir}/${name.trim()}`);
    });

    const viewToggle = document.createElement('div');
    viewToggle.className = 'files__view';
    const gridButton = document.createElement('button');
    gridButton.type = 'button';
    gridButton.append(iconElement('grid', 15));
    gridButton.title = 'Плитка';
    const listButton = document.createElement('button');
    listButton.type = 'button';
    listButton.append(iconElement('list', 15));
    listButton.title = 'Рядки';
    for (const [button, mode] of [
        [gridButton, 'grid'],
        [listButton, 'list'],
    ] as const) {
        button.addEventListener('click', () => {
            view = mode;
            localStorage.setItem('lilka-web-ide:view', mode);
            draw();
        });
    }
    viewToggle.append(gridButton, listButton);

    const folderMenuButton = document.createElement('button');
    folderMenuButton.type = 'button';
    folderMenuButton.className = 'button files__dots';
    folderMenuButton.textContent = '⋯';
    folderMenuButton.title = 'Дії над текою';
    folderMenuButton.addEventListener('click', (event) => {
        event.stopPropagation();
        openMenu(folderMenuButton, folderMenuItems());
    });

    bar.append(addButton, mkdirButton, picker, viewToggle, folderMenuButton);

    // --- крихти
    const crumbs = document.createElement('div');
    crumbs.className = 'files__crumbs';

    const content = document.createElement('div');
    content.className = 'files__content';

    const notice = document.createElement('div');
    notice.className = 'files__notice';
    notice.hidden = true;

    root.append(bar, crumbs, content, notice);

    // --- перетягування з комп'ютера
    root.addEventListener('dragover', (event) => {
        event.preventDefault();
        root.classList.add('files--over');
    });
    root.addEventListener('dragleave', (event) => {
        if (event.target === root) root.classList.remove('files--over');
    });
    root.addEventListener('drop', (event) => {
        event.preventDefault();
        root.classList.remove('files--over');
        void readFiles(event.dataTransfer?.files ?? null);
    });

    async function readFiles(list: FileList | null): Promise<void> {
        if (!list) return;
        const rejected: string[] = [];
        for (const file of Array.from(list)) {
            const data = new Uint8Array(await file.arrayBuffer());
            if (!isAccepted(file.name, data)) {
                rejected.push(file.name);
                continue;
            }
            // Файл із теки приходить із відносним шляхом — зберігаємо вкладеність
            const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
            const target = relative && relative.includes('/') ? `${dir}/${relative}` : `${dir}/${file.name}`;
            events.onAdd(normalizePath(target), data);
        }
        if (rejected.length) {
            showNotice(
                `Не додано: ${rejected.join(', ')}. Прошивка читає лише BMP, PNG і текстові файли.`,
                'error',
            );
        }
    }

    function showNotice(text: string, kind: 'error' | 'warn', action?: { label: string; run: () => void }): void {
        notice.textContent = '';
        notice.className = `files__notice files__notice--${kind}`;
        const span = document.createElement('span');
        span.textContent = text;
        notice.append(span);
        if (action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'files__notice-action';
            button.textContent = action.label;
            button.addEventListener('click', action.run);
            notice.append(button);
        }
        notice.hidden = false;
    }

    // --- меню
    let openedMenu: HTMLElement | null = null;

    interface MenuItem {
        label: string;
        run: () => void;
        kind?: 'accent' | 'danger' | 'fix';
    }

    function closeMenu(): void {
        openedMenu?.remove();
        openedMenu = null;
    }
    document.addEventListener('click', closeMenu);

    function openMenu(anchor: HTMLElement, items: MenuItem[]): void {
        closeMenu();
        const menu = document.createElement('div');
        menu.className = 'menu';
        menu.addEventListener('click', (event) => event.stopPropagation());

        for (const item of items) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = `menu__item${item.kind ? ' menu__item--' + item.kind : ''}`;
            row.textContent = item.label;
            row.addEventListener('click', () => {
                closeMenu();
                item.run();
            });
            menu.append(row);
        }

        const box = anchor.getBoundingClientRect();
        menu.style.top = `${box.bottom + window.scrollY + 4}px`;
        menu.style.left = `${Math.min(box.left + window.scrollX, window.innerWidth - 230)}px`;
        document.body.append(menu);
        openedMenu = menu;
    }

    function folderMenuItems(): MenuItem[] {
        return [
            {
                label: 'Додати теку з комп\'ютера',
                run: () => {
                    const folderPicker = document.createElement('input');
                    folderPicker.type = 'file';
                    folderPicker.setAttribute('webkitdirectory', '');
                    folderPicker.addEventListener('change', () => void readFiles(folderPicker.files));
                    folderPicker.click();
                },
            },
            { label: 'Очистити цю теку', kind: 'danger', run: clearCurrent },
        ];
    }

    function clearCurrent(): void {
        const own = getList();
        if (own.length === 0) return;
        if (!confirm(`Видалити все з теки «${basename(dir) || ROOT_TITLE}»? Це ${own.length} об'єктів.`)) return;
        for (const entry of own) events.onRemove(entry.path);
    }

    function entryMenuItems(entry: FileEntry, info: ImageInfo | null): MenuItem[] {
        const items: MenuItem[] = [];

        if (info?.fixable) {
            items.push({
                label: 'Виправити для Лілки',
                kind: 'fix',
                run: () => void fixImage(entry),
            });
        }

        if (entry.isDirectory) {
            items.push({ label: 'Відкрити', kind: 'accent', run: () => setDir(entry.path) });
        } else if (entry.name.endsWith('.lua')) {
            items.push({ label: 'Відкрити в редакторі', kind: 'accent', run: () => events.onOpenLua(entry.path) });
        }

        items.push({
            label: 'Перейменувати',
            run: () => {
                const name = prompt('Нова назва', entry.name);
                if (!name || name === entry.name) return;
                events.onMove(entry.path, `${dirname(entry.path)}/${name.trim()}`);
            },
        });

        if (!entry.isDirectory) {
            items.push({ label: 'Дублювати', run: () => events.onDuplicate(entry.path) });
        }

        items.push({ label: 'Перемістити…', run: () => openMoveDialog([entry.path]) });

        if (!entry.isDirectory) {
            items.push({ label: 'Завантажити', run: () => events.onDownload(entry.path) });
        }

        items.push({
            label: 'Видалити',
            kind: 'danger',
            run: () => {
                if (entry.isDirectory && !confirm(`Видалити теку «${entry.name}» з усім вмістом?`)) return;
                events.onRemove(entry.path);
            },
        });

        return items;
    }

    async function fixImage(entry: FileEntry): Promise<void> {
        if (!entry.data) return;
        try {
            const { convertToPng } = await import('../emulator/image-info.ts');
            const fixed = await convertToPng(entry.name, entry.data);
            events.onAdd(`${dirname(entry.path)}/${fixed.name}`, fixed.data);
            if (fixed.name !== entry.name) events.onRemove(entry.path);
            showNotice(`«${entry.name}» перезбережено як «${fixed.name}» — тепер Лілка прочитає її правильно.`, 'warn');
        } catch (error) {
            showNotice(`Не вдалося виправити «${entry.name}»: ${String(error)}`, 'error');
        }
    }

    // --- вікно переміщення
    function openMoveDialog(paths: string[]): void {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';

        const dialog = document.createElement('div');
        dialog.className = 'dialog';

        const title = document.createElement('div');
        title.className = 'dialog__title';
        title.textContent =
            paths.length === 1 ? `Перемістити «${basename(paths[0])}»` : `Перемістити ${paths.length} об'єктів`;

        const hint = document.createElement('div');
        hint.className = 'dialog__hint';
        hint.textContent = 'Оберіть, куди покласти';

        const list = document.createElement('div');
        list.className = 'dialog__list';

        let target: string | null = null;
        const moveButton = document.createElement('button');
        moveButton.type = 'button';
        moveButton.className = 'button button--primary';
        moveButton.textContent = 'Перемістити';
        moveButton.disabled = true;

        const candidates = [ROOT, ...getDirs()];
        for (const candidate of candidates) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'dialog__row';
            row.style.paddingLeft = `${14 + (candidate.split('/').length - 2) * 18}px`;

            const label = document.createElement('span');
            label.textContent = candidate === ROOT ? ROOT_TITLE : basename(candidate);
            row.append(label);

            // Тека не може переїхати сама в себе — інакше зникне з дерева
            const insideMoved = paths.some((path) => candidate === path || candidate.startsWith(path + '/'));
            const isCurrent = candidate === dir;

            if (insideMoved || isCurrent) {
                row.disabled = true;
                const note = document.createElement('em');
                note.textContent = insideMoved ? 'переміщується' : 'тут зараз';
                row.append(note);
            } else {
                row.addEventListener('click', () => {
                    target = candidate;
                    for (const other of list.querySelectorAll('.dialog__row')) {
                        other.classList.remove('dialog__row--picked');
                    }
                    row.classList.add('dialog__row--picked');
                    moveButton.disabled = false;
                });
            }
            list.append(row);
        }

        const footer = document.createElement('div');
        footer.className = 'dialog__footer';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'button';
        cancel.textContent = 'Скасувати';
        cancel.addEventListener('click', () => overlay.remove());
        moveButton.addEventListener('click', () => {
            if (!target) return;
            for (const path of paths) events.onMove(path, `${target}/${basename(path)}`);
            selection.clear();
            overlay.remove();
        });
        footer.append(cancel, moveButton);

        dialog.append(title, hint, list, footer);
        overlay.append(dialog);
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) overlay.remove();
        });
        document.body.append(overlay);
    }

    // --- малювання
    function setDir(next: string): void {
        dir = normalizePath(next);
        selection.clear();
        events.onDirChange(dir);
        draw();
    }

    function drawCrumbs(entries: FileEntry[]): void {
        crumbs.textContent = '';

        if (selection.size > 0) {
            crumbs.classList.add('files__crumbs--selection');
            const count = document.createElement('span');
            count.textContent = `обрано ${selection.size}`;
            crumbs.append(count);

            const actions = document.createElement('span');
            actions.className = 'files__selection-actions';

            const move = document.createElement('button');
            move.type = 'button';
            move.textContent = 'Перемістити';
            move.addEventListener('click', () => openMoveDialog([...selection]));

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'files__danger';
            remove.textContent = 'Видалити';
            remove.addEventListener('click', () => {
                for (const path of selection) events.onRemove(path);
                selection.clear();
            });

            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.className = 'files__plain';
            cancel.textContent = 'Скасувати';
            cancel.addEventListener('click', () => {
                selection.clear();
                draw();
            });

            actions.append(move, remove, cancel);
            crumbs.append(actions);
            return;
        }

        crumbs.classList.remove('files__crumbs--selection');

        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'files__back';
        back.textContent = '←';
        back.disabled = dir === ROOT;
        back.addEventListener('click', () => setDir(dirname(dir)));
        crumbs.append(back);

        const parts = dir.slice(ROOT.length).split('/').filter(Boolean);
        const makeCrumb = (label: string, path: string, last: boolean) => {
            const crumb = document.createElement('button');
            crumb.type = 'button';
            crumb.className = last ? 'files__crumb files__crumb--last' : 'files__crumb';
            crumb.textContent = label;
            crumb.disabled = last;
            crumb.addEventListener('click', () => setDir(path));
            crumbs.append(crumb);
        };

        makeCrumb(ROOT_TITLE, ROOT, parts.length === 0);
        let path = ROOT;
        parts.forEach((part, index) => {
            path += '/' + part;
            const separator = document.createElement('span');
            separator.className = 'files__sep';
            separator.textContent = '›';
            crumbs.append(separator);
            makeCrumb(part, path, index === parts.length - 1);
        });

        const total = entries.reduce((sum, entry) => sum + entry.size, 0);
        const summary = document.createElement('span');
        summary.className = 'files__summary';
        summary.textContent = entries.length === 0 ? 'порожньо' : `${entries.length} об'єктів · ${humanSize(total)}`;
        crumbs.append(summary);
    }

    function makeCheckbox(entry: FileEntry): HTMLElement {
        const box = document.createElement('button');
        box.type = 'button';
        box.className = selection.has(entry.path) ? 'pick pick--on' : 'pick';
        box.textContent = selection.has(entry.path) ? '✓' : '';
        box.title = 'Обрати';
        box.addEventListener('click', (event) => {
            event.stopPropagation();
            if (selection.has(entry.path)) selection.delete(entry.path);
            else selection.add(entry.path);
            draw();
        });
        return box;
    }

    function makeDots(entry: FileEntry, info: ImageInfo | null): HTMLElement {
        const dots = document.createElement('button');
        dots.type = 'button';
        dots.className = 'dots';
        dots.textContent = '⋯';
        dots.title = 'Дії';
        dots.addEventListener('click', (event) => {
            event.stopPropagation();
            openMenu(dots, entryMenuItems(entry, info));
        });
        return dots;
    }

    function activate(entry: FileEntry): void {
        if (entry.isDirectory) setDir(entry.path);
        else if (entry.name.endsWith('.lua')) events.onOpenLua(entry.path);
    }

    function draw(): void {
        for (const url of objectUrls.splice(0)) URL.revokeObjectURL(url);

        const entries = getList();
        gridButton.classList.toggle('files__view--on', view === 'grid');
        listButton.classList.toggle('files__view--on', view === 'list');

        drawCrumbs(entries);
        content.textContent = '';
        content.className = `files__content files__content--${view}`;

        // Попередження показується двічі: значком на об'єкті й смугою з
        // поясненням. Самого значка мало — треба знати, що саме не так.
        const problems: string[] = [];
        let firstBroken: FileEntry | null = null;

        const infoOf = (entry: FileEntry): ImageInfo | null => {
            if (entry.isDirectory || !entry.data) return null;
            const info = inspectImage(entry.data);
            if (info?.problems.length) {
                problems.push(`${entry.name} — ${PROBLEM_TEXT[info.problems[0]]}`);
                if (!firstBroken && info.fixable) firstBroken = entry;
            }
            return info;
        };

        for (const entry of entries) {
            const info = infoOf(entry);
            const format = entry.data ? detectFormat(entry.data) : 'unknown';
            const isImage = format === 'bmp' || format === 'png';

            if (view === 'grid') {
                const tile = document.createElement('div');
                tile.className = 'tile';

                const box = document.createElement('div');
                box.className = 'tile__box';
                box.addEventListener('click', () => activate(entry));

                if (entry.isDirectory) {
                    box.classList.add('tile__box--folder');
                    box.append(fileIcon(entry.name, true, 34));
                } else if (isImage && entry.data) {
                    const url = thumbnailUrl(entry.data, format);
                    objectUrls.push(url);
                    const image = document.createElement('img');
                    image.src = url;
                    image.alt = entry.name;
                    if (format === 'png') box.classList.add('tile__box--alpha');
                    box.append(image);
                } else {
                    box.classList.add('tile__box--file');
                    box.append(fileIcon(entry.name, false, 34));
                }

                box.append(makeCheckbox(entry), makeDots(entry, info));
                if (info?.problems.length) {
                    const badge = document.createElement('span');
                    badge.className = 'tile__warn';
                    badge.textContent = '!';
                    badge.title = PROBLEM_TEXT[info.problems[0]];
                    box.append(badge);
                }

                const name = document.createElement('div');
                name.className = 'tile__name';
                name.textContent = entry.name;

                tile.append(box, name);
                content.append(tile);
            } else {
                const row = document.createElement('div');
                row.className = selection.has(entry.path) ? 'row row--picked' : 'row';

                const name = document.createElement('button');
                name.type = 'button';
                name.className = 'row__name';
                name.append(fileIcon(entry.name, entry.isDirectory, 18));
                const label = document.createElement('span');
                label.textContent = entry.name;
                name.append(label);
                name.addEventListener('click', () => activate(entry));
                if (info?.problems.length) {
                    const warn = document.createElement('span');
                    warn.className = 'row__warn';
                    warn.textContent = '!';
                    warn.title = PROBLEM_TEXT[info.problems[0]];
                    name.append(warn);
                }

                const size = document.createElement('span');
                size.className = 'row__size';
                size.textContent = entry.isDirectory ? '—' : humanSize(entry.size);

                const kind = document.createElement('span');
                kind.className = 'row__kind';
                kind.textContent = entry.isDirectory
                    ? 'тека'
                    : info
                      ? `${info.width}×${info.height}`
                      : entry.name.split('.').pop()?.toUpperCase() ?? '';

                row.append(makeCheckbox(entry), name, size, kind, makeDots(entry, info));
                content.append(row);
            }
        }

        if (entries.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'files__empty';
            empty.textContent = 'Перетягніть картинки сюди';
            content.append(empty);
        }

        if (problems.length) {
            const broken = firstBroken as FileEntry | null;
            showNotice(
                problems[0] + (problems.length > 1 ? ` (і ще ${problems.length - 1})` : ''),
                'warn',
                broken ? { label: 'Виправити', run: () => void fixImage(broken) } : undefined,
            );
        } else if (notice.classList.contains('files__notice--warn')) {
            notice.hidden = true;
        }
    }

    return {
        root,
        render(list, directories) {
            getList = list;
            getDirs = directories;
            draw();
        },
        currentDir: () => dir,
        setDir,
    };
}
