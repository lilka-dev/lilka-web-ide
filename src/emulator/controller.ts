/**
 * Контролер.
 *
 * Тримає рівень кожної кнопки й лічильники подій — скільки разів її натиснули
 * та відпустили. Прапорці `just_pressed` / `just_released` з них виводить уже
 * воркер (`LilkaDevice.sampleButtons`): саме там живе програма, і саме там їх
 * треба скидати при читанні, бо на залізі `getState()` прапорець забирає.
 *
 * Чому лічильники, а не прапорці по цей бік: подія мусить пережити кадр. Дотик,
 * який почався й закінчився між двома знімками воркера, за рівнем кнопки
 * невидимий — а на залізі його ловить перехоплювач контролера, там
 * `justPressed` виставляється на самому фронті. Лічильник зростає так само
 * невідворотно, тож воркер бачить різницю навіть тоді, коли кнопка вже
 * відпущена.
 */

export type ButtonName =
    | 'up' | 'down' | 'left' | 'right'
    | 'a' | 'b' | 'c' | 'd'
    | 'select' | 'start';

export const BUTTON_NAMES: readonly ButtonName[] = [
    'up', 'down', 'left', 'right', 'a', 'b', 'c', 'd', 'select', 'start',
];

interface Slot {
    pressed: boolean;
    /** Монотонні лічильники фронтів. До переповнення int32 тут не дійде. */
    presses: number;
    releases: number;
    /** Скільки джерел тримають кнопку: клавіатура, дотик, мишка. */
    holders: Set<string>;
}

export class Controller {
    private readonly slots = new Map<ButtonName, Slot>();
    /** code клавіші -> кнопка. Заповнюється з board.json. */
    private readonly keyMap = new Map<string, ButtonName>();
    private listeners: Array<() => void> = [];

    constructor(keyBindings: Record<string, readonly string[]>) {
        for (const name of BUTTON_NAMES) {
            this.slots.set(name, {
                pressed: false,
                presses: 0,
                releases: 0,
                holders: new Set(),
            });
        }
        for (const [button, keys] of Object.entries(keyBindings)) {
            for (const key of keys) this.keyMap.set(key, button as ButtonName);
        }
    }

    /**
     * Чи слід пропустити подію клавіатури повз контролер.
     *
     * Дві причини, і обидві з практики:
     *   - фокус у полі вводу: KeyA прив'язана до кнопки «вліво», і без цієї
     *     перевірки набір тексту натискав би кнопки;
     *   - утримується Cmd/Ctrl/Alt: інакше preventDefault з'їдав би Cmd+A,
     *     Cmd+C і решту комбінацій, і виділити текст стало б неможливо.
     */
    private static shouldIgnore(event: KeyboardEvent): boolean {
        if (event.ctrlKey || event.metaKey || event.altKey) return true;
        const target = event.target as HTMLElement | null;
        if (!target) return false;
        const tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    /** Підписується на клавіатуру. Повертає функцію відписки. */
    attachKeyboard(target: EventTarget = window): () => void {
        const onDown = (event: Event) => {
            const e = event as KeyboardEvent;
            if (Controller.shouldIgnore(e)) return;
            const button = this.keyMap.get(e.code);
            if (!button) return;
            e.preventDefault();
            if (e.repeat) return;
            this.press(button, 'key');
        };
        const onUp = (event: Event) => {
            const e = event as KeyboardEvent;
            if (Controller.shouldIgnore(e)) return;
            const button = this.keyMap.get(e.code);
            if (!button) return;
            e.preventDefault();
            this.release(button, 'key');
        };
        const onBlur = () => this.releaseAll('key');

        target.addEventListener('keydown', onDown);
        target.addEventListener('keyup', onUp);
        window.addEventListener('blur', onBlur);

        const detach = () => {
            target.removeEventListener('keydown', onDown);
            target.removeEventListener('keyup', onUp);
            window.removeEventListener('blur', onBlur);
        };
        this.listeners.push(detach);
        return detach;
    }

    press(button: ButtonName, holder: string): void {
        const slot = this.slots.get(button);
        if (!slot) return;
        slot.holders.add(holder);
        if (!slot.pressed) {
            slot.pressed = true;
            slot.presses++;
        }
    }

    release(button: ButtonName, holder: string): void {
        const slot = this.slots.get(button);
        if (!slot) return;
        slot.holders.delete(holder);
        if (slot.pressed && slot.holders.size === 0) {
            slot.pressed = false;
            slot.releases++;
        }
    }

    releaseAll(holder: string): void {
        for (const name of BUTTON_NAMES) this.release(name, holder);
    }

    /** Чи натиснута кнопка зараз — для підсвітки в інтерфейсі. */
    isPressed(button: ButtonName): boolean {
        return this.slots.get(button)?.pressed ?? false;
    }

    /** Скільки разів кнопку натиснули від початку сеансу. */
    pressCount(button: ButtonName): number {
        return this.slots.get(button)?.presses ?? 0;
    }

    /** Скільки разів кнопку відпустили від початку сеансу. */
    releaseCount(button: ButtonName): number {
        return this.slots.get(button)?.releases ?? 0;
    }

    destroy(): void {
        for (const detach of this.listeners) detach();
        this.listeners = [];
    }
}
