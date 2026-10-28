// GitHub Pages serves its 404 document for direct SPA routes. Restore only
// same-origin addresses inside this app; preserve query/hash bytes for Router.
(() => {
    const parameter = "__heritage_route";
    const current = new URL(location.href);
    const route = current.searchParams.get(parameter);
    if (route === null) return;
    const base = new URL(document.querySelector("base").href);
    if (current.origin !== base.origin || current.pathname !== base.pathname) return;
    try {
        if (route.length > 16384 || route.startsWith("/") || /[\u0000-\u001f\u007f\\]/u.test(route)) throw new Error("Invalid route");
        // Validate before URL normalizes dot segments. Nested escaping is used by
        // existing generated learning IDs, but encoded separators are never UI paths.
        let path = route.split(/[?#]/u, 1)[0];
        for (let depth = 0; depth < 4; depth++) {
            if (path.split("/").some(part => part === "." || part === "..") || /[\u0000-\u001f\u007f\\]/u.test(path)) throw new Error("Invalid path");
            const decoded = decodeURIComponent(path);
            if (decoded === path) break;
            if (decoded.split("/").length !== path.split("/").length) throw new Error("Encoded separator");
            path = decoded;
            if (depth === 3) throw new Error("Excessive encoding");
        }
        const target = new URL(route, base);
        if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new Error("Outside application");
        history.replaceState(history.state, "", target.pathname + target.search + target.hash);
    } catch {
        current.searchParams.delete(parameter);
        history.replaceState(history.state, "", base.pathname + current.search + current.hash);
    }
})();
