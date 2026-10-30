(() => {
    "use strict";
    // The URL is the replayable state. This module never persists a gallery or reads a service.
    const stateKey = "heritageViewer";
    let gallery = [], index = 0, trigger = null, catalogPage = null, fingerprint = null;
    let boundDialog = null, scrollStyle = null, loadGeneration = 0, navigating = false, scheduled = false;
    const ignoredCloses = new WeakMap();
    const viewer = () => document.getElementById("heritage-media-viewer");
    const notice = () => document.querySelector("[data-media-notice]");
    function safeUrl(value) {
        try {
            const url = new URL(value, location.href);
            return !url.username && !url.password && (url.protocol === "https:" || url.protocol === "http:" && url.origin === location.origin) ? url.href : null;
        } catch { return null; }
    }
    function pageUrl() { const url = new URL(location.href); url.searchParams.delete("image"); return url; }
    function pageKey() { const url = pageUrl(); url.hash = ""; return url.href; }
    let documentPage = pageKey();
    function historyBase() { const state = { ...history.state }; delete state[stateKey]; return state; }
    function ownedEntry() {
        const value = history.state?.[stateKey];
        return value?.version === 2 && value.page === pageKey();
    }
    function clearNotice() { const element = notice(); if (element) element.hidden = true; }
    function showNotice(key) {
        const element = notice(), dialog = viewer();
        if (!element || !dialog) return;
        element.querySelector("[data-media-notice-text]").textContent = dialog.dataset[key] || "";
        element.hidden = false;
    }
    // Below this natural width a source image is kept near its real size instead of being stretched.
    const smallWidth = 360;
    function message(key, ...values) {
        return values.reduce((text, value, i) => text.replace(`{${i}}`, String(value)), viewer()?.dataset[key] || "");
    }
    function fallbacks(anchor) {
        return (anchor?.getAttribute("data-preview-fallback") || "").split(/\s+/).map(value => value && safeUrl(value)).filter(Boolean);
    }
    function collect() {
        const seen = new Set();
        return [...document.querySelectorAll("a[data-preview-image]")].map(anchor => ({
            url: safeUrl(anchor.getAttribute("href")),
            fallbacks: fallbacks(anchor),
            caption: anchor.querySelector("img")?.alt || anchor.getAttribute("aria-label") || "",
            anchor
        })).filter(item => item.url && !seen.has(item.url) && seen.add(item.url));
    }
    // Page images: try the asset's other recorded addresses, then say plainly that the image is
    // missing. Notes are attributes rendered by CSS so the Blazor-owned DOM keeps its children.
    function inspect(image) {
        const anchor = image.closest?.("a[data-preview-image]"), figure = anchor?.closest("figure");
        if (!anchor || !figure || !image.complete) return;
        if (!image.naturalWidth) {
            const tried = Number(image.dataset.fallbackIndex || 0), next = fallbacks(anchor)[tried];
            if (next && next !== image.currentSrc) { image.dataset.fallbackIndex = String(tried + 1); image.src = next; return; }
            figure.setAttribute("data-media-missing", message("missing"));
            figure.removeAttribute("data-media-small");
            return;
        }
        figure.removeAttribute("data-media-missing");
        image.style.setProperty("--media-natural-width", `${image.naturalWidth}px`);
        if (image.naturalWidth < smallWidth) {
            figure.setAttribute("data-media-small", message("small", image.naturalWidth, image.naturalHeight));
            upgrade(image, fallbacks(anchor).filter(url => url !== image.currentSrc), url => { if (image.isConnected) image.src = url; });
        } else figure.removeAttribute("data-media-small");
    }
    // A compressed copy can be much smaller than the recorded original; use the original only
    // when it actually loads with more pixels.
    function upgrade(image, candidates, apply) {
        if (image.dataset.upgradeChecked || !candidates.length) return;
        image.dataset.upgradeChecked = "true";
        const probe = new Image();
        probe.onload = () => { if (probe.naturalWidth > image.naturalWidth) apply(probe.src); };
        probe.src = candidates[0];
    }
    function inspectAll() { for (const image of document.querySelectorAll("a[data-preview-image] img")) if (image.complete) inspect(image); }
    function lockScroll() {
        if (scrollStyle === null) scrollStyle = document.body.style.overflow;
        document.body.style.overflow = "hidden";
    }
    function hide({ focus = true } = {}) {
        loadGeneration++;
        const dialog = viewer();
        if (dialog?.open) {
            ignoredCloses.set(dialog, (ignoredCloses.get(dialog) || 0) + 1);
            dialog.close();
        }
        if (scrollStyle !== null) { document.body.style.overflow = scrollStyle; scrollStyle = null; }
        if (focus && trigger?.isConnected) trigger.focus();
        fingerprint = null;
    }
    function removeImageParameter(message) {
        hide();
        history.replaceState(historyBase(), "", pageUrl().href);
        gallery = []; catalogPage = null; trigger = null;
        if (message) showNotice(message);
    }
    function requestClose() {
        const goBack = ownedEntry() && new URL(location.href).searchParams.has("image");
        hide();
        if (goBack) history.back();
        else removeImageParameter();
    }
    function writeIndex(number, { opening = false } = {}) {
        const base = pageUrl(), url = new URL(base.href);
        url.searchParams.set("image", String(number + 1)); // Human-facing, one-based index.
        if (opening && !ownedEntry()) {
            // Direct links/reloads need an in-page close destination too.
            if (new URL(location.href).searchParams.has("image")) history.replaceState(historyBase(), "", base.href);
            history.pushState({ ...historyBase(), [stateKey]: { version: 2, page: pageKey(), image: number + 1 } }, "", url.href);
        } else {
            history.replaceState({ ...historyBase(), [stateKey]: { version: 2, page: pageKey(), image: number + 1 } }, "", url.href);
        }
    }
    function zoom(value) {
        const dialog = viewer(); if (!dialog) return;
        const amount = Math.max(1, Math.min(3, Number(value) || 1));
        const image = dialog.querySelector("[data-media-image]");
        dialog.querySelector("[data-media-zoom]").value = String(amount);
        if (image) image.style.transform = `scale(${amount})`;
    }
    function loadCurrent() {
        const dialog = viewer(), item = gallery[index]; if (!dialog || !item) return;
        const generation = ++loadGeneration;
        const previous = dialog.querySelector("[data-media-image]");
        // A new element binds load/error to this request, so an old image event cannot
        // turn a newer failed/pending original into a false success.
        const image = previous.cloneNode(false);
        image.removeAttribute("src"); image.removeAttribute("data-failed");
        image.hidden = true; image.alt = item.caption; image.style.transform = "scale(1)";
        const loading = dialog.querySelector("[data-media-loading]"), error = dialog.querySelector("[data-media-error]");
        const range = dialog.querySelector("[data-media-zoom]");
        dialog.dataset.mediaState = "loading"; loading.hidden = false; error.hidden = true; range.disabled = true; range.value = "1";
        dialog.querySelector("[data-media-frame]").setAttribute("aria-busy", "true");
        dialog.querySelector("[data-media-source]").href = item.url;
        const quality = dialog.querySelector("[data-media-quality]"); if (quality) quality.hidden = true;
        const sources = [item.url, ...(item.fallbacks || [])]; let attempt = 0;
        const current = () => generation === loadGeneration && catalogPage === pageKey() && dialog === viewer();
        function failed() {
            if (!current()) return;
            if (++attempt < sources.length) { image.src = sources[attempt]; return; }
            dialog.dataset.mediaState = "error"; loading.hidden = true; error.hidden = false; image.hidden = true; range.disabled = true;
            dialog.querySelector("[data-media-frame]").setAttribute("aria-busy", "false");
        }
        function loaded() {
            if (!current()) return;
            if (!image.naturalWidth) { failed(); return; }
            dialog.dataset.mediaState = "loaded"; loading.hidden = true; error.hidden = true; image.hidden = false; range.disabled = false;
            dialog.querySelector("[data-media-source]").href = image.currentSrc || sources[attempt];
            if (quality && image.naturalWidth < smallWidth) {
                quality.textContent = message("smallViewer", image.naturalWidth, image.naturalHeight); quality.hidden = false;
                upgrade(image, sources.slice(attempt + 1), url => { if (current()) image.src = url; });
            } else if (quality) quality.hidden = true;
            dialog.querySelector("[data-media-frame]").setAttribute("aria-busy", "false");
        }
        image.addEventListener("load", loaded); image.addEventListener("error", failed);
        previous.replaceWith(image); image.src = sources[0];
        if (image.complete) Promise.resolve().then(() => { if (image.naturalWidth) loaded(); else failed(); });
    }
    function show(number, { updateUrl = true } = {}) {
        const dialog = viewer(); if (!dialog || !gallery.length) return;
        index = (number + gallery.length) % gallery.length;
        if (updateUrl) writeIndex(index);
        const item = gallery[index];
        fingerprint = JSON.stringify([catalogPage, index, ...gallery.map(entry => [entry.url, entry.caption])]);
        dialog.querySelector("[data-media-counter]").textContent = `${index + 1} / ${gallery.length}`;
        dialog.querySelector("[data-media-caption]").textContent = item.caption;
        dialog.querySelector("[data-media-previous]").disabled = gallery.length < 2;
        dialog.querySelector("[data-media-next]").disabled = gallery.length < 2;
        loadCurrent();
    }
    function bind() {
        const dialog = viewer(); if (!dialog || boundDialog === dialog) return dialog;
        boundDialog = dialog;
        dialog.addEventListener("click", event => {
            if (event.target.closest("[data-media-close]")) requestClose();
            else if (event.target.closest("[data-media-previous]")) show(index - 1);
            else if (event.target.closest("[data-media-next]")) show(index + 1);
            else if (event.target.closest("[data-media-reset]")) zoom(1);
            else if (event.target.closest("[data-media-retry]")) loadCurrent();
        });
        dialog.addEventListener("keydown", event => {
            // Native slider/editing controls own their arrow keys, including zoom adjustment.
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input,select,textarea,[contenteditable]")) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); show(index - 1); }
            else if (event.key === "ArrowRight") { event.preventDefault(); show(index + 1); }
        });
        dialog.querySelector("[data-media-zoom]").addEventListener("input", event => zoom(event.target.value));
        dialog.addEventListener("cancel", event => { event.preventDefault(); requestClose(); });
        dialog.addEventListener("close", () => {
            const ignored = ignoredCloses.get(dialog) || 0;
            if (ignored) { ignoredCloses.set(dialog, ignored - 1); return; }
            requestClose();
        });
        return dialog;
    }
    function open(number, { fromUrl = false } = {}) {
        const dialog = bind(); if (!dialog) return;
        clearNotice();
        if (!fromUrl) writeIndex(number, { opening: true });
        else if (!ownedEntry()) writeIndex(number, { opening: true });
        else writeIndex(number);
        lockScroll(); show(number, { updateUrl: false });
        if (!dialog.open) dialog.showModal();
    }
    function restoreFromUrl() {
        if (navigating) return;
        if (pageKey() !== documentPage) {
            hide({ focus: false }); gallery = []; catalogPage = null; trigger = null;
            return; // The new page's markup has not been installed yet.
        }
        const url = new URL(location.href), values = url.searchParams.getAll("image");
        if (!values.length) { hide(); gallery = []; catalogPage = null; trigger = null; return; }
        if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !Number.isSafeInteger(Number(values[0]))) {
            removeImageParameter("invalidIndex"); return;
        }
        const items = collect();
        // Streamed detail markup may arrive after startup/enhancedload. Wait for its
        // real heading or error before treating an empty gallery as unavailable.
        if (!items.length) {
            const group = document.querySelector("[data-preview-group]");
            if (document.readyState === "loading" || group && !group.querySelector("h1,[role='alert']")) return;
            removeImageParameter("unavailable"); return;
        }
        const selected = Number(values[0]) - 1;
        if (selected >= items.length) { removeImageParameter("invalidIndex"); return; }
        const nextPage = pageKey(), nextFingerprint = JSON.stringify([nextPage, selected, ...items.map(entry => [entry.url, entry.caption])]);
        if (viewer()?.open && fingerprint === nextFingerprint) return;
        gallery = items; catalogPage = nextPage; trigger = items[selected].anchor;
        open(selected, { fromUrl: true });
    }
    function scheduleRestore() {
        if (navigating || scheduled || !new URL(location.href).searchParams.has("image")) return;
        scheduled = true;
        Promise.resolve().then(() => { scheduled = false; restoreFromUrl(); });
    }
    function beforeNavigate() {
        navigating = true; hide({ focus: false }); clearNotice();
        gallery = []; catalogPage = null; trigger = null;
        const image = viewer()?.querySelector("[data-media-image]");
        image?.removeAttribute("src");
    }
    window.heritageMedia = { close: requestClose, beforeNavigate, restore() { navigating = false; documentPage = pageKey(); bind(); restoreFromUrl(); } };
    document.addEventListener("click", event => {
        if (event.target.closest?.("[data-media-dismiss-notice]")) { clearNotice(); return; }
        const anchor = event.target.closest?.("a[data-preview-image]");
        if (!anchor || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const url = safeUrl(anchor.getAttribute("href"));
        if (!url) { event.preventDefault(); return; }
        if (pageKey() !== documentPage || !bind()) return;
        const items = collect(), selected = items.findIndex(item => item.url === url); if (selected < 0) return;
        event.preventDefault(); navigating = false; gallery = items; catalogPage = pageKey(); trigger = anchor;
        open(selected);
    });
    document.addEventListener("load", event => { if (event.target?.tagName === "IMG") inspect(event.target); }, true);
    document.addEventListener("error", event => { if (event.target?.tagName === "IMG") inspect(event.target); }, true);
    window.addEventListener("popstate", restoreFromUrl);
    window.addEventListener("pageshow", () => window.heritageMedia.restore());
    let inspecting = false;
    if (typeof MutationObserver === "function") new MutationObserver(() => {
        scheduleRestore();
        if (!inspecting) { inspecting = true; Promise.resolve().then(() => { inspecting = false; inspectAll(); }); }
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => window.heritageMedia.restore(), { once: true });
    else window.heritageMedia.restore();
})();
