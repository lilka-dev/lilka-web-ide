/**
 * Тригонометрія прошивки.
 *
 * Лілка не викликає `sin()`, а бере значення з таблиць на 360 і 32 позиції,
 * записаних у `fmath.cpp` з шістьма знаками після коми. `Math.sin` дає інші
 * числа — відхилення до 5.3e-7 — і після `static_cast<int32_t>` це здатне
 * зсунути піксель. Тому тут ті самі таблиці, згенеровані з коду прошивки.
 *
 * `Float32Array` вибрано не для економії: він округлює значення до float,
 * як у C, де таблиці оголошені саме як `float`.
 */

import { SIN_360, SIN_32 } from '../generated/fmath-tables.ts';

const sin360 = Float32Array.from(SIN_360);
const sin32 = Float32Array.from(SIN_32);

function wrap(value: number, period: number): number {
    let v = Math.trunc(value) % period;
    if (v < 0) v += period;
    return v;
}

export function fSin360(deg: number): number {
    return sin360[wrap(deg, 360)];
}

export function fCos360(deg: number): number {
    return sin360[(wrap(deg, 360) + 90) % 360];
}

export function fSin32(fract: number): number {
    return sin32[wrap(fract, 32)];
}

export function fCos32(fract: number): number {
    return sin32[(wrap(fract, 32) + 8) % 32];
}
