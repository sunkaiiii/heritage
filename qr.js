// 二维码编码（docs/features/09，方式 A）：只实现海报需要的部分——字节模式、纠错等级 M、版本 1–10（最多约 210 字节的地址）。
// 结构参照 Project Nayuki 的 QR Code generator library（MIT License），按 ISO/IEC 18004 重新整理为精简版本。
//
// Copyright (c) Project Nayuki. (MIT License) https://www.nayuki.io/page/qr-code-generator-library
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
// (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge,
// publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or
// substantial portions of the Software. The Software is provided "as is", without warranty of any kind, express or implied, including
// but not limited to the warranties of merchantability, fitness for a particular purpose and noninfringement. In no event shall the
// authors or copyright holders be liable for any claim, damages or other liability, whether in an action of contract, tort or otherwise,
// arising from, out of or in connection with the Software or the use or other dealings in the Software.
(() => {
    "use strict";
    // 纠错等级 M：每块纠错码字数与块数（版本 1–10）
    const eccPerBlock = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
    const blockCount = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
    const alignment = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
    const maxVersion = 10;

    function rawModules(version) {
        let result = (16 * version + 128) * version + 64;
        if (version >= 2) {
            const align = Math.floor(version / 7) + 2;
            result -= (25 * align - 10) * align - 55;
            if (version >= 7) result -= 36;
        }
        return result;
    }
    const dataCodewords = version => Math.floor(rawModules(version) / 8) - eccPerBlock[version] * blockCount[version];

    function multiply(x, y) {
        let z = 0;
        for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
        return z;
    }
    function divisor(degree) {
        const result = new Array(degree).fill(0);
        result[degree - 1] = 1;
        let root = 1;
        for (let i = 0; i < degree; i++) {
            for (let j = 0; j < degree; j++) { result[j] = multiply(result[j], root); if (j + 1 < degree) result[j] ^= result[j + 1]; }
            root = multiply(root, 0x02);
        }
        return result;
    }
    function remainder(data, div) {
        const result = new Array(div.length).fill(0);
        for (const b of data) {
            const factor = b ^ result.shift();
            result.push(0);
            div.forEach((coef, i) => { result[i] ^= multiply(coef, factor); });
        }
        return result;
    }

    function encodeData(bytes, version) {
        const bits = [];
        const push = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
        push(0x4, 4);
        push(bytes.length, version <= 9 ? 8 : 16);
        for (const b of bytes) push(b, 8);
        const capacity = dataCodewords(version) * 8;
        push(0, Math.min(4, capacity - bits.length));
        push(0, (8 - bits.length % 8) % 8);
        const codewords = [];
        for (let i = 0; i < bits.length; i += 8) codewords.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
        for (let pad = 0xec; codewords.length < capacity / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);
        return codewords;
    }
    function interleave(data, version) {
        const blocks = blockCount[version], ecc = eccPerBlock[version], raw = Math.floor(rawModules(version) / 8);
        const shortBlocks = blocks - raw % blocks, shortLength = Math.floor(raw / blocks);
        const div = divisor(ecc), split = [];
        for (let i = 0, k = 0; i < blocks; i++) {
            const dat = data.slice(k, k + shortLength - ecc + (i < shortBlocks ? 0 : 1));
            k += dat.length;
            const block = dat.concat(remainder(dat, div));
            if (i < shortBlocks) block.splice(dat.length, 0, 0);   // 短块补位，交织时跳过
            split.push(block);
        }
        const result = [];
        for (let i = 0; i < split[0].length; i++)
            split.forEach((block, j) => { if (i !== shortLength - ecc || j >= shortBlocks) result.push(block[i]); });
        return result;
    }

    function build(codewords, version, mask) {
        const size = version * 4 + 17;
        const modules = Array.from({ length: size }, () => new Array(size).fill(false));
        const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
        const set = (x, y, dark) => { modules[y][x] = dark; fixed[y][x] = true; };
        for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
        const finder = (cx, cy) => {
            for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
                const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
            }
        };
        finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
        const centers = alignment[version];
        centers.forEach((cy, i) => centers.forEach((cx, j) => {
            if ((i === 0 && j === 0) || (i === 0 && j === centers.length - 1) || (i === centers.length - 1 && j === 0)) return;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }));
        const format = dark => {
            const data = (0 << 3) | mask;   // 纠错等级 M 的格式位为 00
            let rem = data;
            for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            const bits = ((data << 10) | rem) ^ 0x5412, bit = i => ((bits >>> i) & 1) !== 0;
            for (let i = 0; i <= 5; i++) set(8, i, bit(i));
            set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
            for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
            for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
            for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
            set(8, size - 8, dark);
        };
        format(true);
        if (version >= 7) {
            let rem = version;
            for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
            const bits = (version << 12) | rem;
            for (let i = 0; i < 18; i++) {
                const dark = ((bits >>> i) & 1) !== 0, a = size - 11 + i % 3, b = Math.floor(i / 3);
                set(a, b, dark); set(b, a, dark);
            }
        }
        let i = 0;
        for (let right = size - 1; right >= 1; right -= 2) {
            if (right === 6) right = 5;
            for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
                const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
                if (!fixed[y][x] && i < codewords.length * 8) { modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0; i++; }
            }
        }
        const masks = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
            (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
            (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0];
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fixed[y][x] && masks[mask](x, y)) modules[y][x] = !modules[y][x];
        return modules;
    }

    // 惩罚分：用于在 8 种掩码中选最易识读的一种（规则见 ISO/IEC 18004 §7.8.3）
    function penalty(modules) {
        const size = modules.length;
        let score = 0, dark = 0;
        const line = get => {
            let run = 1;
            for (let i = 1; i <= size; i++) {
                if (i < size && get(i) === get(i - 1)) run++;
                else { if (run >= 5) score += 3 + run - 5; run = 1; }
            }
            for (let i = 0; i + 11 <= size; i++) {
                const s = Array.from({ length: 11 }, (_, k) => get(i + k) ? 1 : 0).join("");
                if (s === "10111010000" || s === "00001011101") score += 40;
            }
        };
        for (let y = 0; y < size; y++) line(x => modules[y][x]);
        for (let x = 0; x < size; x++) line(y => modules[y][x]);
        for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
            const c = modules[y][x];
            if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) score += 3;
        }
        for (const row of modules) for (const c of row) if (c) dark++;
        const total = size * size;
        score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
        return score;
    }

    // 返回二维码矩阵（true 为深色模块）；超过版本 10 的容量时抛出 too_long
    function matrix(text) {
        if (typeof text !== "string" || !text) throw new Error("invalid");
        const bytes = Array.from(new TextEncoder().encode(text));
        let version = 1;
        while (version <= maxVersion && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version++;
        if (version > maxVersion) throw new Error("too_long");
        const codewords = interleave(encodeData(bytes, version), version);
        let best = null, bestScore = Infinity;
        for (let mask = 0; mask < 8; mask++) {
            const candidate = build(codewords, version, mask), score = penalty(candidate);
            if (score < bestScore) { best = candidate; bestScore = score; }
        }
        return best;
    }

    window.heritageQr = { matrix };
})();
