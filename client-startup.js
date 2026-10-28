// The shared component scripts also work without a server circuit. This adapter
// feeds their navigation lifecycle from the browser Router and rendered DOM.
(() => {
    const callbacks = new Map();
    let blazor, previousPage, queued = false;
    function emit(name) { for (const callback of callbacks.get(name) || []) callback(); }
    function pageKey() { const u = new URL(location.href); u.searchParams.delete("image"); u.hash = ""; return u.href; }
    window.heritageClient = {
        setLanguageTag: language => { document.documentElement.lang = language; },
        async initialize(instance) {
            blazor = instance;
            const shared = await import("./shared-navigation.js");
            shared.afterWebStarted({
                addEventListener(name, callback) { const items = callbacks.get(name) || []; items.push(callback); callbacks.set(name, items); },
                navigateTo: (uri, options) => blazor.navigateTo(uri, options)
            });
            const observer = new MutationObserver(() => {
                if (queued) return;
                queued = true;
                queueMicrotask(() => { queued = false; emit("enhancedload"); });
            });
            observer.observe(document.getElementById("app"), { childList: true, subtree: true });
            this.navigationComplete();
        },
        navigationComplete() {
            const current = pageKey();
            if (previousPage && current !== previousPage) emit("enhancednavigationstart");
            previousPage = current;
            emit("enhancedload");
        }
    };
})();
