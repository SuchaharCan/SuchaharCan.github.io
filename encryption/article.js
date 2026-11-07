/**
 * Decrypt encrypted article only while the short-lived admin session is valid.
 * Decrypted markup lives only in the current DOM and is cleared on timeout,
 * visibility loss, page hide, and bfcache restoration.
 */
(function () {
  "use strict";

  var renderGeneration = 0;
  var activeController = null;
  var markedPromise = null;

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

  function ensureMarked() {
    if (typeof marked !== "undefined" && marked.parse) return Promise.resolve();
    if (markedPromise) return markedPromise;
    markedPromise = new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/marked/marked.min.js";
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
      setTimeout(resolve, 5000);
    });
    return markedPromise;
  }

  function loadScript(src) {
    return new Promise(function (resolve) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = resolve;
      document.body.appendChild(script);
    });
  }

  async function runInitScripts(container) {
    var list = (container && container.dataset.initScripts) || "";
    var sources = list
      .split(",")
      .map(function (value) {
        return value.trim();
      })
      .filter(Boolean);
    for (var i = 0; i < sources.length; i += 1) {
      await loadScript(sources[i]);
    }
    if (container) {
      container.dispatchEvent(
        new CustomEvent("encryption-content-injected", {
          bubbles: true,
        }),
      );
    }
  }

  function readPayload(container, signal) {
    var inline = document.getElementById("encrypted-payload");
    if (inline && inline.value.trim()) {
      return Promise.resolve(JSON.parse(inline.value));
    }
    var url = container && container.dataset.payloadUrl;
    if (!url) return Promise.resolve(null);
    return fetch(encodeURI(url), {
      cache: "no-store",
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      signal: signal,
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("无法加载密文（" + response.status + "）");
      }
      return response.json();
    });
  }

  function lockContent(lock, body) {
    renderGeneration += 1;
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    if (lock) lock.hidden = false;
    if (!body) return;
    body.replaceChildren();
    body.hidden = true;
    body.classList.add("is-locked");
    body.dataset.decrypted = "";
  }

  function adminActive() {
    return !!(
      window.EncryptionAdmin &&
      window.EncryptionAdmin.isAdminActive()
    );
  }

  async function tryDecrypt(container) {
    var cfg = window.__ENCRYPTION_CONFIG__;
    if (!cfg || !cfg.enabled) return;

    var lock = document.getElementById("encryption-lock-notice");
    var body = document.getElementById("encrypted-article-body");
    if (!body) return;

    if (window.EncryptionAdmin && window.EncryptionAdmin.whenReady) {
      await window.EncryptionAdmin.whenReady();
    }
    if (!adminActive()) {
      lockContent(lock, body);
      return;
    }
    if (body.dataset.decrypted === "true") return;

    var generation = ++renderGeneration;
    var payloadType = container && container.dataset.payloadType;
    if (activeController) activeController.abort();
    activeController = new AbortController();
    var controller = activeController;

    if (lock) lock.hidden = true;
    body.hidden = false;
    body.classList.remove("is-locked");
    body.dataset.decrypted = "";

    try {
      var payload = await readPayload(container, controller.signal);
      if (!payload) {
        throw new Error("未找到密文数据，请先运行 ./build-site.sh");
      }
      if (!window.EncryptionCrypto) throw new Error("解密模块未加载");

      var plain = await EncryptionCrypto.decryptPayload(cfg.key, payload);
      if (
        generation !== renderGeneration ||
        !adminActive() ||
        document.visibilityState !== "visible"
      ) {
        lockContent(lock, body);
        return;
      }

      if (payloadType === "html") {
        body.innerHTML = plain;
      } else {
        await ensureMarked();
        body.innerHTML = renderMarkdown(plain);
      }
      body.hidden = false;
      body.dataset.decrypted = "true";
      if (payloadType === "html") {
        await runInitScripts(container);
      }
    } catch (err) {
      if (
        err &&
        (err.name === "AbortError" || generation !== renderGeneration)
      ) {
        return;
      }
      if (!adminActive()) {
        lockContent(lock, body);
        return;
      }
      if (lock) lock.hidden = false;
      body.hidden = false;
      body.innerHTML =
        '<p class="encryption-error">解密失败：' +
        (err && err.message ? err.message : "未知错误") +
        "</p>";
      body.dataset.decrypted = "error";
    } finally {
      if (activeController === controller) activeController = null;
    }
  }

  function init() {
    var container = document.getElementById("encrypted-article");
    if (!container) return;
    var lock = document.getElementById("encryption-lock-notice");
    var body = document.getElementById("encrypted-article-body");

    tryDecrypt(container);
    window.addEventListener("encryption-admin-enabled", function () {
      tryDecrypt(container);
    });
    window.addEventListener("encryption-admin-expired", function () {
      lockContent(lock, body);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        lockContent(lock, body);
      } else {
        tryDecrypt(container);
      }
    });
    window.addEventListener("pagehide", function () {
      lockContent(lock, body);
    });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted) {
        lockContent(lock, body);
        tryDecrypt(container);
      }
    });

    setInterval(function () {
      if (!adminActive() && body.dataset.decrypted) {
        lockContent(lock, body);
      }
    }, 500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
