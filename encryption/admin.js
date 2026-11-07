/**
 * Configurable admin mode with a browser-visible device gate.
 *
 * User interaction is intentionally quiet: clicks 1-3 do nothing, click 4
 * shows the only pre-enable hint, and click 5 starts device verification.
 * Encrypted pages use a page-scoped token and require one of the sidebar
 * navigation/metadata icons to be clicked before the title-click sequence.
 * Decrypted article text is never persisted by this module.
 */
(function () {
  "use strict";

  var TOKEN_STORAGE_PREFIX = "blog-encryption-admin-token-v4-";
  var BINDING_STORAGE_KEY = "blog-encryption-device-binding-v3";
  var TOKEN_VERSION = 2;
  var SCOPE_GENERAL = "general";
  var SCOPE_ENCRYPTED = "encrypted";
  var CLICK_RESET_MS = 2500;
  var STRUCTURE_ARM_MS = 15000;

  var state = {
    verified: false,
    until: 0,
    scope: "",
    page: "",
    ready: null,
    readyResolve: null,
    expiryTimer: null,
    expiryInterval: null,
  };
  var clicks = 0;
  var resetTimer = null;
  var toastEl = null;
  var verifying = false;
  var structureArmed = false;
  var structureTimer = null;

  function getConfig() {
    if (!window.__ENCRYPTION_CONFIG__) {
      var el = document.getElementById("encryption-site-config");
      if (el && el.value.trim()) {
        try {
          window.__ENCRYPTION_CONFIG__ = JSON.parse(el.value);
        } catch (_) {
          window.__ENCRYPTION_CONFIG__ = { enabled: false };
        }
      }
    }
    return window.__ENCRYPTION_CONFIG__ || { enabled: false };
  }

  function ttlMs() {
    var cfg = getConfig();
    var seconds = Number(cfg.admin_ttl_secs);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  }

  function ttlLabel() {
    var seconds = Math.round(ttlMs() / 1000);
    return seconds % 60 === 0
      ? seconds / 60 + " 分钟"
      : seconds + " 秒";
  }

  function isEncryptedPage() {
    return !!document.getElementById("encrypted-article");
  }

  function isNanologPage() {
    return !!(
      document.getElementById("nanolog") ||
      document.getElementById("nanolog-post")
    );
  }

  function isKanbanPage() {
    return !!(
      document.querySelector(".kanban-page") ||
      document.querySelector(".kanban-list-header")
    );
  }

  function isAdminEligiblePage() {
    return isNanologPage() || isKanbanPage() || isEncryptedPage();
  }

  function currentScope() {
    return isEncryptedPage() ? SCOPE_ENCRYPTED : SCOPE_GENERAL;
  }

  function currentPageKey() {
    if (!isEncryptedPage()) return "";
    var root = document.getElementById("encrypted-article");
    return (root && root.dataset.pageKey) || location.pathname;
  }

  function tokenStorageKey(scope) {
    return TOKEN_STORAGE_PREFIX + scope;
  }

  function base64Url(bytes) {
    var binary = "";
    for (var i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  function fromBase64Url(value) {
    var padded = value.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) padded += "=";
    var binary = atob(padded);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function readDeviceBinding() {
    try {
      return localStorage.getItem(BINDING_STORAGE_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function ensureDeviceBinding() {
    var existing = readDeviceBinding();
    if (existing) return existing;
    var secret = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    try {
      localStorage.setItem(BINDING_STORAGE_KEY, secret);
    } catch (_) {}
    return secret;
  }

  function readSessionToken(scope) {
    try {
      var raw = sessionStorage.getItem(tokenStorageKey(scope));
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveSessionToken(scope, token) {
    try {
      sessionStorage.setItem(
        tokenStorageKey(scope),
        JSON.stringify(token),
      );
    } catch (_) {}
  }

  function clearSessionToken(scope) {
    try {
      sessionStorage.removeItem(tokenStorageKey(scope));
    } catch (_) {}
  }

  async function hmacKey(secret, usages) {
    return crypto.subtle.importKey(
      "raw",
      fromBase64Url(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      usages,
    );
  }

  function tokenMessage(scope, page, until, digest) {
    return new TextEncoder().encode(
      TOKEN_VERSION + "." + scope + "." + page + "." + until + "." + digest,
    );
  }

  async function createSessionToken(scope, page, until, digest) {
    var secret = ensureDeviceBinding();
    if (!secret) throw new Error("device_binding_unavailable");
    var key = await hmacKey(secret, ["sign"]);
    var signature = await crypto.subtle.sign(
      "HMAC",
      key,
      tokenMessage(scope, page, until, digest),
    );
    return {
      v: TOKEN_VERSION,
      scope: scope,
      page: page,
      until: until,
      digest: digest,
      sig: base64Url(new Uint8Array(signature)),
    };
  }

  async function verifySessionToken(token, scope, page, digest) {
    if (
      !token ||
      token.v !== TOKEN_VERSION ||
      token.scope !== scope ||
      token.page !== page ||
      token.digest !== digest ||
      !Number.isFinite(token.until) ||
      !token.sig
    ) {
      return false;
    }
    var secret = readDeviceBinding();
    if (!secret) return false;
    try {
      var key = await hmacKey(secret, ["verify"]);
      return crypto.subtle.verify(
        "HMAC",
        key,
        fromBase64Url(token.sig),
        tokenMessage(scope, page, token.until, digest),
      );
    } catch (_) {
      return false;
    }
  }

  function activeNow() {
    return state.verified && Date.now() < state.until;
  }

  function isAdminActive() {
    if (activeNow()) return true;
    if (state.verified) expireAdmin("expired");
    return false;
  }

  function getExpiresAt() {
    return activeNow() ? state.until : 0;
  }

  function syncAdminUi() {
    var active = activeNow();
    document.documentElement.classList.toggle(
      "encryption-admin-active",
      active,
    );
    var header = document.getElementById("site-sidebar-header");
    if (!header) return;
    header.classList.toggle("encryption-admin-header-hint", active);
    if (active) {
      header.setAttribute("aria-label", "管理员模式已开启");
    } else {
      header.removeAttribute("aria-label");
      header.removeAttribute("title");
    }
  }

  function stopExpiryWatch() {
    if (state.expiryTimer) {
      clearTimeout(state.expiryTimer);
      state.expiryTimer = null;
    }
    if (state.expiryInterval) {
      clearInterval(state.expiryInterval);
      state.expiryInterval = null;
    }
  }

  function startExpiryWatch() {
    stopExpiryWatch();
    if (!activeNow()) return;
    var remaining = state.until - Date.now();
    state.expiryTimer = setTimeout(function () {
      expireAdmin("expired");
    }, Math.max(remaining, 0) + 20);
    state.expiryInterval = setInterval(function () {
      if (!activeNow()) expireAdmin("expired");
    }, 500);
  }

  function expireAdmin(reason) {
    var hadAdmin = state.verified;
    var expiredScope = state.scope;
    state.verified = false;
    state.until = 0;
    state.scope = "";
    state.page = "";
    if (expiredScope) clearSessionToken(expiredScope);
    disarmStructureGesture();
    stopExpiryWatch();
    syncAdminUi();
    if (hadAdmin) {
      window.dispatchEvent(
        new CustomEvent("encryption-admin-expired", {
          detail: { reason: reason || "expired" },
        }),
      );
    }
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.id = "encryption-admin-toast";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.hidden = true;
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function showToast(message) {
    var el = ensureToast();
    el.textContent = message;
    el.hidden = false;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  function hideToast() {
    if (toastEl) toastEl.hidden = true;
  }

  function resetClickSequence() {
    clicks = 0;
    hideToast();
  }

  function disarmStructureGesture() {
    structureArmed = false;
    if (structureTimer) {
      clearTimeout(structureTimer);
      structureTimer = null;
    }
  }

  function armStructureGesture() {
    if (!isEncryptedPage() || activeNow()) return;
    structureArmed = true;
    resetClickSequence();
    if (structureTimer) clearTimeout(structureTimer);
    structureTimer = setTimeout(function () {
      disarmStructureGesture();
      resetClickSequence();
    }, STRUCTURE_ARM_MS);
  }

  async function restoreAdminSession(notify) {
    var cfg = getConfig();
    var wasActive = activeNow();
    var scope = currentScope();
    var page = currentPageKey();
    if (!cfg.enabled) {
      expireAdmin("disabled");
      return false;
    }
    if (!isAdminEligiblePage()) {
      if (wasActive) expireAdmin("disabled");
      return false;
    }

    var token = readSessionToken(scope);
    if (!token || !window.EncryptionDeviceAuth) {
      clearSessionToken(scope);
      if (wasActive) expireAdmin("missing_token");
      return false;
    }

    var device = await EncryptionDeviceAuth.verify(cfg);
    if (!device.ok) {
      clearSessionToken(scope);
      if (wasActive) expireAdmin("device_mismatch");
      return false;
    }

    var valid =
      token.scope === scope &&
      token.page === page &&
      token.until > Date.now() &&
      token.until <= Date.now() + ttlMs() + 1000 &&
      (await verifySessionToken(token, scope, page, device.digest));
    if (!valid) {
      clearSessionToken(scope);
      if (wasActive) expireAdmin("invalid_token");
      return false;
    }

    state.verified = true;
    state.until = token.until;
    state.scope = scope;
    state.page = page;
    syncAdminUi();
    startExpiryWatch();
    if (!wasActive && notify) {
      window.dispatchEvent(new CustomEvent("encryption-admin-enabled"));
    }
    return true;
  }

  function refreshAdminState() {
    return restoreAdminSession(true);
  }

  async function verifyAndEnableAdmin() {
    if (verifying || activeNow()) return activeNow();
    var cfg = getConfig();
    if (!cfg.enabled || !window.EncryptionDeviceAuth) return false;
    var sessionTtlMs = ttlMs();
    if (!sessionTtlMs) {
      showToast("管理员有效期配置无效");
      return false;
    }
    var scope = currentScope();
    var page = currentPageKey();

    verifying = true;
    try {
      var device = await EncryptionDeviceAuth.verify(cfg);
      if (!device.ok) {
        console.warn("[encryption] admin device verification failed", {
          reason: device.reason,
          mismatches: device.mismatches || [],
          profile: device.profile,
        });
        showToast(
          device.reason === "browser_unsupported"
            ? "请使用最新版 Chrome / Chromium 验证管理员设备"
            : "当前设备信息与管理员配置不匹配",
        );
        return false;
      }

      var until = Date.now() + sessionTtlMs;
      var token = await createSessionToken(
        scope,
        page,
        until,
        device.digest,
      );
      saveSessionToken(scope, token);
      state.verified = true;
      state.until = until;
      state.scope = scope;
      state.page = page;
      syncAdminUi();
      startExpiryWatch();
      showToast(
        "管理员模式已开启，" + ttlLabel() + "后自动加密",
      );
      window.dispatchEvent(new CustomEvent("encryption-admin-enabled"));
      return true;
    } catch (_) {
      showToast("管理员模式验证失败");
      return false;
    } finally {
      verifying = false;
      disarmStructureGesture();
    }
  }

  function onTargetClick(event) {
    if (!getConfig().enabled) return;
    if (activeNow()) {
      hideToast();
      return;
    }
    if (!isAdminEligiblePage()) return;
    if (isEncryptedPage() && !structureArmed) {
      return;
    }

    clicks += 1;
    if (clicks > 1) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(resetClickSequence, CLICK_RESET_MS);

    if (clicks === 4) {
      showToast("即将开启管理员模式");
      return;
    }
    if (clicks === 5) {
      if (resetTimer) clearTimeout(resetTimer);
      clicks = 0;
      hideToast();
      disarmStructureGesture();
      verifyAndEnableAdmin();
    }
  }

  function bind() {
    var el = document.getElementById("site-sidebar-header");
    if (el) el.addEventListener("click", onTargetClick, true);

    if (!isEncryptedPage()) return;
    document
      .querySelectorAll("#site-sidebar-modes label")
      .forEach(function (label) {
        label.addEventListener("click", armStructureGesture, true);
      });
    document
      .querySelectorAll("#site-sidebar-modes input")
      .forEach(function (input) {
        input.addEventListener("change", function () {
          if (input.checked) armStructureGesture();
        });
      });
  }

  function markReady() {
    if (state.readyResolve) {
      state.readyResolve();
      state.readyResolve = null;
    }
  }

  function whenReady() {
    return state.ready || Promise.resolve();
  }

  function init() {
    if (document.getElementById("encrypted-article")) {
      document.documentElement.classList.add("encryption-protected-page");
    }
    state.ready = new Promise(function (resolve) {
      state.readyResolve = resolve;
    });
    bind();
    syncAdminUi();
    restoreAdminSession(true).finally(markReady);

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        refreshAdminState();
      }
    });
    window.addEventListener("pageshow", function (event) {
      if (event.persisted && document.visibilityState === "visible") {
        refreshAdminState();
      }
    });
  }

  window.EncryptionAdmin = {
    getExpiresAt: getExpiresAt,
    isAdminActive: isAdminActive,
    refresh: refreshAdminState,
    syncAdminUi: syncAdminUi,
    whenReady: whenReady,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
