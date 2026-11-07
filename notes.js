// 我的划线与笔记（docs/features/54）：只存在当前浏览器（heritage.web.notes.v1），不需要账号、不上传、不发任何网络请求。
// 只有读者点「划线」「保存」「删除」「清空」时才写入；打开页面、核对原文都只读。划线用 CSS Custom Highlight API 画，不改正文 DOM。
(() => {
    "use strict";
    const key = "heritage.web.notes.v1";
    const limits = { perPage: 200, total: 1000, title: 80, quote: 200, context: 24, note: 200, raw: 1000000 };
    const types = ["article", "directoryItem", "inheritor"];
    const head = "\u0002", tail = "\u0003";
    // 与 speech.js 同一组句末标点（docs/features/54 §3.1）
    const sentenceEnd = /[^。！？；!?;\n]*(?:[。！？；!?;]+[”’」』）)]*|\n+|$)/g;
    let corrupt = false;
    const diagnostics = { step1: 0, step2: 0, step3: 0, step4: 0, missing: 0 };

    const clean = (value, max) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
    const iso = value => typeof value === "string" && value.length <= 64 && !isNaN(Date.parse(value)) ? new Date(value).toISOString() : null;
    const validId = value => typeof value === "string" && /^[a-f\d]{24}$/i.test(value);
    const pageKey = p => `${p.type}:${p.id}`;
    function fail(code) { const error = new Error(code); error.code = code; throw error; }
    function newNid() {
        const bytes = new Uint8Array(8);
        (globalThis.crypto || window.crypto).getRandomValues(bytes);
        return "n_" + Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    }

    // 原文与前后文是定位依据：只校验、不改写（§4.2，R7-54a）；标题与笔记是读者输入，去控制字符并截长度
    function cleanItem(value) {
        if (!value || typeof value.nid !== "string" || !/^n_[a-f\d]{16}$/.test(value.nid)) return null;
        if (!Number.isInteger(value.block) || value.block < 0 || value.block > 9999) return null;
        if (typeof value.quote !== "string" || value.quote.length < 1 || value.quote.length > limits.quote) return null;
        if (typeof value.prefix !== "string" || value.prefix.length > limits.context || typeof value.suffix !== "string" || value.suffix.length > limits.context) return null;
        const createdAt = iso(value.createdAt);
        if (!createdAt) return null;
        return { nid: value.nid, block: value.block, quote: value.quote, prefix: value.prefix, suffix: value.suffix, note: clean(value.note, limits.note), createdAt, updatedAt: iso(value.updatedAt) || createdAt };
    }
    function cleanPage(value) {
        if (!value || !types.includes(value.type) || !validId(value.id)) return null;
        const seen = new Set();
        const items = (Array.isArray(value.items) ? value.items : []).slice(0, limits.perPage * 2).map(cleanItem)
            .filter(x => x && !seen.has(x.nid) && seen.add(x.nid)).slice(0, limits.perPage);
        return { type: value.type, id: value.id.toLowerCase(), title: clean(value.title, limits.title), items };
    }
    function cleanState(value) {
        const seen = new Set();
        let total = 0;
        const pages = [];
        for (const page of (Array.isArray(value?.pages) ? value.pages : []).slice(0, limits.total).map(cleanPage)) {
            if (!page || seen.has(pageKey(page))) continue;
            page.items = page.items.slice(0, Math.max(0, limits.total - total));
            total += page.items.length;
            seen.add(pageKey(page));
            if (page.items.length) pages.push(page);
        }
        return { version: 1, pages };
    }
    // 原始字符串过长或不是合法 JSON：标记已损坏，拒绝一切写入，避免覆盖原值（R7-54c）
    function read() {
        corrupt = false;
        let raw;
        try { raw = localStorage.getItem(key); } catch { return cleanState(null); }
        if (!raw) return cleanState(null);
        if (raw.length > limits.raw) { corrupt = true; return cleanState(null); }
        try { return cleanState(JSON.parse(raw)); } catch { corrupt = true; return cleanState(null); }
    }
    function write(state) {
        if (corrupt) fail("corrupt");
        try { localStorage.setItem(key, JSON.stringify(state)); }
        catch (error) { fail(error?.name === "QuotaExceededError" || error?.code === 22 ? "quota" : "storage"); }
    }
    const count = state => state.pages.reduce((n, p) => n + p.items.length, 0);

    function occurrences(text, needle) {
        const result = [];
        if (!needle) return result;
        for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) result.push(at);
        return result;
    }

    // 定位（§4.1，noteAnchorRules:v1）：四步，每一步都要求唯一命中；原文单独不作依据。返回 { block, start, end, step } 或 null
    function locate(blocks, item) {
        const list = (Array.isArray(blocks) ? blocks : []).filter(b => b && Number.isInteger(b.index) && typeof b.text === "string");
        const p = item.prefix.length < limits.context ? head + item.prefix : item.prefix;
        const s = item.suffix.length < limits.context ? item.suffix + tail : item.suffix;
        const framed = text => head + text + tail;
        const at = (block, pos) => ({ block: block.index, start: pos - 1, end: pos - 1 + item.quote.length });
        const own = list.find(b => b.index === item.block);
        if (own) {
            const text = framed(own.text);
            const full = occurrences(text, p + item.quote + s);
            if (full.length === 1) { diagnostics.step1++; return { ...at(own, full[0] + p.length), step: 1 }; }
            const before = occurrences(text, p + item.quote).map(i => i + p.length);
            const after = occurrences(text, item.quote + s);
            const positions = new Set([...before, ...after]);
            if (before.length <= 1 && after.length <= 1 && positions.size === 1) { diagnostics.step2++; return { ...at(own, [...positions][0]), step: 2 }; }
        }
        const hits = [];
        for (const block of list) for (const i of occurrences(framed(block.text), p + item.quote + s)) hits.push({ block, pos: i + p.length });
        if (hits.length === 1) { diagnostics.step3++; return { ...at(hits[0].block, hits[0].pos), step: 3 }; }
        // 每段各一处、且这几段全文逐字相同（来源重复了整段）；距离相同时取后面一处（前面插入段落比删除常见）
        if (hits.length > 1 && new Set(hits.map(h => h.block.index)).size === hits.length && hits.every(h => h.block.text === hits[0].block.text)) {
            const nearest = hits.slice().sort((a, b) => Math.abs(a.block.index - item.block) - Math.abs(b.block.index - item.block) || b.block.index - a.block.index)[0];
            diagnostics.step4++; return { ...at(nearest.block, nearest.pos), step: 4 };
        }
        diagnostics.missing++;
        return null;
    }

    function sentences(text) {
        const result = [];
        let offset = 0;
        for (const piece of (typeof text === "string" ? text : "").match(sentenceEnd) || []) {
            const lead = piece.length - piece.trimStart().length;
            const value = piece.trim();
            if (value) result.push({ start: offset + lead, text: value });
            offset += piece.length;
        }
        return result;
    }

    // 记录一条：原文去首尾空白，前后文从同一段规范文字原样截取（不跨段）
    function anchorFrom(text, block, start, end) {
        let s = start, e = end;
        while (s < e && /\s/.test(text[s])) s++;
        while (e > s && /\s/.test(text[e - 1])) e--;
        const quote = text.slice(s, e);
        if (!quote) return { error: "empty" };
        if (quote.length > limits.quote) return { error: "tooLong" };
        return { block, quote, prefix: text.slice(Math.max(0, s - limits.context), s), suffix: text.slice(e, e + limits.context) };
    }

    // ---- 存储 API ----
    const api = {
        status() { const state = read(); return { corrupt, total: count(state), limits }; },
        list() { return read(); },
        forPage(type, id) { const page = read().pages.find(p => p.type === type && p.id === String(id).toLowerCase()); return page ? page.items : []; },
        add(page, anchor, note) {
            const state = read();
            if (corrupt) fail("corrupt");
            if (!page || !types.includes(page.type) || !validId(page.id)) fail("invalid");
            const now = new Date().toISOString();
            const item = cleanItem({ nid: newNid(), block: anchor?.block, quote: anchor?.quote, prefix: anchor?.prefix ?? "", suffix: anchor?.suffix ?? "", note, createdAt: now, updatedAt: now });
            if (!item) fail("invalid");
            if (count(state) >= limits.total) fail("limitTotal");
            let target = state.pages.find(p => p.type === page.type && p.id === page.id.toLowerCase());
            if (!target) { target = { type: page.type, id: page.id.toLowerCase(), title: clean(page.title, limits.title), items: [] }; state.pages.unshift(target); }
            if (target.items.length >= limits.perPage) fail("limitPage");
            target.title = clean(page.title, limits.title) || target.title;
            target.items.push(item);
            write(state);
            return item;
        },
        update(nid, note) {
            const state = read();
            const item = state.pages.flatMap(p => p.items).find(x => x.nid === nid);
            if (!item) fail("missing");
            item.note = clean(note, limits.note); item.updatedAt = new Date().toISOString();
            write(state); return item;
        },
        remove(nid) {
            const state = read();
            for (const page of state.pages) page.items = page.items.filter(x => x.nid !== nid);
            state.pages = state.pages.filter(p => p.items.length);
            write(state);
        },
        // 「清空全部划线」也用于损坏后的恢复：直接删键
        clearAll() { try { localStorage.removeItem(key); } catch { /* 忽略 */ } corrupt = false; },
        locate, sentences, anchorFrom,
        diagnostics() { return { ...diagnostics }; },
        // 加入策展板（§3.4）：返回 added、noted、appended、tooLong
        addToBoard(boardId, page, item) {
            const boards = window.heritageBoards;
            if (!boards) fail("boards");
            const text = noteText(item);
            const board = boards.get(boardId);
            if (!board) fail("board_missing");
            const existing = board.items.find(x => x.type === page.type && x.id === page.id.toLowerCase());
            if (!existing) { boards.addItem(boardId, { type: page.type, id: page.id, title: page.title }); boards.setNote(boardId, page.type, page.id.toLowerCase(), text); return "added"; }
            if (!existing.note) { boards.setNote(boardId, page.type, page.id.toLowerCase(), text); return "noted"; }
            const joined = existing.note + " ／ " + text;
            if (joined.length > limits.note) return "tooLong";
            boards.setNote(boardId, page.type, page.id.toLowerCase(), joined);
            return "appended";
        }
    };

    // 「「划下的文字」笔记」，超过 200 字时先缩短引号里的文字（至少留 20 字），再截到 200 字
    function noteText(item) {
        const note = item.note ? item.note : "";
        let quote = item.quote;
        // 引号 2 字；缩短时结尾加「…」1 字
        const room = limits.note - note.length - 2;
        if (quote.length > room) quote = quote.slice(0, Math.max(20, room - 1)) + "…";
        return `「${quote}」${note}`.slice(0, limits.note);
    }
    api.noteText = noteText;

    // ---- 备份分节（C5）：按页面与 nid 取并集，同一条取较新的；超过上限的不导入；只增不删 ----
    function mergePlan(value) {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        const incoming = cleanState(value);
        const local = read();
        if (corrupt) return null;
        const rawCount = (Array.isArray(value.pages) ? value.pages : []).reduce((n, p) => n + (Array.isArray(p?.items) ? p.items.length : 0), 0);
        const plan = { added: 0, updated: 0, existing: 0, overLimit: 0, invalid: Math.max(0, rawCount - count(incoming)) };
        const merged = JSON.parse(JSON.stringify(local));
        let total = count(merged);
        for (const page of incoming.pages) {
            let target = merged.pages.find(p => pageKey(p) === pageKey(page));
            for (const item of page.items) {
                const current = target?.items.find(x => x.nid === item.nid);
                if (current) {
                    if (item.updatedAt > current.updatedAt) { Object.assign(current, item); plan.updated++; } else plan.existing++;
                    continue;
                }
                if (total >= limits.total || (target && target.items.length >= limits.perPage)) { plan.overLimit++; continue; }
                if (!target) { target = { type: page.type, id: page.id, title: page.title, items: [] }; merged.pages.push(target); }
                target.items.push(item); total++; plan.added++;
            }
        }
        return { preview: plan, apply() { write(cleanState(merged)); } };
    }
    window.heritageBackupSections = window.heritageBackupSections || {};
    window.heritageBackupSections.notes = {
        export() { const state = read(); return corrupt ? { version: 1, pages: [], corrupt: true } : state; },
        plan(value) { try { return mergePlan(value); } catch { return null; } },
        clear() { api.clearAll(); }
    };

    // ---- 页面上的划线（只在浏览器里运行；Node 测试不加载这部分）----
    const paragraphSelector = "p.content-paragraph[id^='block-']";
    let session = null;

    function textNodes(paragraph) {
        const result = [];
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
            acceptNode: node => node.parentElement?.closest("[data-note-skip]") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) result.push(node);
        return result;
    }
    const blockIndex = paragraph => Number(paragraph.id.slice("block-".length));
    const paragraphText = paragraph => textNodes(paragraph).map(n => n.data).join("");
    function blocksOf(root) {
        return Array.from(root.querySelectorAll(paragraphSelector)).map(p => ({ index: blockIndex(p), text: paragraphText(p), element: p }));
    }
    // 段落偏移 → 每个计入的文本节点各一个 Range（跨过小卡片、小注弹层等跳过的节点时不把它们画上）
    function rangesOf(paragraph, start, end) {
        const result = [];
        let offset = 0;
        for (const node of textNodes(paragraph)) {
            const length = node.data.length, from = Math.max(start, offset), to = Math.min(end, offset + length);
            if (to > from) { const range = document.createRange(); range.setStart(node, from - offset); range.setEnd(node, to - offset); result.push(range); }
            offset += length;
            if (offset >= end) break;
        }
        return result;
    }
    // 选区端点 → 段落偏移（逐个文本节点累加，不用 Selection.toString）
    function offsetOf(paragraph, container, offsetInContainer) {
        const probe = document.createRange();
        let offset = 0;
        for (const node of textNodes(paragraph)) {
            if (node === container) return offset + offsetInContainer;
            probe.setStart(container, offsetInContainer);
            probe.setEnd(container, offsetInContainer);
            if (probe.comparePoint(node, 0) > 0) return offset;
            offset += node.data.length;
        }
        return offset;
    }

    // 41 号小注词：.term-plain 是按钮文字的第二份（关掉小注时显示的就是它），与按钮共用同一段偏移（§4.4）
    const skipped = element => element?.closest("[data-note-skip]:not(.term-plain)");
    function twinPoint(container, offset) {
        const element = container?.nodeType === 1 ? container : container?.parentElement;
        const plain = element?.closest(".term-plain");
        const button = plain?.previousElementSibling;
        const text = button?.matches("button.term-note") ? button.firstChild : null;
        if (!text || text.nodeType !== 3) return [container, offset];
        return container.nodeType === 3 ? [text, Math.min(offset, text.data.length)] : [text, offset === 0 ? 0 : text.data.length];
    }
    // 划线经过小注词时，第二份文字也画上（哪一份显示由小注开关决定）；ranges 都只在一个文本节点里
    function withTwins(ranges) {
        const result = [];
        for (const range of ranges) {
            result.push(range);
            const node = range.startContainer, button = node.parentElement;
            const twin = button?.matches("button.term-note") && button.nextElementSibling?.matches(".term-plain") ? button.nextElementSibling.firstChild : null;
            if (!twin || twin.nodeType !== 3) continue;
            const copy = document.createRange();
            copy.setStart(twin, Math.min(range.startOffset, twin.data.length)); copy.setEnd(twin, Math.min(range.endOffset, twin.data.length));
            result.push(copy);
        }
        return result;
    }

    function paint() {
        if (!session) return;
        const { root, page } = session;
        const blocks = blocksOf(root);
        const items = api.forPage(page.type, page.id);
        const found = {};
        session.located = {};
        const ranges = [], active = [];
        const counts = new Map();
        for (const item of items) {
            const where = locate(blocks, item);
            found[item.nid] = where ? { block: where.block, start: where.start } : null;
            if (!where) continue;
            const block = blocks.find(b => b.index === where.block);
            counts.set(block.element, (counts.get(block.element) || 0) + 1);
            (item.nid === session.active ? active : ranges).push(...withTwins(rangesOf(block.element, where.start, where.end)));
            session.located[item.nid] = { block: where.block, start: where.start, end: where.end };
        }
        session.found = found;
        for (const p of root.querySelectorAll("[data-note-count]")) p.removeAttribute("data-note-count");
        if (globalThis.CSS?.highlights && typeof Highlight === "function") {
            CSS.highlights.set("heritage-note", new Highlight(...ranges));
            CSS.highlights.set("heritage-note-active", new Highlight(...active));
        } else {
            // 不支持 Highlight API：段落左侧细竖线标出「这段有划线」
            session.observer?.disconnect();
            for (const [element, n] of counts) element.setAttribute("data-note-count", String(n));
            session.observer?.observe(root, { childList: true, subtree: true, characterData: true });
        }
    }

    function currentAnchor(fromCaret) {
        if (!session) return null;
        const selection = document.getSelection();
        if (!selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        const start = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        const end = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
        // 正文以外（含本页划线一栏）的选区不理会；正文里的小节标题、参考文献、图注只说明原因
        if (!start || !session.root.contains(start) || start.closest("[data-note-panel]")) return null;
        const paragraph = start.closest(paragraphSelector);
        if (!paragraph) return range.collapsed ? null : { error: "notBody" };
        if (skipped(start) || skipped(end)) return { error: "notBody" };
        if (end?.closest(paragraphSelector) !== paragraph) return { error: "crossParagraph" };
        const text = paragraphText(paragraph);
        let s = offsetOf(paragraph, ...twinPoint(range.startContainer, range.startOffset)), e = offsetOf(paragraph, ...twinPoint(range.endContainer, range.endOffset));
        if (range.collapsed) {
            if (!fromCaret) return null;
            // 键盘：光标在句中时取整句
            const sentence = sentences(text).find(x => s >= x.start && s <= x.start + x.text.length);
            if (!sentence) return null;
            if (sentence.text.length > limits.quote) return { error: "sentenceTooLong" };
            s = sentence.start; e = sentence.start + sentence.text.length;
        }
        const anchor = anchorFrom(text, blockIndex(paragraph), s, e);
        if (anchor.error) return anchor;
        const rect = range.getBoundingClientRect();
        return { ...anchor, rect: { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width } };
    }

    function notify(method, ...args) {
        try { session?.listener?.invokeMethodAsync(method, ...args).catch(() => { }); } catch { /* 组件已释放 */ }
    }

    function onSelection() {
        clearTimeout(session?.timer);
        if (!session) return;
        session.timer = setTimeout(() => {
            const anchor = currentAnchor(false);
            // 没有合格选区时只在「刚才还有」时通知一次，光标移动不反复回调（Server host 上每次回调都经 SignalR）
            if (!anchor) { if (session.selecting) { session.selecting = false; notify("OnSelection", null, false, false); } return; }
            session.selecting = true;
            notify("OnSelection", anchor, matchMedia("(pointer: coarse)").matches, false);
        }, 300);
    }

    function onKey(event) {
        if (!session || !event.altKey || event.code !== "KeyN") return;
        const target = event.target;
        if (target && (target.closest?.("input, textarea, select, [contenteditable='true']"))) return;
        const anchor = currentAnchor(true);
        if (!anchor) return;
        event.preventDefault();
        session.selecting = true;
        notify("OnSelection", anchor, matchMedia("(pointer: coarse)").matches, true);
    }

    function caretOffset(event) {
        let node, offset;
        if (document.caretPositionFromPoint) { const pos = document.caretPositionFromPoint(event.clientX, event.clientY); node = pos?.offsetNode; offset = pos?.offset; }
        else if (document.caretRangeFromPoint) { const range = document.caretRangeFromPoint(event.clientX, event.clientY); node = range?.startContainer; offset = range?.startOffset; }
        if (!node) return null;
        const element = node.nodeType === 1 ? node : node.parentElement;
        const paragraph = element?.closest(paragraphSelector);
        if (!paragraph) return null;
        return { block: blockIndex(paragraph), offset: offsetOf(paragraph, ...twinPoint(node, offset)) };
    }

    function onClick(event) {
        if (!session || event.target.closest?.("a, button, [popover]") || skipped(event.target)) return;
        const selection = document.getSelection();
        if (selection && !selection.isCollapsed) return;
        const at = caretOffset(event);
        if (!at) return;
        const nids = Object.entries(session.located).filter(([, w]) => w.block === at.block && at.offset >= w.start && at.offset <= w.end).map(([nid]) => nid);
        if (!nids.length) return;
        // 点开的那条画成强调色
        focusNote(nids[0], false);
        notify("OnNoteClick", nids);
    }

    function focusNote(nid, scroll = true) {
        if (!session) return false;
        session.active = nid;
        paint();
        const where = session.located[nid];
        if (!where) return false;
        const paragraph = session.root.querySelector(`#block-${where.block}`);
        if (scroll && paragraph) {
            // 划线落在隐藏的那份小注文字上时量另一份，再不行量整段
            const rect = withTwins(rangesOf(paragraph, where.start, where.end)).map(r => r.getBoundingClientRect()).find(r => r.height > 0) || paragraph.getBoundingClientRect();
            window.scrollTo({ top: window.scrollY + rect.top - window.innerHeight / 3, behavior: "smooth" });
        }
        return true;
    }

    // 地址片段 #note-n_…：正文可能晚到，到达后定位并去掉片段（保留 Blazor 的 history.state）
    function followFragment() {
        const match = /^#note-(n_[a-f\d]{16})$/.exec(location.hash || "");
        if (!match || !session) return;
        if (focusNote(match[1])) history.replaceState(history.state, "", location.pathname + location.search);
    }

    function attach(root, page, listener) {
        detach();
        const element = typeof root === "string" ? document.querySelector(root) : root;
        if (!element || !page || !types.includes(page.type) || !validId(page.id)) return false;
        session = { root: element, page: { type: page.type, id: page.id.toLowerCase(), title: page.title || "" }, listener, located: {}, found: {}, active: null, timer: 0 };
        session.observer = new MutationObserver(() => { clearTimeout(session.repaint); session.repaint = setTimeout(() => { paint(); followFragment(); }, 120); });
        session.observer.observe(element, { childList: true, subtree: true, characterData: true });
        session.handlers = [[document, "selectionchange", onSelection], [document, "keydown", onKey], [element, "click", onClick], [window, "hashchange", followFragment],
            [window, "storage", event => { if (event.key === key) { paint(); notify("OnChanged"); } }], [window, "pagehide", detach]];
        for (const [target, name, handler] of session.handlers) target.addEventListener(name, handler);
        paint();
        followFragment();
        return true;
    }

    function detach() {
        if (!session) return;
        for (const [target, name, handler] of session.handlers || []) target.removeEventListener(name, handler);
        session.observer?.disconnect();
        clearTimeout(session.timer); clearTimeout(session.repaint);
        if (globalThis.CSS?.highlights) { CSS.highlights.delete("heritage-note"); CSS.highlights.delete("heritage-note-active"); }
        session = null;
    }

    Object.assign(api, {
        attach, detach,
        refresh() { paint(); return session ? { ...session.found } : {}; },
        found() { return session ? { ...session.found } : {}; },
        focusNote,
        // 「按句划线」（§3.2）：本页可划线段落与切好的句子；超过 200 字的句子标出，不能选
        paragraphs() {
            if (!session) return [];
            return blocksOf(session.root).map(b => ({ index: b.index, preview: b.text.slice(0, 12),
                sentences: sentences(b.text).map(x => ({ start: x.start, end: x.start + x.text.length, text: x.text, tooLong: x.text.length > limits.quote })) }));
        },
        anchorAt(block, start, end) {
            if (!session) return null;
            const target = blocksOf(session.root).find(b => b.index === block);
            return target ? anchorFrom(target.text, block, start, end) : null;
        },
        // 「我的 › 划线」核对原文：一页的段落与这一页的各条，返回 { nid: true|false }
        locateAll(blocks, items) { return Object.fromEntries((Array.isArray(items) ? items : []).map(item => [item.nid, !!locate(blocks, item)])); },
        clearSelection() { document.getSelection()?.removeAllRanges(); },
        showPopover(id) { try { document.getElementById(id)?.showPopover(); } catch { /* 已打开 */ } },
        hidePopover(id) { try { document.getElementById(id)?.hidePopover(); } catch { /* 已关闭 */ } },
        showDialog(id) { const d = document.getElementById(id); if (d && !d.open) d.showModal(); },
        closeDialog(id) { document.getElementById(id)?.close(); },
        focus(selector) { document.querySelector(selector)?.focus(); },
        // 笔记框关闭后回到本页一栏里的这一条：一栏收起时先展开
        focusItem(id) {
            const item = document.getElementById(id);
            if (!item) return false;
            const panel = item.closest("details");
            if (panel) panel.open = true;
            item.focus();
            return true;
        }
    });
    window.heritageNotes = api;

    // ---- 底部固定条的排布（README 第七轮共用部分第 5 条）：自下而上 离线提示 → 朗读条 → 划线工具条，窄屏的卡片、策展板选单与错误条也依次排开 ----
    const dockOrder = [".offline-banner", ".speech-bar", ".note-toolbar.is-docked", ".mention-card", ".add-to-board-panel", "#blazor-error-ui"];
    let dockFrame = 0;
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => dock()) : null;
    const watched = new WeakSet();
    function dock() {
        cancelAnimationFrame(dockFrame);
        dockFrame = requestAnimationFrame(() => {
            let bottom = 0;
            for (const selector of dockOrder) {
                for (const element of document.querySelectorAll(selector)) {
                    // 各条自己样式表里的 bottom 记作底线（第一次量时还没有内联值）；只排固定在下半屏、正在显示的
                    if (!("dockBase" in element.dataset)) element.dataset.dockBase = String(parseFloat(getComputedStyle(element).bottom) || 0);
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    if (style.position !== "fixed" || style.display === "none" || style.visibility === "hidden" || rect.height === 0 || rect.top < window.innerHeight / 3) {
                        if (element.style.bottom) element.style.removeProperty("bottom");
                        continue;
                    }
                    if (resize && !watched.has(element)) { watched.add(element); resize.observe(element); }
                    const value = Math.max(Number(element.dataset.dockBase), bottom);
                    if (element.style.bottom !== value + "px") element.style.bottom = value + "px";
                    bottom = value + rect.height + 8;
                }
            }
        });
    }
    if (typeof window !== "undefined" && typeof document !== "undefined" && typeof MutationObserver === "function" && typeof requestAnimationFrame === "function") {
        const start = () => {
            // 不观察 style：dock 自己写 bottom，观察它会循环
            new MutationObserver(dock).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden", "open"] });
            window.addEventListener("resize", dock);
            dock();
        };
        if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
    }
    api.dock = dock;
})();
