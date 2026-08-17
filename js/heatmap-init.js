(function () {
  function formatMonth(monthIndex) {
    return `${monthIndex + 1}月`;
  }

  function dayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function parsePosts(raw) {
    return raw.map((item) => {
      const parts = item.split("|");
      const date = parts[0];
      const url = parts[1];
      const tags = Number(parts[parts.length - 1]) || 0;
      const title = parts.slice(2, parts.length - 1).join("|");
      return { date, url, title, tags };
    });
  }

  function buildDateMap(posts) {
    const map = new Map();
    posts.forEach((post) => {
      const key = post.date.split("T")[0];
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(post);
    });
    map.forEach((items) => {
      items.sort((a, b) => (b.tags || 0) - (a.tags || 0));
    });
    return map;
  }

  function getYearsFromPosts(posts) {
    const years = new Set();
    posts.forEach((post) => {
      years.add(parseInt(post.date.split("T")[0].split("-")[0], 10));
    });
    return [...years].sort((a, b) => b - a);
  }

  function countPostsInYear(posts, year) {
    return posts.filter((post) => {
      return parseInt(post.date.split("T")[0].split("-")[0], 10) === year;
    }).length;
  }

  // [2026-08-11] 文章页热力图窗口：最后一个格子 = 今日，向前显示 35 天
  const ARTICLE_DAYS = 35;

  function getRange(mode, year) {
    const today = startOfDay(new Date());
    if (mode === "article") {
      return {
        start: addDays(today, -(ARTICLE_DAYS - 1)),
        end: today,
        year: today.getFullYear(),
      };
    }
    const y = year ?? today.getFullYear();
    return {
      start: new Date(y, 0, 1),
      end: new Date(y, 11, 31),
      year: y,
    };
  }

  function buildWeeks(start, end) {
    const weeks = [];
    let cursor = addDays(start, -start.getDay());
    const last = addDays(end, 6 - end.getDay());

    while (cursor <= last) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        week.push(startOfDay(addDays(cursor, i)));
      }
      weeks.push(week);
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }

  function monthLabels(weeks, rangeStart, rangeEnd) {
    const labels = [];
    let lastMonth = -1;
    weeks.forEach((week, index) => {
      const monthDay = week.find(
        (day) => day.getDate() === 1 && day >= rangeStart && day <= rangeEnd,
      );
      if (monthDay) {
        const month = monthDay.getMonth();
        if (month !== lastMonth) {
          labels.push({ index, label: formatMonth(month) });
          lastMonth = month;
        }
      }
    });
    return labels;
  }

  function levelForCount(count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count === 2) return 2;
    if (count === 3) return 3;
    return 4;
  }

  // ------------------------------------------------------------------
  // [2026-08-11] 同日多篇文章弹层（popover）
  // 交互：点击多文章格子 → 弹出当天全部文章列表 → 手动选择任意一篇跳转
  // 关闭：Esc / 点击弹层外部 / 页面滚动 / 窗口缩放
  // ------------------------------------------------------------------
  const popoverState = { el: null, owner: null };

  function closePopover() {
    if (popoverState.el) {
      popoverState.el.remove();
      popoverState.el = null;
    }
    if (popoverState.owner) {
      popoverState.owner.setAttribute("aria-expanded", "false");
      popoverState.owner = null;
    }
  }

  function positionPopover(el, anchor) {
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    el.style.left = "0px";
    el.style.top = "0px";
    const width = el.offsetWidth;
    const height = el.offsetHeight;

    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.min(Math.max(left, margin), window.innerWidth - width - margin);

    // 默认显示在格子正上方；上方空间不足时翻转到下方
    let top = rect.top - height - margin;
    if (top < margin) {
      top = rect.bottom + margin;
      el.classList.add("heatmap-popover--below");
    }
    // 翻转后仍超出视口时，整体上移回弹层自身高度范围内
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - height - margin);
    }

    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function openDayPopover(cell, items, key) {
    closePopover();

    const el = document.createElement("div");
    el.className = "heatmap-popover";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", `${key} 的 ${items.length} 篇文章`);

    const header = document.createElement("div");
    header.className = "heatmap-popover-header";
    header.textContent = `${key} · ${items.length} 篇`;

    const list = document.createElement("ul");
    list.className = "heatmap-popover-list";
    items.forEach((post, index) => {
      const li = document.createElement("li");
      li.className = "heatmap-popover-item";
      const a = document.createElement("a");
      a.href = post.url;
      a.textContent = `${index + 1}. ${post.title}`;
      li.appendChild(a);
      list.appendChild(li);
    });

    el.appendChild(header);
    el.appendChild(list);
    document.body.appendChild(el);
    positionPopover(el, cell);

    popoverState.el = el;
    popoverState.owner = cell;
    cell.setAttribute("aria-haspopup", "dialog");
    cell.setAttribute("aria-expanded", "true");
  }

  document.addEventListener("click", (event) => {
    if (!popoverState.el) return;
    if (popoverState.el.contains(event.target)) return;
    closePopover();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePopover();
  });

  // 只在外层滚动时关闭弹层；弹层内部列表滚动（鼠标滚轮/拖滚动条）不关闭
  document.addEventListener(
    "scroll",
    (event) => {
      if (!popoverState.el) return;
      if (popoverState.el.contains(event.target)) return;
      closePopover();
    },
    true,
  );
  window.addEventListener("resize", closePopover);

  function bindDayCell(cell, items, tooltip, isToday) {
    const primary = items[0];
    const multiple = items.length > 1;
    const label = multiple
      ? `${items.length} 篇：${items.map((p) => p.title).join("、")}`
      : primary.title;

    cell.addEventListener("mouseenter", (event) => {
      tooltip.hidden = false;
      tooltip.textContent = `${isToday ? "今日 · " : ""}${label}`;
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;
    });
    cell.addEventListener("mousemove", (event) => {
      tooltip.style.left = `${event.clientX}px`;
      tooltip.style.top = `${event.clientY}px`;
    });
    cell.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });

    if (!multiple) {
      cell.addEventListener("click", () => {
        window.location.href = primary.url;
      });
      return;
    }

    // 多篇文章：点击切换当天文章列表弹层，可手动选择跳转
    cell.addEventListener("click", (event) => {
      event.stopPropagation();
      if (popoverState.owner === cell && popoverState.el) {
        closePopover();
      } else {
        openDayPopover(cell, items, cell.dataset.date);
      }
    });
  }

  function renderHeatmap(container, year) {
    const mode = container.dataset.mode || "archive";
    const posts = parsePosts(JSON.parse(container.dataset.json || "[]"));
    const dateMap = buildDateMap(posts);
    const { start, end, year: activeYear } = getRange(mode, year);
    const weeks = buildWeeks(start, end);
    const labels = monthLabels(weeks, start, end);
    const todayKey = dayKey(new Date());

    const tooltip = document.createElement("div");
    tooltip.className = "heatmap-tooltip";
    tooltip.hidden = true;

    const monthsEl = document.createElement("div");
    monthsEl.className = "heatmap-months";
    monthsEl.setAttribute("aria-hidden", "true");
    labels.forEach(({ index, label }) => {
      const span = document.createElement("span");
      span.className = "heatmap-month-label";
      span.style.gridColumnStart = String(index + 1);
      span.textContent = label;
      monthsEl.appendChild(span);
    });

    const grid = document.createElement("div");
    grid.className = "heatmap-grid";

    weeks.forEach((week) => {
      const column = document.createElement("div");
      column.className = "heatmap-week";
      week.forEach((day) => {
        // [2026-08-11] 文章模式：不渲染今日之后的未来格子（最后一个单元格 = 今日）
        if (day > end) return;

        const key = dayKey(day);
        const items = dateMap.get(key) || [];
        const inRange = day >= start && day <= end;
        const count = inRange ? items.length : 0;
        const level = levelForCount(count);
        const isToday = key === todayKey;

        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "heatmap-day";
        cell.dataset.level = String(level);
        cell.dataset.date = key;
        cell.disabled = count === 0;

        if (isToday) {
          cell.classList.add("is-today");
          cell.setAttribute("aria-current", "date");
        }

        const postLabel = count > 0
          ? (items.length > 1
            ? `${items.length} 篇文章`
            : items[0].title)
          : "无文章";
        cell.setAttribute(
          "aria-label",
          isToday ? `今日 ${key}：${postLabel}` : `${key}：${postLabel}`,
        );

        if (count > 0) {
          bindDayCell(cell, items, tooltip, isToday);
        }

        column.appendChild(cell);
      });
      if (column.childElementCount > 0) {
        grid.appendChild(column);
      }
    });

    // 以实际渲染的周列数为准，保证月份标签对齐
    const weekCount = grid.children.length;
    grid.style.setProperty("--heatmap-weeks", String(weekCount));
    monthsEl.style.setProperty("--heatmap-weeks", String(weekCount));

    const scrollEl = document.createElement("div");
    scrollEl.className = "heatmap-scroll";

    const innerEl = document.createElement("div");
    innerEl.className = "heatmap-inner";
    innerEl.style.setProperty("--heatmap-weeks", String(weekCount));

    innerEl.appendChild(monthsEl);
    innerEl.appendChild(grid);
    scrollEl.appendChild(innerEl);

    container.replaceChildren(scrollEl, tooltip);
    container.dataset.activeYear = String(activeYear);

    if (mode === "archive") {
      updateArchiveStat(activeYear, countPostsInYear(posts, activeYear));
    }
  }

  function updateArchiveStat(year, count) {
    const stat = document.getElementById("archive-heatmap-stat");
    if (stat) {
      stat.textContent = `${count} contributions in ${year}`;
    }
  }

  function filterArchiveList(year) {
    document.querySelectorAll(".archive-year-group").forEach((group) => {
      group.hidden = group.dataset.year !== String(year);
    });
  }

  function setupArchiveYearPicker(container, posts) {
    const years = getYearsFromPosts(posts);
    if (years.length === 0) return;

    const btn = document.getElementById("archive-year-btn");
    const menu = document.getElementById("archive-year-menu");
    const label = document.getElementById("archive-year-current");
    if (!btn || !menu || !label) return;

    let activeYear = years[0];

    menu.replaceChildren(
      ...years.map((year) => {
        const item = document.createElement("li");
        const option = document.createElement("button");
        option.type = "button";
        option.className = "archive-year-option";
        option.textContent = String(year);
        option.dataset.year = String(year);
        option.setAttribute("role", "option");
        option.addEventListener("click", () => selectYear(year));
        item.appendChild(option);
        return item;
      }),
    );

    function selectYear(year) {
      activeYear = year;
      label.textContent = String(year);
      menu.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      renderHeatmap(container, year);
      filterArchiveList(year);
    }

    btn.addEventListener("click", () => {
      const open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", (event) => {
      if (
        !menu.hidden &&
        !menu.contains(event.target) &&
        !btn.contains(event.target)
      ) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });

    selectYear(activeYear);
  }

  function init() {
    document.querySelectorAll("#heatmap-container").forEach((container) => {
      const mode = container.dataset.mode || "archive";
      if (mode === "archive") {
        const posts = parsePosts(JSON.parse(container.dataset.json || "[]"));
        setupArchiveYearPicker(container, posts);
      } else {
        renderHeatmap(container);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
