/**
 * Visitor "lucky refresh" decrypt: after 9–20 page loads per article (session), allow decrypt once.
 */
(function (root) {
  "use strict";

  var PREFIX = "blog-encryption-visitor:";

  function getConfig() {
    return root.__ENCRYPTION_CONFIG__ || {};
  }

  function pageState(pageKey) {
    var raw = sessionStorage.getItem(PREFIX + pageKey);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function saveState(pageKey, state) {
    sessionStorage.setItem(PREFIX + pageKey, JSON.stringify(state));
  }

  function randomTarget(cfg) {
    var min = cfg.visitor_refresh_min || 9;
    var max = cfg.visitor_refresh_max || 20;
    if (max < min) max = min;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  function recordRefresh(pageKey) {
    var cfg = getConfig();
    var state = pageState(pageKey);
    if (!state) {
      state = { views: 0, target: randomTarget(cfg), unlocked: false };
    }
    if (!state.unlocked) {
      state.views += 1;
      if (state.views >= state.target) {
        state.unlocked = true;
      }
      saveState(pageKey, state);
    }
    return state;
  }

  function isVisitorUnlocked(pageKey) {
    if (!getConfig().enabled) return false;
    var state = pageState(pageKey);
    if (!state) {
      state = recordRefresh(pageKey);
    }
    return !!state.unlocked;
  }

  root.EncryptionVisitor = {
    recordRefresh: recordRefresh,
    isUnlocked: isVisitorUnlocked,
    resetPage: function (pageKey) {
      sessionStorage.removeItem(PREFIX + pageKey);
    },
  };
})(typeof self !== "undefined" ? self : this);
