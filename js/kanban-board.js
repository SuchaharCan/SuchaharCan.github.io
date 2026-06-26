(function () {
  "use strict";

  var TZ = "Asia/Shanghai";
  var BUFFER_KEY = "kanban-edit-buffer";
  var dragCardId = null;

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

  function cardEl(card, rules, unlocked, onChange, colKind) {
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

    if (card.bg && colKind !== "goal") el.style.backgroundColor = rules.resolveColor(card.bg);

    var topColor = card.top || null;
    if (topColor) {
      el.style.setProperty("--kanban-top-color", rules.resolveColor(topColor));
      el.classList.add("has-top-color");
    }

    if (card.labels && card.labels.length) {
      var labels = document.createElement("div");
      labels.className = "kanban-card-labels";
      card.labels.forEach(function (name) {
        var span = document.createElement("span");
        span.className = "kanban-label";
        span.style.backgroundColor = rules.resolveColor(name);
        span.title = name;
        labels.appendChild(span);
      });
      el.appendChild(labels);
    }

    var title = document.createElement("h3");
    title.className = "kanban-card-title";
    title.textContent = card.title;

    var body = document.createElement("div");
    body.className = "kanban-card-body";

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
            if (onChange) onChange();
          });
        }
        li.appendChild(box);
        li.appendChild(document.createTextNode(cb.text));
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    if (card.description) {
      var desc = document.createElement("div");
      desc.className = "kanban-card-desc";
      desc.innerHTML = renderDescription(card.description);
      body.appendChild(desc);
    }

    el.appendChild(title);
    el.appendChild(body);

    return el;
  }

  function renderBoard(board, container, rules, unlocked, onChange) {
    container.innerHTML = "";
    container.classList.toggle("is-unlocked", unlocked);

    board.columns.forEach(function (col) {
      var kind = col.kind || rules.columnKind(col.title);
      var column = document.createElement("div");
      column.className = "kanban-column";
      column.dataset.columnId = col.id;
      column.dataset.columnTitle = col.title;
      column.dataset.columnKind = kind;
      if (kind === "resource" || kind === "goal") {
        column.classList.add("kanban-column--meta");
      }

      var head = document.createElement("div");
      head.className = "kanban-column-head";
      head.innerHTML =
        '<span class="kanban-column-title">' +
        escapeHtml(col.title) +
        '</span><span class="kanban-column-count">' +
        col.cards.length +
        "</span>";

      var list = document.createElement("div");
      list.className = "kanban-column-cards";
      list.dataset.columnId = col.id;

      col.cards.forEach(function (card) {
        list.appendChild(cardEl(card, rules, unlocked, onChange, kind));
      });

      column.appendChild(head);
      column.appendChild(list);
      container.appendChild(column);
    });
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

  function setupDragDrop(container, getBoard, getUnlocked, rerender) {
    container.addEventListener("dragstart", function (e) {
      if (!getUnlocked()) {
        e.preventDefault();
        return;
      }
      var card = e.target.closest(".kanban-card.is-draggable");
      if (!card) return;
      dragCardId = card.dataset.cardId;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragCardId);
      card.classList.add("dragging");
    });

    container.addEventListener("dragend", function (e) {
      var card = e.target.closest(".kanban-card");
      if (card) card.classList.remove("dragging");
      dragCardId = null;
      container.querySelectorAll(".kanban-column-cards.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
    });

    container.addEventListener("dragover", function (e) {
      if (!getUnlocked() || !dragCardId) return;
      var list = e.target.closest(".kanban-column-cards");
      if (!list) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      container.querySelectorAll(".kanban-column-cards.drag-over").forEach(function (el) {
        el.classList.remove("drag-over");
      });
      list.classList.add("drag-over");
    });

    container.addEventListener("dragleave", function (e) {
      var list = e.target.closest(".kanban-column-cards");
      if (list && !list.contains(e.relatedTarget)) {
        list.classList.remove("drag-over");
      }
    });

    container.addEventListener("drop", function (e) {
      if (!getUnlocked() || !dragCardId) return;
      var list = e.target.closest(".kanban-column-cards");
      if (!list) return;
      e.preventDefault();
      list.classList.remove("drag-over");
      var board = getBoard();
      if (!board) return;
      if (moveCard(board, dragCardId, list.dataset.columnId)) {
        rerender();
      }
      dragCardId = null;
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
    var statusEl = document.getElementById("kanban-status");

    var weekStart = root.dataset.weekStart;
    var weekEnd = root.dataset.weekEnd;
    var timezone = siteTimezone(root);
    var editable =
      typeof KanbanRules.isEditableWindow === "function"
        ? KanbanRules.isEditableWindow(weekStart, weekEnd, timezone)
        : false;
    var unlocked = false;
    var board = null;
    var rawSource = "";

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
      renderBoard(board, boardEl, rules, unlocked, syncStats);
    }

    function isEncryptionAdmin() {
      if (!window.EncryptionAdmin) return true;
      return window.EncryptionAdmin.isAdminActive();
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
        return;
      }

      if (!admin) {
        unlocked = false;
        lockBtn.disabled = true;
        lockBtn.textContent = "🔒 只读";
        lockBtn.classList.remove("unlocked");
        if (toolbarActions) toolbarActions.hidden = true;
        return;
      }

      lockBtn.disabled = false;
      lockBtn.textContent = unlocked ? "🔓 已解锁 · 可拖拽" : "🔒 已锁定";
      lockBtn.classList.toggle("unlocked", unlocked);
      if (toolbarActions) toolbarActions.hidden = !unlocked;
    }

    lockBtn.addEventListener("click", function () {
      if (!isEncryptionAdmin() || !editable) return;
      unlocked = !unlocked;
      updateToolbar();
      rerender();
      setStatus(
        unlocked
          ? "可拖拽卡片跨列（本地预览）；保存请用 Edit Post"
          : "",
        unlocked ? "info" : "",
      );
    });

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

    setupDragDrop(
      boardEl,
      getBoard,
      function () {
        return unlocked;
      },
      rerender,
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
