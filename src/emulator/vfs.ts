/**
 * Віртуальна файлова система.
 *
 * Побудована за зразком нової VFS у KeiraOS (`src/keira/vfs/`), а не за старими
 * ардуїнівськими обгортками. У заголовку `vfs.h` прошивки сказано прямо:
 * «if possible, just stick to a well documented/tested/used POSIX file api».
 *
 * Структура монтувань повторює `KeiraSystem::registerFileSystems()`:
 *
 *   /          RootFs    — тільки читання, плаский перелік монтувань
 *   /sd        MemoryFs  — карта пам'яті, зберігається між сеансами
 *   /spiffs    MemoryFs  — внутрішня флеш-пам'ять, зберігається
 *   /tmp       MemoryFs  — рамдиск у PSRAM, НЕ зберігається
 *
 * `/tmp` навмисно не потрапляє в постійне сховище: на залізі це рамдиск, який
 * після перезавантаження порожній. Якби в браузері він зберігався «щоб
 * зручніше», програма, яка розраховує на чистий `/tmp`, поводилася б інакше.
 */

/** Корені, зареєстровані в `RootVFS`. Порядок — як у `registerFileSystems()`. */
export const MOUNT_POINTS = ['/sd', '/spiffs', '/tmp'] as const;
export type MountPoint = (typeof MOUNT_POINTS)[number];

/** Монтування, вміст яких переживає перезавантаження сторінки. */
export const PERSISTENT_MOUNTS: readonly MountPoint[] = ['/sd', '/spiffs'];

export interface VfsStat {
    isDirectory: boolean;
    size: number;
}

export class VfsError extends Error {
    readonly code: string;

    constructor(message: string, code: string) {
        super(message);
        this.code = code;
    }
}

/** Прибирає подвійні риски й «.», не чіпаючи решту. */
export function normalizePath(path: string): string {
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return '/' + parts.join('/');
}

/**
 * Порт `FileUtils::joinPath`: правий шлях позбувається початкових рисок,
 * лівий отримує риску в кінці, якщо її немає.
 */
export function joinPath(left: string, right: string): string {
    let path = left;
    if (path !== '' && !path.endsWith('/')) path += '/';
    let start = 0;
    while (start < right.length && right[start] === '/') start++;
    return path + right.slice(start);
}

export function dirname(path: string): string {
    const at = path.lastIndexOf('/');
    return at <= 0 ? '/' : path.slice(0, at);
}

