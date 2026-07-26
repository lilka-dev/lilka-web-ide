/**
 * Типізований доступ до board.json.
 *
 * board.json — єдине джерело правди про залізо, згенероване з
 * `sdk/lib/lilka/src/lilka/config.h` та сусідніх файлів. Нічого з цих чисел
 * не варто дублювати в коді: змінилася плата — змінився лише JSON.
 */

import boardData from '../generated/board.json';
import type { ButtonName } from '../emulator/controller.ts';

export interface DisplayInfo {
    controller: string;
    panelWidth: number;
    panelHeight: number;
    rotation: number;
    rowOffset: number;
    /** Ефективна ширина ПІСЛЯ повороту. Для v2 це 280, а не 240. */
    width: number;
    height: number;
    colorFormat: string;
}

export interface CanvasRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CanvasInfo {
    statusBarHeight: number;
    fullscreen: CanvasRect;
    windowed: CanvasRect;
}

export interface ButtonInfo {
    name: ButtonName;
    gpio: number;
    label: string;
    defaultKeys: string[];
    present: boolean;
}

export interface FontInfo {
    name: string;
    u8g2: string;
    cellWidth: number;
    cellHeight: number;
}

export interface BoardProfile {
    name: string;
    lilkaVersion: number;
    mcu: string;
    display: DisplayInfo;
    canvas: CanvasInfo;
    buttons: ButtonInfo[];
}

const spec = boardData as unknown as {
    defaultBoard: string;
    boards: Record<string, BoardProfile>;
    fonts: FontInfo[];
    defaultFont: string;
    colors: Record<string, number>;
    constants: { gpio: Record<string, number>; spi: Record<string, number> };
};

export const BOARDS = spec.boards;
export const FONTS = spec.fonts;
export const DEFAULT_FONT = spec.defaultFont;
export const COLORS = spec.colors;
export const GPIO_CONSTANTS = spec.constants.gpio;
export const SPI_CONSTANTS = spec.constants.spi;

export function getBoard(id: string = spec.defaultBoard): BoardProfile {
    const board = spec.boards[id];
    if (!board) throw new Error(`Невідомий профіль плати: ${id}`);
    return board;
}

export function fontInfo(name: string): FontInfo {
    const found = spec.fonts.find((f) => f.name === name);
    if (!found) throw new Error(`Невідомий шрифт: ${name}`);
    return found;
}

/** Розкладка клавіатури у вигляді, який очікує Controller. */
export function keyBindings(board: BoardProfile): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const button of board.buttons) {
        if (button.present) map[button.name] = button.defaultKeys;
    }
    return map;
}
