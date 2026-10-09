/**
 * Криптографія модуля `crypto` прошивки (lualilka_crypto.cpp).
 *
 * На залізі це mbedTLS і ROM-функція `esp_crc32_le`. Тут — власні синхронні
 * реалізації: WebCrypto асинхронний, а виклик із Lua мусить повернути
 * результат одразу, як `luaL_*` у прошивці.
 */

/** CRC-32 (поліном 0xEDB88320) — те саме, що `esp_crc32_le(0, ...)`. */
const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c >>> 0;
    }
    return table;
})();

export function crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

// --- MD5 (RFC 1321) ---------------------------------------------------------

const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(data: Uint8Array): Uint8Array {
    const bitLength = data.length * 8;
    const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64);
    padded.set(data);
    padded[data.length] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, bitLength >>> 0, true);
    view.setUint32(padded.length - 4, Math.floor(bitLength / 2 ** 32), true);

    let a0 = 0x67452301;
    let b0 = 0xefcdab89;
    let c0 = 0x98badcfe;
    let d0 = 0x10325476;
    const m = new Uint32Array(16);
    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) m[i] = view.getUint32(offset + i * 4, true);
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let i = 0; i < 64; i++) {
            let f: number;
            let g: number;
            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) % 16;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) % 16;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) % 16;
            }
            const sum = (a + f + MD5_K[i] + m[g]) >>> 0;
            a = d;
            d = c;
            c = b;
            b = (b + ((sum << MD5_S[i]) | (sum >>> (32 - MD5_S[i])))) >>> 0;
        }
        a0 = (a0 + a) >>> 0;
        b0 = (b0 + b) >>> 0;
        c0 = (c0 + c) >>> 0;
        d0 = (d0 + d) >>> 0;
    }
    const out = new Uint8Array(16);
    const outView = new DataView(out.buffer);
    [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word, true));
    return out;
}

// --- AES (FIPS-197), лише те, що потрібно для CBC ---------------------------

const SBOX = new Uint8Array(256);
const INV_SBOX = new Uint8Array(256);
(() => {
    // Таблиця будується з означення, а не вписується руками
    let p = 1;
    let q = 1;
    do {
        p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0);
        q ^= q << 1;
        q ^= q << 2;
        q ^= q << 4;
        q &= 0xff;
        if (q & 0x80) q ^= 0x09;
        const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
        SBOX[p] = (x ^ 0x63) & 0xff;
    } while (p !== 1);
    SBOX[0] = 0x63;
    for (let i = 0; i < 256; i++) INV_SBOX[SBOX[i]] = i;
})();

const xtime = (b: number) => ((b << 1) ^ (b & 0x80 ? 0x1b : 0)) & 0xff;
function gmul(a: number, b: number): number {
    let r = 0;
    while (b) {
        if (b & 1) r ^= a;
        a = xtime(a);
        b >>= 1;
    }
    return r;
}

function expandKey(key: Uint8Array): Uint8Array[] {
    const nk = key.length / 4;
    const rounds = nk + 6;
    const words: number[][] = [];
    for (let i = 0; i < nk; i++) words.push([key[4 * i], key[4 * i + 1], key[4 * i + 2], key[4 * i + 3]]);
    let rcon = 1;
    for (let i = nk; i < 4 * (rounds + 1); i++) {
        let t = words[i - 1].slice();
        if (i % nk === 0) {
            t = [SBOX[t[1]] ^ rcon, SBOX[t[2]], SBOX[t[3]], SBOX[t[0]]];
            rcon = xtime(rcon);
        } else if (nk > 6 && i % nk === 4) {
            t = t.map((b) => SBOX[b]);
        }
        words.push(words[i - nk].map((b, j) => b ^ t[j]));
    }
    const roundKeys: Uint8Array[] = [];
    for (let r = 0; r <= rounds; r++) roundKeys.push(Uint8Array.from(words.slice(4 * r, 4 * r + 4).flat()));
    return roundKeys;
}

function encryptBlock(block: Uint8Array, keys: Uint8Array[]): Uint8Array {
    const s = block.map((b, i) => b ^ keys[0][i]);
    const rounds = keys.length - 1;
    for (let r = 1; r <= rounds; r++) {
        // SubBytes + ShiftRows
        const t = new Uint8Array(16);
        for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) t[c * 4 + row] = SBOX[s[((c + row) % 4) * 4 + row]];
        // MixColumns, крім останнього раунду
        if (r !== rounds) {
            for (let c = 0; c < 4; c++) {
                const [a0, a1, a2, a3] = [t[c * 4], t[c * 4 + 1], t[c * 4 + 2], t[c * 4 + 3]];
                t[c * 4] = xtime(a0) ^ xtime(a1) ^ a1 ^ a2 ^ a3;
                t[c * 4 + 1] = a0 ^ xtime(a1) ^ xtime(a2) ^ a2 ^ a3;
                t[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ xtime(a3) ^ a3;
                t[c * 4 + 3] = xtime(a0) ^ a0 ^ a1 ^ a2 ^ xtime(a3);
            }
        }
        for (let i = 0; i < 16; i++) s[i] = t[i] ^ keys[r][i];
    }
    return s;
}

function decryptBlock(block: Uint8Array, keys: Uint8Array[]): Uint8Array {
    const rounds = keys.length - 1;
    const s = block.map((b, i) => b ^ keys[rounds][i]);
    for (let r = rounds - 1; r >= 0; r--) {
        // InvShiftRows + InvSubBytes
        const t = new Uint8Array(16);
        for (let c = 0; c < 4; c++) for (let row = 0; row < 4; row++) t[((c + row) % 4) * 4 + row] = INV_SBOX[s[c * 4 + row]];
        for (let i = 0; i < 16; i++) t[i] ^= keys[r][i];
        if (r !== 0) {
            for (let c = 0; c < 4; c++) {
                const [a0, a1, a2, a3] = [t[c * 4], t[c * 4 + 1], t[c * 4 + 2], t[c * 4 + 3]];
                t[c * 4] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
                t[c * 4 + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
                t[c * 4 + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
                t[c * 4 + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
            }
        }
        s.set(t);
    }
    return s;
}

/** AES-CBC без доповнення: довжина даних кратна 16, як у `mbedtls_aes_crypt_cbc`. */
export function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
    const keys = expandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
        const block = data.slice(i, i + 16).map((b, j) => b ^ prev[j]);
        prev = encryptBlock(block, keys);
        out.set(prev, i);
    }
    return out;
}

export function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Uint8Array {
    const keys = expandKey(key);
    const out = new Uint8Array(data.length);
    let prev = iv;
    for (let i = 0; i < data.length; i += 16) {
        const block = data.slice(i, i + 16);
        out.set(decryptBlock(block, keys).map((b, j) => b ^ prev[j]), i);
        prev = block;
    }
    return out;
}
