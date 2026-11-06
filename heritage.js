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
    const readingDefaults = { size: "standard", spacing: "standard", contrast: false, rate: 1, follow: true, notes: null };
    function cleanReading(value) {
        const source = value && typeof value === "object" ? value : {};
        return {
            size: readingChoices.size.includes(source.size) ? source.size : readingDefaults.size,
            spacing: readingChoices.spacing.includes(source.spacing) ? source.spacing : readingDefaults.spacing,
            contrast: source.contrast === true,
            rate: readingChoices.rate.includes(source.rate) ? source.rate : readingDefaults.rate,
            follow: source.follow !== false,
            // 术语小注（docs/features/41）：没有设置过时为 null，页面按数据决定默认值
            notes: ["on", "off"].includes(source.notes) ? source.notes : null
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
        if (value.notes) root.readingNotes = value.notes; else delete root.readingNotes;
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
        add(record) { const clean = cleanQuiz({ ...record, answeredAt: new Date().toISOString() }); if (!clean) throw new Error("Invalid quiz record"); writeQuiz([clean, ...readQuiz()]); window.heritageYearly?.bump("quiz", { correct: clean.correct, total: clean.total }); return clean; }
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
    // 正文里的名录（docs/features/17）：Esc 收起当前链接的小卡片，离开链接后恢复
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const link = document.activeElement;
        if (link instanceof HTMLElement && link.classList.contains("mention-link")) link.dataset.cardDismissed = "true";
    });
    document.addEventListener("focusout", event => {
        if (event.target instanceof HTMLElement && event.target.classList.contains("mention-link")) delete event.target.dataset.cardDismissed;
    });
    // 详情页操作栏「更多」（VR-42）：按钮开合，点菜单外或按 Esc 收起；收起只隐藏面板，朗读控制条仍在视口底部
    const setActionMenu = (menu, open) => {
        if (open) menu.setAttribute("data-open", ""); else menu.removeAttribute("data-open");
        menu.querySelector("[data-action-menu-toggle]")?.setAttribute("aria-expanded", open ? "true" : "false");
    };
    document.addEventListener("click", event => {
        const target = event.target instanceof Element ? event.target : null;
        const toggle = target?.closest("[data-action-menu-toggle]");
        for (const menu of document.querySelectorAll(".action-menu[data-open]")) {
            if (target && target.isConnected && !menu.contains(target)) setActionMenu(menu, false);
        }
        const menu = toggle?.closest(".action-menu");
        if (menu) setActionMenu(menu, !menu.hasAttribute("data-open"));
    });
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const menu = document.activeElement?.closest?.(".action-menu[data-open]");
        if (!menu || menu.querySelector(".poster-panel,.reading-tools-panel")) return;
        setActionMenu(menu, false);
        menu.querySelector("[data-action-menu-toggle]")?.focus();
    });
    // 标签栏放不下时单行横向滚动（VR-16）：把当前项滚到可视区中间。SSR、流式渲染、增强导航和 WASM 都会换上新的标签栏，
    // 所以观察 DOM 变化；同一个当前项只滚一次，不打断读者自己的滚动。
    if (typeof MutationObserver === "function" && typeof requestAnimationFrame === "function" && document.documentElement) {
        const revealed = new WeakSet();
        let queued = false;
        const reveal = () => {
            queued = false;
            for (const bar of document.querySelectorAll(".category-tabs,.view-tabs,.dimension-tabs,.years-strip,.taxonomy-tabs,.timeline-types")) {
                const current = bar.querySelector("a.selected,a[aria-current='page']");
                if (!current || revealed.has(current)) continue;
                revealed.add(current);
                if (bar.scrollWidth <= bar.clientWidth + 1) continue;
                const box = bar.getBoundingClientRect(), item = current.getBoundingClientRect();
                bar.scrollLeft = Math.max(0, bar.scrollLeft + item.left - box.left - (box.width - item.width) / 2);
            }
        };
        const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(reveal); } };
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener("resize", () => schedule());
        schedule();
    }
    // 宽表格的横向滚动提示（VR-27）：在 .table-scroll 上标出哪一侧还有没露出的列（data-more="start end"），
    // 样式据此给右缘渐隐、给固定的首列加阴影。表格随时可能被换掉，所以同样观察 DOM 变化；滚动事件在捕获阶段统一处理。
    if (typeof MutationObserver === "function" && typeof requestAnimationFrame === "function" && document.documentElement) {
        const mark = box => {
            const max = box.scrollWidth - box.clientWidth, left = Math.abs(box.scrollLeft), more = [];
            if (max > 1) { if (left > 1) more.push("start"); if (left < max - 1) more.push("end"); }
            const value = more.join(" ");
            if ((box.getAttribute("data-more") ?? "") === value) return;
            if (value) box.setAttribute("data-more", value); else box.removeAttribute("data-more");
        };
        let queued = false;
        const markAll = () => { queued = false; for (const box of document.querySelectorAll(".table-scroll")) mark(box); };
        const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(markAll); } };
        new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
        window.addEventListener("resize", () => schedule());
        document.addEventListener("scroll", event => { if (event.target instanceof Element && event.target.classList.contains("table-scroll")) mark(event.target); }, true);
        document.addEventListener("toggle", () => schedule(), true);
        schedule();
    }
})();
