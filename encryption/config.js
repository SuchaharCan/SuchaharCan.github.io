/**
 * Load site encryption config from <textarea id="encryption-site-config"> (CSP-safe).
 */
(function () {
  "use strict";

  function loadConfig() {
    if (window.__ENCRYPTION_CONFIG__) return window.__ENCRYPTION_CONFIG__;
    var el = document.getElementById("encryption-site-config");
    if (!el || !el.value.trim()) {
      window.__ENCRYPTION_CONFIG__ = { enabled: false };
      return window.__ENCRYPTION_CONFIG__;
    }
    try {
      window.__ENCRYPTION_CONFIG__ = JSON.parse(el.value);
    } catch (_) {
      window.__ENCRYPTION_CONFIG__ = { enabled: false };
    }
    return window.__ENCRYPTION_CONFIG__;
  }

  loadConfig();
})();
