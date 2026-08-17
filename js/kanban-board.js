(function () {
  "use strict";

  var TZ = "Asia/Shanghai";
  var BUFFER_KEY = "kanban-edit-buffer";
  var dragCardId = null;
  var dragColumnId = null;

  function siteTimezone(root) {
    return (root && root.dataset.timezone) || TZ;
  }

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDescription(md) {
    if (!md) return "";
    var html = escapeHtml(md.trim());
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  /* 描述正文悬浮浮层：有内容时悬停显示全文，离开消失 */
  var descTooltipEl = null;
  var descTooltipX = 0;
  var descTooltipY = 0;

  function showDescTooltip(mdText, clientX, clientY) {
    hideDescTooltip();
    descTooltipEl = document.createElement("div");
    descTooltipEl.className = "kanban-desc-tooltip";
    descTooltipEl.innerHTML = renderDescription(mdText);
    document.body.appendChild(descTooltipEl);
    descTooltipX = clientX;
    descTooltipY = clientY;
    positionDescTooltip();
  }

  function positionDescTooltip() {
    if (!descTooltipEl) return;
    var el = descTooltipEl;
    el.style.position = "fixed";
    el.style.left = "0px";
    el.style.top = "0px";
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    var left = descTooltipX + 14;
    var top = descTooltipY + 14;
    if (left + w > window.innerWidth - 8) left = descTooltipX - w - 14;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    el.style.left = Math.max(8, left) + "px";
    el.style.top = Math.max(8, top) + "px";
    el.style.zIndex = 30001;
  }

  function hideDescTooltip() {
    if (descTooltipEl) {
      descTooltipEl.remove();
      descTooltipEl = null;
    }
  }

  function bindDescTooltip(anchor, mdText) {
    if (!mdText || !String(mdText).trim()) return;
    anchor.style.cursor = "help";
    anchor.addEventListener("mouseenter", function (e) {
      showDescTooltip(mdText, e.clientX, e.clientY);
    });
    anchor.addEventListener("mousemove", function (e) {
      if (!descTooltipEl) return;
      descTooltipX = e.clientX;
      descTooltipY = e.clientY;
      positionDescTooltip();
    });
    anchor.addEventListener("mouseleave", hideDescTooltip);
  }

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

  function cardEl(card, rules, unlocked, onChange, colKind, tz) {
    var el = document.createElement("article");
    el.className = "kanban-card";
    el.dataset.cardId = card.id;
    if (card.goalType) el.dataset.goalType = card.goalType;
    if (unlocked) {
      el.draggable = true;
      el.classList.add("is-draggable");
    }

    if (colKind === "resource") {
      el.classList.add("kanban-card--resource");
    }
    if (colKind === "goal") {
      el.classList.add("kanban-card--goal");
      if (card.goalType === "complete") el.classList.add("kanban-card--goal-complete");
      if (card.goalType === "risk") el.classList.add("kanban-card--goal-risk");
    }

    // Trello cover: @bg becomes a color cover strip on the card front.
    if (card.bg && colKind !== "goal") {
      el.classList.add("has-cover");
      var coverColor = rules.resolveColor(card.bg);
      el.style.setProperty("--kanban-cover-color", coverColor);
      if (card.cover === "full") {
        // 全封面：整卡着色，内容用对比色
        el.classList.add("cover-full");
        if (isLightColor(coverColor)) el.classList.add("cover-text-dark");
      } else {
        el.classList.add("cover-half");
        var cover = document.createElement("div");
        cover.className = "kanban-card-cover";
        cover.setAttribute("aria-hidden", "true");
        el.appendChild(cover);
      }
    }

    var topColor = card.top || null;
    if (topColor) {
      el.style.setProperty("--kanban-top-color", rules.resolveColor(topColor));
      el.classList.add("has-top-color");
    }

    if (card.done) el.classList.add("is-done");
    if (card.pinned) el.classList.add("is-pinned");

    // Trello "mark complete" check circle (only meaningful with a due date).
    if (card.due) {
      var check = document.createElement("button");
      check.type = "button";
      check.className = "kanban-card-check";
      check.setAttribute("aria-label", card.done ? "标记为未完成" : "标记为已完成");
      check.textContent = card.done ? "✓" : "";
      if (unlocked) {
        check.addEventListener("click", function (e) {
          e.stopPropagation();
          card.done = !card.done;
          if (onChange) onChange("card-done");
        });
      } else {
        check.disabled = true;
      }
      el.appendChild(check);
    }

    if (card.labels && card.labels.length) {
      var labels = document.createElement("div");
      labels.className = "kanban-card-labels";
      card.labels.forEach(function (name) {
        labels.appendChild(labelPill(name, rules));
      });
      el.appendChild(labels);
    }

    var title = document.createElement("h3");
    title.className = "kanban-card-title";
    title.textContent = card.title;
    el.appendChild(title);

    // Trello badge row: due / start / checklist progress / priority / description.
    var badges = document.createElement("div");
    badges.className = "kanban-card-badges";
    if (card.pinned || unlocked) {
      var pinBadge = document.createElement("button");
      pinBadge.type = "button";
      pinBadge.className =
        "kanban-card-badge kanban-card-badge--pin" +
        (card.pinned ? "" : " is-idle");
      pinBadge.textContent = card.pinned ? "📌 置顶" : "📌";
      pinBadge.title = card.pinned
        ? "已置顶（点击取消置顶；置顶卡片优先显示）"
        : "置顶此卡片（同一列表可多卡片置顶）";
      if (unlocked) {
        pinBadge.addEventListener("click", function (e) {
          e.stopPropagation();
          card.pinned = !card.pinned;
          if (onChange) onChange("pin");
        });
      } else {
        pinBadge.disabled = true;
      }
      badges.appendChild(pinBadge);
    }
    if (card.description && card.description.trim()) {
      var descBadgeEl = descBadge();
      bindDescTooltip(descBadgeEl, card.description);
      badges.appendChild(descBadgeEl);
    }
    if (card.start) badges.appendChild(startBadge(card.start));
    if (card.due) badges.appendChild(dueBadge(card, rules, tz));
    if (card.checkboxes && card.checkboxes.length) {
      badges.appendChild(checklistBadge(card, rules));
    }
    if (card.priority) badges.appendChild(priorityBadge(card.priority));
    if (badges.childNodes.length) el.appendChild(badges);

    if (card.checkboxes && card.checkboxes.length) {
      var ul = document.createElement("ul");
      ul.className = "kanban-checklist";
      card.checkboxes.forEach(function (cb) {
        var li = document.createElement("li");
        li.className = cb.checked ? "checked" : "";
        var box = document.createElement("span");
        box.className = "kanban-checkbox";
        box.textContent = cb.checked ? "✓" : "";
        if (unlocked) {
          box.addEventListener("click", function (e) {
            e.stopPropagation();
            cb.checked = !cb.checked;
            li.classList.toggle("checked", cb.checked);
            box.textContent = cb.checked ? "✓" : "";
            if (onChange) onChange("checklist");
          });
        }
        li.appendChild(box);
        li.appendChild(document.createTextNode(cb.text));
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }

    if (card.description) {
      var desc = document.createElement("div");
      desc.className = "kanban-card-desc";
      desc.innerHTML = renderDescription(card.description);
      bindDescTooltip(desc, card.description);
      el.appendChild(desc);
    }

    return el;
  }

  function uid() {
    return (
      "kb" +
      Math.random().toString(36).slice(2, 9) +
      Date.now().toString(36).slice(-4)
    );
  }

  function todayStr() {
    var n = new Date();
    var m = String(n.getMonth() + 1).padStart(2, "0");
    var d = String(n.getDate()).padStart(2, "0");
    return n.getFullYear() + "-" + m + "-" + d;
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

  function labelPill(name, rules) {
    var span = document.createElement("span");
    span.className = "kanban-label-pill";
    var bg = rules.resolveColor(name);
    span.style.backgroundColor = bg;
    span.textContent = name;
    span.title = name;
    if (isLightColor(bg)) span.classList.add("is-light");
    return span;
  }

  function descBadge() {
    var b = document.createElement("span");
    b.className = "kanban-card-badge kanban-card-badge--desc";
    b.textContent = "☰";
    return b;
  }

  function startBadge(start) {
    var b = document.createElement("span");
    b.className = "kanban-card-badge kanban-card-badge--start";
    b.textContent = "📅 " + String(start).slice(5);
    b.title = start;
    return b;
  }

  function dueBadge(card, rules, tz) {
    var state = rules.dueState(card, tz || "Asia/Shanghai");
    var b = document.createElement("span");
    b.className = "kanban-card-badge kanban-card-badge--due is-" + (state || "upcoming");
    b.textContent =
      (state === "complete" ? "✓ " : "🕒 ") + String(card.due).slice(5);
    b.title = dueTitle(state);
    return b;
  }

  function dueTitle(state) {
    if (state === "complete") return "已标记完成";
    if (state === "soon") return "今天截止";
    if (state === "overdue") return "已逾期";
    if (state === "overdue-old") return "已逾期超过 1 天";
    return "截止日期";
  }

  function checklistBadge(card, rules) {
    var stats = rules.checklistStats(card);
    var b = document.createElement("span");
    b.className = "kanban-card-badge kanban-card-badge--checklist";
    b.textContent = "☑ " + stats.done + "/" + stats.total;
    var bar = document.createElement("span");
    bar.className = "kanban-checklist-bar";
    var fill = document.createElement("span");
    fill.className = "kanban-checklist-bar-fill";
    fill.style.width = stats.pct + "%";
    bar.appendChild(fill);
    b.appendChild(bar);
    return b;
  }

  function priorityBadge(priority) {
    var b = document.createElement("span");
    b.className = "kanban-card-badge kanban-card-badge--priority";
    b.textContent = "★ " + priority;
    return b;
  }

  /* ------------------------------ filter ------------------------------ */

  function filterStateEmpty(f) {
    return (
      !f.keyword &&
      !f.labels.length &&
      f.due === "all" &&
      f.priority === 0 &&
      !f.hideDone
    );
  }

  function cardMatches(card, f, rules) {
    if (f.keyword) {
      var k = f.keyword.trim().toLowerCase();
      var hay = [
        card.title,
        card.description || "",
        (card.labels || []).join(" "),
        card.due || "",
        card.start || "",
      ]
        .join(" ")
        .toLowerCase();
      if (hay.indexOf(k) < 0) return false;
    }
    if (f.labels.length) {
      var cardLabels = (card.labels || []).map(function (s) {
        return String(s).toLowerCase();
      });
      var hit = f.labels.some(function (l) {
        return cardLabels.indexOf(String(l).toLowerCase()) >= 0;
      });
      if (!hit) return false;
    }
    if (f.due === "overdue") {
      var st = rules.dueState(card, "Asia/Shanghai");
      if (st !== "overdue" && st !== "overdue-old") return false;
    } else if (f.due === "soon") {
      if (rules.dueState(card, "Asia/Shanghai") !== "soon") return false;
    } else if (f.due === "none") {
      if (card.due) return false;
    }
    if (f.priority > 0 && !(card.priority && card.priority >= f.priority)) {
      return false;
    }
    if (f.hideDone && card.done) return false;
    return true;
  }

  /* ------------------------------ rendering ------------------------------ */

  function renderBoard(board, container, rules, unlocked, onChange, view) {
    container.innerHTML = "";
    container.classList.toggle("is-unlocked", unlocked);
    var tz = (view && view.timezone) || TZ;
    var filter = view && view.filter;
    var filtering = filter ? !filterStateEmpty(filter) : false;
    container.classList.toggle("is-filtering", filtering);

    // Trello-style two-row layout: workflow columns on top,
    // resource/goal columns side by side on the bottom row.
    var mainRow = document.createElement("div");
    mainRow.className = "kanban-board-main";
    var bottomRow = document.createElement("div");
    bottomRow.className = "kanban-board-bottom";
    var hasBottom = false;

    board.columns.forEach(function (col, ci) {
      var kind = col.kind || rules.columnKind(col.title);
      var cards = rules.sortCards(col.cards, col.sort, col.sortOrder);
      var visible = filtering
        ? cards.filter(function (c) {
            return cardMatches(c, filter, rules);
          })
        : cards;

      var column = document.createElement("div");
      column.className = "kanban-column";
      column.dataset.columnId = col.id;
      column.dataset.columnTitle = col.title;
      column.dataset.columnKind = kind;
      if (kind === "resource" || kind === "goal") {
        column.classList.add("kanban-column--meta");
      }
      if (unlocked) column.classList.add("is-draggable-col");

      var head = document.createElement("div");
      head.className = "kanban-column-head";
      head.draggable = !!unlocked;
      head.title = unlocked ? "拖拽可调整列表顺序" : col.title;
      var titleWrap = document.createElement("div");
      titleWrap.className = "kanban-column-title-wrap";
      var title = document.createElement("span");
      title.className = "kanban-column-title";
      title.textContent = col.title;
      title.title = unlocked ? "双击重命名列" : col.title;
      if (unlocked) {
        title.addEventListener("dblclick", function () {
          startInlineRename(title, col, container, rules, unlocked, onChange, view);
        });
      }
      titleWrap.appendChild(title);
      var count = document.createElement("span");
      count.className = "kanban-column-count";
      count.textContent = filtering
        ? visible.length + "/" + col.cards.length
        : col.cards.length;
      titleWrap.appendChild(count);
      head.appendChild(titleWrap);

      column.appendChild(head);

      var list = document.createElement("div");
      list.className = "kanban-column-cards";
      list.dataset.columnId = col.id;
      visible.forEach(function (card) {
        list.appendChild(cardEl(card, rules, unlocked, onChange, kind, tz));
      });
      column.appendChild(list);

      if (unlocked) {
        var addRow = document.createElement("div");
        addRow.className = "kanban-column-add";
        var addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "kanban-add-card-btn";
        addBtn.textContent = "＋ 添加卡片";
        addBtn.dataset.colIdx = ci;
        addBtn.addEventListener("click", function () {
          startQuickAdd(addRow, addBtn, col, board, container, rules, unlocked, onChange, view);
        });
        addRow.appendChild(addBtn);
        column.appendChild(addRow);
      }

      if (kind === "resource" || kind === "goal") {
        bottomRow.appendChild(column);
        hasBottom = true;
      } else {
        mainRow.appendChild(column);
      }
    });

    if (unlocked) {
      var addCol = document.createElement("div");
      addCol.className = "kanban-add-list";
      var addColBtn = document.createElement("button");
      addColBtn.type = "button";
      addColBtn.textContent = "＋ 添加列表";
      addColBtn.addEventListener("click", function () {
        startQuickAddList(addColBtn, board, container, rules, unlocked, onChange, view);
      });
      addCol.appendChild(addColBtn);
      mainRow.appendChild(addCol);
    }

    container.appendChild(mainRow);
    if (hasBottom) container.appendChild(bottomRow);
  }

  function startInlineRename(titleEl, col, container, rules, unlocked, onChange, view) {
    if (titleEl.querySelector("input")) return;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "kanban-column-rename-input";
    input.value = col.title;
    input.maxLength = 30;
    titleEl.textContent = "";
    titleEl.appendChild(input);
    input.focus();
    input.select();
    function commit() {
      var v = input.value.trim();
      if (v && v !== col.title) {
        col.title = v;
        if (onChange) onChange("column-rename");
      } else if (!v) {
        // restore old title
      }
      renderBoard(board, container, rules, unlocked, onChange, view);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") renderBoard(board, container, rules, unlocked, onChange, view);
    });
    input.addEventListener("blur", commit);
  }

  function startQuickAdd(addRow, addBtn, col, board, container, rules, unlocked, onChange, view) {
    addBtn.remove();
    var input = document.createElement("input");
    input.type = "text";
    input.className = "kanban-quickadd-input";
    input.placeholder = "输入卡片标题，回车添加";
    input.maxLength = 80;
    var commitBtn = document.createElement("button");
    commitBtn.type = "button";
    commitBtn.className = "kanban-quickadd-btn";
    commitBtn.textContent = "添加";
    function commit() {
      var v = input.value.trim();
      if (v) {
        var meta = (board.meta && board.meta.extra) || {};
        var d = todayStr();
        if (meta.week_start && d < meta.week_start) d = meta.week_start;
        if (meta.week_end && d > meta.week_end) d = meta.week_end;
        col.cards.push({
          id: uid(),
          title: v,
          start: d,
          due: d,
          priority: null,
          goalType: null,
          labels: [],
          bg: null,
          top: null,
          cover: null,
          done: false,
          checkboxes: [],
          description: "",
        });
        if (onChange) onChange("quick-add-card");
      }
      renderBoard(board, container, rules, unlocked, onChange, view);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") renderBoard(board, container, rules, unlocked, onChange, view);
    });
    commitBtn.addEventListener("click", commit);
    addRow.appendChild(input);
    addRow.appendChild(commitBtn);
    input.focus();
  }

  function startQuickAddList(btn, board, container, rules, unlocked, onChange, view) {
    var parent = btn.parentNode;
    var wrap = document.createElement("div");
    wrap.className = "kanban-add-list-input";
    var input = document.createElement("input");
    input.type = "text";
    input.placeholder = "输入列表名，回车添加";
    input.maxLength = 30;
    var commitBtn = document.createElement("button");
    commitBtn.type = "button";
    commitBtn.className = "kanban-quickadd-btn";
    commitBtn.textContent = "添加列表";
    function commit() {
      var v = input.value.trim();
      if (v) {
        board.columns.push({
          id: uid(),
          title: v,
          kind: rules.columnKind(v),
          sort: "manual",
          sortOrder: "asc",
          cards: [],
        });
        if (onChange) onChange("quick-add-list");
      }
      renderBoard(board, container, rules, unlocked, onChange, view);
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") commit();
      if (e.key === "Escape") renderBoard(board, container, rules, unlocked, onChange, view);
    });
    commitBtn.addEventListener("click", commit);
    wrap.appendChild(input);
    wrap.appendChild(commitBtn);
    if (parent && parent.replaceWith) parent.replaceWith(wrap);
    else if (parent) parent.appendChild(wrap);
    else container.appendChild(wrap);
    input.focus();
  }

  function moveCard(board, cardId, targetColumnId) {
    var moved = null;
    board.columns.forEach(function (col) {
      col.cards = col.cards.filter(function (c) {
        if (c.id === cardId) {
          moved = c;
          return false;
        }
        return true;
      });
    });
    if (!moved) return false;
    var target = board.columns.find(function (c) {
      return c.id === targetColumnId;
    });
    if (!target) return false;
    target.cards.push(moved);
    board.stats = KanbanRules.computeStats(board);
    return true;
  }

  function moveColumn(board, columnId, targetColumnId) {
    var from = board.columns.findIndex(function (c) {
      return c.id === columnId;
    });
    var to = board.columns.findIndex(function (c) {
      return c.id === targetColumnId;
    });
    if (from < 0 || to < 0 || from === to) return false;
    var col = board.columns.splice(from, 1)[0];
    board.columns.splice(to, 0, col);
    return true;
  }

  /* ------------------------------ popover helpers ------------------------------ */

  function closePopover() {
    var p = document.querySelector(".kanban-popover");
    if (p) p.remove();
    var o = document.querySelector(".kanban-popover-open");
    if (o) o.classList.remove("kanban-popover-open");
  }

  function positionPopover(anchor, pop) {
    var rect = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top =
      Math.min(rect.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + "px";
    pop.style.left =
      Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8)) +
      "px";
    pop.style.zIndex = 20000;
    anchor.classList.add("kanban-popover-open");
  }

  function boardLabelOptions(board) {
    var seen = {};
    board.columns.forEach(function (col) {
      col.cards.forEach(function (card) {
        (card.labels || []).forEach(function (l) {
          if (!seen[l]) seen[l] = true;
        });
      });
    });
    return Object.keys(seen);
  }

  function openFilterPopover(anchor, board, filter, onFilterChange, onClear) {
    closePopover();
    var pop = document.createElement("div");
    pop.className = "kanban-popover kanban-filter-popover";
    var head = document.createElement("div");
    head.className = "kanban-popover-title";
    head.textContent = "筛选卡片";
    pop.appendChild(head);

    var kw = document.createElement("input");
    kw.type = "text";
    kw.className = "kanban-filter-input";
    kw.placeholder = "搜索关键词…";
    kw.value = filter.keyword || "";
    var kwWrap = document.createElement("label");
    kwWrap.className = "kanban-popover-label";
    kwWrap.textContent = "关键词";
    kwWrap.appendChild(kw);
    pop.appendChild(kwWrap);

    var labels = boardLabelOptions(board);
    if (labels.length) {
      var labelHead = document.createElement("div");
      labelHead.className = "kanban-popover-label";
      labelHead.textContent = "标签";
      pop.appendChild(labelHead);
      var chips = document.createElement("div");
      chips.className = "kanban-filter-chips";
      labels.forEach(function (name) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "kanban-filter-chip";
        var bg = KanbanRules.resolveColor(name);
        b.style.borderColor = bg;
        b.textContent = name;
        if (filter.labels.indexOf(name) >= 0) {
          b.classList.add("is-active");
          b.style.backgroundColor = bg;
        }
        b.addEventListener("click", function () {
          var i = filter.labels.indexOf(name);
          if (i >= 0) filter.labels.splice(i, 1);
          else filter.labels.push(name);
          onFilterChange();
          openFilterPopover(anchor, board, filter, onFilterChange, onClear);
        });
        chips.appendChild(b);
      });
      pop.appendChild(chips);
    }

    var dueHead = document.createElement("div");
    dueHead.className = "kanban-popover-label";
    dueHead.textContent = "截止日期";
    pop.appendChild(dueHead);
    var dueRow = document.createElement("div");
    dueRow.className = "kanban-filter-chips";
    [
      ["all", "全部"],
      ["overdue", "已逾期"],
      ["soon", "即将到期"],
      ["none", "无截止日期"],
    ].forEach(function (opt) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kanban-filter-chip";
      b.textContent = opt[1];
      if (filter.due === opt[0]) b.classList.add("is-active");
      b.addEventListener("click", function () {
        filter.due = opt[0];
        onFilterChange();
        openFilterPopover(anchor, board, filter, onFilterChange, onClear);
      });
      dueRow.appendChild(b);
    });
    pop.appendChild(dueRow);

    var pri = document.createElement("select");
    pri.className = "kanban-filter-input";
    [["0", "全部优先级"], ["1", "≥ ★1"], ["2", "≥ ★2"], ["3", "≥ ★3"], ["4", "≥ ★4"], ["5", "★★★★★"]].forEach(function (opt) {
      var o = document.createElement("option");
      o.value = opt[0];
      o.textContent = opt[1];
      pri.appendChild(o);
    });
    pri.value = String(filter.priority || 0);
    var priWrap = document.createElement("label");
    priWrap.className = "kanban-popover-label";
    priWrap.textContent = "优先级";
    priWrap.appendChild(pri);
    pop.appendChild(priWrap);

    var hideDone = document.createElement("input");
    hideDone.type = "checkbox";
    hideDone.checked = !!filter.hideDone;
    var hideWrap = document.createElement("label");
    hideWrap.className = "kanban-filter-check";
    hideWrap.appendChild(hideDone);
    hideWrap.appendChild(document.createTextNode("隐藏已完成"));
    pop.appendChild(hideWrap);

    var foot = document.createElement("div");
    foot.className = "kanban-filter-foot";
    var clear = document.createElement("button");
    clear.type = "button";
    clear.className = "kanban-popover-item";
    clear.textContent = "清除筛选";
    clear.addEventListener("click", function () {
      onClear();
      closePopover();
    });
    foot.appendChild(clear);
    pop.appendChild(foot);

    function commit() {
      filter.keyword = kw.value;
      filter.priority = parseInt(pri.value, 10) || 0;
      filter.hideDone = hideDone.checked;
      onFilterChange();
    }
    kw.addEventListener("input", commit);
    pri.addEventListener("change", commit);
    hideDone.addEventListener("change", commit);

    document.body.appendChild(pop);
    positionPopover(anchor, pop);
    kw.focus();
  }

  /* ------------------------------ drag & drop ------------------------------ */

  function setupDragDrop(container, getBoard, getUnlocked, rerender) {
    // ---- pointer-based card drag (immune to HTML5 DnD quirks on macOS Chrome) ----
    var session = null;

    function cardSource(el) {
      var cardEl = el.closest(".kanban-card");
      if (!cardEl || !getUnlocked()) return null;
      return { cardEl: cardEl, cardId: cardEl.dataset.cardId };
    }

    function onCardDown(e) {
      if (e.button !== 0) return;
      var src = cardSource(e.target);
      if (!src) return;
      e.preventDefault();
      session = {
        src: src,
        moved: false,
        ghost: null,
        startX: e.clientX,
        startY: e.clientY,
      };
      document.addEventListener("mousemove", onCardMove);
      document.addEventListener("mouseup", onCardUp);
    }

    function onCardMove(e) {
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
        session.src.cardEl.classList.add("dragging");
        var titleEl = session.src.cardEl.querySelector(".kanban-card-title");
        session.ghost = document.createElement("div");
        session.ghost.className = "kanban-drag-ghost";
        session.ghost.textContent = titleEl
          ? titleEl.textContent
          : session.src.cardId;
        document.body.appendChild(session.ghost);
        container.classList.add("is-dragging-cards");
      }
      if (session.ghost) {
        session.ghost.style.left = e.clientX + 12 + "px";
        session.ghost.style.top = e.clientY + 12 + "px";
      }
      var target = e.target.closest(".kanban-column-cards");
      container.querySelectorAll(".kanban-column-cards.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      if (target) target.classList.add("drag-over");
    }

    function onCardUp(e) {
      if (!session) return;
      if (session.moved) {
        var board = getBoard();
        var target = e.target.closest(".kanban-column-cards");
        if (
          board &&
          target &&
          moveCard(board, session.src.cardId, target.dataset.columnId)
        ) {
          rerender();
        }
      }
      if (session.ghost) session.ghost.remove();
      session.src.cardEl.classList.remove("dragging");
      container.querySelectorAll(".kanban-column-cards.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      container.classList.remove("is-dragging-cards");
      document.removeEventListener("mousemove", onCardMove);
      document.removeEventListener("mouseup", onCardUp);
      session = null;
    }

    container.addEventListener("mousedown", onCardDown);

    // ---- HTML5 drag & drop for columns ----
    container.addEventListener("dragstart", function (e) {
      if (!getUnlocked()) {
        e.preventDefault();
        return;
      }
      var head = e.target.closest(".kanban-column-head");
      if (head) {
        var col = head.closest(".kanban-column");
        if (!col) return;
        dragColumnId = col.dataset.columnId;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragColumnId);
        col.classList.add("dragging");
      }
    });

    container.addEventListener("dragend", function (e) {
      var card = e.target.closest(".kanban-card");
      if (card) card.classList.remove("dragging");
      var col = e.target.closest(".kanban-column");
      if (col) col.classList.remove("dragging");
      dragCardId = null;
      dragColumnId = null;
      container.querySelectorAll(".drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
    });

    container.addEventListener("dragover", function (e) {
      if (!getUnlocked()) return;
      if (dragColumnId) {
        var colEl = e.target.closest(".kanban-column");
        if (!colEl) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        container.querySelectorAll(".kanban-column.drag-over").forEach(function (el) {
          el.classList.remove("drag-over");
        });
        colEl.classList.add("drag-over");
      }
    });

    container.addEventListener("dragleave", function (e) {
      var el = e.target.closest(".kanban-column-cards, .kanban-column");
      if (el && !el.contains(e.relatedTarget)) {
        el.classList.remove("drag-over");
      }
    });

    container.addEventListener("drop", function (e) {
      if (!getUnlocked()) return;
      var board = getBoard();
      if (!board) return;
      e.preventDefault();
      if (dragColumnId) {
        var colEl = e.target.closest(".kanban-column");
        if (colEl) {
          colEl.classList.remove("drag-over");
          if (moveColumn(board, dragColumnId, colEl.dataset.columnId)) {
            rerender();
          }
        }
        dragColumnId = null;
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var root = document.getElementById("kanban-board");
    if (!root || typeof KanbanRules === "undefined") return;

    var rules = KanbanRules;
    var boardEl = root.querySelector(".kanban-columns");
    var lockBtn = document.getElementById("kanban-lock-btn");
    var toolbarActions = document.getElementById("kanban-toolbar-actions");
    var editPostBtn = document.getElementById("kanban-edit-post");
    var guiEditBtn = document.getElementById("kanban-gui-edit-btn");
    var statusEl = document.getElementById("kanban-status");
    var favBtn = document.getElementById("kanban-fav-btn");
    var boardTitleEl = document.getElementById("kanban-board-title");
    var filterBtn = document.getElementById("kanban-filter-btn");
    var filterBar = document.getElementById("kanban-filter-bar");
    var filterInput = document.getElementById("kanban-filter-keyword");
    var filterClear = document.getElementById("kanban-filter-clear");
    var filterCount = document.getElementById("kanban-filter-count");
    var menuBtn = document.getElementById("kanban-menu-btn");
    var menuEl = document.getElementById("kanban-menu");
    var menuAbout = document.getElementById("kanban-menu-about");
    var menuStats = document.getElementById("kanban-menu-stats");
    var menuProgressFill = document.getElementById("kanban-menu-progress-fill");
    var menuSwatches = document.getElementById("kanban-menu-swatches");
    var menuSearch = document.getElementById("kanban-menu-search");

    var weekStart = root.dataset.weekStart;
    var weekEnd = root.dataset.weekEnd;
    var timezone = siteTimezone(root);
    var daysLeftEl = document.querySelector(".kanban-days-left");
    if (daysLeftEl) {
      var dl = rules.daysRemainingLabel(weekStart, weekEnd, timezone);
      daysLeftEl.textContent = dl.text;
      daysLeftEl.dataset.kind = dl.kind;
    }
    var editable =
      typeof KanbanRules.isEditableWindow === "function"
        ? KanbanRules.isEditableWindow(weekStart, weekEnd, timezone)
        : false;
    var unlocked = false;
    var board = null;
    var rawSource = "";
    var dirty = false;
    var filter = { keyword: "", labels: [], due: "all", priority: 0, hideDone: false };

    function getBoard() {
      return board;
    }

    function setStatus(msg, type) {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.dataset.type = type || "";
    }

    function syncStats() {
      if (board) board.stats = rules.computeStats(board);
    }

    function actionLabel(action) {
      var map = {
        "move-card": "移动卡片",
        "move-column": "调整列表顺序",
        "card-done": "标记完成状态",
        checklist: "勾选清单",
        "quick-add-card": "添加卡片",
        "quick-add-list": "添加列表",
        "column-rename": "重命名列表",
        "column-sort": "排序列表",
        "column-delete": "删除列表",
        "board-bg": "更换背景",
        favorite: "收藏状态",
        pin: "置顶状态",
      };
      return map[action] || "看板内容";
    }

    function markChanged(action) {
      syncStats();
      dirty = true;
      setStatus(
        "⚠ 有未保存的本地修改（" + actionLabel(action) + "）；保存请用 Edit Post",
        "warn",
      );
      rerender();
    }

    function serializeCurrent() {
      if (!board || !rawSource) return "";
      syncStats();
      return rules.serializeMarkdown(board, rawSource);
    }

    function writeSessionBuffer(markdown, slug) {
      try {
        sessionStorage.setItem(BUFFER_KEY, markdown);
        sessionStorage.setItem(BUFFER_KEY + "-target", slug);
        sessionStorage.setItem(BUFFER_KEY + "-at", new Date().toISOString());
      } catch (_) {}
    }

    function rerender() {
      renderBoard(board, boardEl, rules, unlocked, markChanged, {
        timezone: timezone,
        filter: filter,
      });
      updateFilterCount();
    }

    function isEncryptionAdmin() {
      if (!window.EncryptionAdmin) return true;
      return window.EncryptionAdmin.isAdminActive();
    }

    function applyBoardChrome() {
      if (!board) return;
      var meta = board.meta || {};
      var extra = meta.extra || {};
      if (boardTitleEl) {
        boardTitleEl.textContent =
          extra.core_tasks || meta.title || "周计划看板";
      }
      if (favBtn) {
        favBtn.textContent = extra.favorite ? "★" : "☆";
        favBtn.setAttribute("aria-pressed", extra.favorite ? "true" : "false");
        favBtn.title = extra.favorite ? "取消收藏（需保存）" : "收藏此看板（需保存）";
      }
      var page = root.closest(".kanban-page") || root;
      var bg = rules.resolveBoardBg(extra.board_bg);
      if (bg) {
        page.style.background = bg;
        page.classList.add("has-board-bg");
      } else {
        page.style.background = "";
        page.classList.remove("has-board-bg");
      }
    }

    function updateFilterCount() {
      if (!filterCount || !board) return;
      var filtering = !filterStateEmpty(filter);
      var visible = 0;
      var total = 0;
      board.columns.forEach(function (col) {
        col.cards.forEach(function (card) {
          total++;
          if (!filtering || cardMatches(card, filter, rules)) visible++;
        });
      });
      filterCount.textContent = filtering ? visible + " / " + total + " 张卡片" : "";
    }

    function updateToolbar() {
      root.classList.toggle("kanban-board--unlocked", unlocked);
      var admin = isEncryptionAdmin();

      if (!editable) {
        unlocked = false;
        lockBtn.disabled = true;
        lockBtn.textContent = "只读（已过期）";
        lockBtn.classList.remove("unlocked");
        if (toolbarActions) toolbarActions.hidden = true;
        closeMenus();
        return;
      }

      if (!admin) {
        unlocked = false;
        lockBtn.disabled = true;
        lockBtn.textContent = "🔒 只读";
        lockBtn.classList.remove("unlocked");
        if (toolbarActions) toolbarActions.hidden = true;
        closeMenus();
        return;
      }

      lockBtn.disabled = false;
      lockBtn.textContent = unlocked ? "🔓 已解锁 · 可编辑" : "🔒 已锁定";
      lockBtn.classList.toggle("unlocked", unlocked);
      if (toolbarActions) toolbarActions.hidden = false;
    }

    function closeMenus() {
      closePopover();
      if (menuEl) menuEl.hidden = true;
      if (filterBar) filterBar.hidden = true;
    }

    lockBtn.addEventListener("click", function () {
      if (!isEncryptionAdmin() || !editable) return;
      unlocked = !unlocked;
      updateToolbar();
      rerender();
      setStatus(
        unlocked
          ? "已解锁：可拖拽卡片/列表、添加卡片/列表、排序、标记完成；保存请用 Edit Post"
          : "",
        unlocked ? "info" : "",
      );
    });

    if (favBtn) {
      favBtn.addEventListener("click", function () {
        if (!board) return;
        board.meta = board.meta || {};
        board.meta.extra = board.meta.extra || {};
        board.meta.extra.favorite = !board.meta.extra.favorite;
        applyBoardChrome();
        markChanged("favorite");
      });
    }

    if (filterBtn) {
      filterBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (filterBar && !filterBar.hidden) {
          filterBar.hidden = true;
          return;
        }
        openFilterPopover(
          filterBtn,
          board,
          filter,
          function () {
            if (filterBar) filterBar.hidden = !filterStateEmpty(filter);
            rerender();
          },
          function () {
            filter.keyword = "";
            filter.labels = [];
            filter.due = "all";
            filter.priority = 0;
            filter.hideDone = false;
            if (filterInput) filterInput.value = "";
            if (filterBar) filterBar.hidden = true;
            rerender();
          },
        );
      });
    }

    if (filterInput) {
      filterInput.addEventListener("input", function () {
        filter.keyword = filterInput.value;
        rerender();
      });
    }
    if (filterClear) {
      filterClear.addEventListener("click", function () {
        filter.keyword = "";
        filter.labels = [];
        filter.due = "all";
        filter.priority = 0;
        filter.hideDone = false;
        if (filterInput) filterInput.value = "";
        filterBar.hidden = true;
        rerender();
      });
    }

    if (menuBtn && menuEl) {
      menuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var show = menuEl.hidden;
        closePopover();
        menuEl.hidden = !show;
        if (show) updateMenuContent();
      });
      menuEl.addEventListener("click", function (e) {
        if (e.target && e.target.hasAttribute("data-kanban-menu-close")) {
          menuEl.hidden = true;
        }
      });
    }

    var menuGuiBtn = document.getElementById("kanban-menu-gui-edit");
    if (menuGuiBtn) {
      menuGuiBtn.addEventListener("click", function () {
        if (menuEl) menuEl.hidden = true;
        if (guiEditBtn) guiEditBtn.click();
      });
    }
    var menuEditPostBtn = document.getElementById("kanban-menu-edit-post");
    if (menuEditPostBtn) {
      menuEditPostBtn.addEventListener("click", function () {
        if (menuEl) menuEl.hidden = true;
        if (editPostBtn) editPostBtn.click();
      });
    }

    function updateMenuContent() {
      if (!board) return;
      var meta = board.meta || {};
      var extra = meta.extra || {};
      if (menuAbout) {
        menuAbout.textContent =
          (extra.core_tasks || meta.title || "周计划看板") +
          " · " +
          (extra.week_start || "") +
          " → " +
          (extra.week_end || "");
      }
      if (menuStats) {
        var s = board.stats || rules.computeStats(board);
        menuStats.textContent =
          "共 " + s.total + " 项 · 已完成 " + s.done + " · 待办 " + s.todo + " · 进行中 " + s.doing;
      }
      if (menuProgressFill) {
        var pct = (board.stats && board.stats.progress_pct) || rules.computeProgress(board) || 0;
        menuProgressFill.style.width = Math.max(0, Math.min(100, pct)) + "%";
      }
      renderSwatches();
    }

    function renderSwatches() {
      if (!menuSwatches) return;
      menuSwatches.innerHTML = "";
      function addSwatch(key, label, bg) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "kanban-menu-swatch";
        b.style.background = bg;
        b.title = label;
        b.setAttribute("aria-label", label);
        var cur = (board.meta && board.meta.extra && board.meta.extra.board_bg) || "";
        if (key === cur || (key === "__none__" && !cur)) b.classList.add("is-active");
        b.addEventListener("click", function () {
          board.meta = board.meta || {};
          board.meta.extra = board.meta.extra || {};
          board.meta.extra.board_bg = key === "__none__" ? "" : key;
          applyBoardChrome();
          renderSwatches();
          markChanged("board-bg");
        });
        menuSwatches.appendChild(b);
      }
      addSwatch("__none__", "默认背景", "linear-gradient(135deg,#f7f9fc,#dbe3ea)");
      Object.keys(rules.BOARD_BG_PRESETS || {}).forEach(function (key) {
        addSwatch(key, key, rules.BOARD_BG_PRESETS[key]);
      });
    }

    if (menuSearch) {
      menuSearch.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        filter.keyword = menuSearch.value;
        if (menuEl) menuEl.hidden = true;
        if (filterBar) filterBar.hidden = false;
        if (filterInput) filterInput.value = filter.keyword;
        rerender();
      });
    }

    if (editPostBtn) {
      editPostBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var markdown = serializeCurrent();
        if (!markdown) {
          setStatus("看板尚未加载，无法保存", "error");
          return;
        }

        var slug = editPostBtn.dataset.slug;
        var sourceUrl = editPostBtn.dataset.sourceUrl;
        var editUrl = editPostBtn.dataset.editUrl;
        var token = localStorage.getItem("kanbanToken");

        writeSessionBuffer(markdown, slug);

        function openEditor() {
          window.open(editUrl, "_blank", "noopener");
        }

        function copyAndOpen() {
          navigator.clipboard
            .writeText(markdown)
            .then(function () {
              setStatus(
                "Markdown 已写入缓冲并复制到剪贴板，请在打开的编辑器中全选粘贴后保存",
                "success",
              );
              dirty = false;
              openEditor();
            })
            .catch(function () {
              setStatus("Markdown 已写入缓冲，请在打开的编辑器中粘贴当前看板内容", "info");
              openEditor();
            });
        }

        if (token && sourceUrl) {
          var repo = parseRepo(sourceUrl);
          setStatus("正在写入 buffer 并同步至 content/kanban/" + slug + ".md …", "info");
          putKanbanFile(repo, token, "_edit-buffer.md", markdown, "kanban: update edit buffer")
            .then(function () {
              return putKanbanFile(
                repo,
                token,
                slug + ".md",
                markdown,
                "kanban: sync week board from buffer",
              );
            })
            .then(function () {
              setStatus("已通过 buffer 覆盖 content/kanban/" + slug + ".md，正在打开编辑器", "success");
              dirty = false;
              openEditor();
            })
            .catch(function (err) {
              setStatus("API 同步失败（" + err.message + "），改用剪贴板", "warn");
              copyAndOpen();
            });
        } else {
          copyAndOpen();
        }
      });
    }

    if (guiEditBtn) {
      guiEditBtn.addEventListener("click", function () {
        var rawEl = document.getElementById("kanban-raw-markdown");
        var ev = new CustomEvent("kanban-open-gui-edit", {
          detail: {
            mode: "modify",
            raw: rawEl ? rawEl.value : rawSource,
            slug: editPostBtn ? editPostBtn.dataset.slug : "",
          },
        });
        document.dispatchEvent(ev);
      });
    }

    setupDragDrop(
      boardEl,
      getBoard,
      function () {
        return unlocked;
      },
      function () {
        markChanged(dragCardId ? "move-card" : "move-column");
      },
    );

    function loadRawMarkdown(root, onLoad, onError) {
      var rawEl =
        document.getElementById("kanban-raw-markdown") ||
        (root && root.parentElement
          ? root.parentElement.querySelector(".kanban-raw-source")
          : null);
      if (rawEl && rawEl.value) {
        onLoad(rawEl.value);
        return;
      }
      var url = root && root.dataset.rawUrl;
      if (!url) {
        onError(new Error("未找到看板 Markdown 数据"));
        return;
      }
      fetch(url)
        .then(function (r) {
          if (!r.ok) throw new Error("无法加载 " + url);
          return r.text();
        })
        .then(onLoad)
        .catch(onError);
    }

    loadRawMarkdown(
      root,
      function (text) {
        rawSource = text;
        board = rules.parseMarkdown(text);
        if (!board.columns || !board.columns.length) {
          throw new Error("看板解析结果为空，请检查 content/kanban/" + (editPostBtn && editPostBtn.dataset.slug ? editPostBtn.dataset.slug + ".md" : "源文件"));
        }
        applyBoardChrome();
        rerender();
        updateToolbar();
        if (!isEncryptionAdmin()) {
          setStatus("看板为只读模式；进入管理员模式后可编辑", "warn");
        } else if (!editable) {
          var cutoff = KanbanRules.EDIT_CUTOFF_HOUR || 23;
          setStatus(
            "编辑窗口已关闭（截止 " +
              weekEnd +
              " 当日 " +
              cutoff +
              ":00，时区 " +
              timezone +
              "）",
            "warn",
          );
        }
      },
      function (e) {
        setStatus(e.message, "error");
      },
    );

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeMenus();
        return;
      }
      if ((e.key === "f" || e.key === "F") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        var tag = (e.target && e.target.tagName) || "";
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
        if (!isEncryptionAdmin()) return;
        e.preventDefault();
        filterBtn && filterBtn.click();
      }
    });

    window.addEventListener("encryption-admin-enabled", function () {
      updateToolbar();
      rerender();
    });
    window.addEventListener("encryption-admin-expired", function () {
      updateToolbar();
      rerender();
    });
  });
})();
