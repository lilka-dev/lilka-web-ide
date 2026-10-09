/**
 * sinf / cosf / tanf — порт fdlibm із newlib, тієї самої, що в прошивці.
 *
 * Навіщо, якщо є `Math.sin`. Lua на Лілці 32-бітна, і `math.sin(x)` там — це
 * `sinf` з newlib (для Xtensa `__OBSOLETE_MATH = 1`, тобто класичний fdlibm).
 * Він не завжди округлює правильно: cos(rad(30)) на залізі на один ulp більший
 * за точне значення, і `math.round(35 * math.sin(math.rad(210)))` дає -18, а не
 * -17 — лінія закінчується на піксель далі. `Math.fround(Math.sin(x))` дає
 * точне значення, а залізо — ні.
 *
 * Друге, без чого збігу немає: GCC для ESP32-S3 зливає `c + a*b` і `c - a*b`
 * в одну інструкцію FPU (`madd.s` / `msub.s`) з ОДНИМ округленням. Форму
 * `a*b - c` Xtensa злити не вміє. Обидва правила відтворено в `mad`/`msb`.
 * Звірено зі справжньою Лілкою: 155 із 155 значень sin і cos збігаються до
 * біта, тоді як `Math.fround(Math.sin(x))` — лише 146 і 139.
 *
 * Константи — з src/generated/newlib-libm.ts (scripts/gen-libm.mjs).
 */

import { NEWLIB } from '../generated/newlib-libm.ts';

const f = Math.fround;

const f32 = new DataView(new ArrayBuffer(4));
const bitsOf = (x: number): number => {
    f32.setFloat32(0, x);
    return f32.getInt32(0);
};
const fromBits = (bits: number): number => {
    f32.setInt32(0, bits);
    return f32.getFloat32(0);
};

