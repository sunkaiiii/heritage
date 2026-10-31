// 分享图片（docs/features/04、09）：全部在浏览器里用 canvas 绘制，不加载外部图片、不发送任何请求，生成 PNG data URL。
// 配色固定为站点浅色主题，保证导出的图片在任何主题下都一致。
(() => {
    "use strict";
    const colors = { paper: "#fcf8f5", ink: "#211a18", muted: "#51443f", line: "#d6c2ba", primary: "#8f372f", gold: "#735c23", open: "#f1e3dd" };
    const font = (size, weight = 400) => `${weight} ${size}px "Noto Serif SC", "Songti SC", "SimSun", serif`;
    const text = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
    function fail(code) { const error = new Error(code); error.code = code; throw error; }

    // 图鉴图：省份 × 类别的缩略格子。cells[i][j]：0 无内容、1 未点亮、2 已点亮
    function stampsImage(model) {
        const provinces = (Array.isArray(model?.provinces) ? model.provinces : []).slice(0, 40).map(x => text(x, 8));
        const categories = (Array.isArray(model?.categories) ? model.categories : []).slice(0, 10).map(x => text(x, 6));
        const cells = Array.isArray(model?.cells) ? model.cells : [];
        if (!provinces.length || !categories.length) fail("invalid");
        const size = 26, gap = 4, left = 150, top = 230, width = 1080;
        const height = top + provinces.length * (size + gap) + 140;
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const g = canvas.getContext("2d");
        if (!g) fail("unsupported");
        g.fillStyle = colors.paper; g.fillRect(0, 0, width, height);
        g.fillStyle = colors.primary; g.fillRect(0, 0, width, 12);
        g.fillStyle = colors.ink; g.font = font(54, 600); g.textBaseline = "top";
        g.fillText(text(model.title, 30), 72, 64);
        g.fillStyle = colors.muted; g.font = font(28);
        g.fillText(text(model.progress, 80), 72, 140);
        g.font = font(18); g.textAlign = "center";
        categories.forEach((name, j) => g.fillText(name, left + j * (size * 2.6 + gap) + size * 1.3, top - 34));
        provinces.forEach((name, i) => {
            const y = top + i * (size + gap);
            g.textAlign = "right"; g.fillStyle = colors.muted; g.font = font(18);
            g.fillText(name, left - 18, y + 4);
            categories.forEach((_, j) => {
                const state = Array.isArray(cells[i]) ? cells[i][j] : 0, x = left + j * (size * 2.6 + gap);
                if (state === 2) { g.fillStyle = colors.primary; g.fillRect(x, y, size * 2.6, size); }
                else if (state === 1) { g.fillStyle = colors.open; g.fillRect(x, y, size * 2.6, size); }
                else { g.strokeStyle = colors.line; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, size * 2.6 - 1, size - 1); }
            });
        });
        g.textAlign = "left"; g.fillStyle = colors.muted; g.font = font(22);
        g.fillText(text(model.footer, 40), 72, height - 80);
        // 站点二维码（公开网页地址未配置时不画）
        if (typeof model.qrText === "string" && model.qrText && window.heritageQr) {
            const m = window.heritageQr.matrix(model.qrText), qrSize = 150, cell = Math.floor(qrSize / (m.length + 4)), x0 = width - 72 - qrSize, y0 = 48;
            g.fillStyle = "#ffffff"; g.fillRect(x0, y0, qrSize, qrSize);
            g.fillStyle = "#000000";
            const offset = (qrSize - cell * m.length) / 2;
            m.forEach((row, my) => row.forEach((dark, mx) => { if (dark) g.fillRect(x0 + offset + mx * cell, y0 + offset + my * cell, cell, cell); }));
        }
        return canvas.toDataURL("image/png");
    }

    // 文字按像素宽度断行；超过行数时最后一行加省略号。行首避开中文收尾标点。
    function wrap(g, value, width, maxLines) {
        const chars = Array.from(text(value, 600).replace(/\s+/g, " ").trim()), lines = [];
        let line = "";
        for (let i = 0; i < chars.length; i++) {
            const next = line + chars[i];
            if (g.measureText(next).width <= width || !line) { line = next; continue; }
            if ("，。、；：！？）」』》·".includes(chars[i])) { lines.push(line.slice(0, -1)); line = line.slice(-1) + chars[i]; }
            else { lines.push(line); line = chars[i]; }
            if (lines.length === maxLines) break;
        }
        if (lines.length < maxLines && line) lines.push(line);
        const truncated = lines.length === maxLines && lines.join("").length < chars.length;
        if (truncated) {
            let last = lines[maxLines - 1];
            while (last && g.measureText(last + "…").width > width) last = last.slice(0, -1);
            lines[maxLines - 1] = last + "…";
        }
        return lines;
    }

    // 无封面时的品牌纹样，按类别轮换四种几何纹：回纹、水波、菱格、云点
    function pattern(g, kind, width, height) {
        g.save();
        g.fillStyle = "#f6ebe6"; g.fillRect(0, 0, width, height);
        g.lineWidth = 3;
        const step = 72;
        for (let y = -step; y < height + step; y += step) for (let x = -step; x < width + step; x += step) {
            g.strokeStyle = (Math.floor(x / step) + Math.floor(y / step)) % 2 ? colors.primary : colors.gold;
            g.globalAlpha = 0.22;
            g.beginPath();
            if (kind === 0) { g.rect(x + 14, y + 14, 44, 44); g.moveTo(x + 26, y + 46); g.lineTo(x + 26, y + 26); g.lineTo(x + 46, y + 26); g.lineTo(x + 46, y + 38); }
            else if (kind === 1) { g.arc(x + 36, y + 72, 36, Math.PI, 0); g.moveTo(x + 18, y + 72); g.arc(x + 36, y + 72, 18, Math.PI, 0); }
            else if (kind === 2) { g.moveTo(x + 36, y + 6); g.lineTo(x + 66, y + 36); g.lineTo(x + 36, y + 66); g.lineTo(x + 6, y + 36); g.closePath(); }
            else { g.arc(x + 36, y + 36, 22, 0, Math.PI * 2); g.moveTo(x + 50, y + 36); g.arc(x + 36, y + 36, 8, 0, Math.PI * 2); }
            g.stroke();
        }
        g.restore();
    }

    let last = null;
    // 竖版海报 1080 × 1440。模型只含已整理好的纯文本与公开地址；不加载任何图片。生成后保留 PNG Blob，供「分享」在点击时直接使用。
    async function render(model) {
        if (!model || !text(model.title, 200)) fail("invalid");
        try { await document.fonts?.ready; } catch { /* 字体未就绪时用系统字体 */ }
        const width = 1080, height = 1440, left = 72, inner = width - left * 2;
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const g = canvas.getContext("2d");
        if (!g) fail("unsupported");
        g.fillStyle = colors.paper; g.fillRect(0, 0, width, height);
        pattern(g, Number.isInteger(model.pattern) ? Math.abs(model.pattern) % 4 : 0, width, 500);
        g.fillStyle = colors.primary; g.fillRect(0, 0, width, 12); g.fillRect(0, height - 12, width, 12);
        g.textBaseline = "top"; g.textAlign = "left";
        // 品牌区垫一块底色，避免与纹样叠在一起难以辨认
        g.fillStyle = colors.paper; g.fillRect(left - 20, 48, 300, 116);
        g.fillStyle = colors.primary; g.font = font(52, 700); g.fillText(text(model.brand, 10), left, 64);
        g.fillStyle = colors.muted; g.font = font(18, 600); g.fillText(text(model.brandEn, 30), left, 128);
        const label = text(model.kind, 24);
        if (label) {
            g.font = font(26, 600);
            const w = g.measureText(label).width + 40;
            g.fillStyle = colors.paper; g.fillRect(width - left - w, 64, w, 52);
            g.strokeStyle = colors.primary; g.lineWidth = 2; g.strokeRect(width - left - w, 64, w, 52);
            g.fillStyle = colors.primary; g.fillText(label, width - left - w + 20, 76);
        }
        let y = 560;
        g.fillStyle = colors.ink; g.font = font(64, 700);
        for (const line of wrap(g, model.title, inner, 2)) { g.fillText(line, left, y); y += 84; }
        y += 12;
        g.fillStyle = colors.muted; g.font = font(30);
        for (const value of (Array.isArray(model.lines) ? model.lines : []).slice(0, 3)) {
            const [line] = wrap(g, value, inner, 1);
            if (line) { g.fillText(line, left, y); y += 46; }
        }
        g.strokeStyle = colors.line; g.lineWidth = 2; g.beginPath(); g.moveTo(left, y + 20); g.lineTo(width - left, y + 20); g.stroke();
        y += 52;
        g.fillStyle = colors.ink; g.font = font(34);
        for (const line of wrap(g, model.summary, inner, 4)) { g.fillText(line, left, y); y += 54; }
        const bottom = 1150, qrSize = 220;
        let textLeft = left;
        if (typeof model.qrText === "string" && model.qrText && window.heritageQr) {
            const m = window.heritageQr.matrix(model.qrText), cell = Math.floor(qrSize / (m.length + 4)), offset = (qrSize - cell * m.length) / 2;
            g.fillStyle = "#ffffff"; g.fillRect(left, bottom, qrSize, qrSize);
            g.fillStyle = "#000000";
            m.forEach((row, my) => row.forEach((dark, mx) => { if (dark) g.fillRect(left + offset + mx * cell, bottom + offset + my * cell, cell, cell); }));
            textLeft = left + qrSize + 40;
            g.fillStyle = colors.ink; g.font = font(34, 600); g.fillText(text(model.scan, 30), textLeft, bottom + 24);
        } else {
            g.fillStyle = colors.ink; g.font = font(32, 600);
            const [line] = wrap(g, model.fallback, inner, 1);
            g.fillText(line || "", textLeft, bottom + 24);
        }
        g.fillStyle = colors.muted; g.font = font(24);
        let sy = bottom + 86;
        for (const line of wrap(g, model.source, width - left - textLeft, 3)) { g.fillText(line, textLeft, sy); sy += 36; }
        const url = canvas.toDataURL("image/png");
        const blob = await new Promise(resolve => canvas.toBlob ? canvas.toBlob(resolve, "image/png") : resolve(null));
        const name = (text(model.fileName, 60).replace(/[\\/:*?"<>|]/g, "_") || "heritage-poster") + ".png";
        last = blob ? { blob, name, title: text(model.title, 200) } : null;
        let canShare = false;
        try { canShare = !!(last && navigator.canShare && navigator.canShare({ files: [new File([blob], name, { type: "image/png" })] })); } catch { canShare = false; }
        return { url, canShare };
    }

    // 「分享」按钮用原生点击事件直接调用系统分享，确保仍在用户手势有效期内（iOS 要求）
    document.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-poster-share]");
        if (!button || !last) return;
        const feedback = button.parentElement?.querySelector("[data-poster-feedback]");
        try {
            await navigator.share({ files: [new File([last.blob], last.name, { type: "image/png" })], title: last.title });
            if (feedback) feedback.textContent = "";
        } catch (error) {
            if (feedback && error?.name !== "AbortError") feedback.textContent = button.dataset.failure || "";
        }
    });

    window.heritagePoster = { stampsImage, render };
})();
