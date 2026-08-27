/**
 * Словник інтерфейсу: англійська й українська.
 *
 * Лише елементи застосунку — кнопки, меню, повідомлення. НЕ перекладаються:
 * фізична шовкографія на намальованій платі (`shell.ts` — вона така на
 * справжньому залізі), вміст віджетів прошивки (його задає сам Lua-скрипт,
 * а не середовище) і внутрішні повідомлення виключень у `src/runtime/` та
 * `src/emulator/` (рідкісні шляхи-«цього не повинно статися», що не
 * проходять через шар інтерфейсу).
 *
 * Тип `en` — джерело ключів: `Record<Key, string>` для `uk` змушує TS
 * впасти, якщо переклад забули додати або лишили зайвим.
 */

import { getLang } from './lang.ts';

const en = {
    'editor.run': '▶ Run',
    'editor.stop': '■ Stop',
    'editor.runOnDevice': 'On device',
    'editor.filesPrefix': 'Files › ',
    'editor.saved': 'saved',
    'editor.saving': 'saving…',
    'editor.goToLine': 'Go to line {n}',
    'editor.placeholder': 'Your Lilka program goes here',
    'editor.langTitle': 'Interface language',

    'host.idle': 'starting environment…',
    'host.loading': 'loading Lua…',
    'host.ready': 'ready',
    'host.running': 'running',
    'host.stopping': 'stopping…',
    'host.notReady': 'Lua not ready yet',
    'host.failedToStart': 'Lua failed to start',

    'device.chromeOnly': 'connecting to Lilka — Chrome only',
    'device.chromeOnlyTitle': 'USB access from a web page works only in Chrome and Edge',
    'device.connect': 'Connect Lilka',
    'device.connectedLabel': 'Lilka · USB ▾',
    'device.connected': 'Lilka connected.',
    'device.disconnected': 'Lilka disconnected.',
    'device.runConfirm':
        "Only the code travels over the cable.\n\nThis program uses files — images, sounds, or modules. " +
        "They must already be on Lilka's memory card, or the program will crash.\n\nRun anyway?",
    'device.sending': 'Sending code to Lilka…',
    'device.sent': 'Code sent. On Lilka this should open "Development → Lua Live".',
    'device.browserUnsupported': "This browser can't work with USB. Chrome or Edge is required.",
    'device.connectFailed': "Couldn't connect: {error}",
    'device.connectionLost': 'Connection to Lilka was lost: {error}',
    'device.notConnected': 'Lilka is not connected',

    'files.root': 'Files',
    'files.unitByte': 'B',
    'files.unitKB': 'KB',
    'files.unitMB': 'MB',
    'files.upload': 'Upload',
    'files.uploadFile': 'File…',
    'files.uploadFolder': 'Folder…',
    'files.create': 'New',
    'files.createFolder': 'Folder…',
    'files.createFolderTitle': 'New folder',
    'files.createFolderHint': 'Folder name',
    'files.createFile': 'File…',
    'files.createFileTitle': 'New file',
    'files.createFileHint': 'File name with extension',
    'files.viewGrid': 'Grid',
    'files.viewList': 'List',
    'files.fix': 'Fix for Lilka',
    'files.fixShort': 'Fix',
    'files.open': 'Open',
    'files.openInEditor': 'Open in editor',
    'files.rename': 'Rename',
    'files.renameTitle': 'Rename',
    'files.renameHint': 'New name',
    'files.duplicate': 'Duplicate',
    'files.moveEllipsis': 'Move…',
    'files.downloadArchive': 'Download as archive',
    'files.download': 'Download',
    'files.delete': 'Delete',
    'files.confirmDeleteFolder': 'Delete folder "{name}" and everything inside?',
    'files.fixedTo': '"{from}" was re-saved as "{to}" — Lilka will read it correctly now.',
    'files.fixFailed': 'Could not fix "{name}": {error}',
    'files.cancel': 'Cancel',
    'files.done': 'Done',
    'files.moveOne': 'Move "{name}"',
    'files.moveMany': 'Move {n} items',
    'files.moveHint': 'Choose where to put it',
    'files.move': 'Move',
    'files.movingNote': 'being moved',
    'files.hereNote': 'current location',
    'files.selected': '{n} selected',
    'files.empty': 'empty',
    'files.summaryOne': '1 item · {size}',
    'files.summaryMany': '{n} items · {size}',
    'files.select': 'Select',
    'files.actions': 'Actions',
    'files.folderKind': 'folder',
    'files.dropHere': 'Drag images here',
    'files.andMore': '(and {n} more)',
    'files.downloadEmptyFolder': 'Folder "{name}" is empty — nothing to pack.',
    'files.problem.too-large': 'larger than 1024 pixels — Lilka will not load it',
    'files.problem.top-down': 'saved bottom-up — Lilka will not load it',
    'files.problem.alpha-lost': 'the transparent background will be lost — BMP does not keep it',
    'files.problem.row-padding': 'the image will skew diagonally — width is not a multiple of 4',

    'console.title': 'Try a command',
    'console.clear': 'Clear',
    'console.close': 'Close',
    'console.placeholder': 'command for Lilka…',
    'console.tip': 'Enter — run',
    'console.hint1': 'Type one line at a time — Lilka runs it immediately.',
    'console.hint2': 'Try:',
    'console.ready': 'Lilka is connected',
    'console.silent': 'Lilka is silent',
    'console.warning':
        'Looks like Lilka is not waiting for commands right now. On Lilka itself, open ' +
        '<strong>Development → Lua REPL</strong> — then come back here.',
    'console.warningNote': 'Leave this mode on Lilka with the A button.',
    'console.silentFillScreen': "Lilka's screen was filled with color",
    'console.silentDisplay': "drawn on Lilka's screen",
    'console.silentBuzzer': 'sound on Lilka',
    'console.silentSleep': 'pause',

    'hud.stats': '{fps} fps output · Lua frame {frame} · skipped {skipped} · scale {scale}×',
    'hud.scaleOnly': 'scale {scale}×',

    'example.circle': 'Circle & buttons',
    'example.dice': 'Dice game',
    'example.simon': 'Repeat the pattern',
    'example.snake': 'Snake',
    'example.asteroids': 'Asteroids',
    'example.cat': 'Cat (with pictures)',
};

