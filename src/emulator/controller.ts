/**
 * Контролер.
 *
 * Семантика повторює `controller.get_state()` у прошивці: прапорці
 * `just_pressed` / `just_released` живуть до наступного читання стану, після
 * чого скидаються. Саме тому вони накопичуються в окремих полях, а не
 * обчислюються порівнянням з попереднім кадром — інакше програма, яка читає
 * стан двічі за кадр, побачила б натискання двічі, чого на залізі не буває.
 */

export type ButtonName =
    | 'up' | 'down' | 'left' | 'right'
    | 'a' | 'b' | 'c' | 'd'
    | 'select' | 'start';

export const BUTTON_NAMES: readonly ButtonName[] = [
    'up', 'down', 'left', 'right', 'a', 'b', 'c', 'd', 'select', 'start',
];

export interface ButtonState {
    pressed: boolean;
    just_pressed: boolean;
    just_released: boolean;
}

export type ControllerState = Record<ButtonName, ButtonState>;

interface Slot {
    pressed: boolean;
    justPressed: boolean;
    justReleased: boolean;
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
                justPressed: false,
                justReleased: false,
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
            slot.justPressed = true;
        }
    }

    release(button: ButtonName, holder: string): void {
        const slot = this.slots.get(button);
        if (!slot) return;
        slot.holders.delete(holder);
        if (slot.pressed && slot.holders.size === 0) {
            slot.pressed = false;
            slot.justReleased = true;
        }
    }

    releaseAll(holder: string): void {
        for (const name of BUTTON_NAMES) this.release(name, holder);
    }

    /** Чи натиснута кнопка зараз — для підсвітки в інтерфейсі. */
    isPressed(button: ButtonName): boolean {
        return this.slots.get(button)?.pressed ?? false;
    }

    /**
     * Знімок стану. Скидає прапорці just_*, як і прошивка.
     */
    readState(): ControllerState {
        const state = {} as ControllerState;
        for (const name of BUTTON_NAMES) {
            const slot = this.slots.get(name)!;
            state[name] = {
                pressed: slot.pressed,
                just_pressed: slot.justPressed,
                just_released: slot.justReleased,
            };
            slot.justPressed = false;
            slot.justReleased = false;
        }
        return state;
    }

    destroy(): void {
        for (const detach of this.listeners) detach();
        this.listeners = [];
    }
}
