/**
 * Decrypt encrypted article when admin mode or visitor lucky-refresh is active.
 */
(function () {
  "use strict";

  function renderMarkdown(md) {
    if (typeof marked !== "undefined" && marked.parse) {
      return marked.parse(md);
    }
    return (
      '<pre class="encryption-fallback">' +
      md.replace(/&/g, "&amp;").replace(/</g, "&lt;") +
      "</pre>"
    );
  }

  async function ensureMarked() {
    if (typeof marked !== "undefined" && marked.parse) return;
    await new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function readPayload(container) {
    var inline = document.getElementById("encrypted-payload");
    if (inline && inline.value.trim()) {
      return JSON.parse(inline.value);
    }
    var url = container && container.dataset.payloadUrl;
    if (!url) return null;
    return fetch(encodeURI(url), { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("无法加载密文（" + r.status + "）");
      return r.json();
    });
  }

  function pageKey(container) {
    return (container && container.dataset.pageKey) || location.pathname;
  }

  function canDecrypt(container) {
    if (window.EncryptionAdmin && window.EncryptionAdmin.isAdminActive()) {
      return { allowed: true, reason: "admin" };
    }
    if (window.EncryptionVisitor) {
      EncryptionVisitor.recordRefresh(pageKey(container));
      if (EncryptionVisitor.isUnlocked(pageKey(container))) {
        return { allowed: true, reason: "visitor" };
      }
    }
    return { allowed: false, reason: "locked" };
  }

  function lockContent(lock, body) {
    if (lock) lock.hidden = false;
    if (!body) return;
    body.innerHTML = "";
    body.classList.add("is-locked");
    body.dataset.decrypted = "";
    body.dataset.decryptReason = "";
  }

  async function tryDecrypt(container) {
    var cfg = window.__ENCRYPTION_CONFIG__;
    if (!cfg || !cfg.enabled) return;

    var lock = document.getElementById("encryption-lock-notice");
    var body = document.getElementById("encrypted-article-body");
    if (!body) return;

    var access = canDecrypt(container);
    if (!access.allowed) {
      lockContent(lock, body);
      return;
    }

    if (lock) lock.hidden = true;
    body.classList.remove("is-locked");

    if (body.dataset.decrypted === "true" && body.dataset.decryptReason === access.reason) {
      return;
    }

    try {
      var payload = readPayload(container);
      if (payload && typeof payload.then === "function") {
        payload = await payload;
      }
      if (!payload) throw new Error("未找到密文数据，请先运行 ./build-site.sh");

      await ensureMarked();
      if (!window.EncryptionCrypto) throw new Error("解密模块未加载");

      var markdown = await EncryptionCrypto.decryptPayload(cfg.key, payload);
      body.innerHTML = renderMarkdown(markdown);
      body.dataset.decrypted = "true";
      body.dataset.decryptReason = access.reason;
    } catch (err) {
      body.innerHTML =
        '<p class="encryption-error">解密失败：' +
        (err && err.message ? err.message : "未知错误") +
        "</p>";
      body.dataset.decrypted = "error";
    }
  }

  function init() {
    var container = document.getElementById("encrypted-article");
    if (!container) return;

    tryDecrypt(container);
    window.addEventListener("encryption-admin-enabled", function () {
      tryDecrypt(container);
    });
    window.addEventListener("encryption-admin-expired", function () {
      tryDecrypt(container);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