const f64 = new DataView(new ArrayBuffer(8));
/** Сусіднє double у бік знака `direction` — для розв'язання подвійного округлення. */
function nextDouble(x: number, direction: number): number {
    if (x === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
    f64.setFloat64(0, x);
    const bits = f64.getBigInt64(0);
    f64.setBigInt64(0, (x > 0) === direction > 0 ? bits + 1n : bits - 1n);
    return f64.getFloat64(0);
}

/**
 * c + a*b з одним округленням до float, як `madd.s`.
 *
 * Добуток двох float точний у double (24 + 24 < 53 біти), а от сума — ні, і
 * друге округлення до float могло б розійтися з єдиним округленням FPU. Тому
 * залишок суми береться через TwoSum, і коли сума потрапила рівно на межу між
 * двома float, вирішує знак залишку.
 */
function fma32(a: number, b: number, c: number): number {
    const p = a * b;
    const s = p + c;
    const bb = s - p;
    const e = p - (s - bb) + (c - bb);
    const r = f(s);
    if (e === 0 || !Number.isFinite(s)) return r;
    const toward = f(nextDouble(s, e));
    return toward !== r && f(nextDouble(s, -e)) === r ? toward : r;
}

const mad = (c: number, a: number, b: number) => fma32(a, b, c);
const msb = (c: number, a: number, b: number) => fma32(-a, b, c);

const F = (bits: number) => fromBits(bits);
const K = NEWLIB;
const S1 = F(K.kf_sin.S1), S2 = F(K.kf_sin.S2), S3 = F(K.kf_sin.S3);
const S4 = F(K.kf_sin.S4), S5 = F(K.kf_sin.S5), S6 = F(K.kf_sin.S6);
const C1 = F(K.kf_cos.C1), C2 = F(K.kf_cos.C2), C3 = F(K.kf_cos.C3);
const C4 = F(K.kf_cos.C4), C5 = F(K.kf_cos.C5), C6 = F(K.kf_cos.C6);
const T = K.kf_tan.T.map(F);
const PIO4 = F(K.kf_tan.pio4), PIO4LO = F(K.kf_tan.pio4lo);
const R = K.ef_rem_pio2;
const INVPIO2 = F(R.invpio2), PIO2_1 = F(R.pio2_1), PIO2_1T = F(R.pio2_1t), PIO2_2 = F(R.pio2_2);
const PIO2_2T = F(R.pio2_2t), PIO2_3 = F(R.pio2_3), PIO2_3T = F(R.pio2_3t);
const PIO2_TABLE = K.kf_rem_pio2.PIo2.map(F);
const TWO8 = F(K.kf_rem_pio2.two8), TWON8 = F(K.kf_rem_pio2.twon8);

/** (int)x у C — відкидання дробу у бік нуля */
const toInt = Math.trunc;

function kernelSin(x: number, y: number, iy: number): number {
    const ix = bitsOf(x) & 0x7fffffff;
    if (ix < 0x32000000 && toInt(x) === 0) return x;
    const z = f(x * x);
    const v = f(z * x);
    const r = mad(S2, z, mad(S3, z, mad(S4, z, mad(S5, z, S6))));
    if (iy === 0) return mad(x, v, mad(S1, z, r));
    // x - ((z*(half*y - v*r) - y) - v*S1); z*(...) - y — форма a*b - c, не зливається
    const inner = msb(f(0.5 * y), v, r);
    return f(x - msb(f(f(z * inner) - y), v, S1));
}

function kernelCos(x: number, y: number): number {
    const ix = bitsOf(x) & 0x7fffffff;
    if (ix < 0x32000000 && toInt(x) === 0) return 1;
    const z = f(x * x);
    const r = f(z * mad(C1, z, mad(C2, z, mad(C3, z, mad(C4, z, mad(C5, z, C6))))));
    const zrxy = msb(f(z * r), x, y);
    if (ix < 0x3e99999a) return f(1 - f(f(0.5 * z) - zrxy));
    const qx = ix > 0x3f480000 ? 0.28125 : fromBits(ix - 0x01000000);
    const hz = f(f(0.5 * z) - qx);
    return f(f(1 - qx) - f(hz - zrxy));
}

function kernelTan(x: number, y: number, iy: number): number {
    const hx = bitsOf(x);
    const ix = hx & 0x7fffffff;
    if (ix < 0x31800000 && toInt(x) === 0) {
        if ((ix | (iy + 1)) === 0) return f(1 / Math.abs(x));
        return iy === 1 ? x : f(-1 / x);
    }
    if (ix >= 0x3f2ca140) {
        if (hx < 0) {
            x = -x;
            y = -y;
        }
        x = f(f(PIO4 - x) + f(PIO4LO - y));
        y = 0;
    }
    const z = f(x * x);
    const w = f(z * z);
    let r = mad(T[1], w, mad(T[3], w, mad(T[5], w, mad(T[7], w, mad(T[9], w, T[11])))));
    let v = f(z * mad(T[2], w, mad(T[4], w, mad(T[6], w, mad(T[8], w, mad(T[10], w, T[12]))))));
    const s = f(z * x);
    r = mad(y, z, mad(y, s, f(r + v)));
    r = mad(r, T[0], s);
    const sum = f(x + r);
    if (ix >= 0x3f2ca140) {
        v = iy;
        const sign = f(1 - ((hx >> 30) & 2));
        return f(sign * f(v - f(2 * f(x - f(f(f(sum * sum) / f(sum + v)) - r)))));
    }
    if (iy === 1) return sum;
    // -1/(x+r), обчислене точно: так у первотворі
    const zz = fromBits(bitsOf(sum) & 0xfffff000);
    v = f(r - f(zz - x));
    const a = f(-1 / sum);
    const t = fromBits(bitsOf(a) & 0xfffff000);
    const one = mad(1, t, zz);
    return mad(t, a, mad(one, t, v));
}

function scalbnf(x: number, n: number): number {
    return f(x * 2 ** n);
}

/** __kernel_rem_pio2f для prec = 2 — великі аргументи, |x| > 2^7·π/2 */
function kernelRemPio2(x: number[], e0: number, nx: number): [number, number, number] {
    const ipio2 = R.two_over_pi;
    const jk = K.kf_rem_pio2.init_jk[2];
    const jp = jk;
    const jx = nx - 1;
    let jv = toInt((e0 - 3) / 8);
    if (jv < 0) jv = 0;
    let q0 = e0 - 8 * (jv + 1);
    const fl: number[] = [];
    const q: number[] = [];
    const iq: number[] = [];
    const fq: number[] = [];
    for (let i = 0, j = jv - jx; i <= jx + jk; i++, j++) fl[i] = j < 0 ? 0 : f(ipio2[j]);
    for (let i = 0; i <= jk; i++) {
        let fw = 0;
        for (let j = 0; j <= jx; j++) fw = mad(fw, x[j], fl[jx + i - j]);
        q[i] = fw;
    }
    let jz = jk;
    let z: number, n: number, ih: number;
    for (;;) {
        let i = 0;
        z = q[jz];
        for (let j = jz; j > 0; i++, j--) {
            const fw = f(toInt(f(TWON8 * z)));
            iq[i] = toInt(msb(z, TWO8, fw));
            z = f(q[j - 1] + fw);
        }
        z = scalbnf(z, q0);
        z = msb(z, 8, f(Math.floor(f(z * 0.125))));
        n = toInt(z);
        z = f(z - n);
        ih = 0;
        if (q0 > 0) {
            const k = iq[jz - 1] >> (8 - q0);
            n += k;
            iq[jz - 1] -= k << (8 - q0);
            ih = iq[jz - 1] >> (7 - q0);
        } else if (q0 === 0) ih = iq[jz - 1] >> 8;
        else if (z >= 0.5) ih = 2;
        if (ih > 0) {
            n += 1;
            let carry = 0;
            for (let k = 0; k < jz; k++) {
                const j = iq[k];
                if (carry === 0) {
                    if (j !== 0) {
                        carry = 1;
                        iq[k] = 0x100 - j;
                    }
                } else iq[k] = 0xff - j;
            }
            if (q0 === 1) iq[jz - 1] &= 0x7f;
            else if (q0 === 2) iq[jz - 1] &= 0x3f;
            if (ih === 2) {
                z = f(1 - z);
                if (carry !== 0) z = f(z - scalbnf(1, q0));
            }
        }
        if (z === 0) {
            let j = 0;
            for (let k = jz - 1; k >= jk; k--) j |= iq[k];
            if (j === 0) {
                let k = 1;
                while (iq[jk - k] === 0) k++;
                for (let m = jz + 1; m <= jz + k; m++) {
                    fl[jx + m] = f(ipio2[jv + m]);
                    let fw = 0;
                    for (let jj = 0; jj <= jx; jj++) fw = mad(fw, x[jj], fl[jx + m - jj]);
                    q[m] = fw;
                }
                jz += k;
                continue;
            }
        }
        break;
    }
    if (z === 0) {
        jz -= 1;
        q0 -= 8;
        while (iq[jz] === 0) {
            jz--;
            q0 -= 8;
        }
    } else {
        z = scalbnf(z, -q0);
        if (z >= TWO8) {
            const fw = f(toInt(f(TWON8 * z)));
            iq[jz] = toInt(msb(z, TWO8, fw));
            jz += 1;
            q0 += 8;
            iq[jz] = toInt(fw);
        } else iq[jz] = toInt(z);
    }
    let fw = scalbnf(1, q0);
    for (let i = jz; i >= 0; i--) {
        q[i] = f(fw * iq[i]);
        fw = f(fw * TWON8);
    }
    for (let i = jz; i >= 0; i--) {
        let acc = 0;
        for (let k = 0; k <= jp && k <= jz - i; k++) acc = mad(acc, PIO2_TABLE[k], q[i + k]);
        fq[jz - i] = acc;
    }
    let sum = 0;
    for (let i = jz; i >= 0; i--) sum = f(sum + fq[i]);
    const y0 = ih === 0 ? sum : -sum;
    let rest = f(fq[0] - sum);
    for (let i = 1; i <= jz; i++) rest = f(rest + fq[i]);
    return [n & 7, y0, ih === 0 ? rest : -rest];
}

/** __ieee754_rem_pio2f: x = n·π/2 + (y0 + y1) */
function remPio2(x: number): [number, number, number] {
    const hx = bitsOf(x);
    const ix = hx & 0x7fffffff;
    if (ix <= 0x3f490fd8) return [0, x, 0];
    if (ix < 0x4016cbe4) {
        const s = hx > 0 ? 1 : -1;
        let z = f(x - s * PIO2_1);
        if ((ix & 0xfffffff0) !== 0x3fc90fd0) {
            const y0 = f(z - s * PIO2_1T);
            return [s, y0, f(f(z - y0) - s * PIO2_1T)];
        }
        z = f(z - s * PIO2_2);
        const y0 = f(z - s * PIO2_2T);
        return [s, y0, f(f(z - y0) - s * PIO2_2T)];
    }
    if (ix <= 0x43490f80) {
        let t = Math.abs(x);
        const n = toInt(mad(0.5, t, INVPIO2));
        const fn = f(n);
        let r = msb(t, fn, PIO2_1);
        let w = f(fn * PIO2_1T);
        let y0: number;
        if (n < 32 && (ix & 0xffffff00) !== R.npio2_hw[n - 1]) {
            y0 = f(r - w);
        } else {
            const j = ix >> 23;
            y0 = f(r - w);
            let i = j - ((bitsOf(y0) >> 23) & 0xff);
            if (i > 8) {
                t = r;
                w = f(fn * PIO2_2);
                r = f(t - w);
                w = f(f(fn * PIO2_2T) - f(f(t - r) - w));
                y0 = f(r - w);
                i = j - ((bitsOf(y0) >> 23) & 0xff);
                if (i > 25) {
                    t = r;
                    w = f(fn * PIO2_3);
                    r = f(t - w);
                    w = f(f(fn * PIO2_3T) - f(f(t - r) - w));
                    y0 = f(r - w);
                }
            }
        }
        const y1 = f(f(r - y0) - w);
        return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
    }
    if (ix >= 0x7f800000) return [0, NaN, NaN];
    // z = scalbn(|x|, ilogb(x) - 7), розкладене на 8-бітові шматки
    const e0 = (ix >> 23) - 134;
    let z = fromBits(ix - (e0 << 23));
    const tx: number[] = [];
    for (let i = 0; i < 2; i++) {
        tx[i] = f(toInt(z));
        z = f(f(z - tx[i]) * TWO8);
    }
    tx[2] = z;
    let nx = 3;
    while (tx[nx - 1] === 0) nx--;
    const [n, y0, y1] = kernelRemPio2(tx, e0, nx);
    return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
}

export function sinf(value: number): number {
    const x = f(value);
    const ix = bitsOf(x) & 0x7fffffff;
    if (ix <= 0x3f490fd8) return kernelSin(x, 0, 0);
    if (ix >= 0x7f800000) return NaN;
    const [n, y0, y1] = remPio2(x);
    switch (n & 3) {
        case 0:
            return kernelSin(y0, y1, 1);
        case 1:
            return kernelCos(y0, y1);
        case 2:
            return -kernelSin(y0, y1, 1);
        default:
            return -kernelCos(y0, y1);
    }
}

export function cosf(value: number): number {
    const x = f(value);
    const ix = bitsOf(x) & 0x7fffffff;
    if (ix <= 0x3f490fd8) return kernelCos(x, 0);
    if (ix >= 0x7f800000) return NaN;
    const [n, y0, y1] = remPio2(x);
    switch (n & 3) {
        case 0:
            return kernelCos(y0, y1);
        case 1:
            return -kernelSin(y0, y1, 1);
        case 2:
            return -kernelCos(y0, y1);
        default:
            return kernelSin(y0, y1, 1);
    }
}

export function tanf(value: number): number {
    const x = f(value);
    const ix = bitsOf(x) & 0x7fffffff;
    if (ix <= 0x3f490fda) return kernelTan(x, 0, 1);
    if (ix >= 0x7f800000) return NaN;
    const [n, y0, y1] = remPio2(x);
    return kernelTan(y0, y1, 1 - ((n & 1) << 1));
}

// --- обернена тригонометрія, логарифм і степінь ---------------------------
//
// Ті самі правила злиття, що й вище: «c + a·b» і «c − a·b» — одна операція
// FPU; «a·b − c» Xtensa злити не вміє. Коли додаються ДВА добутки, GCC зливає
// перший за порядком обчислення, а другий округлює окремо.

const truncBits = (x: number) => fromBits(bitsOf(x) & 0xfffff000);
const sqrtf = (x: number) => f(Math.sqrt(x));

const AS = K.ef_asin;
const AC = K.ef_acos;

/** R(x²) = p/q — спільний для asin і acos поліном (константи в обох файлах однакові, але беруться кожна зі свого) */
function asinPoly(c: typeof AS | typeof AC, t: number): [number, number] {
    const p = f(t * mad(F(c.pS0), t, mad(F(c.pS1), t, mad(F(c.pS2), t, mad(F(c.pS3), t, mad(F(c.pS4), t, F(c.pS5)))))));
    const q = mad(1, t, mad(F(c.qS1), t, mad(F(c.qS2), t, mad(F(c.qS3), t, F(c.qS4)))));
    return [p, q];
}

export function asinf(value: number): number {
    const x = f(value);
    const hx = bitsOf(x);
    const ix = hx & 0x7fffffff;
    const pio2Hi = F(AS.pio2_hi), pio2Lo = F(AS.pio2_lo), pio4Hi = F(AS.pio4_hi);
    if (ix === 0x3f800000) return mad(f(x * pio2Lo), x, pio2Hi);
    if (ix > 0x3f800000) return NaN;
    if (ix < 0x3f000000) {
        if (ix < 0x32000000) return x;
        const t = f(x * x);
        const [p, q] = asinPoly(AS, t);
        return mad(x, x, f(p / q));
    }
    const w0 = f(1 - Math.abs(x));
    const t = f(w0 * 0.5);
    const [p, q] = asinPoly(AS, t);
    const s = sqrtf(t);
    let res: number;
    if (ix >= 0x3f79999a) {
        const w = f(p / q);
        res = f(pio2Hi - f(f(2 * mad(s, s, w)) - pio2Lo));
    } else {
        const w = truncBits(s);
        const c = f(msb(t, w, w) / f(s + w));
        const r = f(p / q);
        const pp = f(f(f(2 * s) * r) - msb(pio2Lo, 2, c));
        const qq = msb(pio4Hi, 2, w);
        res = f(pio4Hi - f(pp - qq));
    }
    return hx > 0 ? res : -res;
}

export function acosf(value: number): number {
    const x = f(value);
    const hx = bitsOf(x);
    const ix = hx & 0x7fffffff;
    const pi = F(AC.pi), pio2Hi = F(AC.pio2_hi), pio2Lo = F(AC.pio2_lo);
    if (ix === 0x3f800000) return hx > 0 ? 0 : mad(pi, 2, pio2Lo);
    if (ix > 0x3f800000) return NaN;
    if (ix < 0x3f000000) {
        if (ix <= 0x23000000) return f(pio2Hi + pio2Lo);
        const z = f(x * x);
        const [p, q] = asinPoly(AC, z);
        const r = f(p / q);
        return f(pio2Hi - f(x - msb(pio2Lo, x, r)));
    }
    if (hx < 0) {
        const z = f(f(1 + x) * 0.5);
        const [p, q] = asinPoly(AC, z);
        const s = sqrtf(z);
        const r = f(p / q);
        const w = f(f(r * s) - pio2Lo);
        return msb(pi, 2, f(s + w));
    }
    const z = f(f(1 - x) * 0.5);
    const s = sqrtf(z);
    const df = truncBits(s);
    const c = f(msb(z, df, df) / f(s + df));
    const [p, q] = asinPoly(AC, z);
    const r = f(p / q);
    const w = mad(c, r, s);
    return f(2 * f(df + w));
}

const ATANHI = K.sf_atan.atanhi.map(F);
const ATANLO = K.sf_atan.atanlo.map(F);
const AT = K.sf_atan.aT.map(F);

export function atanf(value: number): number {
    let x = f(value);
    const hx = bitsOf(x);
    const ix = hx & 0x7fffffff;
    let id: number;
    if (ix >= 0x50800000) {
        if (ix > 0x7f800000) return NaN;
        return hx > 0 ? f(ATANHI[3] + ATANLO[3]) : f(-ATANHI[3] - ATANLO[3]);
    }
    if (ix < 0x3ee00000) {
        if (ix < 0x31000000) return x;
        id = -1;
    } else {
        x = Math.abs(x);
        if (ix < 0x3f980000) {
            if (ix < 0x3f300000) {
                id = 0;
                x = f(f(f(2 * x) - 1) / f(2 + x));
            } else {
                id = 1;
                x = f(f(x - 1) / f(x + 1));
            }
        } else if (ix < 0x401c0000) {
            id = 2;
            x = f(f(x - 1.5) / mad(1, 1.5, x));
        } else {
            id = 3;
            x = f(-1 / x);
        }
    }
    const z = f(x * x);
    const w = f(z * z);
    const s1 = f(z * mad(AT[0], w, mad(AT[2], w, mad(AT[4], w, mad(AT[6], w, mad(AT[8], w, AT[10]))))));
    const s2 = f(w * mad(AT[1], w, mad(AT[3], w, mad(AT[5], w, mad(AT[7], w, AT[9])))));
    if (id < 0) return msb(x, x, f(s1 + s2));
    const res = f(ATANHI[id] - f(f(f(f(x * f(s1 + s2)) - ATANLO[id])) - x));
    return hx < 0 ? -res : res;
}

const A2 = K.ef_atan2;

export function atan2f(yValue: number, xValue: number): number {
    const x = f(xValue);
    const y = f(yValue);
    const hx = bitsOf(x), hy = bitsOf(y);
    const ix = hx & 0x7fffffff, iy = hy & 0x7fffffff;
    const pi = F(A2.pi), piO2 = F(A2.pi_o_2), piO4 = F(A2.pi_o_4), piLo = F(A2.pi_lo);
    if (ix > 0x7f800000 || iy > 0x7f800000) return f(x + y);
    if (hx === 0x3f800000) return atanf(y);
    const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
    if (iy === 0) {
        if (m === 0 || m === 1) return y;
        return m === 2 ? pi : -pi;
    }
    if (ix === 0) return hy < 0 ? -piO2 : piO2;
    if (ix === 0x7f800000) {
        if (iy === 0x7f800000) {
            return [piO4, -piO4, f(3 * piO4), f(-3 * piO4)][m];
        }
        return [0, -0, pi, -pi][m];
    }
    if (iy === 0x7f800000) return hy < 0 ? -piO2 : piO2;
    const k = (iy - ix) >> 23;
    let z: number;
    if (k > 60) z = mad(piO2, 0.5, piLo);
    else if (hx < 0 && k < -60) z = 0;
    else z = atanf(Math.abs(f(y / x)));
    switch (m) {
        case 0:
            return z;
        case 1:
            return -z;
        case 2:
            return f(pi - f(z - piLo));
        default:
            return f(f(z - piLo) - pi);
    }
}

const LG = K.ef_log;

export function logf(value: number): number {
    let x = f(value);
    let ix = bitsOf(x);
    let k = 0;
    const ln2Hi = F(LG.ln2_hi), ln2Lo = F(LG.ln2_lo);
    if ((ix & 0x7fffffff) === 0) return -Infinity;
    if (ix < 0) return NaN;
    if (ix >= 0x7f800000) return f(x + x);
    if (ix < 0x00800000) {
        k -= 25;
        x = f(x * F(LG.two25));
        ix = bitsOf(x);
    }
    k += (ix >> 23) - 127;
    ix &= 0x007fffff;
    let i = (ix + (0x95f64 << 3)) & 0x800000;
    x = fromBits(ix | (i ^ 0x3f800000));
    k += i >> 23;
    const fv = f(x - 1);
    if ((0x007fffff & (15 + ix)) < 16) {
        if (fv === 0) {
            if (k === 0) return 0;
            const dk = f(k);
            return mad(f(dk * ln2Lo), dk, ln2Hi);
        }
        const R = f(f(fv * fv) * msb(0.5, f(0.33333333333333333), fv));
        if (k === 0) return f(fv - R);
        const dk = f(k);
        return f(f(dk * ln2Hi) - f(msb(R, dk, ln2Lo) - fv));
    }
    const s = f(fv / f(2 + fv));
    const dk = f(k);
    const z = f(s * s);
    i = ix - (0x6147a << 3);
    const w = f(z * z);
    const j = (0x6b851 << 3) - ix;
    const t1 = f(w * mad(F(LG.Lg2), w, mad(F(LG.Lg4), w, F(LG.Lg6))));
    const t2 = f(z * mad(F(LG.Lg1), w, mad(F(LG.Lg3), w, mad(F(LG.Lg5), w, F(LG.Lg7)))));
    i |= j;
    const R = f(t2 + t1);
    if (i > 0) {
        const hfsq = f(f(0.5 * fv) * fv);
        if (k === 0) return f(fv - msb(hfsq, s, f(hfsq + R)));
        return f(f(dk * ln2Hi) - f(f(hfsq - mad(f(dk * ln2Lo), s, f(hfsq + R))) - fv));
    }
    if (k === 0) return msb(fv, s, f(fv - R));
    return f(f(dk * ln2Hi) - f(msb(f(s * f(fv - R)), dk, ln2Lo) - fv));
}

const PW = K.ef_pow;
const EXP_MAX = K.fdlibm.FLT_UWORD_EXP_MAX;
const EXP_MIN = K.fdlibm.FLT_UWORD_EXP_MIN;

export function powf(xValue: number, yValue: number): number {
    const x = f(xValue);
    const y = f(yValue);
    const hx = bitsOf(x), hy = bitsOf(y);
    let ix = hx & 0x7fffffff;
    const iy = hy & 0x7fffffff;
    const P = (name: keyof typeof PW) => F(PW[name] as number);
    if (iy === 0) return 1;
    if (ix > 0x7f800000 || iy > 0x7f800000) return ix === 0x3f800000 ? 1 : NaN;
    let yisint = 0;
    if (hx < 0) {
        if (iy >= 0x4b800000) yisint = 2;
        else if (iy >= 0x3f800000) {
            const k = (iy >> 23) - 0x7f;
            const j = iy >> (23 - k);
            if (j << (23 - k) === iy) yisint = 2 - (j & 1);
        }
    }
    if (iy === 0x7f800000) {
        if (ix === 0x3f800000) return 1;
        if (ix > 0x3f800000) return hy >= 0 ? y : 0;
        return hy < 0 ? -y : 0;
    }
    if (iy === 0x3f800000) return hy < 0 ? f(1 / x) : x;
    if (hy === 0x40000000) return f(x * x);
    if (hy === 0x3f000000 && hx >= 0) return sqrtf(x);
    let ax = Math.abs(x);
    if (ix === 0x7f800000 || ix === 0 || ix === 0x3f800000) {
        let z = ax;
        if (hy < 0) z = f(1 / z);
        if (hx < 0) {
            if (((ix - 0x3f800000) | yisint) === 0) z = NaN;
            else if (yisint === 1) z = -z;
        }
        return z;
    }
    if ((((hx >>> 31) - 1) | yisint) === 0) return NaN;

    let t1: number, t2: number;
    if (iy > 0x4d000000) {
        if (ix < 0x3f7ffff8) return hy < 0 ? Infinity : 0;
        if (ix > 0x3f800007) return hy > 0 ? Infinity : 0;
        const t = f(ax - 1);
        const w = f(f(t * t) * msb(0.5, t, msb(f(0.333333333333), t, 0.25)));
        const u = f(P('ivln2_h') * t);
        const v = msb(f(t * P('ivln2_l')), w, P('ivln2'));
        t1 = truncBits(f(u + v));
        t2 = f(v - f(t1 - u));
    } else {
        let n = 0;
        if (ix < 0x00800000) {
            ax = f(ax * P('two24'));
            n -= 24;
            ix = bitsOf(ax);
        }
        n += (ix >> 23) - 0x7f;
        const j = ix & 0x007fffff;
        ix = j | 0x3f800000;
        let k: number;
        if (j <= 0x1cc471) k = 0;
        else if (j < 0x5db3d7) k = 1;
        else {
            k = 0;
            n += 1;
            ix -= 0x00800000;
        }
        ax = fromBits(ix);
        const bp = F(PW.bp[k]);
        const u = f(ax - bp);
        const v = f(1 / f(ax + bp));
        const s = f(u * v);
        const sH = truncBits(s);
        let tH = fromBits(((ix >> 1) | 0x20000000) + 0x0040000 + (k << 21));
        const tL = f(ax - f(tH - bp));
        const sL = f(v * msb(msb(u, sH, tH), sH, tL));
        let s2 = f(s * s);
        let r = f(
            f(s2 * s2) *
                mad(P('L1'), s2, mad(P('L2'), s2, mad(P('L3'), s2, mad(P('L4'), s2, mad(P('L5'), s2, P('L6')))))),
        );
        r = mad(r, sL, f(sH + s));
        s2 = f(sH * sH);
        tH = truncBits(f(f(3 + s2) + r));
        const tL2 = f(r - f(f(tH - 3) - s2));
        const uu = f(sH * tH);
        const vv = mad(f(tL2 * s), sL, tH);
        const pH = truncBits(f(uu + vv));
        const pL = f(vv - f(pH - uu));
        const zH = f(P('cp_h') * pH);
        const zL = f(mad(f(pL * P('cp')), P('cp_l'), pH) + F(PW.dp_l[k]));
        const t = f(n);
        const dpH = F(PW.dp_h[k]);
        t1 = truncBits(f(f(f(zH + zL) + dpH) + t));
        t2 = f(zL - f(f(f(t1 - t) - dpH) - zH));
    }
    let sign = 1;
    if ((((hx >>> 31) - 1) | (yisint - 1)) === 0) sign = -1;
    const y1 = truncBits(y);
    let pL = mad(f(y * t2), f(y - y1), t1);
    let pH = f(y1 * t1);
    let z = f(pL + pH);
    let j = bitsOf(z);
    const i = j & 0x7fffffff;
    if (j > 0) {
        if (i > EXP_MAX) return sign * Infinity;
        if (i === EXP_MAX && f(pL + P('ovt')) > f(z - pH)) return sign * Infinity;
    } else {
        if (i > EXP_MIN) return sign * 0;
        if (i === EXP_MIN && pL <= f(z - pH)) return sign * 0;
    }
    let k = (i >> 23) - 0x7f;
    let n = 0;
    if (i > 0x3f000000) {
        n = j + (0x00800000 >> (k + 1));
        k = ((n & 0x7fffffff) >> 23) - 0x7f;
        const t = fromBits(n & ~(0x007fffff >> k));
        n = ((n & 0x007fffff) | 0x00800000) >> (23 - k);
        if (j < 0) n = -n;
        pH = f(pH - t);
    }
    const t = truncBits(f(pL + pH));
    const u = f(t * P('lg2_h'));
    const v = mad(f(t * P('lg2_l')), f(pL - f(t - pH)), P('lg2'));
    z = f(u + v);
    const w = f(v - f(z - u));
    const tt = f(z * z);
    const tt1 = msb(z, tt, mad(P('P1'), tt, mad(P('P2'), tt, mad(P('P3'), tt, mad(P('P4'), tt, P('P5'))))));
    const r = f(f(f(z * tt1) / f(tt1 - 2)) - mad(w, z, w));
    z = f(1 - f(r - z));
    j = bitsOf(z) + (n << 23);
    z = j >> 23 <= 0 ? scalbnf(z, n) : fromBits(j);
    return f(sign * z);
}
