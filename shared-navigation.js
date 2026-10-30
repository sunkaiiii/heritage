// Enhanced navigation patches <html> attributes back to their SSR values.
// Restore browser preferences and replay media only after the new DOM is available.
export function afterWebStarted(blazor) {
    // Enhanced navigation changes default attributes without necessarily clearing
    // a control's browser-maintained dirty value. Restore public GET filters once
    // per SSR form/query, then leave drafts alone during later streaming patches.
    const restoredForms = new WeakMap();
    let restoreTask;
    const filterLocation = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("image"); // Media history does not change filters.
        url.hash = "";
        return url.href;
    };
    const restoreFilters = (force = false) => {
        const current = new URL(filterLocation());
        const forms = document.querySelectorAll?.("form[method][action]") ?? [];
        for (const form of forms) {
            if (form.getAttribute("method")?.toLowerCase() !== "get"
                || form.closest("[data-preserve-form-values]")) continue;
            const action = new URL(form.getAttribute("action"), window.location.href);
            if (action.origin !== window.location.origin) continue;
            const controls = Array.from(form.elements).filter(control =>
                ["INPUT", "SELECT", "TEXTAREA"].includes(control.tagName)
                && !["file", "password", "button", "submit", "reset", "image"].includes(control.type)
                // A value generated for the next submission (for example a new random draw) must not be replaced by the current query.
                && !control.hasAttribute?.("data-fresh-value"));
            const stamp = JSON.stringify([filterLocation(), action.href, controls.map(control =>
                control.tagName === "SELECT"
                    ? [control.name, control.multiple, Array.from(control.options, option => [option.value, option.defaultSelected])]
                    : [control.name, control.type, control.defaultValue, control.defaultChecked])]);
            if (!force && restoredForms.get(form) === stamp) continue;
            for (const control of controls) {
                // Blazor may render a value property without a value attribute.
                // The submitted query is authoritative for this GET destination;
                // absent parameters continue to use the server's defaults.
                const submitted = action.pathname === current.pathname && control.name && current.searchParams.has(control.name)
                    ? current.searchParams.getAll(control.name) : null;
                if (control.tagName === "SELECT") {
                    if (control.multiple) {
                        for (const option of control.options) option.selected = submitted ? submitted.includes(option.value) : option.defaultSelected;
                    } else {
                        const options = Array.from(control.options);
                        const fromQuery = submitted ? options.findIndex(option => option.value === submitted[0]) : -1;
                        const selected = fromQuery >= 0 ? fromQuery : options.findLastIndex(option => option.defaultSelected);
                        control.selectedIndex = selected < 0 && options.length ? 0 : selected;
                    }
                } else if (control.type === "checkbox" || control.type === "radio") {
                    control.checked = submitted ? submitted.includes(control.value) : control.defaultChecked;
                } else control.value = submitted ? submitted[0] : control.defaultValue;
            }
            restoredForms.set(form, stamp);
        }
    };
    const scheduleFilters = (force = false) => {
        // A task also runs after the browser has restored history form properties.
        if (!(document.querySelectorAll?.("form[method][action]").length)) return;
        window.clearTimeout(restoreTask);
        restoreTask = window.setTimeout(() => restoreFilters(force), 0);
    };

    // A skip link is a same-document accessibility action even when status-code
    // re-execution rendered its href using /not-found instead of the actual URL.
    // Run in capture so enhanced navigation does not consume it first.
    document.addEventListener?.("click", event => {
        const anchor = event.target?.closest?.("a.skip-link[href]");
        if (!anchor || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
            || anchor.hasAttribute("download") || ![null, "", "_self"].includes(anchor.getAttribute("target"))) return;
        const destination = new URL(anchor.getAttribute("href"), window.location.href);
        if (destination.origin !== window.location.origin || destination.hash !== "#main-content") return;
        const main = document.getElementById?.("main-content");
        if (!main || typeof main.focus !== "function") return;
        event.preventDefault();
        const actual = new URL(window.location.href);
        actual.hash = "main-content";
        if (actual.href !== window.location.href) window.history.pushState(window.history.state, "", actual.href);
        main.focus({ preventScroll: true });
        main.scrollIntoView({ block: "start", behavior: "auto" });
    }, true);

    // Native dialog supplies background inertness and the keyboard focus trap.
    // Enhanced/streamed navigation can replace both the dialog and its opener;
    // restore the logical opener in the current DOM, never a detached reference.
    const graphDialogs = new WeakSet();
    let graphDialog = null, graphBaseHref = null, graphReturn = null, graphObserver = null, graphSyncQueued = false;
    const withoutGraphInfo = () => {
        const url = new URL(window.location.href);
        url.searchParams.delete("info");
        return url.href;
    };
    const scheduleGraphFocus = () => {
        if (graphSyncQueued) return;
        graphSyncQueued = true;
        const run = () => { graphSyncQueued = false; restoreGraphFocus(); };
        if (typeof window.queueMicrotask === "function") window.queueMicrotask(run);
        else if (typeof window.setTimeout === "function") window.setTimeout(run, 0);
        else run();
    };
    const restoreGraphFocus = () => {
        const dialog = document.getElementById?.("graph-info-dialog");
        const opener = document.getElementById?.("graph-info-trigger");
        if (!graphObserver && (dialog || opener) && typeof MutationObserver === "function") {
            graphObserver = new MutationObserver(scheduleGraphFocus);
            graphObserver.observe(document.documentElement, { childList: true, subtree: true });
        }
        if (dialog && typeof dialog.showModal === "function") {
            graphBaseHref = withoutGraphInfo();
            graphReturn = null;
            if (!graphDialogs.has(dialog)) {
                graphDialogs.add(dialog);
                dialog.addEventListener("cancel", event => {
                    event.preventDefault();
                    const close = dialog.querySelector("[data-graph-info-close]");
                    if (close) blazor.navigateTo(close.getAttribute("href"), { replaceHistoryEntry: true });
                });
            }
            const changed = graphDialog !== dialog;
            graphDialog = dialog;
            if (!dialog.open) dialog.showModal();
            if (changed) dialog.querySelector("[data-graph-info-close]")?.focus({ preventScroll: true });
            return;
        }
        if (graphDialog) {
            if (graphDialog.open) graphDialog.close();
            graphDialog = null;
            graphReturn = { href: graphBaseHref, element: null };
        }
        if (!graphReturn) return;
        if (window.location.href !== graphReturn.href) { graphReturn = null; return; }
        if (opener && (opener !== graphReturn.element || document.activeElement === document.body
            || document.activeElement?.tagName === "H1")) {
            graphReturn.element = opener;
            opener.focus({ preventScroll: true });
        }
    };
    // Stop retrying after deliberate user navigation; delayed hydration focus
    // or a streaming DOM replacement may still need one logical restoration.
    document.addEventListener?.("keydown", event => {
        if (!graphDialog && !["Shift", "Alt", "Control", "Meta"].includes(event.key)) graphReturn = null;
    }, true);
    document.addEventListener?.("pointerdown", () => { if (!graphDialog) graphReturn = null; }, true);
    document.addEventListener?.("focusin", () => { if (graphReturn) scheduleGraphFocus(); });
    const restore = () => {
        window.heritageStore.refreshTheme();
        window.heritageMedia?.restore();
        scheduleFilters();
        restoreGraphFocus();
    };
    blazor.addEventListener("enhancedload", restore);
    blazor.addEventListener("enhancednavigationstart", () => window.heritageMedia?.beforeNavigate());
    window.addEventListener("pageshow", event => { if (event.persisted) scheduleFilters(true); });
    restore();
}
