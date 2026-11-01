// 我的非遗年报（docs/features/25 §4.1）：年度计数只保存在当前浏览器。只在读者主动操作成功之后累加，
// 打开页面不累加；只存按月、类别、省份的计数，不存任何内容 ID 或标题。按设备分桶：备份导入时同一设备逐格取较大值，
// 不同设备并列保存、显示时求和，同一份备份导入两次不会翻倍。
(() => {
    "use strict";
    const key = "heritage.web.yearly.v1";
    const kinds = ["read", "saved", "stamped", "quiz", "boardItems", "routesDone"];
    const fields = [...kinds, "quizCorrect", "quizTotal"];
    const categories = ["民间文学", "传统音乐", "传统舞蹈", "传统戏剧", "曲艺", "传统体育、游艺与杂技", "传统美术", "传统技艺", "传统医药", "民俗"];
    const provinces = ["北京", "天津", "上海", "重庆", "河北", "山西", "辽宁", "吉林", "黑龙江", "江苏", "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南",
        "广东", "海南", "四川", "贵州", "云南", "陕西", "甘肃", "青海", "内蒙古", "广西", "西藏", "宁夏", "新疆", "香港", "澳门", "台湾"];
    const limits = { years: 10, devices: 20, count: 10000000 };
    const monthKeys = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const validDevice = value => typeof value === "string" && /^d_[a-f\d]{32}$/.test(value);
    const count = value => Number.isInteger(value) && value > 0 ? Math.min(value, limits.count) : 0;
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    let warned = false;

    function cleanCounts(value, allowed) {
        const result = {};
        for (const name of allowed) { const n = count(value?.[name]); if (n) result[name] = n; }
        return result;
    }
    function cleanYear(value) {
        const months = {};
        for (const month of monthKeys) { const counts = cleanCounts(value?.months?.[month], fields); if (Object.keys(counts).length) months[month] = counts; }
        return { months, categories: cleanCounts(value?.categories, categories), provinces: cleanCounts(value?.provinces, provinces) };
    }
    function cleanDevice(value) {
        const years = {};
        const names = Object.keys(value?.years && typeof value.years === "object" ? value.years : {})
            .filter(y => /^\d{4}$/.test(y) && +y >= 2000 && +y <= 2100).sort().slice(-limits.years);
        for (const year of names) years[year] = cleanYear(value.years[year]);
        return { since: iso(value?.since), years };
    }
    function cleanState(value) {
        const devices = {};
        const entries = Object.entries(value?.devices && typeof value.devices === "object" ? value.devices : {}).filter(([id]) => validDevice(id)).slice(0, limits.devices);
        for (const [id, device] of entries) devices[id] = cleanDevice(device);
        return { version: 1, device: validDevice(value?.device) ? value.device : null, devices };
    }
    function read() {
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length > 1000000) return cleanState(null);
            return cleanState(JSON.parse(raw));
        } catch { return cleanState(null); }
    }
    function write(state) { localStorage.setItem(key, JSON.stringify(state)); }
    function province(region) {
        const value = typeof region === "string" ? region.trim() : "";
        return provinces.find(p => value.startsWith(p)) || null;
    }
    function newDevice() {
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        return "d_" + [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
    }

    // kind：read、saved、stamped、quiz、boardItems、routesDone。detail 只取类别、地区（或省份）与小测得分；失败只提示一次，不影响原操作。
    function bump(kind, detail = {}) {
        if (!kinds.includes(kind)) return false;
        try {
            const state = read(), now = new Date();
            if (!state.device || !state.devices[state.device]) {
                if (!state.device) state.device = newDevice();
                if (Object.keys(state.devices).length >= limits.devices) return false;
                state.devices[state.device] = { since: now.toISOString(), years: {} };
            }
            const device = state.devices[state.device];
            const year = String(now.getFullYear()), month = String(now.getMonth() + 1).padStart(2, "0");
            const bucket = device.years[year] ||= { months: {}, categories: {}, provinces: {} };
            const counts = bucket.months[month] ||= {};
            counts[kind] = count(counts[kind]) + 1;
            if (kind === "quiz") {
                const total = Number.isInteger(detail?.total) && detail.total >= 1 && detail.total <= 10 ? detail.total : 0;
                const correct = total && Number.isInteger(detail?.correct) && detail.correct >= 0 && detail.correct <= total ? detail.correct : 0;
                if (total) { counts.quizTotal = count(counts.quizTotal) + total; counts.quizCorrect = count(counts.quizCorrect) + correct; }
            }
            if (categories.includes(detail?.category)) bucket.categories[detail.category] = count(bucket.categories[detail.category]) + 1;
            const place = provinces.includes(detail?.province) ? detail.province : province(detail?.region);
            if (place) bucket.provinces[place] = count(bucket.provinces[place]) + 1;
            for (const old of Object.keys(device.years).sort().slice(0, -limits.years)) delete device.years[old];
            write(state);
            return true;
        } catch (error) {
            if (!warned) { warned = true; console.warn("Yearly counts could not be saved", error?.name === "QuotaExceededError" ? "quota" : "storage"); }
            return false;
        }
    }

    function maxCounts(a, b) {
        const result = { ...a };
        for (const [name, value] of Object.entries(b)) result[name] = Math.max(result[name] || 0, value);
        return result;
    }
    function mergeDevice(local, incoming) {
        const years = { ...local.years };
        for (const [year, value] of Object.entries(incoming.years)) {
            const current = years[year] || { months: {}, categories: {}, provinces: {} };
            const months = { ...current.months };
            for (const [month, counts] of Object.entries(value.months)) months[month] = maxCounts(months[month] || {}, counts);
            years[year] = { months, categories: maxCounts(current.categories, value.categories), provinces: maxCounts(current.provinces, value.provinces) };
        }
        const since = [local.since, incoming.since].filter(Boolean).sort()[0] || null;
        return cleanDevice({ since, years });
    }
    function mergePlan(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const incoming = cleanState(value), local = read();
        const ids = Object.keys(incoming.devices);
        const merged = ids.filter(id => local.devices[id]).length;
        return {
            preview: { devices: ids.length, merged, added: ids.length - merged, years: [...new Set(ids.flatMap(id => Object.keys(incoming.devices[id].years)))].sort() },
            apply() {
                const current = read();
                for (const id of ids) {
                    if (current.devices[id]) current.devices[id] = mergeDevice(current.devices[id], incoming.devices[id]);
                    else if (Object.keys(current.devices).length < limits.devices) current.devices[id] = incoming.devices[id];
                }
                write(current);
            }
        };
    }

    // 浏览器本地的「年-月」：年份按读者所在地的日历划分（Server host 上的计算不用服务器时区）
    function localMonth(value) {
        const time = typeof value === "string" ? Date.parse(value) : NaN;
        if (isNaN(time)) return null;
        const date = new Date(time);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    // 年报的全部输入：一次读取各本机存储，交给页面在 C# 里计算；不发送任何网络请求
    function reportData() {
        const history = [];
        for (let page = 1; page <= 8; page++) {
            const result = window.heritagePersonal?.getHistory(null, page, 25);
            if (!result) break;
            history.push(...result.items);
            if (!result.hasMore) break;
        }
        const boards = (window.heritageBoards?.list() || []).map(x => window.heritageBoards.get(x.boardId)).filter(Boolean)
            .map(board => ({ month: localMonth(board.createdAt), items: board.items.map(item => ({ month: localMonth(item.addedAt) })) }));
        const state = read(), devices = {};
        for (const [id, device] of Object.entries(state.devices)) devices[id] = { sinceMonth: localMonth(device.since), years: device.years };
        return {
            currentYear: new Date().getFullYear(),
            yearly: { device: state.device, devices },
            history: history.map(x => ({ type: x.type, title: x.title, href: x.href, viewedAt: x.viewedAt, viewCount: x.viewCount, month: localMonth(x.viewedAt) })),
            saved: (window.heritageStore?.getSaved() || []).map(x => ({ month: localMonth(x.savedAt) })),
            stamps: (window.heritageStamps?.list().stamps || []).map(x => ({ province: x.province, category: x.category, month: localMonth(x.stampedAt) })),
            quiz: (window.heritageQuiz?.list() || []).map(x => ({ scope: x.scope, key: x.key ?? null, correct: x.correct, total: x.total, month: localMonth(x.answeredAt) })),
            boards,
            progress: (window.heritagePersonal?.getProgressSummaries() || []).map(x => ({ routeTitle: x.routeTitle, startedMonth: localMonth(x.startedAt), completedMonth: localMonth(x.completedAt) }))
        };
    }

    window.heritageYearly = { bump, reportData, clear() { localStorage.removeItem(key); } };
    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.yearly = {
        export: read,
        plan(value) { try { return mergePlan(value); } catch { return null; } },
        clear() { localStorage.removeItem(key); }
    };
})();
