// 离线阅读（docs/features/15）：只在 GitHub Pages 的 WebAssembly host 上提供，默认关闭（D10），
// 读者在设置页打开后才注册 Service Worker；只缓存读者主动「存为离线」的条目详情（不浏览即缓存，D5）。
// 本文件同时被 Service Worker 用 importScripts 载入，共用缓存键规则；在 worker 里只定义规则。
(() => {
    "use strict";
    const types = { directoryItem: "directory-items", inheritor: "inheritors", article: "articles" };
    const typeOfPath = Object.fromEntries(Object.entries(types).map(([type, path]) => [path, type]));
    const rules = {
        prefix: "heritage-",
        shellPrefix: "heritage-shell-",
        contentCache: "heritage-content-v1",
        limits: { items: 300, bytes: 30 * 1024 * 1024 },
        // 详情地址 → 缓存键：只认 ApiBaseUrl 下的三类详情，ID 统一小写，去掉查询串与片段；其他地址返回 null
        detailKey(apiBase, value) {
            let base, url;
            try { base = new URL(apiBase); url = new URL(value); } catch { return null; }
            if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return null;
            const match = /^api\/(directory-items|inheritors|articles)\/([0-9a-fA-F]{24})$/.exec(url.pathname.slice(base.pathname.length));
            return match ? base.origin + base.pathname + "api/" + match[1] + "/" + match[2].toLowerCase() : null;
        },
        detailUrl(apiBase, type, id) {
            if (!Object.hasOwn(types, type) || !/^[0-9a-fA-F]{24}$/.test(id || "")) return null;
            const base = new URL(apiBase);
            return base.origin + base.pathname + "api/" + types[type] + "/" + id.toLowerCase();
        },
        refOfKey(apiBase, key) {
            const normalized = rules.detailKey(apiBase, key);
            if (!normalized) return null;
            const [, path, id] = /api\/([a-z-]+)\/([0-9a-f]{24})$/.exec(normalized);
            return { type: typeOfPath[path], id };
        },
        // 作用域内的整页导航（不含带扩展名的地址，如 release-manifest.json）回退到缓存的 index.html
        isAppNavigation(scope, value) {
            let base, url;
            try { base = new URL(scope); url = new URL(value); } catch { return false; }
            if (url.origin !== base.origin || !(url.pathname + "/").startsWith(base.pathname)) return false;
            const last = url.pathname.split("/").pop() || "";
            return !last.includes(".");
        },
        // 只注销本站作用域的注册（同域根站点与其他子站点的注册不动）
        ownScope(registrationScope, baseHref) {
            try { return registrationScope === new URL("./", baseHref).href; } catch { return false; }
        }
    };
    self.heritageOfflineRules = rules;
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const stateKey = "heritage.web.offline.v1";
    const zh = () => !/^en/i.test(document.documentElement.lang || "");
    const text = {
        update: () => zh() ? "E迹有新版本。点此更新（所有打开的 E迹 页面会一起刷新）" : "A new version of E迹 is ready. Update now (all open E迹 pages will reload)",
        offline: () => zh() ? "当前离线，只能阅读已存为离线的内容。" : "You are offline. Only content saved for offline reading is available."
    };
    let registration = null, hadController = false, refreshing = false, lastUpdate = 0, environment = null, requestOffline = false;

    // 本机只存开关：enabled＝读者开启过；paused＝配置关闭期间已清除缓存，配置恢复后要读者再点一次才重新下载
    function readState() {
        try { const value = JSON.parse(localStorage.getItem(stateKey) || "null"); return { enabled: value?.enabled === true, paused: value?.paused === true }; }
        catch { return { enabled: false, paused: false }; }
    }
    const readEnabled = () => { const state = readState(); return state.enabled && !state.paused; };
    // WebAssembly host 才定义 heritageClient（client-startup.js）；Server host 不提供离线
    const browserHost = () => typeof window.heritageClient === "object" && window.heritageClient !== null;
    const scopeHref = () => new URL("./", document.baseURI).href;

    async function loadEnvironment() {
        let config = null;
        try {
            // 带查询串读取：worker 对配置网络优先，读者拿到的是网络上的最新值
            const response = await fetch(new URL("appsettings.json?offline-check=" + Date.now(), document.baseURI), { cache: "no-store" });
            if (response.ok) config = (await response.json())?.Heritage || null;
        } catch { /* 离线或读取失败时沿用 null */ }
        const loopback = location.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) && config?.Offline?.LoopbackPreview === true;
        environment = {
            supported: "serviceWorker" in navigator && "caches" in window && window.isSecureContext && browserHost() && (location.protocol === "https:" || loopback),
            configEnabled: config ? config.Offline?.Enabled !== false : null,
            apiBase: typeof config?.ApiBaseUrl === "string" ? config.ApiBaseUrl : null
        };
        return environment;
    }

    async function ownRegistration() {
        if (!("serviceWorker" in navigator)) return null;
        const list = await navigator.serviceWorker.getRegistrations();
        return list.find(r => rules.ownScope(r.scope, document.baseURI)) || null;
    }

    async function teardown() {
        const own = await ownRegistration();
        if (own) await own.unregister();
        if ("caches" in window) for (const name of await caches.keys()) if (name.startsWith(rules.prefix)) await caches.delete(name);
        registration = null;
    }

    function banner(id, message, action) {
        let element = document.getElementById(id);
        if (!message) { element?.remove(); return; }
        if (!element) {
            element = document.createElement(action ? "button" : "div");
            element.id = id;
            element.className = "offline-banner" + (action ? " offline-update" : "");
            element.setAttribute("role", "status");
            if (action) { element.type = "button"; element.addEventListener("click", action); }
            document.body.append(element);
        }
        element.textContent = message;
    }

    function prompt(worker) {
        banner("heritage-update", text.update(), () => worker.postMessage({ type: "skip-waiting" }));
    }

    function watch(reg) {
        registration = reg;
        if (reg.waiting && hadController) prompt(reg.waiting);
        reg.addEventListener("updatefound", () => {
            const worker = reg.installing;
            worker?.addEventListener("statechange", () => { if (worker.state === "installed" && navigator.serviceWorker.controller) prompt(worker); });
        });
    }

    async function register() {
        const reg = await navigator.serviceWorker.register("service-worker.js", { scope: "./", updateViaCache: "none" });
        watch(reg);
        lastUpdate = Date.now();
        return reg;
    }

    // 以 worker 报告的请求失败为主、navigator.onLine 为辅
    function updateConnectivity(event) {
        if (event?.type === "online") requestOffline = false;
        banner("heritage-offline", readEnabled() && (navigator.onLine === false || requestOffline) ? text.offline() : null);
    }

    async function startup() {
        window.addEventListener("beforeinstallprompt", event => event.preventDefault());
        if (!browserHost() || !("serviceWorker" in navigator)) return;
        hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener("message", event => {
            if (event.data?.type === "heritage-connectivity") { requestOffline = event.data.offline === true; updateConnectivity(); }
        });
        // 有旧版本控制页面时，新版本接管后刷新一次（点「更新」或安全阀注销后）；首次开启不刷新
        navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !refreshing) { refreshing = true; location.reload(); } });
        window.addEventListener("online", updateConnectivity);
        window.addEventListener("offline", updateConnectivity);
        updateConnectivity();
        const env = await loadEnvironment();
        if (!env.supported) return;
        if (env.configEnabled === false) {
            await teardown();
            const state = readState();
            if (state.enabled && !state.paused) try { localStorage.setItem(stateKey, JSON.stringify({ enabled: true, paused: true })); } catch { /* 存储不可用 */ }
            return;
        }
        if (readEnabled()) {
            await register();
            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible" && registration && Date.now() - lastUpdate > 3600000) { lastUpdate = Date.now(); registration.update().catch(() => {}); }
            });
        } else if (await ownRegistration()) await teardown();
    }

    async function contentEntries() {
        if (!("caches" in window) || !(await caches.has(rules.contentCache))) return [];
        const cache = await caches.open(rules.contentCache);
        const entries = [];
        for (const request of await cache.keys()) {
            const response = await cache.match(request);
            if (!response) continue;
            entries.push({
                type: response.headers.get("x-heritage-type") || "", id: (request.url.split("/").pop() || "").toLowerCase(),
                title: decodeURIComponent(response.headers.get("x-heritage-title") || ""), savedAt: response.headers.get("x-heritage-saved-at") || "",
                bytes: Number(response.headers.get("x-heritage-bytes")) || 0
            });
        }
        return entries;
    }

    window.heritageOffline = {
        rules,
        async status() {
            const env = environment || await loadEnvironment();
            const reg = env.supported ? (registration || await ownRegistration()) : null;
            const entries = env.supported ? await contentEntries() : [];
            const local = readState();
            return {
                supported: env.supported, configEnabled: env.configEnabled, enabled: local.enabled, paused: local.paused,
                state: !reg ? "none" : reg.active && !reg.installing ? "active" : reg.installing ? "installing" : reg.waiting ? "waiting" : "none",
                controlled: Boolean(navigator.serviceWorker?.controller), count: entries.length, bytes: entries.reduce((sum, e) => sum + e.bytes, 0)
            };
        },
        async enable() {
            const env = await loadEnvironment();
            if (!env.supported) throw new Error("offline_unsupported");
            if (env.configEnabled === false) throw new Error("offline_disabled");
            localStorage.setItem(stateKey, JSON.stringify({ enabled: true, enabledAt: new Date().toISOString() }));
            try { await navigator.storage?.persist?.(); } catch { /* 可选：降低被回收的概率 */ }
            await register();
            // 经 .NET 互操作调用时没有 this，直接引用全局对象
            return window.heritageOffline.status();
        },
        // 关闭离线：注销本站注册、删除全部 heritage- 缓存与开关；Server host 上只删开关
        async disable() {
            if (browserHost() && "serviceWorker" in navigator && "caches" in window) await teardown();
            try { localStorage.removeItem(stateKey); } catch { /* 存储不可用 */ }
            updateConnectivity();
        },
        // refs: [{ type, id, title }]；listener 可选（.NET 对象，接收 OnOfflineProgress(done, total)）
        async save(refs, listener) {
            const env = environment || await loadEnvironment();
            if (!env.supported || !env.apiBase || !readEnabled()) throw new Error("offline_unavailable");
            const cache = await caches.open(rules.contentCache);
            let entries = await contentEntries(), done = 0, saved = 0, failed = 0, limited = false;
            const all = Array.isArray(refs) ? refs : [];
            const list = all.slice(0, rules.limits.items);
            for (const ref of list) {
                const url = rules.detailUrl(env.apiBase, ref?.type, ref?.id);
                try {
                    if (!url) throw new Error("invalid");
                    const known = entries.some(e => e.type === ref.type && e.id === ref.id.toLowerCase());
                    if (!known && entries.length >= rules.limits.items) throw new Error("offline_limit");
                    const response = await fetch(url, { mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", headers: { Accept: "application/json" } });
                    if (!response.ok) throw new Error("status");
                    const body = await response.arrayBuffer();
                    const bytes = entries.filter(e => !(e.type === ref.type && e.id === ref.id.toLowerCase())).reduce((sum, e) => sum + e.bytes, 0) + body.byteLength;
                    if (bytes > rules.limits.bytes) throw new Error("offline_limit");
                    const headers = new Headers({ "content-type": response.headers.get("content-type") || "application/json", "x-heritage-type": ref.type,
                        "x-heritage-title": encodeURIComponent(String(ref.title || "").slice(0, 300)), "x-heritage-saved-at": new Date().toISOString(), "x-heritage-bytes": String(body.byteLength) });
                    await cache.put(url, new Response(body, { headers }));
                    entries = entries.filter(e => !(e.type === ref.type && e.id === ref.id.toLowerCase()))
                        .concat([{ type: ref.type, id: ref.id.toLowerCase(), bytes: body.byteLength }]);
                    saved++;
                } catch (error) {
                    // 达到条数或体积上限即停止，剩余条目不再尝试
                    if (error?.message === "offline_limit") { limited = true; break; }
                    failed++;
                }
                done++;
                try { await listener?.invokeMethodAsync("OnOfflineProgress", done, list.length); } catch { /* 页面已离开 */ }
            }
            return { saved, failed, total: all.length, limited: limited || all.length > list.length };
        },
        async list() { return (environment || await loadEnvironment()).supported ? contentEntries() : []; },
        async isSaved(type, id) {
            const env = environment || await loadEnvironment();
            const url = env.supported && env.apiBase ? rules.detailUrl(env.apiBase, type, id) : null;
            if (!url || !(await caches.has(rules.contentCache))) return false;
            return Boolean(await (await caches.open(rules.contentCache)).match(url));
        },
        async remove(type, id) {
            const env = environment || await loadEnvironment();
            const url = env.apiBase ? rules.detailUrl(env.apiBase, type, id) : null;
            if (url && await caches.has(rules.contentCache)) await (await caches.open(rules.contentCache)).delete(url);
        },
        async clearContent() { if ("caches" in window) await caches.delete(rules.contentCache); },
        // 从「在设置中开启离线阅读」链接进入时滚到设置小节（小节在 Blazor 渲染后才出现，浏览器自己的锚点跳转找不到它）
        reveal() { if (location.hash === "#offline") document.getElementById("offline")?.scrollIntoView({ block: "start" }); }
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => startup().catch(() => {}));
    else startup().catch(() => {});
})();
