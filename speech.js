(() => {
    "use strict";
    // 朗读（docs/features/16）：只用浏览器的本机中文语音（localService=true），在线语音一律不用；
    // 朗读文字不离开本机，不发任何网络请求。段落文本由页面传入，元素用 data-speech-index 对应。
    const chinese = /^(?:zh|cmn)(?:[-_]|$)/i;
    const sentenceEnd = /[^。！？；!?;\n]*(?:[。！？；!?;]+[”’」』）)]*|\n+|$)/g;
    const maxSentence = 160;

    // 只选本机中文语音：zh-CN 优先，其次其他简体中文，再其次任何中文
    function pickVoice(voices) {
        const local = (Array.isArray(voices) ? voices : []).filter(v => v && v.localService === true && typeof v.lang === "string" && chinese.test(v.lang));
        const rank = v => /^zh[-_]CN$/i.test(v.lang) ? 0 : /^zh[-_](?:Hans|SG)/i.test(v.lang) ? 1 : /^cmn/i.test(v.lang) ? 2 : 3;
        return local.sort((a, b) => rank(a) - rank(b) || (b.default === true) - (a.default === true))[0] || null;
    }

    // 按句号、问号、叹号、分号与换行切句；过长的句子再按逗号或长度切开，避免浏览器读到一半停住
    function splitSentences(text) {
        const value = typeof text === "string" ? text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ").trim() : "";
        if (!value) return [];
        const result = [];
        for (const piece of value.match(sentenceEnd) || []) {
            let rest = piece.trim();
            while (rest.length > maxSentence) {
                const window = rest.slice(0, maxSentence);
                const cut = Math.max(window.lastIndexOf("，"), window.lastIndexOf("、"), window.lastIndexOf(","), window.lastIndexOf(" "));
                const at = cut > maxSentence / 3 ? cut + 1 : maxSentence;
                result.push(rest.slice(0, at).trim());
                rest = rest.slice(at).trim();
            }
            if (rest) result.push(rest);
        }
        return result;
    }

    // 段落 → [{ paragraph, text }]；空段落跳过，但保留原段号以便高亮对应元素
    function plan(paragraphs) {
        const list = Array.isArray(paragraphs) ? paragraphs.slice(0, 2000) : [];
        const result = [];
        list.forEach((text, paragraph) => { for (const sentence of splitSentences(text)) result.push({ paragraph, text: sentence }); });
        return result;
    }

    const synth = () => (typeof window.speechSynthesis === "object" && window.speechSynthesis) || null;
    let state = null;
    let voice = null;

    function detect(timeoutMs) {
        const speech = synth();
        if (!speech || typeof window.SpeechSynthesisUtterance !== "function") return Promise.resolve(false);
        voice = pickVoice(speech.getVoices());
        if (voice) return Promise.resolve(true);
        // 首次调用 getVoices() 常返回空数组，等 voiceschanged 或超时后再判定
        return new Promise(resolve => {
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                speech.removeEventListener?.("voiceschanged", finish);
                voice = pickVoice(speech.getVoices());
                resolve(Boolean(voice));
            };
            speech.addEventListener?.("voiceschanged", finish);
            setTimeout(finish, Math.max(0, Math.min(Number(timeoutMs) || 3000, 10000)));
        });
    }

    function mark(index) {
        for (const element of document.querySelectorAll("[data-speech-index].is-speaking")) element.classList.remove("is-speaking");
        if (index < 0) return;
        const element = document.querySelector(`[data-speech-index="${index}"]`);
        if (!element) return;
        element.classList.add("is-speaking");
        if (state?.follow) element.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }

    function report(status, current = state) {
        if (!current) return;
        const paragraph = current.items[current.position]?.paragraph ?? -1;
        current.listener?.invokeMethodAsync("OnSpeechState", status, paragraph).catch(() => {});
    }

    // 原因另走可选回调（docs/features/56 §4.4，R7-56a）：只在报完 paused 之后调用；监听方没有这个方法时调用失败被吞掉，状态仍然正确
    function notice(listener, reason) {
        try { listener?.invokeMethodAsync("OnSpeechNotice", reason)?.catch?.(() => {}); } catch { /* 没有这个方法 */ }
    }

    // 后台被浏览器停下（interrupted）或首次发声超时（blocked）：都报 paused，等读者点「继续」，不自动接着读
    function interrupt(reason) {
        if (!state || state.status !== "playing") return;
        const listener = state.listener;
        state.status = "paused";
        state.token++;
        synth()?.cancel();
        report("paused");
        notice(listener, reason);
    }

    const silent = speech => !speech || (!speech.speaking && !speech.pending);

    // 播放中每 2 秒看一次：连续 3 次既没在说也没排队（浏览器丢了 onend）按 interrupted 处理
    function watch() {
        const current = state;
        if (!current || current.watching) return;
        current.watching = true;
        current.silentTicks = 0;
        const tick = () => {
            if (state !== current || current.status !== "playing") { current.watching = false; return; }
            if (silent(synth())) { if (++current.silentTicks >= 3) { current.watching = false; interrupt("interrupted"); return; } }
            else current.silentTicks = 0;
            setTimeout(tick, 2000);
        };
        setTimeout(tick, 2000);
    }

    // 暂停用「取消并记住位置」实现：各浏览器对 pause/resume 的支持不一致
    function speakCurrent() {
        const speech = synth();
        if (!state || !speech) return;
        const item = state.items[state.position];
        if (!item) { finish("ended"); return; }
        // 换条或重新开始后，旧的朗读、旧的计时不能动新的状态：同时核对状态对象与 token
        const owner = state, token = ++state.token;
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.voice = voice;
        utterance.lang = voice?.lang || "zh-CN";
        utterance.rate = state.rate;
        state.started = false;
        utterance.onstart = () => { if (state === owner && owner.token === token) owner.started = true; };
        utterance.onend = () => {
            if (state !== owner || state.token !== token || state.status !== "playing") return;
            state.position++;
            if (state.position >= state.items.length) { finish("ended"); return; }
            if (state.items[state.position].paragraph !== item.paragraph) { if (state.highlight) mark(state.items[state.position].paragraph); report("playing"); }
            speakCurrent();
        };
        utterance.onerror = event => {
            if (state !== owner || state.token !== token || event?.error === "interrupted" || event?.error === "canceled") return;
            finish("error");
        };
        speech.speak(utterance);
        // 首次发声超时：4 秒内没有 onstart（iOS 拦下了非读者操作触发的 speak）
        setTimeout(() => { if (state === owner && owner.token === token && owner.status === "playing" && !owner.started) interrupt("blocked"); }, 4000);
    }

    // 先清掉状态再报告：WebAssembly 上监听方会在回调里同步地开始下一条（连续朗读换条），不能在报告之后再把新的状态清掉
    function finish(status) {
        synth()?.cancel();
        const current = state;
        if (!current || current.highlight) mark(-1);
        if (!current) return;
        current.status = status;
        current.token++;
        state = null;
        report(status, current);
    }

    function jumpParagraph(step) {
        if (!state) return;
        const current = state.items[state.position]?.paragraph ?? 0;
        const paragraphs = [...new Set(state.items.map(i => i.paragraph))];
        const at = paragraphs.indexOf(current);
        const target = paragraphs[Math.max(0, Math.min(paragraphs.length - 1, at + step))];
        state.position = state.items.findIndex(i => i.paragraph === target);
        synth()?.cancel();
        if (state.highlight) mark(target);
        report(state.status);
        if (state.status === "playing") speakCurrent();
    }

    function bindKeys(element) {
        if (!(element instanceof HTMLElement) || element.dataset.speechKeys) return;
        element.dataset.speechKeys = "true";
        // 快捷键只在焦点位于控制条内时生效，不影响页面滚动与读屏软件
        element.addEventListener("keydown", event => {
            if (!state) return;
            // 空格只在焦点是朗读条本身时暂停／继续；焦点在按钮、链接上时交给浏览器按下它（R7-56g）
            if ((event.key === " " || event.key === "Spacebar") && event.target === element) { event.preventDefault(); state.status === "playing" ? api.pause() : api.resume(); }
            else if (event.key === "Escape") { event.preventDefault(); api.stop(); }
        });
    }

    // 列表页（家族、系列、策展板）高亮正在读的那一行：is-speaking 与 aria-current；reveal(null) 清除全部（R7-56b）
    function reveal(key, follow) {
        for (const element of document.querySelectorAll("[data-read-aloud-key]")) {
            element.classList.remove("is-speaking");
            element.removeAttribute?.("aria-current");
        }
        if (typeof key !== "string" || !key) return false;
        const element = Array.from(document.querySelectorAll("[data-read-aloud-key]")).find(e => e.getAttribute("data-read-aloud-key") === key);
        if (!element) return false;
        element.classList.add("is-speaking");
        element.setAttribute("aria-current", "true");
        if (follow !== false) element.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return true;
    }

    // 屏幕常亮（docs/features/56 §3.5）：只由连续朗读的队列持有，换条不释放；暂停、停止、读完时释放；16 号单页朗读不用
    let wakeWanted = false, wakeLock = null;
    async function requestWake() {
        try {
            const lock = await globalThis.navigator?.wakeLock?.request("screen");
            if (!lock) return false;
            if (!wakeWanted) { lock.release?.(); return false; }
            wakeLock = lock;
            lock.addEventListener?.("release", () => { if (wakeLock === lock) wakeLock = null; });
            return true;
        } catch { wakeLock = null; return false; }
    }
    function keepAwake(on) {
        wakeWanted = on === true;
        if (wakeWanted) return wakeLock ? Promise.resolve(true) : requestWake();
        const lock = wakeLock;
        wakeLock = null;
        try { lock?.release?.(); } catch { /* 已释放 */ }
        return Promise.resolve(false);
    }

    // 回到前台：语音已经停了按 interrupted 处理；仍要常亮时重新请求（切到后台时浏览器自动释放）
    document.addEventListener?.("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (state?.status === "playing" && silent(synth())) interrupt("interrupted");
        if (wakeWanted && !wakeLock) requestWake();
    });

    // 连续朗读的续读位置（docs/features/56 §4.2，C5）：heritage.web.listen.v1；页面打开时只读，只有读者开始连续朗读后才写
    const listenKey = "heritage.web.listen.v1";
    const listenLimits = { queues: 20, days: 90, raw: 20000 };
    const listenKinds = ["family", "series", "board"], listenTypes = ["directoryItem", "article", "inheritor"];
    function cleanListen(value, now) {
        if (!value || !listenKinds.includes(value.kind) || typeof value.key !== "string" || !value.key || value.key.length > 100 || /[\u0000-\u001f\u007f]/.test(value.key)) return null;
        if (!listenTypes.includes(value.type) || typeof value.id !== "string" || !/^[a-f\d]{24}$/i.test(value.id)) return null;
        if (!Number.isInteger(value.index) || value.index < 0 || value.index > 99 || !Number.isInteger(value.total) || value.total < 1 || value.total > 100) return null;
        if (!Number.isInteger(value.paragraph) || value.paragraph < 0 || value.paragraph > 1999) return null;
        const at = typeof value.savedAt === "string" && value.savedAt.length <= 64 ? Date.parse(value.savedAt) : NaN;
        if (isNaN(at) || now - at > listenLimits.days * 86400000) return null;
        return { kind: value.kind, key: value.key, type: value.type, id: value.id.toLowerCase(), index: value.index, paragraph: value.paragraph, total: value.total, savedAt: new Date(at).toISOString() };
    }
    // 读取时逐条清洗，不合格、过期的只在内存里忽略，不写回
    function cleanQueues(value, now) {
        const seen = new Set();
        return (Array.isArray(value?.queues) ? value.queues : []).slice(0, 200).map(x => cleanListen(x, now))
            .filter(x => x && !seen.has(x.kind + "\n" + x.key) && seen.add(x.kind + "\n" + x.key))
            .sort((a, b) => b.savedAt.localeCompare(a.savedAt)).slice(0, listenLimits.queues);
    }
    function readListen() {
        try {
            const raw = globalThis.localStorage?.getItem(listenKey);
            if (!raw || raw.length > listenLimits.raw) return [];
            return cleanQueues(JSON.parse(raw), Date.now());
        } catch { return []; }
    }
    function writeListen(list) {
        try {
            if (list.length) globalThis.localStorage.setItem(listenKey, JSON.stringify({ v: 1, queues: list }));
            else globalThis.localStorage.removeItem(listenKey);
            return "saved";
        } catch { return "quota"; }
    }
    const listen = {
        get(kind, key) { return readListen().find(x => x.kind === kind && x.key === key) || null; },
        // 写入时一并按 20 个上限与 90 天过期整理
        save(entry) {
            const now = Date.now();
            const item = cleanListen({ ...(entry || {}), savedAt: new Date(now).toISOString() }, now);
            if (!item) return "invalid";
            return writeListen([item, ...readListen().filter(x => x.kind !== item.kind || x.key !== item.key)].slice(0, listenLimits.queues));
        },
        remove(kind, key) { return writeListen(readListen().filter(x => x.kind !== kind || x.key !== key)); },
        clear() { try { globalThis.localStorage?.removeItem(listenKey); } catch { /* 忽略 */ } },
        _clean: cleanQueues
    };
    window.heritageListen = listen;

    const api = {
        detect,
        // paragraphs[i] 对应页面上 data-speech-index="i" 的元素
        // options：rate、follow；from 从第几段开始（默认 0，超出时从头）；highlight=false 时不高亮正文段落（列表页用）；
        // replace=true 时替换正在读的内容而不报 stopped（连续朗读换条用）
        start(paragraphs, options, listener) {
            const speech = synth();
            if (!speech || !voice) return false;
            if (state && options?.replace === true) { state.token++; state.status = "stopped"; state = null; }
            else if (state) finish("stopped");
            const items = plan(paragraphs);
            if (!items.length) return false;
            const rate = [0.8, 1, 1.2].includes(options?.rate) ? options.rate : 1;
            const from = Number.isInteger(options?.from) && options.from > 0 ? options.from : 0;
            const position = Math.max(0, items.findIndex(i => i.paragraph >= from));
            speech.cancel();
            state = { items, position, rate, follow: options?.follow !== false, highlight: options?.highlight !== false, status: "playing", token: 0, listener };
            if (state.highlight) mark(items[position].paragraph);
            report("playing");
            speakCurrent();
            watch();
            return true;
        },
        pause() {
            if (!state || state.status !== "playing") return;
            state.status = "paused";
            state.token++;
            synth()?.cancel();
            report("paused");
        },
        resume() {
            if (!state || state.status !== "paused") return;
            state.status = "playing";
            report("playing");
            speakCurrent();
            watch();
        },
        stop() { if (state) finish("stopped"); else synth()?.cancel(); },
        next() { jumpParagraph(1); },
        previous() { jumpParagraph(-1); },
        setRate(rate) {
            if (!state || ![0.8, 1, 1.2].includes(rate)) return;
            state.rate = rate;
            if (state.status === "playing") { synth()?.cancel(); speakCurrent(); }
        },
        bindKeys,
        reveal,
        keepAwake,
        // 供 Node 测试与开发者工具查看当前状态（只读）
        _state: () => state && { status: state.status, position: state.position, items: state.items.length, token: state.token, highlight: state.highlight },
        _pickVoice: pickVoice,
        _splitSentences: splitSentences,
        _plan: plan
    };
    window.heritageSpeech = api;
    window.addEventListener?.("pagehide", () => api.stop());
})();
