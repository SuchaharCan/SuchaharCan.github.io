/**
 * Kanban Markdown ↔ Board rule engine.
 * See content/kanban/kanban-mapping.md for syntax reference.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KanbanRules = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LABEL_COLORS = {
    red: "#EB5A46",
    orange: "#FF9F1A",
    yellow: "#F2D600",
    green: "#61BD4F",
    blue: "#0079BF",
    purple: "#C377E0",
    pink: "#FF78CB",
    sky: "#00C2E0",
    lime: "#51E898",
    black: "#344563",
  };

  // Trello-like board background presets (used by detail page + GUI editor).
  var BOARD_BG_PRESETS = {
    sky: "linear-gradient(135deg, #0079bf 0%, #00c2e0 100%)",
    ocean: "linear-gradient(135deg, #026aa7 0%, #00b8d4 100%)",
    green: "linear-gradient(135deg, #4caf50 0%, #8bc34a 100%)",
    lime: "linear-gradient(135deg, #7cb342 0%, #aed581 100%)",
    orange: "linear-gradient(135deg, #ef6c00 0%, #ffa000 100%)",
    purple: "linear-gradient(135deg, #7e57c2 0%, #b388ff 100%)",
    pink: "linear-gradient(135deg, #d81b60 0%, #f06292 100%)",
    red: "linear-gradient(135deg, #c62828 0%, #ef5350 100%)",
    navy: "linear-gradient(135deg, #283593 0%, #5c6bc0 100%)",
    slate: "linear-gradient(135deg, #37474f 0%, #607d8b 100%)",
    dark: "linear-gradient(135deg, #172b4d 0%, #42526e 100%)",
    paper: "linear-gradient(135deg, #f7f9fc 0%, #e4eaf0 100%)",
  };

  var FM_BLOCK_RE = /^\+\+\+\n([\s\S]*?)\n\+\+\+\n/;

  function stripFrontMatter(raw) {
    var m = raw.match(FM_BLOCK_RE);
    if (m) return { frontMatter: m[1], body: raw.slice(m[0].length) };
    var m2 = raw.match(/^---\n([\s\S]*?)\n---\n/);
    if (m2) return { frontMatter: m2[1], body: raw.slice(m2[0].length) };
    return { frontMatter: "", body: raw };
  }

  function parseFrontMatter(fmText) {
    var meta = { extra: {} };
    if (!fmText) return meta;

    var lines = fmText.split("\n");
    var section = null;
    var inStats = false;
    var statsBuf = "";

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (line.trim() === "[extra]") {
        section = "extra";
        continue;
      }
      if (section === "extra" && /^\s*\w+\s*=/.test(line) && !line.trim().startsWith("stats")) {
        var ev = parseExtraValue(line);
        if (ev) {
          if (ev.key === "importance") meta.extra.importance = parseInt(ev.value, 10) || 3;
          else if (ev.key === "favorite") meta.extra.favorite = /^(true|1)$/i.test(ev.value);
          else meta.extra[ev.key] = ev.value;
        }
        continue;
      }
      if (/^\s*stats\s*=\s*\{/.test(line)) {
        inStats = true;
        statsBuf = line.replace(/^\s*stats\s*=\s*/, "");
        if (statsBuf.indexOf("}") >= 0) {
          inStats = false;
          meta.extra.stats = parseStatsObject(statsBuf);
          statsBuf = "";
        }
        continue;
      }
      if (inStats) {
        statsBuf += line;
        if (statsBuf.indexOf("}") >= 0) {
          inStats = false;
          meta.extra.stats = parseStatsObject(statsBuf);
          statsBuf = "";
        }
        continue;
      }
      if (section !== "extra") {
        var m = line.match(/^(\w+)\s*=\s*"?([^"]*)"?/);
        if (m) meta[m[1]] = m[2];
      }
    }
    return meta;
  }

  function parseStatsObject(str) {
    var stats = {};
    var re = /(\w+)\s*=\s*(\d+)/g;
    var m;
    while ((m = re.exec(str))) stats[m[1]] = parseInt(m[2], 10);
    return stats;
  }

  function parseExtraValue(line) {
    var m = line.match(/^\s*(\w+)\s*=\s*"?([^"]*)"?/);
    return m ? { key: m[1], value: m[2] } : null;
  }

  function resolveColor(value) {
    if (!value) return null;
    var v = value.trim().toLowerCase();
    if (v.charAt(0) === "#") return v;
    return LABEL_COLORS[v] || v;
  }

  function parseDirective(line) {
    var t = line.trim();
    var due = t.match(/^@due\s+(\S+)/i);
    if (due) return { type: "due", value: due[1] };

    var labels = t.match(/^@labels?\s+(.+)/i);
    if (labels) {
      return {
        type: "labels",
        value: labels[1].split(/[,，]/).map(function (s) {
          return s.trim();
        }).filter(Boolean),
      };
    }

    var bg = t.match(/^@bg\s+(\S+)/i);
    if (bg) return { type: "bg", value: bg[1] };

    var top = t.match(/^@top\s+(\S+)/i);
    if (top) return { type: "top", value: top[1] };

    var start = t.match(/^@start\s+(\S+)/i);
    if (start) return { type: "start", value: start[1] };

    var priority = t.match(/^@(?:priority|importance)\s+(\d)/i);
    if (priority) return { type: "priority", value: parseInt(priority[1], 10) };

    var done = t.match(/^@(?:done|complete|completed)\b/i);
    if (done) return { type: "done", value: true };

    var pin = t.match(/^@(?:pin|pinned|置顶)\b/i);
    if (pin) return { type: "pin", value: true };

    var cover = t.match(/^@cover\s+(half|full)/i);
    if (cover) return { type: "cover", value: cover[1].toLowerCase() };

    var colSort = t.match(/^@sort\s+(manual|due|priority|title|checklist)/i);
    if (colSort) return { type: "colsort", value: colSort[1].toLowerCase() };

    var colSortOrder = t.match(/^@sort-order\s+(asc|desc)/i);
    if (colSortOrder) return { type: "colsortorder", value: colSortOrder[1].toLowerCase() };

    var goal = t.match(/^@goal\s+(complete|done|success|risk|fail|consequence|未完成)/i);
    if (goal) {
      var g = goal[1].toLowerCase();
      var isRisk = g === "risk" || g === "fail" || g === "consequence" || g === "未完成";
      return { type: "goal", value: isRisk ? "risk" : "complete" };
    }

    return null;
  }

  function parseCheckbox(line) {
    var m = line.match(/^-\s*\[([ xX])\]\s*(.*)/);
    if (!m) return null;
    return { checked: m[1].toLowerCase() === "x", text: m[2].trim() };
  }

  function columnKind(title) {
    var t = (title || "").toLowerCase();
    if (/资源|resource/i.test(t)) return "resource";
    if (/目标|goal/i.test(t)) return "goal";
    if (/进度|progress|timeline/i.test(t)) return "progress";
    if (/完成|done/i.test(t)) return "done";
    if (/待办|todo|to-do/i.test(t)) return "todo";
    if (/进行|doing|progress/i.test(t)) return "doing";
    return "other";
  }

  function isProgressColumn(kind) {
    return kind === "todo" || kind === "doing" || kind === "done";
  }

  function labelWeight(card) {
    var n = card.labels && card.labels.length ? card.labels.length : 0;
    return Math.max(n, 1);
  }

  function cardProgressContribution(kind, card) {
    var w = labelWeight(card);
    if (kind === "todo") return -10 * w;
    if (kind === "doing") return 5 * w;
    if (kind === "done") return 15 * w;
    return 0;
  }

  function computeProgress(board) {
    var sum = 50;
    board.columns.forEach(function (col) {
      var kind = columnKind(col.title);
      if (!isProgressColumn(kind)) return;
      col.cards.forEach(function (card) {
        sum += cardProgressContribution(kind, card);
      });
    });
    return Math.max(0, Math.min(100, Math.round(sum)));
  }

  function slugify(text) {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
  }

  function parseMarkdown(raw) {
    var split = stripFrontMatter(raw);
    var meta = parseFrontMatter(split.frontMatter);
    var lines = split.body.replace(/\r\n/g, "\n").split("\n");
    var board = { meta: meta, columns: [] };
    var currentColumn = null;
    var currentCard = null;
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];
      var h1 = line.match(/^#\s+(.+)/);
      if (h1) {
        currentColumn = {
          id: slugify(h1[1]) || "col-" + board.columns.length,
          title: h1[1].trim(),
          kind: columnKind(h1[1].trim()),
          sort: "manual",
          sortOrder: "asc",
          cards: [],
        };
        board.columns.push(currentColumn);
        currentCard = null;
        i++;
        continue;
      }

      var h2 = line.match(/^##\s*(.*)/);
      if (h2 && currentColumn) {
        currentCard = {
          id: slugify(h2[1]) || "card-" + currentColumn.cards.length,
          title: h2[1].trim(),
          start: null,
          due: null,
          priority: null,
          goalType: null,
          labels: [],
          bg: null,
          top: null,
          cover: null,
          done: false,
          pinned: false,
          checkboxes: [],
          description: "",
        };
        currentColumn.cards.push(currentCard);
        i++;
        continue;
      }

      if (currentCard) {
        var dir = parseDirective(line);
        if (dir) {
          if (dir.type === "due") currentCard.due = dir.value;
          if (dir.type === "start") currentCard.start = dir.value;
          if (dir.type === "priority") currentCard.priority = Math.max(1, Math.min(5, dir.value));
          if (dir.type === "goal") currentCard.goalType = dir.value;
          if (dir.type === "labels") currentCard.labels = dir.value;
          if (dir.type === "bg") currentCard.bg = dir.value;
          if (dir.type === "top") currentCard.top = dir.value;
          if (dir.type === "done") currentCard.done = true;
          if (dir.type === "pin") currentCard.pinned = true;
          if (dir.type === "cover") currentCard.cover = dir.value;
          i++;
          continue;
        }
        var cb = parseCheckbox(line);
        if (cb) {
          currentCard.checkboxes.push(cb);
          i++;
          continue;
        }
        if (line.trim() === "" && !currentCard.description) {
          i++;
          continue;
        }
        currentCard.description += (currentCard.description ? "\n" : "") + line;
        i++;
        continue;
      }

      if (currentColumn) {
        var cdir = parseDirective(line);
        if (cdir && (cdir.type === "colsort" || cdir.type === "colsortorder")) {
          if (cdir.type === "colsort") currentColumn.sort = cdir.value;
          if (cdir.type === "colsortorder") currentColumn.sortOrder = cdir.value;
          i++;
          continue;
        }
        // 列级勾选项：没有卡片标题时自动兜底一张「未命名卡片」，
        // 避免 `- [ ]` 清单在界面上被静默丢弃。
        var colCb = parseCheckbox(line);
        if (colCb) {
          if (!currentCard) {
            currentCard = {
              id: "card-" + currentColumn.cards.length,
              title: "未命名卡片",
              start: null,
              due: null,
              priority: null,
              goalType: null,
              labels: [],
              bg: null,
              top: null,
              cover: null,
              done: false,
              pinned: false,
              checkboxes: [],
              description: "",
            };
            currentColumn.cards.push(currentCard);
          }
          currentCard.checkboxes.push(colCb);
          i++;
          continue;
        }
      }

      i++;
    }

    board.stats = computeStats(board);
    board.progress = computeProgress(board);
    return board;
  }

  function computeStats(board) {
    var total = 0;
    var done = 0;
    var todo = 0;
    var doing = 0;
    board.columns.forEach(function (col) {
      var kind = col.kind || columnKind(col.title);
      if (!isProgressColumn(kind)) return;
      col.cards.forEach(function () {
        total++;
        if (kind === "done") done++;
        else if (kind === "todo") todo++;
        else if (kind === "doing") doing++;
      });
    });
    return {
      total: total,
      done: done,
      todo: todo,
      doing: doing,
      progress_pct: computeProgress(board),
    };
  }

  function serializeCard(card) {
    var out = ["## " + card.title];
    if (card.start) out.push("@start " + card.start);
    if (card.due) out.push("@due " + card.due);
    if (card.priority) out.push("@priority " + card.priority);
    if (card.goalType) out.push("@goal " + (card.goalType === "risk" ? "risk" : "complete"));
    if (card.labels && card.labels.length) out.push("@labels " + card.labels.join(", "));
    if (card.bg) out.push("@bg " + card.bg);
    if (card.top) out.push("@top " + card.top);
    if (card.cover) out.push("@cover " + card.cover);
    if (card.done) out.push("@done");
    if (card.pinned) out.push("@pin");
    out.push("");
    if (card.checkboxes && card.checkboxes.length) {
      card.checkboxes.forEach(function (cb) {
        out.push("- [" + (cb.checked ? "x" : " ") + "] " + cb.text);
      });
      out.push("");
    }
    if (card.description && card.description.trim()) {
      out.push(card.description.trim());
    }
    return out.join("\n");
  }

  function serializeMarkdown(board, originalRaw) {
    var split = stripFrontMatter(originalRaw || "");
    var meta = board.meta || parseFrontMatter(split.frontMatter);

    meta.extra = meta.extra || {};
    meta.extra.stats = computeStats(board);

    var fmLines = ["+++"];
    if (meta.title) fmLines.push('title = "' + meta.title + '"');
    if (meta.description) fmLines.push('description = "' + meta.description + '"');
    if (meta.date) fmLines.push("date = " + meta.date);
    fmLines.push('template = "kanban.html"');
    fmLines.push("[extra]");
    if (meta.extra.week_start) fmLines.push('week_start = "' + meta.extra.week_start + '"');
    if (meta.extra.week_end) fmLines.push('week_end = "' + meta.extra.week_end + '"');
    if (meta.extra.period) fmLines.push('period = "' + meta.extra.period + '"');
    if (meta.extra.core_tasks) fmLines.push('core_tasks = "' + meta.extra.core_tasks + '"');
    if (meta.extra.importance) fmLines.push("importance = " + meta.extra.importance);
    if (meta.extra.board_bg) fmLines.push('board_bg = "' + meta.extra.board_bg + '"');
    if (meta.extra.favorite) fmLines.push("favorite = true");
    var s = meta.extra.stats;
    fmLines.push(
      "stats = { total = " +
        s.total +
        ", done = " +
        s.done +
        ", todo = " +
        s.todo +
        ", doing = " +
        s.doing +
        ", progress_pct = " +
        (s.progress_pct != null ? s.progress_pct : computeProgress(board)) +
        " }",
    );
    fmLines.push("+++");
    fmLines.push("");

    var body = [];
    board.columns.forEach(function (col) {
      body.push("# " + col.title);
      if (col.sort && col.sort !== "manual") body.push("@sort " + col.sort);
      if (col.sortOrder === "desc") body.push("@sort-order desc");
      body.push("");
      col.cards.forEach(function (card) {
        body.push(serializeCard(card));
        body.push("");
      });
    });

    return fmLines.join("\n") + "\n" + body.join("\n").trim() + "\n";
  }

  function listProgressClass(stats) {
    if (!stats || !stats.total) return "kanban-progress-none";
    if (stats.todo > 3) return "kanban-progress-low";
    if (stats.done === stats.total && stats.total > 0) return "kanban-progress-complete";
    var pct = stats.progress_pct != null ? stats.progress_pct : 0;
    if (pct >= 100) return "kanban-progress-complete";
    return "kanban-progress-partial";
  }

  function listProgressStyle(stats) {
    if (!stats || !stats.total) return {};
    var pct = stats.progress_pct != null ? stats.progress_pct : 0;
    if (stats.done === stats.total) return { "--kanban-progress": "100%" };
    return { "--kanban-progress": pct + "%" };
  }

  var EDIT_CUTOFF_HOUR = 23;

  function toUtcDay(dateStr) {
    if (!dateStr) return NaN;
    var p = dateStr.split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function clockInTimezone(tz) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    var map = {};
    parts.forEach(function (p) {
      if (p.type !== "literal") map[p.type] = p.value;
    });
    return {
      date: map.year + "-" + map.month + "-" + map.day,
      hour: parseInt(map.hour, 10),
    };
  }

  function isPastEditDeadline(end, tz, cutoffHour) {
    if (!end || !tz) return true;
    var hourLimit = cutoffHour == null ? EDIT_CUTOFF_HOUR : cutoffHour;
    var c = clockInTimezone(tz);
    if (c.date > end) return true;
    if (c.date === end && c.hour >= hourLimit) return true;
    return false;
  }

  function isEditableWindow(start, end, tz, cutoffHour) {
    if (!start || !end || !tz) return false;
    var c = clockInTimezone(tz);
    if (c.date < start) return false;
    return !isPastEditDeadline(end, tz, cutoffHour);
  }

  function daysRemainingLabel(start, end, tz, cutoffHour) {
    if (!end || !tz) return { text: "—", kind: "unknown" };
    var c = clockInTimezone(tz);
    if (start && c.date < start) {
      var untilStart = Math.round((toUtcDay(start) - toUtcDay(c.date)) / 86400000);
      return { text: untilStart + " 天后开始", kind: "before" };
    }
    if (isPastEditDeadline(end, tz, cutoffHour)) {
      var overdue = Math.round((toUtcDay(c.date) - toUtcDay(end)) / 86400000);
      if (overdue <= 0) return { text: "已截止", kind: "expired" };
      return { text: "已超期 " + overdue + " 天", kind: "expired" };
    }
    if (c.date === end) return { text: "今天", kind: "today" };
    var left = Math.round((toUtcDay(end) - toUtcDay(c.date)) / 86400000);
    return { text: left + " 天", kind: "remaining" };
  }

  function daySpan(start, end) {
    if (!start || !end) return 7;
    return Math.max(1, Math.round((toUtcDay(end) - toUtcDay(start)) / 86400000) + 1);
  }

  function checklistStats(card) {
    var items = (card && card.checkboxes) || [];
    var done = 0;
    items.forEach(function (cb) {
      if (cb && cb.checked) done++;
    });
    return {
      total: items.length,
      done: done,
      pct: items.length ? Math.round((done / items.length) * 100) : 0,
    };
  }

  function dueState(card, tz) {
    if (!card || !card.due) return null;
    if (card.done) return "complete";
    var c = clockInTimezone(tz || "Asia/Shanghai");
    var diff = Math.round((toUtcDay(card.due) - toUtcDay(c.date)) / 86400000);
    if (diff < 0) return diff <= -2 ? "overdue-old" : "overdue";
    if (diff === 0) return "soon";
    return "upcoming";
  }

  function sortCards(cards, key, order) {
    var arr = (cards || []).slice();
    if (!key || key === "manual") {
      var pinnedFirst = arr.filter(function (c) {
        return !!c.pinned;
      });
      var rest = arr.filter(function (c) {
        return !c.pinned;
      });
      return pinnedFirst.concat(rest);
    }
    var dir = order === "desc" ? -1 : 1;
    arr.sort(function (a, b) {
      // Pinned cards float to the top within the same list (Trello-style).
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      var va, vb;
      if (key === "due") {
        va = a.due || "9999-99-99";
        vb = b.due || "9999-99-99";
      } else if (key === "priority") {
        va = a.priority || 0;
        vb = b.priority || 0;
      } else if (key === "title") {
        va = String(a.title || "");
        vb = String(b.title || "");
        return va.localeCompare(vb, "zh") * dir;
      } else if (key === "checklist") {
        va = checklistStats(a).pct;
        vb = checklistStats(b).pct;
      } else {
        return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
    return arr;
  }

  function resolveBoardBg(value) {
    if (!value) return "";
    var v = String(value).trim();
    var low = v.toLowerCase();
    if (BOARD_BG_PRESETS[low]) return BOARD_BG_PRESETS[low];
    if (v.charAt(0) === "#") return v;
    if (/^(linear|radial)-gradient\(/i.test(v)) return v;
    return v;
  }

  function applyListCardMetrics(card, doc) {
    var root = (doc && doc.documentElement) || document.documentElement;
    var bodyMin =
      parseFloat(getComputedStyle(root).getPropertyValue("--kanban-week-body-min")) || 88;
    var weekSpan =
      parseFloat(getComputedStyle(root).getPropertyValue("--kanban-week-span-height")) || 280;
    var start = card.dataset.weekStart;
    var end = card.dataset.weekEnd || start;
    var days = Math.min(14, Math.max(1, daySpan(start, end)));
    var bodyHeight = bodyMin + (weekSpan * days) / 7;
    var metaScale = 0.85 + (days / 7) * 0.35;
    card.style.setProperty("--kanban-card-body-height", bodyHeight + "px");
    card.style.setProperty("--kanban-span-days", String(days));
    card.style.setProperty("--kanban-meta-scale", metaScale.toFixed(3));
  }

  return {
    LABEL_COLORS: LABEL_COLORS,
    BOARD_BG_PRESETS: BOARD_BG_PRESETS,
    EDIT_CUTOFF_HOUR: EDIT_CUTOFF_HOUR,
    parseMarkdown: parseMarkdown,
    serializeMarkdown: serializeMarkdown,
    computeStats: computeStats,
    computeProgress: computeProgress,
    columnKind: columnKind,
    isProgressColumn: isProgressColumn,
    labelWeight: labelWeight,
    resolveColor: resolveColor,
    listProgressClass: listProgressClass,
    listProgressStyle: listProgressStyle,
    clockInTimezone: clockInTimezone,
    isPastEditDeadline: isPastEditDeadline,
    isEditableWindow: isEditableWindow,
    daysRemainingLabel: daysRemainingLabel,
    daySpan: daySpan,
    checklistStats: checklistStats,
    dueState: dueState,
    sortCards: sortCards,
    resolveBoardBg: resolveBoardBg,
    applyListCardMetrics: applyListCardMetrics,
  };
});
