/**
 * Намальована Лілка — компактна розкладка.
 *
 * Плата насправді широка: хрестовина ліворуч від екрана, дії праворуч. Але у
 * вертикальній колонці поруч із редактором це з'їдало б забагато ширини, тому
 * тут органи керування зібрані ПІД екраном. Розташування кнопок одне до одного
 * збережене — обидві групи ромбом, і праворуч C зверху, D ліворуч, A праворуч,
 * B знизу, як на платі. Рука тягнеться туди ж, куди й на справжній Лілці.
 *
 * Екранні кнопки приєднані до того самого `Controller`, що й клавіатура, через
 * механізм «утримувачів»: одночасне натискання пальцем і клавішею не збиває
 * стан.
 */

import type { BoardProfile, ButtonInfo } from '../board/board.ts';
import type { Controller } from '../emulator/controller.ts';
import type { Screen } from '../emulator/screen.ts';

const GLYPHS: Record<string, string> = {
    up: '▲',
    down: '▼',
    left: '◀',
    right: '▶',
};

export interface Shell {
    root: HTMLElement;
    syncButtons(): void;
    layout(): void;
}

export function createShell(board: BoardProfile, controller: Controller, screen: Screen): Shell {
    const root = document.createElement('div');
    root.className = 'device';

    const buttons = new Map<string, HTMLButtonElement>();
    const byName = new Map(board.buttons.map((b) => [b.name, b]));

    const makeButton = (name: string, className: string): HTMLElement | null => {
        const info = byName.get(name as ButtonInfo['name']);
        if (!info || !info.present) return null;

        const el = document.createElement('button');
        el.type = 'button';
        el.className = className;
        el.textContent = GLYPHS[name] ?? info.label;
        el.title = `${info.label} · GPIO${info.gpio} · ${info.defaultKeys.join(' / ')}`;

        const hold = (event: Event) => {
            event.preventDefault();
            controller.press(info.name, 'pointer');
            syncButtons();
        };
        const letGo = (event: Event) => {
            event.preventDefault();
            controller.release(info.name, 'pointer');
            syncButtons();
        };
        el.addEventListener('pointerdown', hold);
        el.addEventListener('pointerup', letGo);
        el.addEventListener('pointerleave', letGo);
        el.addEventListener('pointercancel', letGo);

        buttons.set(name, el);
        return el;
    };

    // --- екран у бірюзовій рамці, як тримач дисплея на платі
    const screenSlot = document.createElement('div');
    screenSlot.className = 'device__screen';
    screenSlot.append(screen.canvas);
    root.append(screenSlot);

    // --- органи керування під екраном
    const controls = document.createElement('div');
    controls.className = 'device__controls';

    const dpad = document.createElement('div');
    dpad.className = 'pad';
    for (const name of ['up', 'left', 'right', 'down']) {
        const el = makeButton(name, `key key--round key--${name}`);
        if (el) dpad.append(el);
    }

    // Select і Start — пігулки з підписом усередині. Вони службові, тому
    // навмисно менші за круглі кнопки: розмір сам відсуває їх на другий план,
    // і для цього не потрібен окремий колір.
    const middle = document.createElement('div');
    middle.className = 'device__system';
    for (const name of ['select', 'start']) {
        const el = makeButton(name, 'key key--pill');
        if (el) middle.append(el);
    }

    const actions = document.createElement('div');
    actions.className = 'pad';
    for (const name of ['c', 'd', 'a', 'b']) {
        const el = makeButton(name, `key key--round key--action key--${name}`);
        if (el) actions.append(el);
    }

    controls.append(dpad, middle, actions);
    root.append(controls);

    // --- шовкографія знизу, як на платі
    const silk = document.createElement('div');
    silk.className = 'device__silk';
    silk.innerHTML =
        `<span>${board.name} · ${board.display.width}×${board.display.height}</span>` +
        `<span class="device__motto">Борітеся — поборете.</span>` +
        `<span class="device__logo">ЛІЛКА</span>`;
    root.append(silk);

    function syncButtons(): void {
        for (const [name, el] of buttons) {
            // Модифікатор навмисно НЕ називається key--down: такий клас уже
            // задає розташування кнопки «вниз», і toggle стирав би його
            el.classList.toggle('key--pressed', controller.isPressed(name as ButtonInfo['name']));
        }
    }

    function layout(): void {
        const rect = screenSlot.getBoundingClientRect();
        // Висоту обмежуємо так, щоб під екраном лишалося місце на кнопки
        // й шовкографію, інакше на низькому вікні пристрій не влізе цілком.
        screen.fit(Math.max(1, rect.width - 24), Math.max(1, window.innerHeight - 300));
    }

    return { root, syncButtons, layout };
}
