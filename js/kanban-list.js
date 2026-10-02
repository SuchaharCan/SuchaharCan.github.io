(function () {
  "use strict";

  var TZ = "Asia/Shanghai";

  function siteTimezone() {
    var list = document.getElementById("kanban-week-list");
    return (list && list.dataset.timezone) || TZ;
  }

  function updateDaysLeft(el) {
    var start = el.dataset.start;
    var end = el.dataset.end;
    if (typeof KanbanRules !== "undefined" && KanbanRules.daysRemainingLabel) {
      var label = KanbanRules.daysRemainingLabel(start, end, siteTimezone());
      el.textContent = label.text;
      return;
    }
    el.textContent = "—";
  }

  function applyProgress(card, board) {
    if (!board || !board.stats) return;
    var stats = board.stats;
    var pct =
      stats.progress_pct != null && !isNaN(stats.progress_pct)
        ? stats.progress_pct
        : KanbanRules.computeProgress(board);
    if (typeof pct !== "number" || isNaN(pct)) return;

    var pctEl = card.querySelector(".kanban-progress-pct");
    var fallback = pctEl && pctEl.dataset.fallback ? parseInt(pctEl.dataset.fallback, 10) : null;
    if (pct === 0 && fallback > 0 && board.columns && !board.columns.length) return;
    if (pct === 0 && fallback > 0 && stats.total === 0) {
      pct = fallback;
    }

    var cls = KanbanRules.listProgressClass(stats);
    card.classList.remove(
      "kanban-progress-none",
      "kanban-progress-low",
      "kanban-progress-partial",
      "kanban-progress-complete",
    );
    card.classList.add(cls);
    card.style.setProperty("--kanban-progress", pct + "%");
    if (pctEl) pctEl.textContent = pct + "%";
  }

  function applySpanHeight(card) {
    if (typeof KanbanRules !== "undefined" && KanbanRules.applyListCardMetrics) {
      KanbanRules.applyListCardMetrics(card);
      return;
    }
  }

  function initCard(card) {
    applySpanHeight(card);
    var daysEl = card.querySelector(".kanban-days-left");
    if (daysEl) {
      if (!daysEl.dataset.end && card.dataset.weekEnd) daysEl.dataset.end = card.dataset.weekEnd;
      if (!daysEl.dataset.start && card.dataset.weekStart) daysEl.dataset.start = card.dataset.weekStart;
      updateDaysLeft(daysEl);
    }
  }

  function loadCardMarkdown(card) {
    var rawEl = card.querySelector(".kanban-raw-source");
    if (rawEl && rawEl.value) {
      return Promise.resolve(rawEl.value);
    }
    var url = card.dataset.rawUrl;
    if (!url) return Promise.resolve(null);
    return fetch(url)
      .then(function (r) {
        return r.ok ? r.text() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function init() {
    document.querySelectorAll(".kanban-week-card").forEach(function (card) {
      initCard(card);

      if (typeof KanbanRules === "undefined") return;

      loadCardMarkdown(card).then(function (text) {
        if (!text) return;
        var board = KanbanRules.parseMarkdown(text);
        if (!board.columns || !board.columns.length) return;
        applyProgress(card, board);
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
