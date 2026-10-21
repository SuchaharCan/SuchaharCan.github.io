/**
 * Click #site-sidebar-header 6× to enable admin mode (see zola.toml [extra.encryption]).
 */
(function () {
  "use strict";

  var STORAGE_KEY = "blog-encryption-admin-until";
  var CLICK_TARGET = 6;
  var CLICK_HINT_FROM = 3;
  var CLICK_RESET_MS = 2000;

  var clicks = 0;
  var resetTimer = null;
  var toastEl = null;
  var expiryTimer = null;
  var expiryInterval = null;

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

  function adminUntil() {
    var raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    var n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  }

  function isAdminActive() {
    if (!getConfig().enabled) return false;
    var until = adminUntil();
    if (!until) return false;
    if (Date.now() >= until) {
      sessionStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return true;
  }

  function syncAdminUi() {
    var active = isAdminActive();
    document.documentElement.classList.toggle("encryption-admin-active", active);
    var header = document.getElementById("site-sidebar-header");
    if (header) {
      header.classList.toggle("encryption-admin-header-hint", active);
      if (active) {
        header.setAttribute("aria-label", "你已经是管理员");
      } else {
        header.removeAttribute("aria-label");
        header.removeAttribute("title");
      }
    }
  }

  function stopExpiryWatch() {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = null;
    }
    if (expiryInterval) {
      clearInterval(expiryInterval);
      expiryInterval = null;
    }
  }

  function expireAdmin() {
    var had = isAdminActive() || sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    stopExpiryWatch();
    syncAdminUi();
    if (had) {
      window.dispatchEvent(new CustomEvent("encryption-admin-expired"));
    }
  }

  function startExpiryWatch() {
    stopExpiryWatch();
    if (!isAdminActive()) return;
    var ms = adminUntil() - Date.now();
    if (ms <= 0) {
      expireAdmin();
      return;
    }
    expiryTimer = setTimeout(expireAdmin, ms + 20);
    expiryInterval = setInterval(function () {
      if (!isAdminActive()) expireAdmin();
    }, 500);
  }

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement("div");
    toastEl.id = "encryption-admin-toast";
    toastEl.setAttribute("role", "status");
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

  function enableAdmin() {
    var cfg = getConfig();
    if (!cfg.enabled) return;
    var ttl = (cfg.admin_ttl_secs || 3600) * 1000;
    sessionStorage.setItem(STORAGE_KEY, String(Date.now() + ttl));
    syncAdminUi();
    startExpiryWatch();
    showToast("你已经是管理员，可浏览所有加密博客啦");
    window.dispatchEvent(new CustomEvent("encryption-admin-enabled"));
  }

  function refreshAdminState() {
    if (!getConfig().enabled) {
      sessionStorage.removeItem(STORAGE_KEY);
      stopExpiryWatch();
      syncAdminUi();
      return false;
    }
    if (!isAdminActive()) {
      stopExpiryWatch();
      syncAdminUi();
      return false;
    }
    syncAdminUi();
    startExpiryWatch();
    return true;
  }

  function onTargetClick(e) {
    if (!getConfig().enabled) return;

    if (isAdminActive()) {
      hideToast();
      return;
    }

    clicks += 1;
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(function () {
      clicks = 0;
      hideToast();
    }, CLICK_RESET_MS);

    if (clicks >= CLICK_TARGET) {
      clicks = 0;
      e.preventDefault();
      e.stopPropagation();
      enableAdmin();
      return;
    }

    if (clicks >= CLICK_HINT_FROM) {
      showToast("再点击 " + (CLICK_TARGET - clicks) + " 次可进入管理员模式");
    }
  }

  function bind() {
    var el = document.getElementById("site-sidebar-header");
    if (!el) return;
    el.addEventListener("click", onTargetClick, true);
  }

  function init() {
    refreshAdminState();
    bind();
    if (document.getElementById("encrypted-article")) {
      document.documentElement.classList.add("encryption-protected-page");
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshAdminState();
    });
  }

  window.EncryptionAdmin = {
    isAdminActive: isAdminActive,
    enableAdmin: enableAdmin,
    refresh: refreshAdminState,
    syncAdminUi: syncAdminUi,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
