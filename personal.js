(() => {
    "use strict";
    const key = "heritage.web.personal.v1";
    const savedKey = "heritage.web.saved.v1";
    const prefixes = { article: "articles", directoryItem: "directory", inheritor: "inheritors" };
    const languages = ["system", "zh-Hans", "en"];
    const kinds = ["favorite-upsert", "favorite-delete", "history-add", "history-clear", "progress-upsert"];
    const text = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max).trim() : "";
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : new Date().toISOString();
    const validProfile = value => typeof value === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
    const validRoute = value => typeof value === "string" && value.length > 0 && value.length <= 640 && !/[\u0000-\u001f\u007f/\\?#]/.test(value) && ![".", ".."].includes(value);
    const validStep = value => typeof value === "string" && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f\u007f,]/.test(value);
    const sourceKinds = ["content", "graph", "search", "learning", "personal", "discovery", "unknown"];
    const appPaths = /^(?:\/(?:articles|directory|inheritors)\/[a-f\d]{24}|\/graph(?:\/(?:content\/(?:article|directoryItem|inheritor)\/[a-f\d]{24}|topic\/(?:region|category|year|kind|projectCode)\/[^/?#]+|trail|path|bridge|edge))?|\/search|\/learning-routes(?:\/[^/?#]+)?|\/my(?:\/(?:favorites|history|learning|journeys|research))?|\/explore(?:\/[^/?#]+)?|\/discover(?:\/[^/?#]+)?)$/i;
    let navigationSource = null, referrerAllowed = true;
    // Persist canonical paths so root-hosted bookmarks and reading paths survive a move to a subdirectory.
    // Navigation evidence, in contrast, must actually belong to the current base URI.
    function appPath(value, allowCanonical = false) {
        if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
        try {
            const rawPath = value.split(/[?#]/, 1)[0];
            if (/%(?:2f|5c|2e)/i.test(rawPath) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return null;
            const base = new URL(document.baseURI || "/", window.location.origin);
            if (base.origin !== window.location.origin || base.username || base.password || base.search || base.hash || !base.pathname.endsWith("/")) return null;
            const url = new URL(value, base);
            if (url.origin !== base.origin || url.username || url.password) return null;
            const pathname = url.pathname.startsWith(base.pathname) ? "/" + url.pathname.slice(base.pathname.length)
                : allowCanonical && value.startsWith("/") && !value.startsWith("//") ? url.pathname : null;
            return pathname === null ? null : { url, pathname };
        } catch { return null; }
    }
    function appLocation(value, allowCanonical = false) {
        const target = appPath(value, allowCanonical);
        if (!target || !appPaths.test(target.pathname)) return null;
        const { url, pathname } = target;
        try {
            const query = new URLSearchParams();
            for (const key of ["tab", "view", "strategy", "mode", "q", "type", "difficulty", "seedType", "seedKey", "page", "item", "id", "topicType", "key", "sample", "fromType", "fromId", "toType", "toId", "depth", "limit", "topics", "ai", "relation", "source", "entity", "confidence", "stale"]) {
                const value = url.searchParams.get(key);
                if (value && value.length <= 300 && !/[\u0000-\u001f\u007f]/.test(value)) query.set(key, value);
            }
            const source = /^\/(articles|directory|inheritors)\//.test(pathname) ? "content" : pathname.startsWith("/graph") ? "graph" : pathname === "/search" ? "search" : pathname.startsWith("/learning-routes") ? "learning" : pathname.startsWith("/my") ? "personal" : "discovery";
            return { href: pathname + (query.size ? "?" + query.toString() : ""), pathname, source };
        } catch { return null; }
    }
    const position = value => typeof value === "string" && /^scroll:v1:(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.test(value) ? Number(value.slice(10)) : null;
    const scrollRange = () => Math.max(0, Number(document.documentElement.scrollHeight || 0) - Number(window.innerHeight || 0));
    function recordItem(item, lastPosition, origin = null) {
        const state = read(), previous = state.history.find(x => x.id === item.id && x.type === item.type);
        const viewedAt = new Date().toISOString();
        enqueue(state, { kind: "history-add", targetType: item.type, targetId: item.id, lastPosition });
        state.history = [{ ...item, viewedAt, viewCount: (previous?.viewCount || 0) + 1, lastPosition }, ...state.history.filter(x => x.id !== item.id || x.type !== item.type)].slice(0, 200);
        state.readingPath = [{ ...item, createdAt: viewedAt, fromTitle: origin?.title || "", fromHref: origin?.href || null, source: origin?.source || "unknown" }, ...state.readingPath].slice(0, 50);
        write(state); return summary(state);
    }
    function content(value) {
        if (!value || typeof value.type !== "string" || !Object.hasOwn(prefixes, value.type) || typeof value.id !== "string" || !/^[a-f\d]{24}$/i.test(value.id)) return null;
        const href = `/${prefixes[value.type]}/${value.id}`;
        if (value.href !== href || !text(value.title, 300)) return null;
        let image = null;
        try { const url = new URL(value.image); if (url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2048) image = url.href; } catch { /* Text is sufficient. */ }
        return { id: value.id, type: value.type, title: text(value.title, 300), href, image, meta: text(value.meta, 240) };
    }
    function progress(value) {
        if (!value || !validRoute(value.routeId)) return null;
        const completedStepIds = [...new Set(Array.isArray(value.completedStepIds) ? value.completedStepIds.filter(validStep) : [])].slice(0, 100);
        const stepCount = Number.isInteger(value.stepCount) ? Math.max(0, Math.min(100, value.stepCount)) : 0;
        const percent = stepCount ? Math.min(100, Math.round(completedStepIds.length / stepCount * 100)) : Number.isFinite(value.percent) ? Math.max(0, Math.min(100, value.percent)) : 0;
        return { routeId: value.routeId, routeTitle: text(value.routeTitle, 300), completedStepIds,
            currentStepId: validStep(value.currentStepId) ? value.currentStepId : null, stepCount,
            percent,
            startedAt: iso(value.startedAt), updatedAt: iso(value.updatedAt),
            completedAt: percent >= 100 ? iso(value.completedAt || value.updatedAt) : null };
    }
    function operation(value) {
        if (!value || typeof value.id !== "string" || !/^[a-zA-Z\d_-]{1,80}$/.test(value.id) || !kinds.includes(value.kind)) return null;
        if (value.kind === "history-clear") return { id: value.id, kind: value.kind };
        if (value.kind === "progress-upsert") {
            const item = progress(value);
            return item ? { id: value.id, kind: value.kind, routeId: item.routeId, completedStepIds: item.completedStepIds, currentStepId: item.currentStepId } : null;
        }
        if (typeof value.targetType !== "string" || !Object.hasOwn(prefixes, value.targetType) || typeof value.targetId !== "string" || !/^[a-f\d]{24}$/i.test(value.targetId)) return null;
        return { id: value.id, kind: value.kind, targetType: value.targetType, targetId: value.targetId, lastPosition: text(value.lastPosition, 1000) };
    }
    function empty() { return { profileId: null, languageMode: "system", history: [], readingPath: [], progress: [], operations: [], lastSyncAt: null, lastSyncError: null }; }
    function read() {
        const raw = localStorage.getItem(key);
        if (!raw || raw.length > 3000000) return empty();
        let parsed;
        try { parsed = JSON.parse(raw); } catch { return empty(); }
        return parse(parsed) || empty();
    }
    // Shared by stored state and backup files: every record passes the same validation.
    function parse(parsed) {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const state = empty();
        state.profileId = validProfile(parsed.profileId) ? parsed.profileId : null;
        state.languageMode = languages.includes(parsed.languageMode) ? parsed.languageMode : "system";
        const historyKeys = new Set();
        state.history = (Array.isArray(parsed.history) ? parsed.history : []).slice(0, 400).map(value => {
            const item = content(value);
            if (!item || historyKeys.has(`${item.type}:${item.id}`)) return null;
            historyKeys.add(`${item.type}:${item.id}`);
            return { ...item, viewedAt: iso(value.viewedAt), viewCount: Number.isInteger(value.viewCount) ? Math.max(1, Math.min(value.viewCount, 1000000)) : 1, lastPosition: text(value.lastPosition, 1000) };
        }).filter(Boolean).slice(0, 200);
        state.readingPath = (Array.isArray(parsed.readingPath) ? parsed.readingPath : []).slice(0, 50).map(value => {
            const item = content(value);
            const candidate = appLocation(value.fromHref, true), origin = candidate && sourceKinds.includes(value.source) && value.source === candidate.source ? candidate : null;
            return item ? { ...item, createdAt: iso(value.createdAt), fromTitle: origin ? text(value.fromTitle, 300) : "", fromHref: origin?.href || null, source: origin?.source || "unknown" } : null;
        }).filter(Boolean);
        const routes = new Set();
        state.progress = (Array.isArray(parsed.progress) ? parsed.progress : []).slice(0, 200).map(progress).filter(value => {
            if (!value || routes.has(value.routeId)) return false;
            routes.add(value.routeId); return true;
        }).slice(0, 100);
        state.operations = (Array.isArray(parsed.operations) ? parsed.operations : []).slice(0, 500).map(operation).filter(Boolean);
        state.lastSyncAt = typeof parsed.lastSyncAt === "string" && parsed.lastSyncAt.length <= 64 && !isNaN(Date.parse(parsed.lastSyncAt)) ? iso(parsed.lastSyncAt) : null;
        state.lastSyncError = text(parsed.lastSyncError, 300) || null;
        return state;
    }
    // A backup restore only adds to this browser: nothing local is removed, a newer local record wins,
    // and identity, sync state and old pending operations are not taken from the file.
    function backupPlan(value) {
        if (typeof value !== "string" || value.length > 4000000) throw new Error("Invalid backup");
        let parsed;
        try { parsed = JSON.parse(value); } catch { throw new Error("Invalid backup"); }
        const personal = parsed && parsed.version === 1 && Array.isArray(parsed.favorites) ? parse(parsed.personal) : null;
        if (!personal) throw new Error("Invalid backup");
        const state = read(), saved = window.heritageStore.getSaved(), keyOf = x => `${x.type}:${x.id}`;
        const savedKeys = new Set(saved.map(keyOf)), favoriteKeys = new Set();
        const valid = parsed.favorites.slice(0, 400).map(x => { const item = content(x); return item ? { ...item, savedAt: iso(x.savedAt) } : null; }).filter(Boolean);
        const favorites = valid.filter(x => !savedKeys.has(keyOf(x)) && !favoriteKeys.has(keyOf(x)) && favoriteKeys.add(keyOf(x)));
        const room = Math.max(0, 200 - saved.length), addedFavorites = favorites.slice(0, room);
        const localHistory = new Map(state.history.map(x => [keyOf(x), x]));
        const history = personal.history.filter(x => !localHistory.has(keyOf(x)) || x.viewedAt > localHistory.get(keyOf(x)).viewedAt);
        const localProgress = new Map(state.progress.map(x => [x.routeId, x]));
        const progressItems = personal.progress.filter(x => !localProgress.has(x.routeId) || x.updatedAt > localProgress.get(x.routeId).updatedAt);
        return { state, saved, addedFavorites, history, progressItems, localHistory, localProgress,
            preview: { exportedAt: typeof parsed.exportedAt === "string" && !isNaN(Date.parse(parsed.exportedAt)) ? iso(parsed.exportedAt) : null,
                favoritesAdded: addedFavorites.length, favoritesExisting: valid.length - favorites.length, favoritesInvalid: parsed.favorites.length - valid.length, favoritesOverLimit: favorites.length - addedFavorites.length,
                historyAdded: history.filter(x => !localHistory.has(keyOf(x))).length, historyUpdated: history.filter(x => localHistory.has(keyOf(x))).length,
                historyKeptLocal: personal.history.length - history.length,
                progressAdded: progressItems.filter(x => !localProgress.has(x.routeId)).length, progressUpdated: progressItems.filter(x => localProgress.has(x.routeId)).length,
                progressKeptLocal: personal.progress.length - progressItems.length } };
    }
    function write(state) { localStorage.setItem(key, JSON.stringify(state)); }
    function operationId() { return crypto.randomUUID().replaceAll("-", ""); }
    function enqueue(state, value) {
        if (["favorite-upsert", "favorite-delete"].includes(value.kind)) state.operations = state.operations.filter(x => !x.kind.startsWith("favorite-") || x.targetType !== value.targetType || x.targetId !== value.targetId);
        if (value.kind === "progress-upsert") state.operations = state.operations.filter(x => x.kind !== value.kind || x.routeId !== value.routeId);
        if (state.operations.length >= 500) throw new Error("Pending personal operations limit reached");
        const checked = operation({ id: operationId(), ...value });
        if (!checked) throw new Error("Invalid personal operation");
        state.operations.push(checked);
    }
    function summary(state) { return { profileId: state.profileId, languageMode: state.languageMode, pendingCount: state.operations.length, historyCount: state.history.length, progressCount: state.progress.length, readingPathCount: state.readingPath.length, lastSyncAt: state.lastSyncAt, lastSyncError: state.lastSyncError }; }
    function favoriteTransaction(action) {
        const beforeSaved = localStorage.getItem(savedKey), beforePersonal = localStorage.getItem(key);
        try { return action(); }
        catch (error) {
            try {
                if (beforeSaved === null) localStorage.removeItem(savedKey); else localStorage.setItem(savedKey, beforeSaved);
                if (beforePersonal === null) localStorage.removeItem(key); else localStorage.setItem(key, beforePersonal);
            } catch { /* Preserve the original storage error for the visible retry state. */ }
            throw error;
        }
    }
    window.heritagePersonal = {
        getState() { return summary(read()); },
        createProfile() { const state = read(); if (!state.profileId) state.profileId = "web_" + crypto.randomUUID().replaceAll("-", ""); write(state); return summary(state); },
        getLanguage() { return read().languageMode; },
        setLanguage(mode) { if (!languages.includes(mode)) throw new Error("Invalid language"); const state = read(); state.languageMode = mode; write(state); document.cookie = `heritage-language=${mode}; Path=/; SameSite=Lax; Max-Age=31536000`; },
        getHistory(type = null, page = 1, pageSize = 20) {
            const rows = read().history.filter(x => !type || x.type === type);
            page = Math.max(1, Math.min(10000, Number.isInteger(page) ? page : 1)); pageSize = Math.max(1, Math.min(25, Number.isInteger(pageSize) ? pageSize : 20));
            return { items: rows.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: rows.length, hasMore: page * pageSize < rows.length };
        },
        getReadingPath() { return read().readingPath; },
        getProgressSummaries() { return read().progress.map(({ completedStepIds, ...item }) => ({ ...item, completedCount: completedStepIds.length })); },
        getRouteProgress(routeId) { return read().progress.find(x => x.routeId === routeId) || null; },
        getReadingPosition(type, id) { const row=read().history.find(x=>x.type===type&&x.id===id);return row && position(row.lastPosition)!==null ? row.lastPosition : null; },
        getOperations(limit = 10) { return read().operations.slice(0, Math.max(1, Math.min(10, limit))); },
        prepareSync() {
            const state = read();
            if (!state.profileId) throw new Error("Create a personal profile before synchronization");
            if (!state.lastSyncAt) {
                for (const item of window.heritageStore.getSaved()) {
                    if (!state.operations.some(x => x.kind.startsWith("favorite-") && x.targetType === item.type && x.targetId === item.id))
                        enqueue(state, { kind: "favorite-upsert", targetType: item.type, targetId: item.id });
                }
            }
            write(state); return summary(state);
        },
        acknowledgeOperation(id) { const state = read(); state.operations = state.operations.filter(x => x.id !== id); write(state); },
        queueFavorite(type, id, isSaved) {
            if (typeof type !== "string" || !Object.hasOwn(prefixes, type) || typeof id !== "string" || !/^[a-f\d]{24}$/i.test(id) || typeof isSaved !== "boolean") throw new Error("Invalid favorite");
            const state = read(); enqueue(state, { kind: isSaved ? "favorite-upsert" : "favorite-delete", targetType: type, targetId: id }); write(state);
        },
        toggleFavorite(value) { return favoriteTransaction(() => { const saved = window.heritageStore.toggleSaved(value); window.heritagePersonal.queueFavorite(value.type, value.id, saved); return saved; }); },
        removeFavorite(id, type) { return favoriteTransaction(() => { window.heritageStore.removeSaved(id, type); window.heritagePersonal.queueFavorite(type, id, false); }); },
        recordHistory(value) {
            const item = content(value); if (!item) throw new Error("Invalid history item");
            return recordItem(item,text(value.lastPosition,1000));
        },
        recordCurrentReading(value) {
            const item=content(value);if(!item||appLocation(window.location.href)?.pathname!==item.href)throw new Error("Reading target must match the current page");
            const fraction=scrollRange()?Math.max(0,Math.min(1,Number(window.scrollY||0)/scrollRange())):0;
            let origin=navigationSource?.destination===item.href?navigationSource:null;
            if(!origin&&referrerAllowed){const referrer=appLocation(document.referrer);if(referrer&&referrer.pathname!==item.href)origin={...referrer,title:""};}
            return recordItem(item,"scroll:v1:"+fraction.toFixed(6),origin);
        },
        restoreReadingPosition(type,id) {
            if(typeof type!=="string"||!Object.hasOwn(prefixes,type)||typeof id!=="string"||!/^[a-f\d]{24}$/i.test(id)||appLocation(window.location.href)?.pathname!==`/${prefixes[type]}/${id}`)return false;
            const saved=window.heritagePersonal.getReadingPosition(type,id),fraction=position(saved);
            if(fraction===null)return false;
            window.scrollTo({top:Math.round(scrollRange()*fraction),behavior:"instant"});return true;
        },
        focusReadingPath(){const section=document.getElementById("reading-path");if(section){section.scrollIntoView({block:"start",behavior:"auto"});section.focus({preventScroll:true});}},
        setBuildUrl(value){const target=appPath(value,true),current=appLocation(window.location.href);if(current?.pathname!=="/learning-routes/build"||target?.pathname!=="/learning-routes/build"||target.url.hash)throw new Error("Invalid learning build address");const base=new URL(document.baseURI||"/",window.location.origin);window.history.replaceState(window.history.state,"",base.pathname+target.pathname.slice(1)+target.url.search);},
        clearHistory() { const state = read(); state.history = []; state.operations = state.operations.filter(x => x.kind !== "history-add" && x.kind !== "history-clear"); enqueue(state, { kind: "history-clear" }); write(state); return summary(state); },
        clearReadingPath() { const state = read(); state.readingPath = []; write(state); return summary(state); },
        saveProgress(value) {
            const item = progress(value); if (!item) throw new Error("Invalid route progress");
            const state = read(); enqueue(state, { kind: "progress-upsert", ...item });
            state.progress = [item, ...state.progress.filter(x => x.routeId !== item.routeId)].slice(0, 100); write(state); return item;
        },
        restartProgress(routeId, routeTitle, stepCount) {
            if (!validRoute(routeId)) throw new Error("Invalid route progress");
            const previous=read().progress.find(x=>x.routeId===routeId);
            return window.heritagePersonal.saveProgress({routeId, routeTitle, stepCount, completedStepIds: [], currentStepId: null, startedAt: previous?.startedAt || new Date().toISOString(), updatedAt: new Date().toISOString()});
        },
        completeSync(error = null) { const state = read(); state.lastSyncError = text(error, 300) || null; if (!error) state.lastSyncAt = new Date().toISOString(); write(state); return summary(state); },
        mergeRemoteHistory(items) {
            const state = read();
            const remote = state.operations.some(x => x.kind === "history-clear") ? [] : (Array.isArray(items) ? items : []);
            const pending = new Set(state.operations.filter(x => x.kind === "history-add").map(x => `${x.targetType}:${x.targetId}`));
            const all = [...state.history, ...remote.filter(x => x && !pending.has(`${x.type}:${x.id}`))].map(value => {
                const item = content(value); return item ? { ...item, viewedAt: iso(value.viewedAt), viewCount: Math.max(1, Math.min(Number(value.viewCount) || 1, 1000000)), lastPosition: text(value.lastPosition, 1000) } : null;
            }).filter(Boolean).sort((a, b) => b.viewedAt.localeCompare(a.viewedAt));
            const keys = new Set(); state.history = all.filter(x => { const k = `${x.type}:${x.id}`; if (keys.has(k)) return false; keys.add(k); return true; }).slice(0, 200); write(state);
        },
        mergeRemoteProgress(items) {
            const state = read();
            const pending = new Set(state.operations.filter(x => x.kind === "progress-upsert").map(x => x.routeId));
            const all = [...state.progress, ...(Array.isArray(items) ? items : []).filter(x => x && !pending.has(x.routeId))].map(progress).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
            const keys = new Set(); state.progress = all.filter(x => { if (keys.has(x.routeId)) return false; keys.add(x.routeId); return true; }).slice(0, 100); write(state);
        },
        mergeRemoteFavorites(items) {
            const state = read();
            const current = window.heritageStore.getSaved();
            const pending = new Set(state.operations.filter(x => x.kind.startsWith("favorite-")).map(x => `${x.targetType}:${x.targetId}`));
            const all = [...current, ...(Array.isArray(items) ? items : []).filter(x => x && !pending.has(`${x.type}:${x.id}`))].map(value => { const item = content(value); return item ? { ...item, savedAt: iso(value.savedAt) } : null; }).filter(Boolean);
            const keys = new Set(); const checked = all.filter(x => { const k = `${x.type}:${x.id}`; if (keys.has(k)) return false; keys.add(k); return true; }).slice(0, 200);
            localStorage.setItem(savedKey, JSON.stringify(checked));
        },
        clearLocalData() { return favoriteTransaction(() => { const languageMode = read().languageMode; const state = empty(); state.languageMode = languageMode; localStorage.removeItem(savedKey); write(state); return summary(state); }); },
        previewBackup(value) { return backupPlan(value).preview; },
        restoreBackup(value) {
            return favoriteTransaction(() => {
                const plan = backupPlan(value), state = plan.state, keyOf = x => `${x.type}:${x.id}`;
                for (const item of plan.addedFavorites) enqueue(state, { kind: "favorite-upsert", targetType: item.type, targetId: item.id });
                for (const item of plan.progressItems) enqueue(state, { kind: "progress-upsert", ...item });
                const history = [...plan.history.map(x => ({ ...x, viewCount: Math.max(x.viewCount, plan.localHistory.get(keyOf(x))?.viewCount || 1) })), ...state.history.filter(x => !plan.history.some(y => keyOf(y) === keyOf(x)))];
                state.history = history.sort((a, b) => b.viewedAt.localeCompare(a.viewedAt)).slice(0, 200);
                state.progress = [...plan.progressItems, ...state.progress.filter(x => !plan.progressItems.some(y => y.routeId === x.routeId))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
                localStorage.setItem(savedKey, JSON.stringify([...plan.saved, ...plan.addedFavorites].sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, 200)));
                write(state);
                return { ...summary(state), restore: plan.preview };
            });
        },
        downloadBackup() {
            const state = read();
            const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), personal: state, favorites: window.heritageStore.getSaved() }, null, 2)], { type: "application/json;charset=utf-8" });
            const url = URL.createObjectURL(blob), anchor = document.createElement("a"); anchor.href = url; anchor.download = "heritage-personal-backup.json"; anchor.click(); URL.revokeObjectURL(url);
        },
        openDialog(id) { const element = document.getElementById(id); if (element && element.tagName === "DIALOG" && !element.open) element.showModal(); }
    };
    // Capture only an actual in-app anchor activation; this is ephemeral and never records history on navigation.
    document.addEventListener("click",event=>{
        if(event.isTrusted!==true||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
        const anchor=event.target?.closest?.("a[href]");if(!anchor||anchor.target==="_blank"||anchor.hasAttribute("download"))return;
        const from=appLocation(window.location.href),to=appLocation(anchor.href);
        if(to&&from?.pathname!==to.pathname){navigationSource=null;referrerAllowed=false;if(from)navigationSource={...from,title:text(document.querySelector("h1")?.textContent,300),destination:to.pathname};}
    },true);
    window.addEventListener("popstate",()=>{navigationSource=null;referrerAllowed=false;});
})();
