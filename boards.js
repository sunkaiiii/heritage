// 我的策展板（docs/features/06）：只保存在当前浏览器；分享链接把内容放在站点根路径的 # 片段里，
// 读入后转存 sessionStorage 并清除地址栏片段，payload 不进入任何路径或查询参数，也不发给服务器。
(() => {
    "use strict";
    const key = "heritage.web.boards.v1";
    const pendingKey = "heritage.web.sharedBoard";
    const limits = { boards: 30, items: 1500, perBoard: 100, title: 40, description: 200, note: 200, prompt: 200, worksheetText: 40, link: 2000, inflated: 256 * 1024 };
    const prefix = { article: "articles", directoryItem: "directory", inheritor: "inheritors" };
    const letters = { article: "a", directoryItem: "d", inheritor: "p" };
    const types = { a: "article", d: "directoryItem", p: "inheritor" };
    const clean = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
    const validBoardId = value => typeof value === "string" && /^b_[a-f\d]{16}$/.test(value);
    function fail(code) { const error = new Error(code); error.code = code; throw error; }

    function cleanItem(value) {
        if (!value || !Object.hasOwn(prefix, value.type) || !validId(value.id)) return null;
        const title = clean(value.title, 300);
        if (!title) return null;
        // prompt（研学单思考题，docs/features/12）：null 表示跟随备注，字符串（含空串＝留白）表示老师填写
        return { type: value.type, id: value.id.toLowerCase(), title, meta: clean(value.meta, 300) || null, note: clean(value.note, limits.note),
            prompt: typeof value.prompt === "string" ? clean(value.prompt, limits.prompt) : null, addedAt: iso(value.addedAt) || new Date().toISOString() };
    }
    // 研学单设置：不合格的字段回落默认；date 为 null 表示打印当天，空串表示不印日期；seed 为 null 时由页面按 boardId 推出，不写回
    function validDate(value) {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const [y, m, d] = value.split("-").map(Number), date = new Date(Date.UTC(y, m - 1, d));
        return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }
    function cleanWorksheet(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return {
            title: clean(value.title, limits.worksheetText), group: clean(value.group, limits.worksheetText),
            date: value.date === "" ? "" : validDate(value.date) ? value.date : null,
            count: [0, 5, 10].includes(value.count) ? value.count : 5,
            seed: Number.isInteger(value.seed) && value.seed >= 1 && value.seed <= 2147483646 ? value.seed : null,
            lunar: value.lunar === true, answers: value.answers !== false, qr: value.qr === true,
            size: value.size === "large" ? "large" : "standard"
        };
    }
    function cleanBoard(value) {
        if (!value || !validBoardId(value.boardId)) return null;
        const title = clean(value.title, limits.title);
        if (!title) return null;
        const seen = new Set();
        const items = (Array.isArray(value.items) ? value.items : []).map(cleanItem).filter(x => x && !seen.has(x.type + x.id) && seen.add(x.type + x.id)).slice(0, limits.perBoard);
        const origin = value.origin && value.origin.fromShare === true ? { fromShare: true, importedAt: iso(value.origin.importedAt) || new Date().toISOString() } : null;
        return { boardId: value.boardId, title, description: clean(value.description, limits.description), createdAt: iso(value.createdAt) || new Date().toISOString(),
            updatedAt: iso(value.updatedAt) || new Date().toISOString(), origin, items, worksheet: cleanWorksheet(value.worksheet) };
    }
    function read() {
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length > 3000000) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.boards) ? parsed.boards.slice(0, limits.boards).map(cleanBoard).filter(Boolean) : [];
        } catch { return []; }
    }
    function write(boards) {
        const total = boards.reduce((sum, board) => sum + board.items.length, 0);
        if (boards.length > limits.boards) fail("boards_limit");
        if (total > limits.items) fail("items_limit");
        try { localStorage.setItem(key, JSON.stringify({ version: 1, boards })); }
        catch (error) { fail(error && error.name === "QuotaExceededError" ? "quota" : "storage"); }
    }
    function newId() { const bytes = crypto.getRandomValues(new Uint8Array(8)); return "b_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
    function update(boardId, change) {
        const boards = read(), board = boards.find(x => x.boardId === boardId);
        if (!board) fail("missing_board");
        // change 返回 false 表示没有变化：不写入、不刷新 updatedAt（导入合并按 updatedAt 取较新者）
        if (change(board) === false) return board;
        board.updatedAt = new Date().toISOString();
        write(boards);
        return board;
    }

    // base64url 与可选的 deflate-raw 压缩；解压设输出上限，超过即整体拒绝
    const toBase64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    function fromBase64Url(text) {
        if (!/^[A-Za-z0-9_-]+$/.test(text)) fail("share_invalid");
        const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
        return Uint8Array.from(binary, c => c.charCodeAt(0));
    }
    async function pipe(bytes, transform, max) {
        const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader();
        const chunks = []; let size = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > max) { await reader.cancel(); fail("share_too_large"); }
            chunks.push(value);
        }
        const out = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
        return out;
    }
    const canCompress = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

    async function encode(board, includeNotes) {
        const compact = { t: board.title, d: board.description || undefined, i: board.items.map(x => includeNotes && x.note ? [letters[x.type], x.id, x.note] : [letters[x.type], x.id]) };
        const json = new TextEncoder().encode(JSON.stringify(compact));
        if (canCompress()) return "v1.z." + toBase64Url(await pipe(json, new CompressionStream("deflate-raw"), limits.inflated));
        return "v1.r." + toBase64Url(json);
    }
    async function decode(payload) {
        if (typeof payload !== "string" || payload.length > limits.link) fail("share_invalid");
        const match = /^v1\.([zr])\.([A-Za-z0-9_-]+)$/.exec(payload);
        if (!match) fail("share_invalid");
        let bytes = fromBase64Url(match[2]);
        if (match[1] === "z") {
            if (!canCompress()) fail("share_unsupported");
            try { bytes = await pipe(bytes, new DecompressionStream("deflate-raw"), limits.inflated); }
            catch (error) { if (error.code) throw error; fail("share_invalid"); }
        } else if (bytes.byteLength > limits.inflated) fail("share_too_large");
        let value;
        try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { fail("share_invalid"); }
        // 任一字段不合格就整体拒绝，不做部分猜测
        if (!value || typeof value.t !== "string" || !Array.isArray(value.i) || value.i.length > limits.perBoard) fail("share_invalid");
        const title = clean(value.t, limits.title), description = value.d === undefined ? "" : typeof value.d === "string" ? clean(value.d, limits.description) : null;
        if (!title || description === null || value.t.length > limits.title * 2) fail("share_invalid");
        const items = value.i.map(row => {
            if (!Array.isArray(row) || row.length < 2 || row.length > 3 || !Object.hasOwn(types, row[0]) || !validId(row[1])) fail("share_invalid");
            if (row.length === 3 && (typeof row[2] !== "string" || row[2].length > limits.note * 2)) fail("share_invalid");
            return { type: types[row[0]], id: row[1].toLowerCase(), note: row.length === 3 ? clean(row[2], limits.note) : "" };
        });
        return { title, description, items };
    }

    function shareUrl(payload) { return new URL("#share=" + payload, document.baseURI).href; }

    // 站点根路径带 #share= 时：转存 sessionStorage，再跳到应用内的预览页（不经过 404.html 的查询串）
    try {
        const base = new URL(document.baseURI);
        if (location.pathname === base.pathname && location.hash.startsWith("#share=") && location.hash.length <= limits.link + 7) {
            sessionStorage.setItem(pendingKey, location.hash.slice(7));
            history.replaceState(null, "", base.pathname);
            location.replace(new URL("boards/shared", base).href);
        }
    } catch { /* 浏览器存储不可用时停留在首页，不处理分享 */ }

    window.heritageBoards = {
        limits,
        list() { return read().map(board => ({ boardId: board.boardId, title: board.title, description: board.description, count: board.items.length, updatedAt: board.updatedAt, fromShare: !!board.origin })); },
        get(boardId) { return read().find(x => x.boardId === boardId) || null; },
        create(title, description) {
            const boards = read();
            const board = cleanBoard({ boardId: newId(), title, description, items: [] });
            if (!board) fail("title_required");
            boards.unshift(board); write(boards); return board;
        },
        rename(boardId, title, description) { const name = clean(title, limits.title); if (!name) fail("title_required"); return update(boardId, board => { board.title = name; board.description = clean(description, limits.description); }); },
        remove(boardId) { write(read().filter(x => x.boardId !== boardId)); return true; },
        addItem(boardId, item) {
            const entry = cleanItem({ ...item, note: "", prompt: null, addedAt: new Date().toISOString() });
            if (!entry) fail("item_invalid");
            return update(boardId, board => {
                if (board.items.some(x => x.type === entry.type && x.id === entry.id)) return;
                if (board.items.length >= limits.perBoard) fail("board_full");
                board.items.push(entry);
            });
        },
        removeItem(boardId, type, id) { return update(boardId, board => { board.items = board.items.filter(x => x.type !== type || x.id !== id); }); },
        moveItem(boardId, type, id, delta) {
            return update(boardId, board => {
                const from = board.items.findIndex(x => x.type === type && x.id === id), to = from + Math.sign(delta);
                if (from < 0 || to < 0 || to >= board.items.length) return;
                const [moved] = board.items.splice(from, 1); board.items.splice(to, 0, moved);
            });
        },
        // 研学单（docs/features/12）：思考题与设置只在读者修改时写入，打开研学单不写本机
        setPrompt(boardId, type, id, prompt) {
            return update(boardId, board => {
                const item = board.items.find(x => x.type === type && x.id === id);
                const value = typeof prompt === "string" ? clean(prompt, limits.prompt) : null;
                if (!item || item.prompt === value) return false;
                item.prompt = value;
            });
        },
        setWorksheet(boardId, patch) {
            return update(boardId, board => {
                const next = cleanWorksheet({ ...(board.worksheet || cleanWorksheet({})), ...(patch && typeof patch === "object" ? patch : {}) });
                if (JSON.stringify(next) === JSON.stringify(board.worksheet || cleanWorksheet({}))) return false;
                board.worksheet = next;
            });
        },
        today() { const now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-"); },
        setNote(boardId, type, id, note) { return update(boardId, board => { const item = board.items.find(x => x.type === type && x.id === id); if (item) item.note = clean(note, limits.note); }); },
        boardsContaining(type, id) { return read().filter(board => board.items.some(x => x.type === type && x.id === id)).map(board => board.boardId); },
        async shareLink(boardId, includeNotes) {
            const board = read().find(x => x.boardId === boardId);
            if (!board) fail("missing_board");
            const url = shareUrl(await encode(board, includeNotes));
            return { url, length: url.length, tooLong: url.length > limits.link, compressed: canCompress() };
        },
        async takePendingShare() {
            let payload = null;
            try { payload = sessionStorage.getItem(pendingKey); sessionStorage.removeItem(pendingKey); } catch { fail("storage"); }
            if (!payload) return null;
            return await decode(payload);
        },
        decode,
        saveShared(shared) {
            const boards = read();
            // 只取四个字段：分享链接不带思考题与研学单设置
            const board = cleanBoard({ boardId: newId(), title: shared?.title, description: shared?.description, origin: { fromShare: true },
                items: (shared?.items || []).map(x => ({ type: x?.type, id: x?.id, note: x?.note, title: x?.title || x?.id })) });
            if (!board) fail("share_invalid");
            boards.unshift(board); write(boards); return board;
        },
        exportFile(boardId) {
            const boards = read().filter(x => !boardId || x.boardId === boardId);
            return JSON.stringify({ kind: "heritage-boards", version: 1, exportedAt: new Date().toISOString(), boards }, null, 2);
        },
        previewImport(text) { return importPlan(text).preview; },
        importFile(text) { const plan = importPlan(text); plan.apply(); return plan.preview; }
    };

    function importPlan(text) {
        if (typeof text !== "string" || text.length > 3000000) fail("file_invalid");
        let parsed; try { parsed = JSON.parse(text); } catch { fail("file_invalid"); }
        if (!parsed || parsed.kind !== "heritage-boards" || parsed.version !== 1 || !Array.isArray(parsed.boards)) fail("file_invalid");
        return mergePlan(parsed.boards);
    }
    // 合并：同一 boardId 以更新时间较新的为准；不删除本机已有的策展板
    function mergePlan(incoming) {
        const local = read(), byId = new Map(local.map(x => [x.boardId, x]));
        const valid = incoming.slice(0, limits.boards * 2).map(cleanBoard).filter(Boolean);
        const added = valid.filter(x => !byId.has(x.boardId)), updated = valid.filter(x => byId.has(x.boardId) && x.updatedAt > byId.get(x.boardId).updatedAt);
        return {
            preview: { added: added.length, updated: updated.length, keptLocal: valid.length - added.length - updated.length, invalid: Math.min(incoming.length, limits.boards * 2) - valid.length },
            apply() {
                const merged = [...added, ...local.map(x => updated.find(y => y.boardId === x.boardId) || x)];
                write(merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
            }
        };
    }

    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.boards = {
        export: read,
        plan(value) { if (!Array.isArray(value)) return null; try { return mergePlan(value); } catch { return null; } },
        clear() { localStorage.removeItem(key); }
    };
})();