export function basename(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Одне монтування: файли в пам'яті.
 *
 * Каталоги зберігаються окремо від файлів, бо порожній каталог теж має
 * існувати — саме так поводиться справжня файлова система.
 */
export class MemoryFs {
    private readonly files = new Map<string, Uint8Array>();
    private readonly dirs = new Set<string>(['']);

    /** Ключ — шлях відносно точки монтування, без початкової риски. */
    private key(path: string): string {
        return normalizePath(path).slice(1);
    }

    read(path: string): Uint8Array | null {
        return this.files.get(this.key(path)) ?? null;
    }

    write(path: string, data: Uint8Array): void {
        const key = this.key(path);
        this.ensureParents(key);
        this.files.set(key, data);
    }

    exists(path: string): boolean {
        const key = this.key(path);
        return this.files.has(key) || this.dirs.has(key);
    }

    stat(path: string): VfsStat | null {
        const key = this.key(path);
        const file = this.files.get(key);
        if (file) return { isDirectory: false, size: file.length };
        if (this.dirs.has(key)) return { isDirectory: true, size: 0 };
        return null;
    }

    remove(path: string): boolean {
        const key = this.key(path);
        if (this.files.delete(key)) return true;
        return this.dirs.delete(key);
    }

    rename(from: string, to: string): boolean {
        const fromKey = this.key(from);
        const data = this.files.get(fromKey);
        if (!data) return false;
        this.files.delete(fromKey);
        this.write(to, data);
        return true;
    }

    mkdir(path: string): void {
        const key = this.key(path);
        this.ensureParents(key);
        this.dirs.add(key);
    }

    /** Імена безпосередніх нащадків каталогу. */
    list(path: string): string[] {
        const key = this.key(path);
        const prefix = key === '' ? '' : key + '/';
        const names = new Set<string>();

        for (const source of [this.files.keys(), this.dirs.keys()]) {
            for (const entry of source) {
                if (entry === key || !entry.startsWith(prefix)) continue;
                const rest = entry.slice(prefix.length);
                if (rest === '') continue;
                names.add(rest.split('/')[0]);
            }
        }
        return [...names].sort();
    }

    /** Усі файли монтування — для збереження в IndexedDB та для експорту. */
    entries(): Array<[string, Uint8Array]> {
        return [...this.files.entries()].map(([key, data]) => ['/' + key, data]);
    }

    clear(): void {
        this.files.clear();
        this.dirs.clear();
        this.dirs.add('');
    }

    private ensureParents(key: string): void {
        const parts = key.split('/');
        parts.pop();
        let current = '';
        for (const part of parts) {
            current = current === '' ? part : current + '/' + part;
            this.dirs.add(current);
        }
    }
}

/**
 * Кореневий каталог.
 *
 * Порт `RootVFS`: тільки читання, плаский перелік, і `opendir` приймає
 * ВИКЛЮЧНО `"/"` — будь-який інший шлях у первотворі дає `EINVAL`.
 * Створити щось у корені не можна: решта методів там повертає `ENOSYS`.
 */
export class Vfs {
    private readonly mounts = new Map<MountPoint, MemoryFs>();

    constructor() {
        for (const point of MOUNT_POINTS) this.mounts.set(point, new MemoryFs());
    }

    mount(point: MountPoint): MemoryFs {
        const fs = this.mounts.get(point);
        if (!fs) throw new VfsError(`Немає монтування ${point}`, 'ENODEV');
        return fs;
    }

    /** Розкладає абсолютний шлях на монтування та шлях усередині нього. */
    private resolve(path: string): { fs: MemoryFs; rest: string; point: MountPoint } | null {
        const full = normalizePath(path);
        for (const point of MOUNT_POINTS) {
            if (full === point || full.startsWith(point + '/')) {
                return { fs: this.mount(point), rest: full.slice(point.length) || '/', point };
            }
        }
        return null;
    }

    read(path: string): Uint8Array | null {
        const target = this.resolve(path);
        return target ? target.fs.read(target.rest) : null;
    }

    write(path: string, data: Uint8Array): void {
        const target = this.resolve(path);
        if (!target) throw new VfsError(`Шлях поза межами монтувань: ${path}`, 'ENOENT');
        target.fs.write(target.rest, data);
    }

    exists(path: string): boolean {
        const full = normalizePath(path);
        if (full === '/') return true;
        const target = this.resolve(path);
        if (!target) return false;
        return target.rest === '/' || target.fs.exists(target.rest);
    }

    stat(path: string): VfsStat | null {
        const full = normalizePath(path);
        if (full === '/') return { isDirectory: true, size: 0 };
        const target = this.resolve(path);
        if (!target) return null;
        if (target.rest === '/') return { isDirectory: true, size: 0 };
        return target.fs.stat(target.rest);
    }

    remove(path: string): boolean {
        const target = this.resolve(path);
        return target ? target.fs.remove(target.rest) : false;
    }

    rename(from: string, to: string): boolean {
        const source = this.resolve(from);
        const destination = this.resolve(to);
        if (!source || !destination) return false;
        if (source.point !== destination.point) {
            // Перенесення між монтуваннями: копіювання плюс видалення
            const data = source.fs.read(source.rest);
            if (!data) return false;
            destination.fs.write(destination.rest, data);
            source.fs.remove(source.rest);
            return true;
        }
        return source.fs.rename(source.rest, destination.rest);
    }

    mkdir(path: string): void {
        const target = this.resolve(path);
        if (!target) throw new VfsError(`У корені створювати не можна: ${path}`, 'ENOSYS');
        target.fs.mkdir(target.rest);
    }

    /**
     * Перелік каталогу. Для `/` повертає імена монтувань без початкової риски —
     * саме так `RootVFS::registerPath` кладе `basename(path)`.
     */
    list(path: string): string[] {
        const full = normalizePath(path);
        if (full === '/') return MOUNT_POINTS.map((point) => point.slice(1));
        const target = this.resolve(path);
        if (!target) return [];
        return target.fs.list(target.rest);
    }

    /** Усі файли всіх монтувань — для панелі файлів і для експорту. */
    allFiles(): Array<{ path: string; size: number }> {
        const out: Array<{ path: string; size: number }> = [];
        for (const point of MOUNT_POINTS) {
            for (const [path, data] of this.mount(point).entries()) {
                out.push({ path: point + path, size: data.length });
            }
        }
        return out.sort((a, b) => a.path.localeCompare(b.path));
    }
}
