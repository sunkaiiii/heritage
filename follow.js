// 我关注的项目（docs/features/47）：关注列表只保存在当前浏览器，不需要账号、不上传。
// 只有读者点「关注」「取消关注」「全部标为已看」时才写入，打开「我的 › 关注」不会改变「上次标为已看」。
(() => {
    "use strict";
    const key = "heritage.web.follow.v1";
    const limits = { items: 200, title: 80 };
    const types = ["directoryItem", "inheritor"];
    const clean = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
    const identity = x => `${x.type}:${x.id}`;
    function fail(code) { const error = new Error(code); error.code = code; throw error; }

    function cleanItem(value) {
        if (!value || !types.includes(value.type) || !validId(value.id)) return null;
        const title = clean(value.title, limits.title);
        const followedAt = iso(value.followedAt);
        return title && followedAt ? { type: value.type, id: value.id.toLowerCase(), title, followedAt } : null;
    }
    function cleanState(value) {
        const seen = new Set();
        const items = (Array.isArray(value?.items) ? value.items : []).slice(0, limits.items * 2).map(cleanItem)
            .filter(x => x && !seen.has(identity(x)) && seen.add(identity(x))).slice(0, limits.items);
        return { version: 1, seenAt: iso(value?.seenAt), items };
    }
    function read() {
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length > 200000) return cleanState(null);
            return cleanState(JSON.parse(raw));
        } catch { return cleanState(null); }
    }
    function write(state) {
        try { localStorage.setItem(key, JSON.stringify(state)); }
        catch (error) { fail(error?.name === "QuotaExceededError" || error?.code === 22 ? "quota" : "storage"); }
    }
    // 备份合并：按 type:id 取并集，本机已有的保留本机的关注时刻与标题；超过上限的不导入；「已看」保留本机值，本机为空时才取备份值
    function mergePlan(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const incoming = cleanState(value), local = read(), known = new Set(local.items.map(identity));
        const fresh = incoming.items.filter(x => !known.has(identity(x)));
        const room = Math.max(0, limits.items - local.items.length), added = fresh.slice(0, room);
        const total = Array.isArray(value.items) ? Math.min(value.items.length, limits.items * 2) : 0;
        const seenAt = local.seenAt ? null : incoming.seenAt;
        return {
            preview: { added: added.length, existing: incoming.items.length - fresh.length, overLimit: fresh.length - added.length, invalid: total - incoming.items.length, seenAt: !!seenAt },
            apply() {
                const current = read(), present = new Set(current.items.map(identity));
                current.items = [...current.items, ...added.filter(x => !present.has(identity(x)))].slice(0, limits.items);
                if (!current.seenAt && seenAt) current.seenAt = seenAt;
                write(current);
            }
        };
    }

    window.heritageFollow = {
        list() { return read(); },
        isFollowed(type, id) { return validId(id) && read().items.some(x => x.type === type && x.id === id.toLowerCase()); },
        // 返回操作后是否在关注；满 200 个时报 limit
        toggle(value) {
            const item = cleanItem({ ...value, followedAt: new Date().toISOString() });
            if (!item) fail("invalid");
            const state = read();
            if (state.items.some(x => identity(x) === identity(item))) { state.items = state.items.filter(x => identity(x) !== identity(item)); write(state); return false; }
            if (state.items.length >= limits.items) fail("limit");
            state.items = [item, ...state.items]; write(state);
            return true;
        },
        remove(type, id) { const state = read(); state.items = state.items.filter(x => !(x.type === type && x.id === String(id).toLowerCase())); write(state); },
        markSeen() { const state = read(); state.seenAt = new Date().toISOString(); write(state); return state.seenAt; },
        clear() { localStorage.removeItem(key); }
    };
    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.follow = {
        export() { return read(); },
        plan(value) { try { return mergePlan(value); } catch { return null; } },
        clear() { localStorage.removeItem(key); }
    };
})();
