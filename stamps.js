// 非遗图鉴（docs/features/04）：只保存在当前浏览器。只有读者点「记录此次阅读」「收藏」或「用我的浏览记录补章」时才写入，
// 页面打开不会盖章。省份与类别由服务端 /api/contents/facets 给出，这里只做校验与去重。
(() => {
    "use strict";
    const key = "heritage.web.stamps.v1";
    const limits = { stamps: 8000, articles: 2000, title: 40 };
    const provinces = ["北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
        "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门", "台湾", "national", "institution", "unknown"];
    const categories = ["民间文学", "传统音乐", "传统舞蹈", "传统戏剧", "曲艺", "传统体育、游艺与杂技", "传统美术", "传统技艺", "传统医药", "民俗"];
    const types = ["directoryItem", "inheritor"];
    const clean = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
    const identity = x => `${x.type}:${x.id}`;
    const cell = x => `${x.province}|${x.category}`;
    function fail(code) { const error = new Error(code); error.code = code; throw error; }

    function cleanStamp(value) {
        if (!value || !types.includes(value.type) || !validId(value.id) || !provinces.includes(value.province) || !categories.includes(value.category)) return null;
        const title = clean(value.title, limits.title);
        if (!title) return null;
        // family 是规范化的项目编号（如「Ⅶ-16」），只用于徽章；格式不对时丢弃该字段，不丢弃图章
        const family = typeof value.family === "string" && /^[\u2160-\u2169]-\d{1,4}$/.test(value.family) ? value.family : null;
        return { type: value.type, id: value.id.toLowerCase(), province: value.province, category: value.category, title, family, stampedAt: iso(value.stampedAt) || new Date().toISOString() };
    }
    function cleanState(value) {
        const seen = new Set(), articles = new Set();
        const stamps = (Array.isArray(value?.stamps) ? value.stamps : []).slice(0, limits.stamps * 2).map(cleanStamp)
            .filter(x => x && !seen.has(identity(x)) && seen.add(identity(x))).slice(0, limits.stamps);
        const articleIds = (Array.isArray(value?.articleIds) ? value.articleIds : []).filter(id => validId(id) && !articles.has(id.toLowerCase()) && articles.add(id.toLowerCase()))
            .map(id => id.toLowerCase()).slice(0, limits.articles);
        return { version: 1, stamps, articleIds, updatedAt: iso(value?.updatedAt) || null };
    }
    function read() {
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length > 2000000) return cleanState(null);
            return cleanState(JSON.parse(raw));
        } catch { return cleanState(null); }
    }
    function write(state) {
        state.updatedAt = new Date().toISOString();
        try { localStorage.setItem(key, JSON.stringify(state)); }
        catch (error) { fail(error?.name === "QuotaExceededError" || error?.code === 22 ? "quota" : "storage"); }
    }
    // 返回本次新增的条目与新点亮的格子；已有的条目不重复计数
    function addMany(values) {
        const state = read(), known = new Set(state.stamps.map(identity)), lit = new Set(state.stamps.map(cell));
        const added = [], newCells = [];
        let invalid = 0;
        for (const value of Array.isArray(values) ? values : []) {
            const stamp = cleanStamp({ ...value, stampedAt: new Date().toISOString() });
            if (!stamp) { invalid++; continue; }
            if (known.has(identity(stamp))) continue;
            if (state.stamps.length + added.length >= limits.stamps) fail("stamps_limit");
            known.add(identity(stamp)); added.push(stamp);
            if (!lit.has(cell(stamp))) { lit.add(cell(stamp)); newCells.push({ province: stamp.province, category: stamp.category }); }
        }
        if (added.length) { state.stamps = [...added, ...state.stamps]; write(state); }
        return { added: added.length, newCells, invalid };
    }
    function mergePlan(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const incoming = cleanState(value), local = read();
        const known = new Set(local.stamps.map(identity)), knownArticles = new Set(local.articleIds);
        const added = incoming.stamps.filter(x => !known.has(identity(x)));
        const articles = incoming.articleIds.filter(id => !knownArticles.has(id));
        const total = Array.isArray(value.stamps) ? Math.min(value.stamps.length, limits.stamps * 2) : 0;
        return {
            preview: { added: added.length, existing: incoming.stamps.length - added.length, invalid: total - incoming.stamps.length, articles: articles.length },
            apply() {
                const current = read();
                current.stamps = [...current.stamps, ...added.filter(x => !current.stamps.some(y => identity(y) === identity(x)))].slice(0, limits.stamps);
                current.articleIds = [...new Set([...current.articleIds, ...articles])].slice(0, limits.articles);
                write(current);
            }
        };
    }

    window.heritageStamps = {
        list() { const state = read(); return { stamps: state.stamps, articleCount: state.articleIds.length, updatedAt: state.updatedAt }; },
        add(stamp) { return addMany([stamp]); },
        addMany,
        addArticle(id) {
            if (!validId(id)) fail("invalid");
            const state = read(), value = id.toLowerCase();
            if (state.articleIds.includes(value)) return false;
            if (state.articleIds.length >= limits.articles) return false;
            state.articleIds = [value, ...state.articleIds];
            write(state);
            return true;
        },
        clear() { localStorage.removeItem(key); }
    };
    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.stamps = {
        export() { const state = read(); return { version: 1, stamps: state.stamps, articleIds: state.articleIds }; },
        plan(value) { try { return mergePlan(value); } catch { return null; } },
        clear() { localStorage.removeItem(key); }
    };
})();
