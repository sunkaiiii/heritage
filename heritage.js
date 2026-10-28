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
    applyTheme(getTheme());
    media.addEventListener("change", () => applyTheme(getTheme()));
    window.addEventListener("storage", event => { if (event.key === themeKey) applyTheme(getTheme()); });
    document.addEventListener("error", event => { if (event.target instanceof HTMLImageElement) event.target.dataset.failed = "true"; }, true);
})();
