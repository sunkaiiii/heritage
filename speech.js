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

    function report(status) {
        if (!state) return;
        const paragraph = state.items[state.position]?.paragraph ?? -1;
        state.listener?.invokeMethodAsync("OnSpeechState", status, paragraph).catch(() => {});
    }

    // 暂停用「取消并记住位置」实现：各浏览器对 pause/resume 的支持不一致
    function speakCurrent() {
        const speech = synth();
        if (!state || !speech) return;
        const item = state.items[state.position];
        if (!item) { finish("ended"); return; }
        const token = ++state.token;
        const utterance = new SpeechSynthesisUtterance(item.text);
        utterance.voice = voice;
        utterance.lang = voice?.lang || "zh-CN";
        utterance.rate = state.rate;
        utterance.onend = () => {
            if (!state || state.token !== token || state.status !== "playing") return;
            state.position++;
            if (state.position >= state.items.length) { finish("ended"); return; }
            if (state.items[state.position].paragraph !== item.paragraph) { mark(state.items[state.position].paragraph); report("playing"); }
            speakCurrent();
        };
        utterance.onerror = event => {
            if (!state || state.token !== token || event?.error === "interrupted" || event?.error === "canceled") return;
            finish("error");
        };
        speech.speak(utterance);
    }

    function finish(status) {
        synth()?.cancel();
        mark(-1);
        if (!state) return;
        state.status = status;
        state.token++;
        report(status);
        state = null;
    }

    function jumpParagraph(step) {
        if (!state) return;
        const current = state.items[state.position]?.paragraph ?? 0;
        const paragraphs = [...new Set(state.items.map(i => i.paragraph))];
        const at = paragraphs.indexOf(current);
        const target = paragraphs[Math.max(0, Math.min(paragraphs.length - 1, at + step))];
        state.position = state.items.findIndex(i => i.paragraph === target);
        synth()?.cancel();
        mark(target);
        report(state.status);
        if (state.status === "playing") speakCurrent();
    }

    function bindKeys(element) {
        if (!(element instanceof HTMLElement) || element.dataset.speechKeys) return;
        element.dataset.speechKeys = "true";
        // 快捷键只在焦点位于控制条内时生效，不影响页面滚动与读屏软件
        element.addEventListener("keydown", event => {
            if (!state) return;
            if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); state.status === "playing" ? api.pause() : api.resume(); }
            else if (event.key === "Escape") { event.preventDefault(); api.stop(); }
        });
    }

    const api = {
        detect,
        // paragraphs[i] 对应页面上 data-speech-index="i" 的元素
        start(paragraphs, options, listener) {
            const speech = synth();
            if (!speech || !voice) return false;
            if (state) finish("stopped");
            const items = plan(paragraphs);
            if (!items.length) return false;
            const rate = [0.8, 1, 1.2].includes(options?.rate) ? options.rate : 1;
            speech.cancel();
            state = { items, position: 0, rate, follow: options?.follow !== false, status: "playing", token: 0, listener };
            mark(items[0].paragraph);
            report("playing");
            speakCurrent();
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
        // 供 Node 测试
        _pickVoice: pickVoice,
        _splitSentences: splitSentences,
        _plan: plan
    };
    window.heritageSpeech = api;
    window.addEventListener?.("pagehide", () => api.stop());
})();
