(() => {
    "use strict";
    const maximum = 5 * 1024 * 1024;
    const artifactMaximum = 32 * 1024 * 1024;
    const textTypes = ["application/json", "text/plain", "text/markdown", "text/csv"];
    function download(name, type, content) {
        const safeName = typeof name === "string" ? name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 160) : "heritage-export.txt";
        const url = URL.createObjectURL(new Blob([content], {type}));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = safeName || "heritage-download"; anchor.rel = "noopener";
        try { document.body.append(anchor); anchor.click(); }
        finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    }
    window.heritageCulture = {
        getLanguage() {
            let preference = "system";
            try { preference = window.heritagePersonal?.getLanguage() || "system"; } catch { /* Device language remains available when storage is denied. */ }
            const languages = preference === "system" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [preference];
            const language = languages.find(value => typeof value === "string" && /^(en|zh)(?:-|$)/i.test(value));
            const culture = /^en(?:-|$)/i.test(language || "") ? "en" : "zh-CN";
            if (document.documentElement) document.documentElement.lang = culture;
            return culture;
        }
    };
    window.heritageDownloads = {
        saveText(name, mime, text) {
            if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("File exceeds download limit");
            const type = textTypes.includes(mime?.split(';')[0]) ? mime : "text/plain;charset=utf-8";
            download(name, type, text);
        },
        saveBytes(name, mime, bytes) {
            // Blazor's byte[] interop arrives as Uint8Array, preserving arbitrary
            // binary data without base64 expansion or UTF-8 decoding.
            if (!(bytes instanceof Uint8Array) || bytes.byteLength > artifactMaximum) throw new Error("Invalid file or download limit exceeded");
            const mediaType = typeof mime === "string" ? mime.split(';')[0].trim().toLowerCase() : "";
            const type = [...textTypes, "application/pdf", "application/zip", "application/octet-stream", "image/png", "image/jpeg", "image/webp"].includes(mediaType) ? mediaType : "application/octet-stream";
            download(name, type, bytes);
        },
        // Export options live in the address so returning from a preview item restores them.
        setExportUrl(value) {
            if (typeof value !== "string" || value.length > 4096 || !value.startsWith("/export") || /[\u0000-\u001f\u007f\\#]/.test(value)) throw new Error("Invalid export address");
            const base = new URL(document.baseURI || "/", location.origin);
            const target = new URL(value.slice(1), base);
            const relative = target.pathname.startsWith(base.pathname) ? target.pathname.slice(base.pathname.length) : null;
            const current = location.pathname.startsWith(base.pathname) ? location.pathname.slice(base.pathname.length) : null;
            const exportPath = /^export(?:\/(?:article|directoryItem|inheritor)\/[^/]+)?$/;
            if (target.origin !== location.origin || !exportPath.test(relative || "") || !exportPath.test(current || "")) throw new Error("Invalid export address");
            history.replaceState(history.state, "", target.pathname + target.search);
        },
        // 非遗地图的批次、模式与类别写进地址，复制链接即可还原；只替换当前记录，不新增历史。
        setMapUrl(value) {
            if (typeof value !== "string" || value.length > 1024 || !value.startsWith("/explore/regions?") || /[\u0000-\u001f\u007f\\#]/.test(value)) throw new Error("Invalid map address");
            const base = new URL(document.baseURI || "/", location.origin);
            const target = new URL(value.slice(1), base);
            const current = location.pathname.startsWith(base.pathname) ? location.pathname.slice(base.pathname.length) : null;
            if (target.origin !== location.origin || target.pathname !== base.pathname + "explore/regions" || current !== "explore/regions") throw new Error("Invalid map address");
            history.replaceState(history.state, "", target.pathname + target.search);
        },
        // 项目家族对照视图的 view 与 ids 写进地址；只允许当前家族页，替换当前记录。
        setFamilyUrl(value) {
            if (typeof value !== "string" || value.length > 1024 || !value.startsWith("/directory/families/") || /[\u0000-\u001f\u007f\\#]/.test(value)) throw new Error("Invalid family address");
            const base = new URL(document.baseURI || "/", location.origin);
            const target = new URL(value.slice(1), base);
            const relative = target.pathname.startsWith(base.pathname) ? target.pathname.slice(base.pathname.length) : null;
            if (target.origin !== location.origin || !/^directory\/families\/[^/]+$/.test(relative || "") || target.pathname !== location.pathname) throw new Error("Invalid family address");
            history.replaceState(history.state, "", target.pathname + target.search);
        },
        async copyText(text) {
            if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("Clipboard content exceeds limit");
            await navigator.clipboard.writeText(text);
        }
    };
    // Horizontal pickers keep the selected item in view after navigation or a return visit.
    // Only the strip itself scrolls, so the page position is left alone.
    const revealed = new WeakMap();
    function revealSelected() {
        for (const strip of document.querySelectorAll("[data-scroll-selected]")) {
            const selected = strip.querySelector(".selected");
            if (!selected || revealed.get(strip) === selected) continue;
            revealed.set(strip, selected);
            const left = selected.offsetLeft - strip.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2;
            strip.scrollLeft = Math.max(0, left);
        }
    }
    if (typeof MutationObserver === "function" && document.documentElement) {
        let queued = false;
        new MutationObserver(() => { if (!queued) { queued = true; setTimeout(() => { queued = false; revealSelected(); }, 0); } })
            .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    }
    // Same-page section links move keyboard focus with the view, so the next Tab continues
    // inside the chosen section instead of jumping back to the table of contents.
    document.addEventListener("click", event => {
        const link = event.target.closest?.("a[href*='#']");
        if (!link || event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        let url;
        try { url = new URL(link.href, location.href); } catch { return; }
        if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || url.hash.length < 2) return;
        const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (!target) return;
        setTimeout(() => {
            if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
            target.focus({ preventScroll: true });
        }, 0);
    });
    // Native reset restores HTML default values, but Blazor writes input values as properties.
    // Put the applied conditions back so “cancel changes” matches the results on screen.
    document.addEventListener("reset", event => {
        const form = event.target;
        if (!form?.querySelectorAll) return;
        setTimeout(() => { for (const input of form.querySelectorAll("input[data-applied]")) input.value = input.getAttribute("data-applied") || ""; }, 0);
    });
    document.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-copy-link],[data-copy-text]");
        if (!button) return;
        const feedback = button.nextElementSibling?.hasAttribute("data-copy-feedback") ? button.nextElementSibling : null;
        if (feedback) feedback.textContent = "";
        try {
            // data-copy-text names an element on the page whose visible text is copied, e.g. a citation.
            const named = button.dataset.copyText;
            const text = named === undefined ? location.href : document.getElementById(named)?.textContent?.trim();
            if (!text) throw new Error("Nothing to copy");
            await navigator.clipboard.writeText(text); button.dataset.copied = "true";
            if (feedback) feedback.textContent = button.dataset.copySuccess || "Link copied.";
        }
        catch {
            button.dataset.copied = "false";
            if (feedback) feedback.textContent = button.dataset.copyFailure || "The link could not be copied. Please try again.";
        }
    });
})();
