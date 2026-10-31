/* Manifest version: pzIBP88o */
// 离线阅读的发布版 Service Worker（docs/features/15）。只有读者在设置页开启后才会注册。
// 外壳：按 SDK 生成的 service-worker-assets.js（含 SHA-256）整体缓存；内容：只服务读者「存为离线」的三类详情。
// 只对四类请求 respondWith：作用域内导航、清单内外壳文件、appsettings.json、配置 API 下的三类详情；其余交给浏览器。
self.importScripts("./service-worker-assets.js");
self.importScripts("./offline.js");

const rules = self.heritageOfflineRules;
const scope = new URL(self.registration.scope);
const shellName = rules.shellPrefix + self.assetsManifest.version;
const skipped = new Set([".nojekyll", "404.html", "service-worker.js"]);
const shellAssets = self.assetsManifest.assets.filter(asset => !skipped.has(asset.url));
const shellUrls = new Set(shellAssets.map(asset => new URL(asset.url, scope).href));
const configUrl = new URL("appsettings.json", scope).href;
const indexUrl = new URL("index.html", scope).href;
const detailPath = /\/api\/(?:directory-items|inheritors|articles)\/[0-9a-fA-F]{24}$/;
const networkTimeout = 5000;
let apiBase = null;

// 读取失败或无法解析时抛出：安装失败、保留旧版本，下次检查更新时重试
async function readConfig() {
    const response = await fetch(configUrl, { cache: "no-store" });
    if (!response.ok) throw new Error("config_unavailable");
    const config = (await response.json())?.Heritage;
    if (!config || typeof config !== "object") throw new Error("config_invalid");
    return config;
}

async function cachedConfig() {
    const cache = await caches.open(shellName);
    const response = await cache.match(configUrl);
    return response ? (await response.json())?.Heritage || null : null;
}

// 安全阀一：配置关闭离线功能时删除全部 heritage- 缓存并注销；各页面刷新一次（页面读到关闭后不会再注册）
async function teardown() {
    for (const name of await caches.keys()) if (name.startsWith(rules.prefix)) await caches.delete(name);
    await self.registration.unregister();
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url).catch(() => {});
}

self.addEventListener("install", event => event.waitUntil((async () => {
    const config = await readConfig();
    if (config.Offline?.Enabled === false) { await self.skipWaiting(); return; }
    const cache = await caches.open(shellName);
    await cache.addAll(shellAssets.map(asset => new Request(new URL(asset.url, scope).href, { integrity: asset.hash, cache: "no-cache" })));
})()));

self.addEventListener("activate", event => event.waitUntil((async () => {
    let config = null;
    try { config = await readConfig(); } catch { config = await cachedConfig(); }
    if (config?.Offline?.Enabled === false) { await teardown(); return; }
    // 旧外壳一并删除；内容缓存的 ApiBaseUrl 变了时，旧地址下的条目不再命中，也删除
    for (const name of await caches.keys()) if (name.startsWith(rules.shellPrefix) && name !== shellName) await caches.delete(name);
    apiBase = typeof config?.ApiBaseUrl === "string" ? config.ApiBaseUrl : null;
    if (apiBase && await caches.has(rules.contentCache)) {
        const content = await caches.open(rules.contentCache);
        for (const request of await content.keys()) if (!rules.detailKey(apiBase, request.url)) await content.delete(request);
    }
    await self.clients.claim();
})()));

self.addEventListener("message", event => { if (event.data?.type === "skip-waiting") self.skipWaiting(); });

async function shell(request) {
    const cache = await caches.open(shellName);
    return (await cache.match(request.url, { ignoreSearch: true })) || fetch(request);
}

async function navigation(request) {
    const cache = await caches.open(shellName);
    return (await cache.match(indexUrl)) || fetch(request);
}

// 离线提示以请求失败为主（navigator.onLine 为辅）：网络请求失败、改用缓存时告诉发起请求的页面
async function notify(clientId, offline) {
    const client = clientId ? await self.clients.get(clientId) : null;
    client?.postMessage({ type: "heritage-connectivity", offline });
}

// 配置：网络优先，失败时用缓存（这样只改配置的发布也能被页面读到）
async function config(request, clientId) {
    try {
        const response = await fetch(request, { cache: "no-store" });
        notify(clientId, false);
        if (response.ok) return response;
    } catch { notify(clientId, true); }
    const cache = await caches.open(shellName);
    return (await cache.match(configUrl)) || Response.error();
}

// 页面经 CORS 读响应头：声明公开 x-heritage-offline，详情页据此提示「其他区块离线时不可用」
function marked(response) {
    const headers = new Headers(response.headers);
    headers.set("x-heritage-offline", "1");
    headers.set("access-control-expose-headers", "x-heritage-offline");
    return new Response(response.body, { status: 200, headers });
}

// 详情：只有读者存过（缓存里有）的条目网络优先、5 秒超时；未存的条目原样转发，不写缓存
async function detail(request, clientId) {
    apiBase = apiBase || (await cachedConfig())?.ApiBaseUrl || null;
    const key = apiBase ? rules.detailKey(apiBase, request.url) : null;
    if (!key || !(await caches.has(rules.contentCache))) return fetch(request);
    const cache = await caches.open(rules.contentCache);
    const cached = await cache.match(key, { ignoreVary: true });
    if (!cached) return fetch(request);
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), networkTimeout); });
    const network = fetch(request).then(async response => {
        const type = response.headers.get("content-type") || "";
        if (response.ok && type.includes("json")) {
            const body = await response.clone().arrayBuffer();
            // 刷新前再确认一次仍是已存条目，避免与「移除」竞争时把条目写回
            const current = await cache.match(key, { ignoreVary: true });
            if (current) {
                const headers = new Headers(current.headers);
                headers.set("content-type", type);
                headers.set("x-heritage-bytes", String(body.byteLength));
                headers.set("x-heritage-refreshed-at", new Date().toISOString());
                await cache.put(key, new Response(body, { headers }));
            }
        }
        return response;
    }, () => null);
    const winner = await Promise.race([network, timeout]);
    clearTimeout(timer);
    notify(clientId, !winner);
    if (winner && winner.status < 500) return winner;
    return marked(cached);
}

self.addEventListener("fetch", event => {
    const request = event.request;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (request.mode === "navigate") {
        if (rules.isAppNavigation(scope.href, url.href)) event.respondWith(navigation(request));
        return;
    }
    if (url.origin + url.pathname === configUrl) { event.respondWith(config(request, event.clientId)); return; }
    if (url.origin === scope.origin && !url.search && shellUrls.has(url.href)) { event.respondWith(shell(request)); return; }
    if (detailPath.test(url.pathname)) event.respondWith(detail(request, event.clientId));
});
