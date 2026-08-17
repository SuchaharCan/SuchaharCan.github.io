/**
 * Kanban GUI editor — create / modify boards with dropdowns and manual inputs.
 *
 * Layout (Trello-style): left = live board canvas, right = inspector panel.
 * Select a column / card on the canvas (or via inspector list) to edit it.
 *
 * Workflow:
 *   1. Open "新建看板" (list page) or "GUI 编辑" (detail page / week card).
 *   2. Set front matter / columns / cards through the inspector.
 *   3. Generate Markdown via KanbanRules.serializeMarkdown(), copy it to the
 *      clipboard automatically, and show the create-vs-modify follow-up flow
 *      (Codeberg editor → ReDeplog → refresh).
 *   4. Optional: with a saved kanbanToken, sync the file straight to the repo.
 */
(function () {
  "use strict";

  var rootEl = null;
  var formEl = null;
  var canvasEl = null;
  var panelEl = null;
  var previewEl = null;
  var resultEl = null;
  var modeEl = null;
  var slugEl = null;
  var state = null;
  var selection = null;
  var sourceUrl = "";
  var replogUrl = "";
  var existingSlugs = {};
  var lastGenerated = "";

  function uid() {
    return (
      "kb" +
      Math.random().toString(36).slice(2, 9) +
      Date.now().toString(36).slice(-4)
    );
  }

  function presetColors() {
    if (typeof KanbanRules !== "undefined" && KanbanRules.LABEL_COLORS) {
      return KanbanRules.LABEL_COLORS;
    }
    return {
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
  }

  var LOWER_PRESETS = null;
  function lowerPresetMap() {
    if (LOWER_PRESETS) return LOWER_PRESETS;
    LOWER_PRESETS = {};
    Object.keys(presetColors()).forEach(function (k) {
      LOWER_PRESETS[k.toLowerCase()] = true;
    });
    return LOWER_PRESETS;
  }

  function isPreset(value) {
    if (!value) return false;
    var v = String(value).trim().toLowerCase();
    if (v.charAt(0) === "#") return false;
    return !!lowerPresetMap()[v];
  }

  function isCustomColorValue(value) {
    return !!value && !isPreset(value);
  }

  function resolveColorValue(value) {
    if (typeof KanbanRules !== "undefined" && KanbanRules.resolveColor) {
      return KanbanRules.resolveColor(value);
    }
    return value;
  }

  function fmtDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function addDays(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  function addDaysToDate(dateStr, n) {
    var p = String(dateStr || "").split("-").map(Number);
    if (p.length !== 3 || p.some(isNaN)) return "";
    return fmtDate(addDays(new Date(p[0], p[1] - 1, p[2]), n));
  }

  function autoPeriod(d) {
    var h = d.getHours();
    if (h >= 5 && h < 12) return "上午";
    if (h >= 12 && h < 18) return "下午";
    return "晚上";
  }

  // 单日 + 时段 → YYYY-MM-DD_上午；否则保持 YYYY-MM-DD，保证文件唯一性
  function buildSlug() {
    if (!state || !state.weekStart) return "";
    var oneDay =
      daySpan(state.weekStart, state.weekEnd || state.weekStart) === 1;
    return state.period && oneDay
      ? state.weekStart + "_" + state.period
      : state.weekStart;
  }

  function startOfWeek(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = x.getDay() || 7; // Mon=1 … Sun=7
    x.setDate(x.getDate() - (day - 1));
    return x;
  }

  function daySpan(start, end) {
    if (typeof KanbanRules !== "undefined" && KanbanRules.daySpan) {
      return KanbanRules.daySpan(start, end);
    }
    if (!start || !end) return 7;
    var a = start.split("-").map(Number);
    var b = end.split("-").map(Number);
    return (
      Math.max(
        1,
        Math.round(
          (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) /
            86400000,
        ) + 1,
      )
    );
  }

  function makeColumn(title) {
    return {
      id: uid(),
      title: title || "",
      sort: "manual",
      sortOrder: "asc",
      cards: [],
    };
  }

  function makeCard() {
    return {
      id: uid(),
      title: "",
      start: "",
      due: "",
      priority: 0,
      goalType: "",
      labels: [],
      bg: "",
      top: "",
      cover: "",
      done: false,
      pinned: false,
      checkboxes: [],
      description: "",
    };
  }

  var WEEKDAY_CN = ["日", "一", "二", "三", "四", "五", "六"];

  function weekdayLabel(dateStr) {
    var p = String(dateStr || "").split("-").map(Number);
    if (p.length !== 3 || p.some(isNaN)) return "";
    return "周" + WEEKDAY_CN[new Date(p[0], p[1] - 1, p[2]).getDay()];
  }

  function dayCardsBetween(start, end) {
    var out = [];
    var cur = new Date(start + "T00:00:00");
    var endDate = new Date(end + "T00:00:00");
    if (isNaN(cur.getTime()) || isNaN(endDate.getTime()) || endDate < cur) return out;
    while (cur <= endDate) {
      var d = fmtDate(cur);
      out.push({
        id: uid(),
        title: d.slice(5) + " " + weekdayLabel(d),
        start: "",
        due: "",
        priority: 0,
        goalType: "",
        labels: [],
        bg: "",
        top: "",
        cover: "",
        done: false,
        pinned: false,
        checkboxes: [{ checked: false, text: "记录当日完成内容" }],
        description: "",
      });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  function isAutoDayCard(card) {
    return /^\d{2}-\d{2} 周[一二三四五六日]$/.test(String(card.title || ""));
  }

  function defaultState() {
    var today = new Date();
    var ws = fmtDate(today);
    var we = ws;
    var period = autoPeriod(today);
    return {
      mode: "create",
      originalSlug: "",
      weekStart: ws,
      weekEnd: we,
      period: period,
      coreTasks: "",
      importance: "3",
      title:
        ws +
        (we !== ws ? " – " + we : "") +
        (period ? " " + period : "") +
        " 计划",
      description: "",
      boardBg: "",
      favorite: false,
      columns: [
        makeColumn("待办"),
        makeColumn("进行中"),
        makeColumn("已完成"),
        Object.assign(makeColumn("进度"), { cards: dayCardsBetween(ws, we) }),
        makeColumn("资源"),
        makeColumn("目标"),
      ],
    };
  }

  function boardToState(board) {
    var meta = board.meta || {};
    var extra = meta.extra || {};
    return {
      mode: "modify",
      originalSlug: extra.week_start || "",
      weekStart: extra.week_start || "",
      weekEnd: extra.week_end || "",
      period: extra.period || "",
      coreTasks: extra.core_tasks || "",
      importance: String(extra.importance || 3),
      title: meta.title || "",
      description: meta.description || "",
      boardBg: extra.board_bg || "",
      favorite: !!extra.favorite,
      columns: board.columns.map(function (col) {
        return {
          id: uid(),
          title: col.title || "",
          sort: col.sort || "manual",
          sortOrder: col.sortOrder || "asc",
          cards: col.cards.map(function (c) {
            return {
              id: uid(),
              title: c.title || "",
              start: c.start || "",
              due: c.due || "",
              priority: c.priority || 0,
              goalType: c.goalType || "",
              labels: (c.labels || []).slice(),
              bg: c.bg || "",
              top: c.top || "",
              cover: c.cover || "",
              done: !!c.done,
              pinned: !!c.pinned,
              checkboxes: (c.checkboxes || []).map(function (cb) {
                return { checked: !!cb.checked, text: cb.text || "" };
              }),
              description: c.description || "",
            };
          }),
        };
      }),
    };
  }

  function stateToBoard() {
    var title =
      state.title ||
      (state.weekStart +
        (state.weekEnd !== state.weekStart ? " – " + state.weekEnd : "") +
        (state.period ? " " + state.period : "") +
        " 计划");
    return {
      meta: {
        title: title,
        description: state.description || undefined,
        date: state.weekStart || undefined,
        extra: {
          week_start: state.weekStart,
          week_end: state.weekEnd,
          period:
            state.period &&
            daySpan(state.weekStart, state.weekEnd) === 1
              ? state.period
              : undefined,
          core_tasks: state.coreTasks || undefined,
          importance: state.importance ? parseInt(state.importance, 10) : undefined,
          board_bg: state.boardBg || undefined,
          favorite: state.favorite || undefined,
        },
      },
      columns: state.columns.map(function (col) {
        return {
          id: col.id,
          title: col.title || "",
          sort: col.sort || "manual",
          sortOrder: col.sortOrder || "asc",
          cards: col.cards.map(function (c) {
            return {
              id: c.id,
              title: c.title || "",
              start: c.start || null,
              due: c.due || null,
              priority: c.priority ? parseInt(c.priority, 10) : null,
              goalType: c.goalType || null,
              labels: c.labels || [],
              bg: c.bg || null,
              top: c.top || null,
              cover: c.cover || null,
              done: !!c.done,
              pinned: !!c.pinned,
              checkboxes: c.checkboxes || [],
              description: c.description || "",
            };
          }),
        };
      }),
    };
  }

  function buildMarkdown() {
    if (typeof KanbanRules === "undefined" || !KanbanRules.serializeMarkdown) {
      return "";
    }
    return KanbanRules.serializeMarkdown(stateToBoard(), null);
  }

  function operationKind() {
    if (!state) return "create";
    var slug = buildSlug();
    if (existingSlugs[slug]) return "modify";
    if (state.originalSlug && state.originalSlug === slug) return "modify";
    return "create";
  }

  function validate() {
    var errors = [];
    var wsRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!wsRe.test(state.weekStart)) errors.push("周开始日期无效");
    if (!wsRe.test(state.weekEnd)) errors.push("周结束日期无效");
    if (wsRe.test(state.weekStart) && wsRe.test(state.weekEnd)) {
      if (state.weekEnd < state.weekStart) errors.push("周结束不能早于周开始");
      else {
        var span = daySpan(state.weekStart, state.weekEnd);
        if (span > 14) errors.push("看板跨度不能超过 14 天（当前 " + span + " 天）");
      }
    }
    if (!state.columns.length) errors.push("至少需要一列");
    var wsRe2 = /^\d{4}-\d{2}-\d{2}$/;
    var hasTopLevel = wsRe2.test(state.weekStart) && wsRe2.test(state.weekEnd);
    state.columns.forEach(function (col, ci) {
      if (!String(col.title || "").trim()) {
        errors.push("第 " + (ci + 1) + " 列缺少列名");
      }
      col.cards.forEach(function (card, ri) {
        var cardName =
          "「" +
          (col.title || "列 " + (ci + 1)) +
          " / " +
          (card.title || "第 " + (ri + 1) + " 张卡片") +
          "」";
        if (!String(card.title || "").trim()) {
          errors.push(cardName + " 缺少标题");
        }
        if (hasTopLevel) {
          if (card.start && wsRe2.test(card.start) && card.start < state.weekStart) {
            errors.push(cardName + " 开始日期早于看板起始 " + state.weekStart);
          }
          if (card.start && wsRe2.test(card.start) && card.start > state.weekEnd) {
            errors.push(cardName + " 开始日期晚于看板截止 " + state.weekEnd);
          }
          if (card.due && wsRe2.test(card.due) && card.due < state.weekStart) {
            errors.push(cardName + " 截止日期早于看板起始 " + state.weekStart);
          }
          if (card.due && wsRe2.test(card.due) && card.due > state.weekEnd) {
            errors.push(cardName + " 截止日期晚于看板截止 " + state.weekEnd);
          }
        }
      });
    });
    return errors;
  }

  /* ------------------------------ DOM builders ------------------------------ */

  function labelSpan(text) {
    var span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  function fieldWrap(labelText, control, extraClass) {
    var label = document.createElement("label");
    label.className =
      "kanban-editor-field" + (extraClass ? " " + extraClass : "");
    label.appendChild(labelSpan(labelText));
    label.appendChild(control);
    return label;
  }

  function makeInput(type, cls, value, fieldName, placeholder) {
    var el = document.createElement("input");
    el.type = type;
    el.className = cls || "kanban-editor-input";
    el.value = value || "";
    if (fieldName) el.dataset.field = fieldName;
    if (placeholder) el.placeholder = placeholder;
    return el;
  }

  function makeSelect(value, options, fieldName) {
    var el = document.createElement("select");
    el.className = "kanban-editor-input";
    el.dataset.field = fieldName;
    options.forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt[0];
      o.textContent = opt[1];
      el.appendChild(o);
    });
    el.value = value || "";
    return el;
  }

  function priorityOptions() {
    return [
      ["0", "无"],
      ["1", "★ 1"],
      ["2", "★★ 2"],
      ["3", "★★★ 3"],
      ["4", "★★★★ 4"],
      ["5", "★★★★★ 5"],
    ];
  }

  function goalOptions() {
    return [
      ["", "无"],
      ["complete", "complete · 完成效果（淡蓝）"],
      ["risk", "risk · 未完成后果（灰爆）"],
    ];
  }

  function colorOptions() {
    var opts = [["", "无"]];
    Object.keys(presetColors()).forEach(function (name) {
      opts.push([name, name]);
    });
    opts.push(["__custom__", "自定义…"]);
    return opts;
  }

  function buildCheckboxRow(cb, ci, ri, bi) {
    var row = document.createElement("div");
    row.className = "kanban-editor-check-row";
    row.dataset.cbIdx = bi;

    var toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.className = "kanban-editor-check-toggle";
    toggle.checked = !!cb.checked;
    toggle.dataset.field = "cardCbChecked";

    var text = makeInput(
      "text",
      "kanban-editor-input kanban-editor-input--sm",
      cb.text,
      "cardCbText",
      "勾选项内容",
    );

    var del = document.createElement("button");
    del.type = "button";
    del.className = "kanban-editor-btn kanban-editor-btn--danger-sm";
    del.dataset.action = "remove-checkbox";
    del.dataset.colIdx = ci;
    del.dataset.cardIdx = ri;
    del.textContent = "✕";
    del.title = "删除勾选项";

    row.appendChild(toggle);
    row.appendChild(text);
    row.appendChild(del);
    return row;
  }

  function syncLabels(card, chips, customInput) {
    var low = lowerPresetMap();
    var customTokens = customInput.value
      .split(/[,，]/)
      .map(function (s) {
        return s.trim();
      })
      .filter(Boolean)
      .filter(function (t) {
        return !low[t.toLowerCase()];
      });
    var merged = {};
    Array.prototype.forEach.call(chips, function (cb) {
      if (cb.checked) merged[cb.value] = true;
    });
    customTokens.forEach(function (t) {
      merged[t] = true;
    });
    card.labels = Object.keys(merged);
    Array.prototype.forEach.call(chips, function (cb) {
      cb.checked = card.labels.indexOf(cb.value) >= 0;
    });
    customInput.value = card.labels
      .filter(function (t) {
        return !low[t.toLowerCase()];
      })
      .join(", ");
  }

  function toggleColorCustom(select) {
    var customField =
      select.dataset.field === "cardBg" ? "cardBgCustom" : "cardTopCustom";
    var wrap = select.closest(".kanban-editor-field");
    var customInput =
      wrap && wrap.querySelector('[data-field="' + customField + '"]');
    if (customInput) customInput.hidden = select.value !== "__custom__";
  }

  /* ------------------------------ canvas & inspector ------------------------------ */

  /* ------------------------------ canvas card drag ------------------------------ */

  function setupCanvasCardDrag() {
    var session = null;

    function onDown(e) {
      if (e.button !== 0) return;
      var cardEl = e.target.closest(".kanban-editor-canvas-card");
      if (!cardEl) return;
      e.preventDefault();
      session = {
        cardEl: cardEl,
        colIdx: parseInt(cardEl.dataset.colIdx, 10),
        cardIdx: parseInt(cardEl.dataset.cardIdx, 10),
        moved: false,
        ghost: null,
        startX: e.clientX,
        startY: e.clientY,
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }

    function onMove(e) {
      if (!session) return;
      if (!session.moved) {
        if (
          Math.abs(e.clientX - session.startX) +
            Math.abs(e.clientY - session.startY) <
          6
        ) {
          return;
        }
        session.moved = true;
        var titleEl = session.cardEl.querySelector(
          ".kanban-editor-canvas-card-title",
        );
        session.ghost = document.createElement("div");
        session.ghost.className = "kanban-drag-ghost";
        session.ghost.textContent = titleEl ? titleEl.textContent : "";
        document.body.appendChild(session.ghost);
        if (canvasEl) canvasEl.classList.add("is-dragging-cards");
      }
      if (session.ghost) {
        session.ghost.style.left = e.clientX + 12 + "px";
        session.ghost.style.top = e.clientY + 12 + "px";
      }
      if (!canvasEl) return;
      canvasEl.querySelectorAll(".kanban-editor-canvas-col.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      var colEl = e.target.closest(".kanban-editor-canvas-col");
      if (colEl) colEl.classList.add("drag-over");
    }

    function onUp(e) {
      if (!session) return;
      if (session.moved) {
        var srcCol = state.columns[session.colIdx];
        var card = srcCol && srcCol.cards[session.cardIdx];
        if (card) {
          var targetColEl = e.target.closest(".kanban-editor-canvas-col");
          var targetCardEl = e.target.closest(".kanban-editor-canvas-card");
          var toColIdx = targetColEl
            ? parseInt(targetColEl.dataset.colIdx, 10)
            : null;
          if (toColIdx != null && state.columns[toColIdx]) {
            srcCol.cards.splice(session.cardIdx, 1);
            var toCards = state.columns[toColIdx].cards;
            var insertAt = toCards.length;
            if (targetCardEl) {
              var ti = parseInt(targetCardEl.dataset.cardIdx, 10);
              if (toColIdx === session.colIdx && ti > session.cardIdx) ti -= 1;
              if (!isNaN(ti)) insertAt = Math.max(0, Math.min(toCards.length, ti));
            }
            toCards.splice(insertAt, 0, card);
            selection = { type: "card", colIdx: toColIdx, cardIdx: insertAt };
            renderAll();
          }
        }
      }
      if (session.ghost) session.ghost.remove();
      if (canvasEl) {
        canvasEl.classList.remove("is-dragging-cards");
        canvasEl.querySelectorAll(".kanban-editor-canvas-col.drag-over").forEach(function (el) {
          el.classList.remove("drag-over");
        });
      }
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      session = null;
    }

    if (canvasEl) canvasEl.addEventListener("mousedown", onDown);
  }

  function coverOptions() {
    return [
      ["", "默认（半封面）"],
      ["half", "half · 半封面"],
      ["full", "full · 全封面"],
    ];
  }

  function isLightColor(color) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(color || "").trim());
    if (!m) return false;
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    return 0.299 * r + 0.587 * g + 0.114 * b > 186;
  }

  function canvasCardEl(card, rules, onPinToggle) {
    var el = document.createElement("article");
    el.className = "kanban-editor-canvas-card";
    if (card.pinned) el.classList.add("is-pinned");
    if (card.bg) {
      el.classList.add("has-cover");
      var coverColor = rules.resolveColor(card.bg);
      el.style.setProperty("--kanban-cover-color", coverColor);
      if (card.cover === "full") {
        el.classList.add("cover-full");
        if (isLightColor(coverColor)) el.classList.add("cover-text-dark");
      } else {
        el.classList.add("cover-half");
      }
    }
    if (card.top) {
      el.classList.add("has-top");
      el.style.setProperty("--kanban-top-color", rules.resolveColor(card.top));
    }
    if (card.done) el.classList.add("is-done");
    var pin = document.createElement("button");
    pin.type = "button";
    pin.className =
      "kanban-editor-canvas-card-pin" + (card.pinned ? " is-active" : "");
    pin.textContent = "📌";
    pin.title = card.pinned ? "解除置顶" : "置顶此卡片";
    pin.addEventListener("click", function (e) {
      e.stopPropagation();
      if (onPinToggle) onPinToggle();
    });
    el.appendChild(pin);
    if (card.labels && card.labels.length) {
      var labels = document.createElement("div");
      labels.className = "kanban-editor-canvas-labels";
      card.labels.forEach(function (name) {
        var s = document.createElement("span");
        s.className = "kanban-editor-canvas-label";
        s.style.background = rules.resolveColor(name);
        labels.appendChild(s);
      });
      el.appendChild(labels);
    }
    var t = document.createElement("span");
    t.className = "kanban-editor-canvas-card-title";
    t.textContent = card.title || "（未命名卡片）";
    el.appendChild(t);
    var badges = [];
    if (card.start) badges.push("📅" + String(card.start).slice(5));
    if (card.due) badges.push("🕒" + String(card.due).slice(5));
    if (card.checkboxes && card.checkboxes.length) {
      var cs = rules.checklistStats(card);
      badges.push("☑" + cs.done + "/" + cs.total);
    }
    if (card.priority) badges.push("★" + card.priority);
    if (badges.length) {
      var b = document.createElement("div");
      b.className = "kanban-editor-canvas-card-badges";
      b.textContent = badges.join(" · ");
      el.appendChild(b);
    }
    return el;
  }

  function renderCanvas() {
    if (!canvasEl || !state) return;
    canvasEl.innerHTML = "";
    var rules = typeof KanbanRules !== "undefined" ? KanbanRules : null;
    var bg = rules && rules.resolveBoardBg ? rules.resolveBoardBg(state.boardBg) : "";
    canvasEl.style.background = bg || "linear-gradient(135deg,#f7f9fc,#dbe3ea)";
    canvasEl.classList.toggle("has-board-bg", !!bg);

    var mainRow = document.createElement("div");
    mainRow.className = "kanban-editor-canvas-row";
    var bottomRow = document.createElement("div");
    bottomRow.className = "kanban-editor-canvas-row kanban-editor-canvas-row--bottom";
    var hasBottom = false;

    state.columns.forEach(function (col, ci) {
      var colEl = document.createElement("div");
      colEl.className = "kanban-editor-canvas-col";
      colEl.dataset.colIdx = ci;
      if (selection && selection.type === "col" && selection.idx === ci) {
        colEl.classList.add("is-selected");
      }

      var head = document.createElement("div");
      head.className = "kanban-editor-canvas-col-head";
      head.textContent = (col.title || "未命名列") + " · " + col.cards.length;
      head.title = "点击编辑列表";
      head.addEventListener("click", function () {
        selectCol(ci);
      });
      colEl.appendChild(head);

      var cards = document.createElement("div");
      cards.className = "kanban-editor-canvas-cards";
      col.cards.forEach(function (card, ri) {
        var cardEl = canvasCardEl(card, rules, function () {
          card.pinned = !card.pinned;
          renderAll();
        });
        cardEl.dataset.colIdx = ci;
        cardEl.dataset.cardIdx = ri;
        if (
          selection &&
          selection.type === "card" &&
          selection.colIdx === ci &&
          selection.cardIdx === ri
        ) {
          cardEl.classList.add("is-selected");
        }
        cardEl.addEventListener("click", function () {
          selectCard(ci, ri);
        });
        cards.appendChild(cardEl);
      });
      colEl.appendChild(cards);

      var addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "kanban-editor-canvas-add";
      addBtn.textContent = "＋ 添加卡片";
      addBtn.addEventListener("click", function () {
        addCardTo(ci);
      });
      colEl.appendChild(addBtn);
      var kind = typeof rules !== "undefined" && rules.columnKind
        ? rules.columnKind(col.title)
        : "";
      if (kind === "resource" || kind === "goal") {
        bottomRow.appendChild(colEl);
        hasBottom = true;
      } else {
        mainRow.appendChild(colEl);
      }
    });

    var addCol = document.createElement("button");
    addCol.type = "button";
    addCol.className = "kanban-editor-canvas-addcol";
    addCol.textContent = "＋ 添加列表";
    addCol.addEventListener("click", function () {
      addColumn("");
    });
    mainRow.appendChild(addCol);

    canvasEl.appendChild(mainRow);
    if (hasBottom) canvasEl.appendChild(bottomRow);
  }

  function actionBtn(label, fn, danger) {
    var b = document.createElement("button");
    b.type = "button";
    b.className =
      "kanban-editor-btn" +
      (danger ? " kanban-editor-btn--danger-sm" : " kanban-editor-btn--ghost-sm");
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }

  function buildBoardPanel() {
    var grid = document.createElement("div");
    grid.className = "kanban-editor-grid";
    var wsInput = makeInput("date", "kanban-editor-input", state.weekStart, "weekStart");
    wsInput.max = state.weekEnd || "";
    if (state.mode === "modify") {
      wsInput.disabled = true;
      wsInput.title = "修改已有看板时，开始时间不可编辑";
    }
    var weInput = makeInput("date", "kanban-editor-input", state.weekEnd, "weekEnd");
    weInput.min = state.weekStart || "";
    weInput.max = addDaysToDate(state.weekStart, 13);
    grid.appendChild(
      fieldWrap(
        state.mode === "modify" ? "周开始（修改时锁定）" : "周开始（= 文件名）",
        wsInput,
      ),
    );
    grid.appendChild(
      fieldWrap(
        "周结束",
        weInput,
      ),
    );
    var periodSelect = makeSelect(
      state.period || "",
      [
        ["", "无"],
        ["上午", "上午"],
        ["下午", "下午"],
        ["晚上", "晚上"],
      ],
      "period",
    );
    if (state.mode === "modify") {
      periodSelect.disabled = true;
      periodSelect.title = "修改已有看板时，时段不可编辑";
    }
    grid.appendChild(
      fieldWrap(
        "时段 period（仅单天看板用于文件名唯一）",
        periodSelect,
      ),
    );
    grid.appendChild(
      fieldWrap(
        "重要等级（1–5 星）",
        makeSelect(
          state.importance || "3",
          [
            ["1", "★ 1"],
            ["2", "★★ 2"],
            ["3", "★★★ 3"],
            ["4", "★★★★ 4"],
            ["5", "★★★★★ 5"],
          ],
          "importance",
        ),
      ),
    );
    grid.appendChild(
      fieldWrap(
        "核心任务 core_tasks（列表页标题）",
        makeInput("text", "kanban-editor-input", state.coreTasks, "coreTasks", "本周核心任务一句话"),
        "kanban-editor-field--wide",
      ),
    );
    grid.appendChild(
      fieldWrap(
        "页面标题 title（可选）",
        makeInput("text", "kanban-editor-input", state.title, "title", "如 7.13 – 7.19 周计划"),
        "kanban-editor-field--wide",
      ),
    );
    grid.appendChild(
      fieldWrap(
        "页面描述 description（可选）",
        makeInput("text", "kanban-editor-input", state.description, "description", "一句话描述本周计划"),
        "kanban-editor-field--wide",
      ),
    );

    var bgWrap = document.createElement("div");
    bgWrap.className = "kanban-editor-field kanban-editor-field--wide";
    bgWrap.appendChild(labelSpan("看板背景 board_bg（Trello 风格）"));
    var swatches = document.createElement("div");
    swatches.className = "kanban-editor-bg-swatches";
    function addSw(key, label, bgStyle) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kanban-editor-bg-swatch";
      b.style.background = bgStyle;
      b.title = label;
      b.setAttribute("aria-label", label);
      if ((state.boardBg || "") === key) b.classList.add("is-active");
      b.addEventListener("click", function () {
        state.boardBg = key;
        renderCanvas();
        renderInspector();
        refreshPreview();
        syncModeLabel();
      });
      swatches.appendChild(b);
    }
    addSw("", "默认", "linear-gradient(135deg,#f7f9fc,#dbe3ea)");
    if (typeof KanbanRules !== "undefined" && KanbanRules.BOARD_BG_PRESETS) {
      Object.keys(KanbanRules.BOARD_BG_PRESETS).forEach(function (key) {
        addSw(key, key, KanbanRules.BOARD_BG_PRESETS[key]);
      });
    }
    bgWrap.appendChild(swatches);
    var bgCustom = makeInput(
      "text",
      "kanban-editor-input kanban-editor-input--sm",
      isCustomColorValue(state.boardBg) ? state.boardBg : "",
      "boardBgCustom",
      "自定义：#RRGGBB 或 gradient(...)",
    );
    bgCustom.hidden = !isCustomColorValue(state.boardBg);
    bgWrap.appendChild(bgCustom);
    grid.appendChild(bgWrap);

    var favWrap = document.createElement("div");
    favWrap.className = "kanban-editor-field";
    favWrap.appendChild(labelSpan("收藏此看板 favorite"));
    var fav = document.createElement("input");
    fav.type = "checkbox";
    fav.className = "kanban-editor-check-toggle";
    fav.dataset.field = "favorite";
    fav.checked = !!state.favorite;
    favWrap.appendChild(fav);
    grid.appendChild(favWrap);
    return grid;
  }

  function buildColumnPanel(col, ci) {
    var el = document.createElement("div");
    el.className = "kanban-editor-panel-block";

    var head = document.createElement("h3");
    head.textContent = "列表 " + (ci + 1) + " · " + (col.title || "未命名");
    el.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "kanban-editor-grid";
    grid.appendChild(
      fieldWrap(
        "列名",
        makeInput("text", "kanban-editor-input", col.title, "colTitle", "待办 / 进行中 / 已完成 / 资源 / 目标"),
      ),
    );
    grid.appendChild(
      fieldWrap(
        "排序 @sort",
        makeSelect(
          col.sort || "manual",
          [
            ["manual", "手动"],
            ["due", "截止日期"],
            ["priority", "优先级"],
            ["title", "标题"],
            ["checklist", "清单进度"],
          ],
          "colSort",
        ),
      ),
    );
    grid.appendChild(
      fieldWrap(
        "方向 @sort-order",
        makeSelect(
          col.sortOrder || "asc",
          [
            ["asc", "升序 ↑"],
            ["desc", "降序 ↓"],
          ],
          "colSortOrder",
        ),
      ),
    );
    el.appendChild(grid);

    var actions = document.createElement("div");
    actions.className = "kanban-editor-panel-actions";
    actions.appendChild(
      actionBtn(card.pinned ? "解除置顶" : "置顶", function () {
        card.pinned = !card.pinned;
        renderAll();
      }),
    );
    actions.appendChild(
      actionBtn("＋ 添加卡片", function () {
        addCardTo(ci);
      }),
    );
    actions.appendChild(
      actionBtn("上移", function () {
        moveColumn(ci, -1);
      }),
    );
    actions.appendChild(
      actionBtn("下移", function () {
        moveColumn(ci, 1);
      }),
    );
    actions.appendChild(
      actionBtn("删除列", function () {
        deleteColumn(ci);
      }, true),
    );
    el.appendChild(actions);

    var listHead = document.createElement("div");
    listHead.className = "kanban-editor-panel-sublabel";
    listHead.textContent = "卡片（点击选择编辑）";
    el.appendChild(listHead);
    var list = document.createElement("div");
    list.className = "kanban-editor-panel-cardlist";
    col.cards.forEach(function (card, ri) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "kanban-editor-panel-cardrow";
      if (
        selection &&
        selection.type === "card" &&
        selection.colIdx === ci &&
        selection.cardIdx === ri
      ) {
        row.classList.add("is-selected");
      }
      row.textContent = (card.title || "（未命名卡片）") + (card.done ? " ✓" : "");
      row.addEventListener("click", function () {
        selectCard(ci, ri);
      });
      var del = document.createElement("span");
      del.className = "kanban-editor-panel-cardrow-del";
      del.textContent = "✕";
      del.title = "删除卡片";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        deleteCard(ci, ri);
      });
      row.appendChild(del);
      list.appendChild(row);
    });
    el.appendChild(list);
    return el;
  }

  function buildCardPanel(col, card, ci, ri) {
    var el = document.createElement("div");
    el.className = "kanban-editor-panel-block";
    var head = document.createElement("h3");
    head.textContent = "卡片 · " + (card.title || "未命名");
    el.appendChild(head);

    var grid = document.createElement("div");
    grid.className = "kanban-editor-grid";

    grid.appendChild(
      fieldWrap(
        "卡片标题",
        makeInput("text", "kanban-editor-input", card.title, "cardTitle", "卡片标题"),
        "kanban-editor-field--wide",
      ),
    );
    var startInput = makeInput("date", "kanban-editor-input", card.start, "cardStart");
    startInput.min = state.weekStart || "";
    startInput.max = state.weekEnd || "";
    var dueInput = makeInput("date", "kanban-editor-input", card.due, "cardDue");
    dueInput.min = state.weekStart || "";
    dueInput.max = state.weekEnd || "";
    grid.appendChild(fieldWrap("开始日期 @start", startInput));
    grid.appendChild(fieldWrap("截止日期 @due", dueInput));
    grid.appendChild(
      fieldWrap(
        "重要等级 @priority",
        makeSelect(String(card.priority || 0), priorityOptions(), "cardPriority"),
      ),
    );
    grid.appendChild(
      fieldWrap(
        "目标类型 @goal",
        makeSelect(card.goalType || "", goalOptions(), "cardGoal"),
      ),
    );

    var bgRow = document.createElement("div");
    bgRow.className = "kanban-editor-color-row";
    bgRow.appendChild(makeSelect(card.bg, colorOptions(), "cardBg"));
    var bgSwatch = document.createElement("span");
    bgSwatch.className = "kanban-editor-dot kanban-editor-swatch";
    bgSwatch.dataset.swatchFor = "cardBg";
    bgRow.appendChild(bgSwatch);
    var bgWrap = fieldWrap("背景封面色 @bg（Trello 封面）", bgRow);
    var bgCustom = makeInput(
      "text",
      "kanban-editor-input kanban-editor-input--sm",
      isCustomColorValue(card.bg) ? card.bg : "",
      "cardBgCustom",
      "#RRGGBB 或颜色名",
    );
    bgCustom.hidden = !isCustomColorValue(card.bg);
    bgWrap.appendChild(bgCustom);
    grid.appendChild(bgWrap);

    grid.appendChild(
      fieldWrap("封面尺寸 @cover", makeSelect(card.cover || "", coverOptions(), "cardCover")),
    );

    var topRow = document.createElement("div");
    topRow.className = "kanban-editor-color-row";
    topRow.appendChild(makeSelect(card.top, colorOptions(), "cardTop"));
    var topSwatch = document.createElement("span");
    topSwatch.className = "kanban-editor-dot kanban-editor-swatch";
    topSwatch.dataset.swatchFor = "cardTop";
    topRow.appendChild(topSwatch);
    var topWrap = fieldWrap("顶栏色 @top", topRow);
    var topCustom = makeInput(
      "text",
      "kanban-editor-input kanban-editor-input--sm",
      isCustomColorValue(card.top) ? card.top : "",
      "cardTopCustom",
      "#RRGGBB 或颜色名",
    );
    topCustom.hidden = !isCustomColorValue(card.top);
    topWrap.appendChild(topCustom);
    grid.appendChild(topWrap);

    var labelsWrap = document.createElement("div");
    labelsWrap.className = "kanban-editor-field kanban-editor-field--wide";
    labelsWrap.appendChild(labelSpan("颜色标签 @labels（可多选 / 手输自定义）"));
    var chips = document.createElement("div");
    chips.className = "kanban-editor-chips";
    Object.keys(presetColors()).forEach(function (name) {
      var label = document.createElement("label");
      label.className = "kanban-editor-chip";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = name;
      cb.dataset.field = "cardLabel";
      cb.checked = (card.labels || []).indexOf(name) >= 0;
      var dot = document.createElement("span");
      dot.className = "kanban-editor-dot";
      dot.style.backgroundColor = presetColors()[name];
      label.appendChild(cb);
      label.appendChild(dot);
      label.appendChild(document.createTextNode(name));
      chips.appendChild(label);
    });
    labelsWrap.appendChild(chips);
    var labelsCustom = makeInput(
      "text",
      "kanban-editor-input kanban-editor-input--sm",
      (card.labels || [])
        .filter(function (l) {
          return !isPreset(l);
        })
        .join(", "),
      "cardLabelsCustom",
      "自定义标签：逗号分隔，如 #FFE0B2, 橙色",
    );
    labelsWrap.appendChild(labelsCustom);
    grid.appendChild(labelsWrap);

    var doneWrap = document.createElement("div");
    doneWrap.className = "kanban-editor-field";
    doneWrap.appendChild(labelSpan("标记完成 @done"));
    var done = document.createElement("input");
    done.type = "checkbox";
    done.className = "kanban-editor-check-toggle";
    done.dataset.field = "cardDone";
    done.checked = !!card.done;
    doneWrap.appendChild(done);
    grid.appendChild(doneWrap);

    var cbWrap = document.createElement("div");
    cbWrap.className = "kanban-editor-field kanban-editor-field--wide";
    cbWrap.appendChild(labelSpan("勾选清单 checklist"));
    var listEl = document.createElement("div");
    listEl.className = "kanban-editor-check-list";
    card.checkboxes.forEach(function (cb, bi) {
      listEl.appendChild(buildCheckboxRow(cb, ci, ri, bi));
    });
    cbWrap.appendChild(listEl);
    var addCb = document.createElement("button");
    addCb.type = "button";
    addCb.className = "kanban-editor-btn kanban-editor-btn--ghost-sm";
    addCb.dataset.action = "add-checkbox";
    addCb.dataset.colIdx = ci;
    addCb.dataset.cardIdx = ri;
    addCb.textContent = "＋ 添加勾选项";
    cbWrap.appendChild(addCb);
    grid.appendChild(cbWrap);

    var descWrap = document.createElement("div");
    descWrap.className = "kanban-editor-field kanban-editor-field--wide";
    descWrap.appendChild(labelSpan("描述正文（其余 Markdown）"));
    var desc = document.createElement("textarea");
    desc.className = "kanban-editor-input kanban-editor-textarea";
    desc.rows = 4;
    desc.dataset.field = "cardDesc";
    desc.placeholder = "卡片描述：段落 / 列表 / 加粗等";
    desc.value = card.description || "";
    descWrap.appendChild(desc);
    grid.appendChild(descWrap);

    el.appendChild(grid);

    var actions = document.createElement("div");
    actions.className = "kanban-editor-panel-actions";
    actions.appendChild(
      actionBtn("上移", function () {
        moveCard(ci, ri, -1);
      }),
    );
    actions.appendChild(
      actionBtn("下移", function () {
        moveCard(ci, ri, 1);
      }),
    );
    actions.appendChild(
      actionBtn("删除卡片", function () {
        deleteCard(ci, ri);
      }, true),
    );
    el.appendChild(actions);
    return el;
  }

  function selectBoard() {
    selection = { type: "board" };
    renderInspector();
    renderCanvas();
  }

  function selectCol(idx) {
    if (!state.columns[idx]) return;
    selection = { type: "col", idx: idx };
    renderInspector();
    renderCanvas();
  }

  function selectCard(colIdx, cardIdx) {
    var col = state.columns[colIdx];
    if (!col || !col.cards[cardIdx]) return;
    selection = { type: "card", colIdx: colIdx, cardIdx: cardIdx };
    renderInspector();
    renderCanvas();
  }

  function addColumn(title) {
    state.columns.push(makeColumn(title || ""));
    selection = { type: "col", idx: state.columns.length - 1 };
    renderAll();
  }

  function addCardTo(ci) {
    if (!state.columns[ci]) return;
    var card = makeCard();
    // 卡片开始/截止默认按创建时间（今日）填充，并夹取到看板时间区间内
    var d = fmtDate(new Date());
    if (state.weekStart && state.weekEnd) {
      if (d < state.weekStart) d = state.weekStart;
      if (d > state.weekEnd) d = state.weekEnd;
    }
    card.start = d;
    card.due = d;
    state.columns[ci].cards.push(card);
    selection = {
      type: "card",
      colIdx: ci,
      cardIdx: state.columns[ci].cards.length - 1,
    };
    renderAll();
  }

  function deleteColumn(ci) {
    var col = state.columns[ci];
    if (!col) return;
    if (
      col.cards.length &&
      !window.confirm(
        "确定删除该列及其中的 " + col.cards.length + " 张卡片？",
      )
    ) {
      return;
    }
    state.columns.splice(ci, 1);
    selection = { type: "board" };
    renderAll();
  }

  function deleteCard(ci, ri) {
    var col = state.columns[ci];
    if (!col || !col.cards[ri]) return;
    col.cards.splice(ri, 1);
    selection = { type: "col", idx: ci };
    renderAll();
  }

  function moveColumn(ci, delta) {
    var to = ci + delta;
    if (to < 0 || to >= state.columns.length) return;
    var col = state.columns.splice(ci, 1)[0];
    state.columns.splice(to, 0, col);
    selection = { type: "col", idx: to };
    renderAll();
  }

  function moveCard(ci, ri, delta) {
    var col = state.columns[ci];
    if (!col) return;
    var to = ri + delta;
    if (to < 0 || to >= col.cards.length) return;
    var card = col.cards.splice(ri, 1)[0];
    col.cards.splice(to, 0, card);
    selection = { type: "card", colIdx: ci, cardIdx: to };
    renderAll();
  }

  function renderInspector() {
    if (!panelEl || !state) return;
    panelEl.innerHTML = "";
    var inner = document.createElement("div");
    inner.className = "kanban-editor-panel-inner";
    var hint = document.createElement("p");
    hint.className = "kanban-editor-panel-hint";
    hint.textContent =
      !selection || selection.type === "board"
        ? "看板信息 · 点击左侧列或卡片进入编辑"
        : selection.type === "col"
          ? "列表设置 · 点击左侧卡片可编辑卡片"
          : "卡片设置 · 所有字段以 下拉 / 手输 方式生成";
    inner.appendChild(hint);
    if (!selection || selection.type === "board") {
      inner.appendChild(buildBoardPanel());
    } else if (selection.type === "col") {
      inner.appendChild(buildColumnPanel(state.columns[selection.idx], selection.idx));
    } else if (selection.type === "card") {
      var col = state.columns[selection.colIdx];
      var card = col && col.cards[selection.cardIdx];
      if (card) {
        inner.appendChild(buildCardPanel(col, card, selection.colIdx, selection.cardIdx));
      } else {
        selection = { type: "board" };
        inner.appendChild(buildBoardPanel());
      }
    }
    panelEl.appendChild(inner);
  }

  function renderAll() {
    renderCanvas();
    renderInspector();
    syncModeLabel();
    refreshPreview();
  }

  function buildForm() {
    renderAll();
  }

  /* ------------------------------ state updates ------------------------------ */

  function resolveTarget(target) {
    var col = null;
    var card = null;
    var cb = null;
    if (!selection) return { col: col, card: card, cb: cb };
    if (selection.type === "col") {
      col = state.columns[selection.idx];
    } else if (selection.type === "card") {
      col = state.columns[selection.colIdx];
      card = col && col.cards[selection.cardIdx];
      var cbRow =
        target && target.closest ? target.closest("[data-cb-idx]") : null;
      var cbIdx =
        (target && target.dataset && target.dataset.cbIdx) ||
        (cbRow && cbRow.dataset.cbIdx);
      if (card && cbIdx != null) cb = card.checkboxes[parseInt(cbIdx, 10)];
    }
    return { col: col, card: card, cb: cb };
  }

  function applyInspectorField(target) {
    if (!target || !target.dataset || !target.dataset.field) return;
    var field = target.dataset.field;
    var ref = resolveTarget(target);
    var col = ref.col;
    var card = ref.card;
    var cb = ref.cb;

    switch (field) {
      case "weekStart":
        state.weekStart = target.value;
        break;
      case "weekEnd":
        state.weekEnd = target.value;
        break;
      case "period":
        state.period = target.value;
        break;
      case "importance":
        state.importance = target.value;
        break;
      case "coreTasks":
        state.coreTasks = target.value;
        break;
      case "title":
        state.title = target.value;
        break;
      case "description":
        state.description = target.value;
        break;
      case "favorite":
        state.favorite = target.checked;
        break;
      case "boardBgCustom":
        state.boardBg = target.value;
        break;
      case "colTitle":
        if (col) col.title = target.value;
        break;
      case "colSort":
        if (col) col.sort = target.value;
        break;
      case "colSortOrder":
        if (col) col.sortOrder = target.value;
        break;
      case "cardTitle":
        if (card) card.title = target.value;
        break;
      case "cardStart":
        if (card) card.start = target.value;
        break;
      case "cardDue":
        if (card) card.due = target.value;
        break;
      case "cardPriority":
        if (card) card.priority = target.value ? parseInt(target.value, 10) : 0;
        break;
      case "cardGoal":
        if (card) card.goalType = target.value;
        break;
      case "cardLabel":
      case "cardLabelsCustom":
        if (card && panelEl) {
          var chips = panelEl.querySelectorAll('[data-field="cardLabel"]');
          var custom = panelEl.querySelector(
            '[data-field="cardLabelsCustom"]',
          );
          if (chips.length && custom) syncLabels(card, chips, custom);
        }
        break;
      case "cardBg":
        if (card) {
          card.bg = target.value === "__custom__" ? "" : target.value;
          toggleColorCustom(target);
        }
        break;
      case "cardBgCustom":
        if (card) card.bg = target.value;
        break;
      case "cardCover":
        if (card) card.cover = target.value;
        break;
      case "cardTop":
        if (card) {
          card.top = target.value === "__custom__" ? "" : target.value;
          toggleColorCustom(target);
        }
        break;
      case "cardTopCustom":
        if (card) card.top = target.value;
        break;
      case "cardDone":
        if (card) card.done = target.checked;
        break;
      case "cardCbChecked":
        if (cb) cb.checked = target.checked;
        break;
      case "cardCbText":
        if (cb) cb.text = target.value;
        break;
      case "cardDesc":
        if (card) card.description = target.value;
        break;
    }
    if (field === "weekStart" || field === "weekEnd") {
      applyDateBounds();
      maybeRegenerateProgress();
    }
    renderCanvas();
    refreshSwatches();
    refreshPreview();
    syncModeLabel();
  }

  function applyDateBounds() {
    if (!panelEl) return;
    panelEl
      .querySelectorAll('input[type="date"][data-field]')
      .forEach(function (input) {
        var f = input.dataset.field;
        if (f === "weekStart") input.max = state.weekEnd || "";
        else if (f === "weekEnd") {
          input.min = state.weekStart || "";
          input.max = addDaysToDate(state.weekStart, 13);
        }
        else if (f === "cardStart" || f === "cardDue") {
          input.min = state.weekStart || "";
          input.max = state.weekEnd || "";
        }
      });
  }

  function maybeRegenerateProgress() {
    if (state.mode !== "create") return;
    var wsRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!wsRe.test(state.weekStart) || !wsRe.test(state.weekEnd)) return;
    state.columns.forEach(function (col) {
      if (String(col.title || "").trim() !== "进度") return;
      var cards = col.cards || [];
      if (!cards.length) return;
      var allAuto = cards.every(isAutoDayCard);
      if (!allAuto) return;
      col.cards = dayCardsBetween(state.weekStart, state.weekEnd);
    });
    if (selection && selection.type === "card") {
      var selCol = state.columns[selection.colIdx];
      if (!selCol || !selCol.cards[selection.cardIdx]) {
        selection = { type: "col", idx: selection.colIdx };
      }
    }
  }

  function refreshSwatches() {
    if (!rootEl) return;
    rootEl
      .querySelectorAll("[data-swatch-for]")
      .forEach(function (sw) {
        var field = sw.dataset.swatchFor;
        var select = rootEl.querySelector('[data-field="' + field + '"]');
        var custom = rootEl.querySelector(
          '[data-field="' + field + 'Custom"]',
        );
        var value = "";
        if (select && select.value === "__custom__" && custom) {
          value = custom.value;
        } else if (select) {
          value = select.value;
        }
        sw.style.backgroundColor = value
          ? resolveColorValue(value)
          : "transparent";
        sw.title = value || "无";
      });
  }

  function refreshPreview() {
    if (!previewEl) return;
    previewEl.value = buildMarkdown();
    refreshSwatches();
    syncModeLabel();
  }

  function syncModeLabel() {
    var slug = buildSlug() || "?";
    var kind = operationKind();
    var prefix = state.mode === "modify" ? "修改" : "新建";
    if (modeEl) modeEl.textContent = prefix;
    if (slugEl) {
      slugEl.textContent =
        "content/kanban/" +
        slug +
        ".md · " +
        (kind === "create" ? "将创建新文件" : "将覆盖已有文件");
    }
  }

  /* ------------------------------ clipboard & result ------------------------------ */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallbackCopy(text);
        },
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      var ta = document.getElementById("kanban-editor-preview");
      if (!ta) return false;
      ta.value = text;
      ta.focus();
      ta.select();
      return document.execCommand("copy");
    } catch (e) {
      return false;
    }
  }

  function resetResultLinks() {
    document.getElementById("kanban-editor-open-editor").hidden = false;
    document.getElementById("kanban-editor-open-redeploy").hidden = false;
    document.getElementById("kanban-editor-sync-repo").hidden = true;
    document.getElementById("kanban-editor-sync-repo").disabled = false;
    document.getElementById("kanban-editor-sync-repo").textContent =
      "用 Token 直接同步到仓库";
    document.getElementById("kanban-editor-result-note").textContent = "";
  }

  function showError(errors) {
    if (!resultEl) return;
    resultEl.hidden = false;
    document.getElementById("kanban-editor-result-icon").textContent = "⚠️";
    document.getElementById("kanban-editor-result-title").textContent =
      "无法生成，请先修正：";
    document.getElementById("kanban-editor-result-copy").textContent = "";
    var steps = document.getElementById("kanban-editor-result-steps");
    steps.innerHTML = "";
    errors.forEach(function (msg) {
      var li = document.createElement("li");
      li.textContent = msg;
      steps.appendChild(li);
    });
    document.getElementById("kanban-editor-open-editor").hidden = true;
    document.getElementById("kanban-editor-open-redeploy").hidden = true;
    document.getElementById("kanban-editor-sync-repo").hidden = true;
    document.getElementById("kanban-editor-result-note").textContent = "";
    resultEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showResult(kind) {
    if (!resultEl) return;
    var slug = buildSlug() || "?";
    var isCreate = kind === "create";
    resultEl.hidden = false;
    resetResultLinks();
    document.getElementById("kanban-editor-result-icon").textContent = isCreate
      ? "🆕"
      : "✏️";
    document.getElementById("kanban-editor-result-title").textContent = isCreate
      ? "新建看板 · Markdown 已复制到剪贴板"
      : "修改看板 · Markdown 已复制到剪贴板";
    document.getElementById("kanban-editor-result-copy").textContent =
      "目标文件：content/kanban/" +
      slug +
      ".md（" +
      (isCreate ? "创建新文件" : "覆盖已有文件") +
      "）";

    var steps = document.getElementById("kanban-editor-result-steps");
    steps.innerHTML = "";
    var lines = isCreate
      ? [
          "在 Codeberg 新建文件 content/kanban/" + slug + ".md（下方按钮会预填路径）",
          "在编辑器中粘贴（Ctrl / ⌘ + V）刚复制的内容",
          "保存并提交，例如 kanban: create week " + slug,
          "打开 ReDeplog 触发重新部署",
          "回到 /kanban/ 刷新，新看板出现在列表",
        ]
      : [
          "打开 Codeberg 中的 content/kanban/" + slug + ".md（下方按钮）",
          "全选（Ctrl / ⌘ + A）后粘贴替换原内容",
          "保存并提交，例如 kanban: update week " + slug,
          "打开 ReDeplog 触发重新部署",
          "回到 /kanban/ 刷新查看修改后的看板",
        ];
    lines.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      steps.appendChild(li);
    });

    var editorLink = document.getElementById("kanban-editor-open-editor");
    editorLink.href =
      sourceUrl +
      "/_edit/master/content/kanban/" +
      encodeURIComponent(slug) +
      ".md";
    var redeploy = document.getElementById("kanban-editor-open-redeploy");
    redeploy.href = replogUrl;
    redeploy.hidden = !replogUrl;

    var token = localStorage.getItem("kanbanToken");
    document.getElementById("kanban-editor-sync-repo").hidden = !token;
    resultEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function showCopyFeedback(ok) {
    if (!resultEl) return;
    resultEl.hidden = false;
    document.getElementById("kanban-editor-result-icon").textContent = ok
      ? "✅"
      : "⚠️";
    document.getElementById("kanban-editor-result-title").textContent = ok
      ? "已复制到剪贴板"
      : "复制失败";
    document.getElementById("kanban-editor-result-copy").textContent = ok
      ? "后续创建 / 修改流程请使用「生成并复制到剪贴板」查看指引。"
      : "请手动全选预览区内容复制。";
    var steps = document.getElementById("kanban-editor-result-steps");
    steps.innerHTML = "";
    var li = document.createElement("li");
    li.textContent = ok
      ? "打开 Codeberg 编辑器后粘贴即可保存。"
      : "预览区文本已就绪，手动 Ctrl / ⌘ + C 复制。";
    steps.appendChild(li);
    document.getElementById("kanban-editor-open-editor").hidden = true;
    document.getElementById("kanban-editor-open-redeploy").hidden = true;
    document.getElementById("kanban-editor-sync-repo").hidden = true;
    document.getElementById("kanban-editor-result-note").textContent = "";
  }

  function generateAndCopy() {
    var errors = validate();
    if (errors.length) {
      showError(errors);
      return;
    }
    lastGenerated = buildMarkdown();
    refreshPreview();
    copyText(lastGenerated).then(function (ok) {
      if (ok) {
        showResult(operationKind());
      } else {
        showError(["自动复制失败：请手动全选预览区的 Markdown 并复制"]);
      }
    });
  }

  /* ------------------------------ token repo sync ------------------------------ */

  function parseRepo(sourceUrl) {
    var u = new URL(sourceUrl);
    var parts = u.pathname.split("/").filter(Boolean);
    return { api: u.origin + "/api/v1", owner: parts[0], repo: parts[1] };
  }

  function putKanbanFile(repo, token, filename, content, message) {
    var path = "content/kanban/" + filename;
    var url =
      repo.api +
      "/repos/" +
      encodeURIComponent(repo.owner) +
      "/" +
      encodeURIComponent(repo.repo) +
      "/contents/" +
      encodeURIComponent(path).replace(/%2F/g, "/");

    return fetch(url + "?ref=master", {
      headers: { Authorization: "token " + token },
    })
      .then(function (r) {
        return r.json().then(function (data) {
          return { ok: r.ok, data: data };
        });
      })
      .then(function (res) {
        var body = {
          message: message,
          content: btoa(unescape(encodeURIComponent(content))),
          branch: "master",
        };
        if (res.ok && res.data && res.data.sha) {
          body.sha = res.data.sha;
        }
        return fetch(url, {
          method: res.ok ? "PUT" : "POST",
          headers: {
            Authorization: "token " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      })
      .then(function (r) {
        if (!r.ok) {
          return r.json().then(function (d) {
            throw new Error((d && d.message) || "HTTP " + r.status);
          });
        }
        return r.json();
      });
  }

  function syncToRepo() {
    var token = localStorage.getItem("kanbanToken");
    if (!token) {
      showError(["未找到 kanbanToken，请先保存 Token 或使用剪贴板流程"]);
      return;
    }
    if (!sourceUrl) {
      showError(["未配置 source_url，无法直接同步到仓库"]);
      return;
    }
    var errors = validate();
    if (errors.length) {
      showError(errors);
      return;
    }
    lastGenerated = buildMarkdown();
    var repo = parseRepo(sourceUrl);
    var slug = buildSlug();
    var kind = operationKind();
    var note = document.getElementById("kanban-editor-result-note");
    var syncBtn = document.getElementById("kanban-editor-sync-repo");
    syncBtn.disabled = true;
    note.textContent = "正在同步 content/kanban/" + slug + ".md …";
    putKanbanFile(
      repo,
      token,
      slug + ".md",
      lastGenerated,
      "kanban: " + (kind === "create" ? "create" : "update") + " week board",
    )
      .then(function () {
        note.textContent =
          "✓ 已同步到仓库 content/kanban/" +
          slug +
          ".md。下一步：打开 ReDeplog 部署。";
        syncBtn.disabled = false;
        syncBtn.textContent = "同步完成 ✓";
      })
      .catch(function (err) {
        note.textContent =
          "同步失败：" +
          (err && err.message ? err.message : "未知错误") +
          "，请改用剪贴板流程。";
        syncBtn.disabled = false;
      });
  }

  /* ------------------------------ open / close ------------------------------ */

  function openEditor(mode, raw, slug) {
    if (
      typeof KanbanRules === "undefined" ||
      !KanbanRules.parseMarkdown ||
      !KanbanRules.serializeMarkdown
    ) {
      window.alert("看板规则引擎未加载，请刷新页面后重试");
      return;
    }
    if (mode === "modify" && raw) {
      var board = KanbanRules.parseMarkdown(raw);
      if (!board || !board.columns) {
        window.alert("看板 Markdown 解析失败，无法进入编辑");
        return;
      }
      state = boardToState(board);
    } else {
      state = defaultState();
    }
    state.mode = mode;
    if (slug) state.originalSlug = slug;
    lastGenerated = "";
    selection = { type: "board" };
    resultEl.hidden = true;
    rootEl.hidden = false;
    document.body.classList.add("kanban-editor-open");
    buildForm();
    var first = formEl && formEl.querySelector("input, select, textarea");
    if (first) first.focus();
  }

  function closeEditor() {
    if (rootEl) rootEl.hidden = true;
    document.body.classList.remove("kanban-editor-open");
  }

  function collectExistingSlugs() {
    existingSlugs = {};
    document
      .querySelectorAll(".kanban-week-card")
      .forEach(function (card) {
        var slug = card.dataset.slug || card.dataset.weekStart;
        if (slug) existingSlugs[slug] = true;
      });
  }

  function isMacChrome() {
    var ua = navigator.userAgent || "";
    var isMac =
      !!(
        /Macintosh|Mac OS X|MacIntel/i.test(ua) ||
        (navigator.platform && /Mac/i.test(navigator.platform)) ||
        (navigator.userAgentData &&
          navigator.userAgentData.platform &&
          /macOS/i.test(navigator.userAgentData.platform))
      );
    var isChrome =
      !!(
        /Chrome\//.test(ua) &&
        !/Edg\//.test(ua) &&
        !/OPR\//.test(ua) &&
        !/SamsungBrowser/i.test(ua)
      );
    return isMac && isChrome;
  }

  function revealListButtons() {
    // 新建看板：管理员模式可见可触发；Mac-Chrome 浏览器也放行。
    // 其他编辑入口（卡片 ✎ 编辑 / 明细 GUI 编辑）保持管理员门控。
    var newBtn = document.getElementById("kanban-new-btn");
    if (newBtn && (isMacChrome() || !document.querySelector(".encryption-admin-only"))) {
      newBtn.removeAttribute("hidden");
      newBtn.classList.remove("encryption-admin-only");
    }
  }

  function wireTriggers() {
    var newBtn = document.getElementById("kanban-new-btn");
    if (newBtn) {
      newBtn.addEventListener("click", function () {
        openEditor("create", "");
      });
    }

    document
      .querySelectorAll("[data-action='edit-card']")
      .forEach(function (btn) {
        btn.addEventListener("click", function () {
          var card = btn.closest(".kanban-week-card");
          var rawEl = card && card.querySelector(".kanban-raw-source");
          var slug = btn.dataset.slug || (card && card.dataset.slug) || "";
          openEditor(
            "modify",
            rawEl && rawEl.value ? rawEl.value : "",
            slug,
          );
        });
      });

    // Detail page: kanban-board.js dispatches this event from the GUI 编辑 button.
    document.addEventListener("kanban-open-gui-edit", function (e) {
      var detail = e.detail || {};
      openEditor("modify", detail.raw || "", detail.slug || "");
    });
  }

  function wireForm() {
    formEl.addEventListener("submit", function (e) {
      e.preventDefault();
      generateAndCopy();
    });

    formEl.addEventListener("input", function (e) {
      applyInspectorField(e.target);
    });

    formEl.addEventListener("change", function (e) {
      applyInspectorField(e.target);
    });

    formEl.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-action]");
      if (!btn) return;
      var action = btn.dataset.action;
      var colIdx =
        btn.dataset.colIdx != null ? parseInt(btn.dataset.colIdx, 10) : null;
      var cardIdx =
        btn.dataset.cardIdx != null ? parseInt(btn.dataset.cardIdx, 10) : null;

      if (action === "add-checkbox" && colIdx != null && cardIdx != null) {
        state.columns[colIdx].cards[cardIdx].checkboxes.push({
          checked: false,
          text: "",
        });
        renderAll();
      } else if (
        action === "remove-checkbox" &&
        colIdx != null &&
        cardIdx != null
      ) {
        var row = e.target.closest("[data-cb-idx]");
        var bi = row ? parseInt(row.dataset.cbIdx, 10) : -1;
        if (bi >= 0) {
          state.columns[colIdx].cards[cardIdx].checkboxes.splice(bi, 1);
          renderAll();
        }
      }
    });
  }

  function init() {
    rootEl = document.getElementById("kanban-editor");
    if (!rootEl) return;
    formEl = document.getElementById("kanban-editor-form");
    canvasEl = document.getElementById("kanban-editor-canvas-board");
    panelEl = document.getElementById("kanban-editor-panel");
    previewEl = document.getElementById("kanban-editor-preview");
    resultEl = document.getElementById("kanban-editor-result");
    modeEl = document.getElementById("kanban-editor-mode");
    slugEl = document.getElementById("kanban-editor-slug");
    sourceUrl = rootEl.dataset.sourceUrl || "";
    replogUrl = rootEl.dataset.replogUrl || "";

    collectExistingSlugs();
    revealListButtons();
    wireTriggers();
    wireForm();
    setupCanvasCardDrag();

    document
      .getElementById("kanban-editor-copy")
      .addEventListener("click", function () {
        var errors = validate();
        if (errors.length) {
          showError(errors);
          return;
        }
        lastGenerated = buildMarkdown();
        refreshPreview();
        copyText(lastGenerated).then(showCopyFeedback);
      });

    document
      .getElementById("kanban-editor-sync-repo")
      .addEventListener("click", syncToRepo);

    var previewToggle = document.getElementById("kanban-editor-preview-toggle");
    if (previewToggle) {
      previewToggle.addEventListener("click", function () {
        var collapsed = previewEl.hidden;
        previewEl.hidden = !collapsed;
        previewToggle.textContent = collapsed
          ? "Markdown 预览 ▴"
          : "Markdown 预览 ▾";
      });
    }

    if (canvasEl) {
      canvasEl.addEventListener("click", function (e) {
        if (e.target === canvasEl) selectBoard();
      });
    }

    rootEl.addEventListener("click", function (e) {
      if (e.target && e.target.hasAttribute("data-kanban-editor-close")) {
        closeEditor();
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && rootEl && !rootEl.hidden) closeEditor();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