export type Key = keyof typeof en;

const uk: Record<Key, string> = {
    'editor.run': '▶ Запустити',
    'editor.stop': '■ Зупинити',
    'editor.runOnDevice': 'На пристрої',
    'editor.filesPrefix': 'Файли › ',
    'editor.saved': 'збережено',
    'editor.saving': 'збереження…',
    'editor.goToLine': 'Перейти до рядка {n}',
    'editor.placeholder': 'Тут буде програма для Лілки',
    'editor.langTitle': 'Мова інтерфейсу',

    'host.idle': 'запуск середовища…',
    'host.loading': 'завантаження Lua…',
    'host.ready': 'готово',
    'host.running': 'виконується',
    'host.stopping': 'зупинка…',
    'host.notReady': 'Lua не готова',
    'host.failedToStart': 'Lua не запустилася',

    'device.chromeOnly': 'підключення до Лілки — у Chrome',
    'device.chromeOnlyTitle': 'Доступ до USB із веб-сторінки є лише в Chrome і Edge',
    'device.connect': "Під'єднати Лілку",
    'device.connectedLabel': 'Лілка · USB ▾',
    'device.connected': "Лілку під'єднано.",
    'device.disconnected': "Лілку від'єднано.",
    'device.runConfirm':
        'Через кабель їде лише код.\n\nЦя програма використовує файли — картинки, звуки або модулі. ' +
        "Вони мають уже лежати на картці пам'яті Лілки, інакше програма впаде.\n\nЗапустити все одно?",
    'device.sending': 'Надсилаю код на Лілку…',
    'device.sent': 'Код надіслано. На Лілці має відкритися «Розробка → Lua Live».',
    'device.browserUnsupported': 'Цей браузер не вміє працювати з USB. Потрібен Chrome або Edge.',
    'device.connectFailed': 'Не вдалося підключитися: {error}',
    'device.connectionLost': "Зв'язок із Лілкою обірвався: {error}",
    'device.notConnected': 'Лілка не підключена',

    'files.root': 'Файли',
    'files.unitByte': 'Б',
    'files.unitKB': 'КБ',
    'files.unitMB': 'МБ',
    'files.upload': 'Завантажити',
    'files.uploadFile': 'Файл…',
    'files.uploadFolder': 'Тека…',
    'files.create': 'Створити',
    'files.createFolder': 'Тека…',
    'files.createFolderTitle': 'Нова тека',
    'files.createFolderHint': 'Назва теки',
    'files.createFile': 'Файл…',
    'files.createFileTitle': 'Новий файл',
    'files.createFileHint': 'Назва файлу з розширенням',
    'files.viewGrid': 'Плитка',
    'files.viewList': 'Рядки',
    'files.fix': 'Виправити для Лілки',
    'files.fixShort': 'Виправити',
    'files.open': 'Відкрити',
    'files.openInEditor': 'Відкрити в редакторі',
    'files.rename': 'Перейменувати',
    'files.renameTitle': 'Перейменувати',
    'files.renameHint': 'Нова назва',
    'files.duplicate': 'Дублювати',
    'files.moveEllipsis': 'Перемістити…',
    'files.downloadArchive': 'Завантажити архівом',
    'files.download': 'Завантажити',
    'files.delete': 'Видалити',
    'files.confirmDeleteFolder': 'Видалити теку «{name}» з усім вмістом?',
    'files.fixedTo': '«{from}» перезбережено як «{to}» — тепер Лілка прочитає її правильно.',
    'files.fixFailed': 'Не вдалося виправити «{name}»: {error}',
    'files.cancel': 'Скасувати',
    'files.done': 'Готово',
    'files.moveOne': 'Перемістити «{name}»',
    'files.moveMany': "Перемістити {n} об'єктів",
    'files.moveHint': 'Оберіть, куди покласти',
    'files.move': 'Перемістити',
    'files.movingNote': 'переміщується',
    'files.hereNote': 'тут зараз',
    'files.selected': 'обрано {n}',
    'files.empty': 'порожньо',
    'files.summaryOne': "1 об'єкт · {size}",
    'files.summaryMany': "{n} об'єктів · {size}",
    'files.select': 'Обрати',
    'files.actions': 'Дії',
    'files.folderKind': 'тека',
    'files.dropHere': 'Перетягніть картинки сюди',
    'files.andMore': '(і ще {n})',
    'files.downloadEmptyFolder': 'Тека «{name}» порожня — пакувати нічого.',
    'files.problem.too-large': 'більша за 1024 пікселі — Лілка її не завантажить',
    'files.problem.top-down': 'збережена догори низом — Лілка її не завантажить',
    'files.problem.alpha-lost': 'прозоре тло зникне, бо BMP її не зберігає',
    'files.problem.row-padding': 'зображення поїде по діагоналі через ширину, не кратну 4',

    'console.title': 'Спробувати команду',
    'console.clear': 'Очистити',
    'console.close': 'Закрити',
    'console.placeholder': 'команда для Лілки…',
    'console.tip': 'Enter — виконати',
    'console.hint1': 'Пишіть по одному рядку — Лілка виконає його одразу.',
    'console.hint2': 'Спробуйте:',
    'console.ready': 'Лілка на звʼязку',
    'console.silent': 'Лілка мовчить',
    'console.warning':
        'Схоже, Лілка зараз не чекає команд. На самій Лілці відкрийте ' +
        '<strong>Розробка → Lua REPL</strong> — і поверніться сюди.',
    'console.warningNote': 'Вийти з цього режиму на Лілці — кнопкою A.',
    'console.silentFillScreen': 'екран Лілки залито кольором',
    'console.silentDisplay': 'намальовано на екрані Лілки',
    'console.silentBuzzer': 'звук на Лілці',
    'console.silentSleep': 'пауза',

    'hud.stats': '{fps} к/с виводу · кадр Lua {frame} · пропущено {skipped} · масштаб {scale}×',
    'hud.scaleOnly': 'масштаб {scale}×',

    'example.circle': 'Коло та кнопки',
    'example.dice': 'Гра «Кубики»',
    'example.simon': 'Повтори комбінацію',
    'example.snake': 'Змійка',
    'example.asteroids': 'Астероїди',
    'example.cat': 'Кіт (із картинками)',
};

/** Підставляє `{ім'я}` у рядок значеннями з `params`. */
function interpolate(template: string, params?: Record<string, string | number>): string {
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
    );
}

export function t(key: Key, params?: Record<string, string | number>): string {
    const dict = getLang() === 'uk' ? uk : en;
    return interpolate(dict[key], params);
}
