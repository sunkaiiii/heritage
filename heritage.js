(() => {
    "use strict";
    const savedKey = "heritage.web.saved.v1";
    const themeKey = "heritage.web.theme.v1";
    const modes = ["system", "light", "dark"];
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const prefix = {article: "articles", directoryItem: "directory", inheritor: "inheritors"};
    function getThemeStatus() {
        try { const value = localStorage.getItem(themeKey); return { mode: modes.includes(value) ? value : "system", readable: true }; }
        catch { return { mode: "system", readable: false }; }
    }
    function getTheme() { return getThemeStatus().mode; }
    function applyTheme(mode) {
        const value = mode === "system" ? (media.matches ? "dark" : "light") : mode;
        document.documentElement.dataset.theme = value;
        document.documentElement.style.colorScheme = value;
    }
    // 阅读偏好（docs/features/16）：与主题一样只存在本机，不进备份，「清理本机资料」不清除。
    // 只设置 <html> 的 data-reading-* 属性，由样式覆盖阅读区域，不修改根字号。
    const readingKey = "heritage.web.reading.v1";
    const readingChoices = { size: ["standard", "large", "xlarge"], spacing: ["standard", "loose"], rate: [0.8, 1, 1.2] };
    const readingDefaults = { size: "standard", spacing: "standard", contrast: false, rate: 1, follow: true };
    function cleanReading(value) {
        const source = value && typeof value === "object" ? value : {};
        return {
            size: readingChoices.size.includes(source.size) ? source.size : readingDefaults.size,
            spacing: readingChoices.spacing.includes(source.spacing) ? source.spacing : readingDefaults.spacing,
            contrast: source.contrast === true,
            rate: readingChoices.rate.includes(source.rate) ? source.rate : readingDefaults.rate,
            follow: source.follow !== false
        };
    }
    function getReadingStatus() {
        let raw;
        try { raw = localStorage.getItem(readingKey); }
        catch { return { ...readingDefaults, readable: false }; }
        // 损坏的值按默认读取，不算存储不可用
        try { return { ...cleanReading(raw && raw.length <= 1000 ? JSON.parse(raw) : null), readable: true }; }
        catch { return { ...readingDefaults, readable: true }; }
    }
    function applyReading(value) {
        const root = document.documentElement.dataset;
        if (value.size === "standard") delete root.readingSize; else root.readingSize = value.size;
        if (value.spacing === "standard") delete root.readingSpacing; else root.readingSpacing = value.spacing;
        if (value.contrast) root.readingContrast = "high"; else delete root.readingContrast;
    }
    window.heritageReading = {
        get: getReadingStatus,
        set(value) {
            const clean = cleanReading(value);
            localStorage.setItem(readingKey, JSON.stringify(clean));
            applyReading(clean);
            return clean;
        }
    };
    function validItem(item) {
        if (!item || typeof item.type !== "string" || !Object.hasOwn(prefix, item.type) || typeof item.id !== "string" || !/^[a-f\d]{24}$/i.test(item.id) || typeof item.title !== "string") return false;
        // Storage stays canonical across root and subdirectory deployments; only UI rendering adds the application base.
        return item.href === `/${prefix[item.type]}/${item.id}`;
    }
    function cleanItem(item) {
        let image = null;
        try { const url = new URL(item.image); if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048) image = url.href; } catch { /* Text-only bookmark. */ }
        return {id: item.id, type: item.type, title: item.title.slice(0, 300), href: item.href,
            image, meta: typeof item.meta === "string" ? item.meta.slice(0, 300) : null,
            savedAt: typeof item.savedAt === "string" && item.savedAt.length <= 64 && !isNaN(Date.parse(item.savedAt)) ? new Date(item.savedAt).toISOString() : new Date().toISOString()};
    }
    function getSaved() {
        const raw = localStorage.getItem(savedKey);
        if (!raw || raw.length > 600000) return [];
        try { const values = JSON.parse(raw); return Array.isArray(values) ? values.filter(validItem).slice(0, 200).map(cleanItem) : []; }
        catch { return []; }
    }
    window.heritageStore = {
        getTheme,
        getThemeStatus,
        refreshTheme() { applyTheme(getTheme()); },
        setTheme(mode) { if (!modes.includes(mode)) return; localStorage.setItem(themeKey, mode); applyTheme(mode); },
        getSaved,
        toggleSaved(item) {
            if (!validItem(item)) throw new Error("Invalid bookmark");
            const current = getSaved();
            const exists = current.some(x => x.id === item.id && x.type === item.type);
            const updated = current.filter(x => x.id !== item.id || x.type !== item.type);
            if (!exists) updated.unshift(cleanItem({...item, savedAt: new Date().toISOString()}));
            localStorage.setItem(savedKey, JSON.stringify(updated.slice(0, 200)));
            return !exists;
        },
        removeSaved(id, type) { localStorage.setItem(savedKey, JSON.stringify(getSaved().filter(x => x.id !== id || x.type !== type))); }
    };
    // 「新收录」来访记录：只有读者开启后才写入；只存在本机，不上传（docs/features/08）。
    const visitKey = "heritage.web.lastVisit.v1";
    const visitGap = 30 * 60 * 1000;
    const isoOrNull = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    function readVisits() {
        try {
            const value = JSON.parse(localStorage.getItem(visitKey) || "null");
            if (!value || value.enabled !== true) return { enabled: false, previousVisitAt: null, currentVisitAt: null };
            return { enabled: true, previousVisitAt: isoOrNull(value.previousVisitAt), currentVisitAt: isoOrNull(value.currentVisitAt) };
        } catch { return { enabled: false, previousVisitAt: null, currentVisitAt: null }; }
    }
    window.heritageVisits = {
        get: readVisits,
        enable() { const now = new Date().toISOString(); localStorage.setItem(visitKey, JSON.stringify({ enabled: true, previousVisitAt: null, currentVisitAt: now })); return readVisits(); },
        disable() { localStorage.removeItem(visitKey); return readVisits(); },
        // 30 分钟内重复打开不更新，避免一刷新「新」标记就消失。返回更新前用于比较的记录。
        touch() {
            const state = readVisits();
            if (!state.enabled) return state;
            const now = Date.now(), current = state.currentVisitAt ? Date.parse(state.currentVisitAt) : 0;
            if (now - current >= visitGap) localStorage.setItem(visitKey, JSON.stringify({ enabled: true, previousVisitAt: state.currentVisitAt, currentVisitAt: new Date(now).toISOString() }));
            return readVisits();
        },
        // 给列表中新收录的文章卡片加上标记；只处理 24 位内容编号
        markNew(ids, label) {
            const wanted = new Set((Array.isArray(ids) ? ids : []).filter(id => typeof id === "string" && /^[a-f\d]{24}$/i.test(id)));
            for (const link of document.querySelectorAll("a[href*='/articles/']")) {
                const id = (link.getAttribute("href") || "").split(/[?#]/, 1)[0].split("/").pop();
                // 卡片的图片链接对读屏隐藏，只在可读的标题链接上标记一次
                if (!wanted.has(id) || link.getAttribute("aria-hidden") === "true" || link.querySelector(".new-badge")) continue;
                const badge = document.createElement("span"); badge.className = "new-badge"; badge.textContent = String(label || "新").slice(0, 12);
                link.prepend(badge);
            }
        }
    };
    // 知识小测成绩：只在答完一组后写入，最多 100 条；纳入本机备份 v2 与清理（docs/features/03）。
    const quizKey = "heritage.web.quiz.v1";
    const quizScopes = ["route", "contents", "category", "region", "family", "random"];
    function cleanQuiz(value) {
        if (!value || !quizScopes.includes(value.scope) || !Number.isInteger(value.seed) || value.seed < 0) return null;
        if (!Number.isInteger(value.total) || value.total < 1 || value.total > 10 || !Number.isInteger(value.correct) || value.correct < 0 || value.correct > value.total) return null;
        const key = value.key === null || value.key === undefined ? null : typeof value.key === "string" && value.key.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value.key) ? value.key : undefined;
        const answeredAt = isoOrNull(value.answeredAt);
        return key === undefined || !answeredAt ? null : { scope: value.scope, key, seed: value.seed, correct: value.correct, total: value.total, answeredAt };
    }
    function readQuiz() {
        try { const values = JSON.parse(localStorage.getItem(quizKey) || "[]"); return Array.isArray(values) ? values.slice(0, 100).map(cleanQuiz).filter(Boolean) : []; }
        catch { return []; }
    }
    const quizIdentity = x => `${x.scope}|${x.key}|${x.seed}|${x.answeredAt}`;
    function writeQuiz(values) { localStorage.setItem(quizKey, JSON.stringify(values.sort((a, b) => b.answeredAt.localeCompare(a.answeredAt)).slice(0, 100))); }
    window.heritageQuiz = {
        list: readQuiz,
        add(record) { const clean = cleanQuiz({ ...record, answeredAt: new Date().toISOString() }); if (!clean) throw new Error("Invalid quiz record"); writeQuiz([clean, ...readQuiz()]); return clean; }
    };
    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.quiz = {
        export: readQuiz,
        plan(value) {
            if (!Array.isArray(value)) return null;
            const local = readQuiz(), known = new Set(local.map(quizIdentity));
            const valid = value.slice(0, 200).map(cleanQuiz).filter(Boolean), added = valid.filter(x => !known.has(quizIdentity(x)) && known.add(quizIdentity(x)));
            return { preview: { added: added.length, existing: valid.length - added.length, invalid: Math.min(value.length, 200) - valid.length },
                apply() { writeQuiz([...added, ...readQuiz()]); } };
        },
        clear() { localStorage.removeItem(quizKey); }
    };
    applyTheme(getTheme());
    applyReading(getReadingStatus());
    media.addEventListener("change", () => applyTheme(getTheme()));
    window.addEventListener("storage", event => {
        if (event.key === themeKey) applyTheme(getTheme());
        if (event.key === readingKey) applyReading(getReadingStatus());
    });
    document.addEventListener("error", event => { if (event.target instanceof HTMLImageElement) event.target.dataset.failed = "true"; }, true);
})();
