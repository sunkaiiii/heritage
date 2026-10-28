(() => {
    "use strict";
    const maximum = 5 * 1024 * 1024;
    const artifactMaximum = 32 * 1024 * 1024;
    const textTypes = ["application/json", "text/plain", "text/markdown", "text/csv"];
    function download(name, type, content) {
        const safeName = typeof name === "string" ? name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 160) : "heritage-export.txt";
        const url = URL.createObjectURL(new Blob([content], {type}));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = safeName || "heritage-download"; anchor.rel = "noopener";
        try { document.body.append(anchor); anchor.click(); }
        finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    }
    window.heritageCulture = {
        getLanguage() {
            let preference = "system";
            try { preference = window.heritagePersonal?.getLanguage() || "system"; } catch { /* Device language remains available when storage is denied. */ }
            const languages = preference === "system" ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [preference];
            const language = languages.find(value => typeof value === "string" && /^(en|zh)(?:-|$)/i.test(value));
            const culture = /^en(?:-|$)/i.test(language || "") ? "en" : "zh-CN";
            if (document.documentElement) document.documentElement.lang = culture;
            return culture;
        }
    };
    window.heritageDownloads = {
        saveText(name, mime, text) {
            if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("File exceeds download limit");
            const type = textTypes.includes(mime?.split(';')[0]) ? mime : "text/plain;charset=utf-8";
            download(name, type, text);
        },
        saveBytes(name, mime, bytes) {
            // Blazor's byte[] interop arrives as Uint8Array, preserving arbitrary
            // binary data without base64 expansion or UTF-8 decoding.
            if (!(bytes instanceof Uint8Array) || bytes.byteLength > artifactMaximum) throw new Error("Invalid file or download limit exceeded");
            const mediaType = typeof mime === "string" ? mime.split(';')[0].trim().toLowerCase() : "";
            const type = [...textTypes, "application/pdf", "application/zip", "application/octet-stream", "image/png", "image/jpeg", "image/webp"].includes(mediaType) ? mediaType : "application/octet-stream";
            download(name, type, bytes);
        },
        async copyText(text) {
            if (typeof text !== "string" || new TextEncoder().encode(text).length > maximum) throw new Error("Clipboard content exceeds limit");
            await navigator.clipboard.writeText(text);
        }
    };
    document.addEventListener("click", async event => {
        const button = event.target.closest?.("[data-copy-link]");
        if (!button) return;
        const feedback = button.nextElementSibling?.hasAttribute("data-copy-feedback") ? button.nextElementSibling : null;
        if (feedback) feedback.textContent = "";
        try {
            await navigator.clipboard.writeText(location.href); button.dataset.copied = "true";
            if (feedback) feedback.textContent = button.dataset.copySuccess || "Link copied.";
        }
        catch {
            button.dataset.copied = "false";
            if (feedback) feedback.textContent = button.dataset.copyFailure || "The link could not be copied. Please try again.";
        }
    });
})();
