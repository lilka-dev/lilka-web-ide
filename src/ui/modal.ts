/**
 * Велике вікно для редакторів — тексту й картинок.
 *
 * На відміну від вікон розміру й обрізання, тут довга робота, тож закрити
 * випадковим кліком повз вікно не можна, а незбережені зміни питають
 * підтвердження: інакше хвилина малювання зникала б від одного Escape.
 */

import { t } from '../i18n/index.ts';

export interface Modal {
    dialog: HTMLElement;
    head: HTMLElement;
    body: HTMLElement;
    footer: HTMLElement;
    /** Закрити без питань — після збереження. */
    close(): void;
    /** Закрити, спитавши про незбережене. */
    requestClose(): void;
}

export function openModal(options: {
    title: string;
    fileName: string;
    className: string;
    isDirty: () => boolean;
    onKey?: (event: KeyboardEvent) => void;
}): Modal {
    const overlay = document.createElement('div');
    overlay.className = 'overlay overlay--editor';

    const dialog = document.createElement('div');
    dialog.className = `dialog dialog--editor ${options.className}`;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', options.title);

    const head = document.createElement('div');
    head.className = 'dialog__title imgdlg__head';

    const heading = document.createElement('span');
    heading.textContent = options.title;

    const name = document.createElement('span');
    name.className = 'imgdlg__name';
    name.textContent = options.fileName;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'imgdlg__close';
    closeButton.textContent = '×';
    closeButton.title = t('files.cancel');

    head.append(heading, name, closeButton);

    const body = document.createElement('div');
    body.className = 'modal__body';
    const footer = document.createElement('div');
    footer.className = 'dialog__footer';

    dialog.append(head, body, footer);
    overlay.append(dialog);

    const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            requestClose();
            return;
        }
        options.onKey?.(event);
    };

    function close(): void {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
    }

    function requestClose(): void {
        if (options.isDirty() && !confirm(t('editors.discard'))) return;
        close();
    }

    closeButton.addEventListener('click', requestClose);
    // Перехоплення на спуску: інакше клавіші вікна дійшли б і до головного
    // редактора коду під ним
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);

    return { dialog, head, body, footer, close, requestClose };
}

/** Кнопка підвалу. */
export function footerButton(label: string, primary: boolean, run: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = primary ? 'button button--primary' : 'button';
    button.textContent = label;
    button.addEventListener('click', run);
    return button;
}
