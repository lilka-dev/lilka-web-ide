/**
 * Афінне перетворення 2x2 — порт `lilka::Transform`.
 *
 * Три речі, від яких залежить збіг з залізом:
 *   1. `rotate` бере синус із таблиці прошивки, а не з `Math.sin`;
 *   2. матриця в C оголошена як `float`, тому кожна операція округлюється
 *      до float32 через `Math.fround`;
 *   3. `transform()` робить `static_cast<int32_t>`, тобто відкидає дріб
 *      У БІК НУЛЯ. `Math.floor` тут дав би інший піксель для від'ємних
 *      координат — а вони трапляються завжди, бо обхід іде від лівого
 *      верхнього кута обмежувальної рамки.
 *
 * Об'єкт незмінний: `rotate` і `scale` повертають нове перетворення, як і в
 * Lua API (`Transform:rotate` повертає нове значення, не змінюючи поточне).
 */

import { fCos360, fSin360 } from './fmath.ts';

const f = Math.fround;

export type Matrix2x2 = readonly [readonly [number, number], readonly [number, number]];

export class Transform {
    readonly matrix: Matrix2x2;

    constructor(matrix: Matrix2x2 = [
        [1, 0],
        [0, 1],
    ]) {
        this.matrix = [
            [f(matrix[0][0]), f(matrix[0][1])],
            [f(matrix[1][0]), f(matrix[1][1])],
        ];
    }

    /** `this * other` — саме в такому порядку, як `Transform::multiply`. */
    multiply(other: Transform): Transform {
        const a = this.matrix;
        const b = other.matrix;
        return new Transform([
            [f(f(a[0][0] * b[0][0]) + f(a[0][1] * b[1][0])), f(f(a[0][0] * b[0][1]) + f(a[0][1] * b[1][1]))],
            [f(f(a[1][0] * b[0][0]) + f(a[1][1] * b[1][0])), f(f(a[1][0] * b[0][1]) + f(a[1][1] * b[1][1]))],
        ]);
    }

    /** Кут у градусах, за годинниковою стрілкою (вісь Y дивиться вниз). */
    rotate(angle: number): Transform {
        const rotation = new Transform([
            [fCos360(angle), -fSin360(angle)],
            [fSin360(angle), fCos360(angle)],
        ]);
        // У первотворі: `return t.multiply(*this)` — обертання застосовується злива
        return rotation.multiply(this);
    }

    scale(sx: number, sy: number): Transform {
        if (sx === 0 || sy === 0) {
            // Прошивка сварить у лог і повертає поточне перетворення без змін
            return this;
        }
        return new Transform([
            [sx, 0],
            [0, sy],
        ]).multiply(this);
    }

    inverse(): Transform {
        const m = this.matrix;
        const det = f(f(m[0][0] * m[1][1]) - f(m[0][1] * m[1][0]));
        return new Transform([
            [f(m[1][1] / det), f(-m[0][1] / det)],
            [f(-m[1][0] / det), f(m[0][0] / det)],
        ]);
    }

    /** Застосувати до цілочисельної точки. Відкидання дробу — у бік нуля. */
    apply(x: number, y: number): { x: number; y: number } {
        const m = this.matrix;
        return {
            x: Math.trunc(f(f(m[0][0] * x) + f(m[0][1] * y))),
            y: Math.trunc(f(f(m[1][0] * x) + f(m[1][1] * y))),
        };
    }
}
