(function () {
  "use strict";

  var MONTH_NAMES = [
    "全年",
    "1月",
    "2月",
    "3月",
    "4月",
    "5月",
    "6月",
    "7月",
    "8月",
    "9月",
    "10月",
    "11月",
    "12月",
  ];
  var DAYS_PER_WEEK = 7;

  function parsePosts(raw) {
    return raw.map(function (item) {
      var parts = item.split("|");
      return {
        weekStart: parts[0],
        weekEnd: parts[1] || parts[0],
        url: parts[2],
        title: parts.slice(3, parts.length - 1).join("|"),
        progress: Number(parts[parts.length - 1]) || 0,
      };
    });
  }

  function toUtcDay(dateStr) {
    var p = dateStr.split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function daySpan(start, end) {
    if (!start || !end) return 7;
    return Math.max(1, Math.round((toUtcDay(end) - toUtcDay(start)) / 86400000) + 1);
  }

  function yearOf(dateStr) {
    return parseInt(dateStr.slice(0, 4), 10);
  }

  function monthOf(dateStr) {
    return parseInt(dateStr.slice(5, 7), 10);
  }

  function overlapsMonth(post, year, month) {
    if (yearOf(post.weekStart) !== year && yearOf(post.weekEnd) !== year) return false;
    if (!month) return yearOf(post.weekStart) === year || yearOf(post.weekEnd) === year;
    return monthOf(post.weekStart) === month || monthOf(post.weekEnd) === month;
  }

  function getYears(posts) {
    var set = new Set();
    posts.forEach(function (p) {
      set.add(yearOf(p.weekStart));
      if (p.weekEnd) set.add(yearOf(p.weekEnd));
    });
    return Array.from(set).sort(function (a, b) {
      return b - a;
    });
  }

  function getMonthsInYear(posts, year) {
    var set = new Set();
    posts.forEach(function (p) {
      if (overlapsMonth(p, year, null)) {
        set.add(monthOf(p.weekStart));
        if (p.weekEnd) set.add(monthOf(p.weekEnd));
      }
    });
    return Array.from(set).sort(function (a, b) {
      return a - b;
    });
  }

  function allMonthOptions() {
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  }

  function startOfWeekMonday(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var day = d.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function addDays(date, days) {
    var next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function dayKey(date) {
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function siteTimezone() {
    var list = document.getElementById("kanban-week-list");
    return (list && list.dataset.timezone) || "Asia/Shanghai";
  }

  function clockInTimezone(tz) {
    if (typeof KanbanRules !== "undefined" && KanbanRules.clockInTimezone) {
      return KanbanRules.clockInTimezone(tz);
    }
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

  function getTodayContext(tz) {
    var c = clockInTimezone(tz);
    return {
      dateKey: c.date,
      year: yearOf(c.date),
      month: monthOf(c.date),
    };
  }

  function isDateInWeek(dateKey, week) {
    var d = toUtcDay(dateKey);
    var ps = toUtcDay(week.key);
    var pe = toUtcDay(dayKey(week.end));
    return d >= ps && d <= pe;
  }

  function appendTodayMarker(slot) {
    var marker = document.createElement("span");
    marker.className = "kanban-heatmap-today-marker";
    marker.setAttribute("aria-hidden", "true");
    slot.appendChild(marker);
    return marker;
  }

  function wrapWeekCell(cell, week, todayCtx, viewYear) {
    var slot = document.createElement("div");
    slot.className = "kanban-heatmap-week-slot";
    slot.appendChild(cell);
    appendTodayMarker(slot);
    if (viewYear === todayCtx.year && isDateInWeek(todayCtx.dateKey, week)) {
      slot.classList.add("is-current");
    }
    return slot;
  }

  function wrapDayCell(cell, dateKey, todayCtx, viewYear, viewMonth) {
    var slot = document.createElement("div");
    slot.className = "kanban-heatmap-day-slot";
    slot.appendChild(cell);
    appendTodayMarker(slot);
    if (
      viewYear === todayCtx.year &&
      viewMonth === todayCtx.month &&
      dateKey === todayCtx.dateKey
    ) {
      slot.classList.add("is-current");
    }
    return slot;
  }

  function enumerateDays(startDate, endDate) {
    var days = [];
    var cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    var end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    while (cur <= end) {
      days.push(dayKey(cur));
      cur = addDays(cur, 1);
    }
    return days;
  }

  function weeksInMonth(year, month) {
    var start = new Date(year, month - 1, 1);
    var end = new Date(year, month, 0);
    var weeks = [];
    var cursor = startOfWeekMonday(start);
    var seen = new Set();
    while (cursor <= addDays(end, 6)) {
      var weekStart = new Date(cursor);
      var weekEnd = addDays(cursor, 6);
      var key = dayKey(weekStart);
      if (!seen.has(key)) {
        var touchesMonth = enumerateDays(weekStart, weekEnd).some(function (dk) {
          return monthOf(dk) === month && yearOf(dk) === year;
        });
        if (touchesMonth) {
          weeks.push({ start: weekStart, end: weekEnd, key: key });
          seen.add(key);
        }
      }
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }

  function weekCoverage(posts, week) {
    var weekDays = enumerateDays(week.start, week.end);
    var covered = new Set();
    var overlapping = [];

    posts.forEach(function (p) {
      var ps = toUtcDay(p.weekStart);
      var pe = toUtcDay(p.weekEnd || p.weekStart);
      var touched = false;
      weekDays.forEach(function (dk) {
        var d = toUtcDay(dk);
        if (d >= ps && d <= pe) {
          covered.add(dk);
          touched = true;
        }
      });
      if (touched) overlapping.push(p);
    });

    var fill = covered.size / DAYS_PER_WEEK;
    var avgProgress = overlapping.length
      ? overlapping.reduce(function (s, p) {
          return s + p.progress;
        }, 0) / overlapping.length
      : 0;

    return {
      fill: fill,
      covered: covered.size,
      overlapping: overlapping,
      avgProgress: avgProgress,
      full: covered.size >= DAYS_PER_WEEK,
    };
  }

  function levelForProgress(pct) {
    if (pct >= 100) return 4;
    if (pct >= 60) return 3;
    if (pct >= 30) return 2;
    return 1;
  }

  function isDayCovered(posts, dateKey) {
    var d = toUtcDay(dateKey);
    return posts.filter(function (p) {
      var ps = toUtcDay(p.weekStart);
      var pe = toUtcDay(p.weekEnd || p.weekStart);
      return d >= ps && d <= pe;
    });
  }

  function bindTooltip(cell, tooltip, textFn) {
    cell.addEventListener("mouseenter", function (e) {
      tooltip.hidden = false;
      tooltip.textContent = textFn();
      tooltip.style.left = e.clientX + "px";
      tooltip.style.top = e.clientY + "px";
    });
    cell.addEventListener("mousemove", function (e) {
      tooltip.style.left = e.clientX + "px";
      tooltip.style.top = e.clientY + "px";
    });
    cell.addEventListener("mouseleave", function () {
      tooltip.hidden = true;
    });
  }

  function scrollToPost(post) {
    if (!post) return;
    var card = document.querySelector(
      '.kanban-week-card[data-week-start="' + post.weekStart + '"]',
    );
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      card.classList.add("kanban-week-card--highlight");
      setTimeout(function () {
        card.classList.remove("kanban-week-card--highlight");
      }, 1600);
    } else {
      window.location.href = post.url;
    }
  }

  function createWeekCell(week, posts, tooltip) {
    var cov = weekCoverage(posts, week);
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "heatmap-week-cell";
    cell.dataset.weekStart = week.key;
    cell.style.setProperty("--week-fill", String(cov.fill));

    if (cov.covered === 0) {
      cell.disabled = true;
      cell.dataset.level = "0";
      cell.setAttribute("aria-label", week.key + ": 无看板覆盖");
      return cell;
    }

    var level = levelForProgress(cov.avgProgress);
    cell.dataset.level = String(level);
    if (!cov.full) cell.classList.add("is-partial");

    var titles = cov.overlapping.map(function (p) {
      return p.title;
    });
    cell.setAttribute(
      "aria-label",
      week.key +
        ": " +
        cov.covered +
        "/" +
        DAYS_PER_WEEK +
        " 天 · " +
        titles.join("；"),
    );

    bindTooltip(cell, tooltip, function () {
      return (
        cov.covered +
        "/" +
        DAYS_PER_WEEK +
        " 天有效 · " +
        Math.round(cov.avgProgress) +
        "% · " +
        titles.join("；")
      );
    });

    cell.addEventListener("click", function () {
      scrollToPost(cov.overlapping[0]);
    });

    return cell;
  }

  function createDayCell(date, posts, tooltip) {
    var key = dayKey(date);
    var matching = isDayCovered(posts, key);
    var cell = document.createElement("button");
    cell.type = "button";
    cell.className = "heatmap-day-cell";
    cell.dataset.date = key;

    if (!matching.length) {
      cell.disabled = true;
      cell.dataset.level = "0";
      cell.setAttribute("aria-label", key + ": 未纳入看板");
      return cell;
    }

    var avg =
      matching.reduce(function (s, p) {
        return s + p.progress;
      }, 0) / matching.length;
    cell.dataset.level = String(levelForProgress(avg));
    cell.style.setProperty("--week-fill", "1");

    var titles = matching.map(function (p) {
      return p.title;
    });
    cell.setAttribute("aria-label", key + ": " + titles.join("；"));

    bindTooltip(cell, tooltip, function () {
      return key + " · " + titles.join("；");
    });

    cell.addEventListener("click", function () {
      scrollToPost(matching[0]);
    });

    return cell;
  }

  function renderYearHeatmap(container, posts, year, tooltip) {
    var todayCtx = getTodayContext(siteTimezone());
    var root = document.createElement("div");
    root.className = "kanban-heatmap-year";

    [[1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12]].forEach(function (months) {
      var semester = document.createElement("div");
      semester.className = "kanban-heatmap-semester";

      months.forEach(function (m) {
        var block = document.createElement("div");
        block.className = "kanban-heatmap-month-block";
        block.dataset.month = String(m);

        var label = document.createElement("span");
        label.className = "kanban-heatmap-month-block-label";
        label.textContent = MONTH_NAMES[m];
        block.appendChild(label);

        var weekRow = document.createElement("div");
        weekRow.className = "kanban-heatmap-month-weeks";

        weeksInMonth(year, m).forEach(function (week) {
          weekRow.appendChild(
            wrapWeekCell(createWeekCell(week, posts, tooltip), week, todayCtx, year),
          );
        });

        block.appendChild(weekRow);
        semester.appendChild(block);
      });

      root.appendChild(semester);
    });

    var scrollEl = document.createElement("div");
    scrollEl.className = "heatmap-scroll heatmap-scroll--kanban-year";
    scrollEl.appendChild(root);
    container.replaceChildren(scrollEl, tooltip);
  }

  function renderMonthDailyHeatmap(container, posts, year, month, tooltip) {
    var todayCtx = getTodayContext(siteTimezone());
    var start = new Date(year, month - 1, 1);
    var end = new Date(year, month, 0);
    var days = enumerateDays(start, end);

    var header = document.createElement("div");
    header.className = "kanban-heatmap-daily-header";
    header.textContent = year + " 年 " + month + " 月 · 按天查看";

    var grid = document.createElement("div");
    grid.className = "kanban-heatmap-daily-grid";
    grid.style.setProperty("--kanban-days", String(days.length));

    days.forEach(function (dk) {
      var parts = dk.split("-").map(Number);
      var date = new Date(parts[0], parts[1] - 1, parts[2]);
      grid.appendChild(
        wrapDayCell(createDayCell(date, posts, tooltip), dk, todayCtx, year, month),
      );
    });

    var labels = document.createElement("div");
    labels.className = "kanban-heatmap-daily-labels";
    labels.setAttribute("aria-hidden", "true");
    days.forEach(function (dk, i) {
      var dayNum = parseInt(dk.slice(8, 10), 10);
      if (dayNum === 1 || dayNum % 5 === 0) {
        var span = document.createElement("span");
        span.className = "kanban-heatmap-daily-label";
        span.style.gridColumnStart = String(i + 1);
        span.textContent = String(dayNum);
        labels.appendChild(span);
      }
    });

    var wrap = document.createElement("div");
    wrap.className = "kanban-heatmap-daily";
    wrap.appendChild(header);
    wrap.appendChild(labels);
    wrap.appendChild(grid);

    var scrollEl = document.createElement("div");
    scrollEl.className = "heatmap-scroll heatmap-scroll--kanban-month";
    scrollEl.appendChild(wrap);
    container.replaceChildren(scrollEl, tooltip);
  }

  function renderHeatmap(container, posts, year, month) {
    var tooltip = document.createElement("div");
    tooltip.className = "heatmap-tooltip";
    tooltip.hidden = true;

    if (month) {
      renderMonthDailyHeatmap(container, posts, year, month, tooltip);
    } else {
      renderYearHeatmap(container, posts, year, tooltip);
    }
  }

  function updateStat(posts, year, month) {
    var stat = document.getElementById("kanban-heatmap-stat");
    if (!stat) return;
    if (month) {
      stat.textContent = year + " 年 " + month + " 月";
    } else {
      stat.textContent = year + " 年";
    }
  }

  function sortCardsDesc(cards) {
    return cards.sort(function (a, b) {
      return b.dataset.weekStart.localeCompare(a.dataset.weekStart);
    });
  }

  function applyCardHeights(cards) {
    if (typeof KanbanRules !== "undefined" && KanbanRules.applyListCardMetrics) {
      cards.forEach(function (card) {
        KanbanRules.applyListCardMetrics(card);
      });
    }
  }

  function regroupList(listEl, cards, year, month) {
    var visible = cards.filter(function (card) {
      var ws = card.dataset.weekStart;
      var we = card.dataset.weekEnd || ws;
      if (yearOf(ws) !== year && yearOf(we) !== year) return false;
      if (!month) return yearOf(ws) === year || yearOf(we) === year;
      return monthOf(ws) === month || monthOf(we) === month;
    });
    sortCardsDesc(visible);
    listEl.replaceChildren();

    if (!month) {
      var byMonth = new Map();
      visible.forEach(function (card) {
        var m = monthOf(card.dataset.weekStart);
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(card);
      });
      Array.from(byMonth.keys())
        .sort(function (a, b) {
          return b - a;
        })
        .forEach(function (m) {
          var group = document.createElement("div");
          group.className = "kanban-month-group";
          group.dataset.month = String(m);
          group.dataset.year = String(year);
          var title = document.createElement("h2");
          title.className = "kanban-month-group-title";
          title.textContent = year + " 年 " + m + " 月";
          group.appendChild(title);
          var inner = document.createElement("div");
          inner.className = "kanban-month-group-cards";
          byMonth.get(m).forEach(function (card) {
            card.hidden = false;
            inner.appendChild(card);
          });
          group.appendChild(inner);
          listEl.appendChild(group);
        });
    } else {
      var flat = document.createElement("div");
      flat.className = "kanban-month-group-cards kanban-month-group-cards--flat";
      visible.forEach(function (card) {
        card.hidden = false;
        flat.appendChild(card);
      });
      listEl.appendChild(flat);
    }

    applyCardHeights(visible);
  }

  function setupPicker(btnId, menuId, labelId, options, onSelect, formatLabel) {
    var btn = document.getElementById(btnId);
    var menu = document.getElementById(menuId);
    var label = document.getElementById(labelId);
    if (!btn || !menu || !label) return null;

    menu.replaceChildren(
      ...options.map(function (opt) {
        var item = document.createElement("li");
        var option = document.createElement("button");
        option.type = "button";
        option.className = "archive-year-option";
        option.textContent = formatLabel(opt);
        option.dataset.value = String(opt);
        option.setAttribute("role", "option");
        option.addEventListener("click", function () {
          onSelect(opt);
          label.textContent = formatLabel(opt);
          menu.hidden = true;
          btn.setAttribute("aria-expanded", "false");
        });
        item.appendChild(option);
        return item;
      }),
    );

    btn.addEventListener("click", function () {
      var open = menu.hidden;
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });

    document.addEventListener("click", function (e) {
      if (!menu.hidden && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.hidden = true;
        btn.setAttribute("aria-expanded", "false");
      }
    });

    return {
      setLabel: function (v) {
        label.textContent = formatLabel(v);
      },
    };
  }

  function init() {
    var container = document.getElementById("kanban-heatmap-container");
    var listEl = document.getElementById("kanban-week-list");
    if (!container || !listEl) return;
    if (container.dataset.kanbanHeatmapInit === "1") return;
    container.dataset.kanbanHeatmapInit = "1";

    var posts = parsePosts(JSON.parse(container.dataset.json || "[]"));
    var allCards = Array.from(listEl.querySelectorAll(".kanban-week-card"));
    var years = getYears(posts);
    var todayCtx = getTodayContext(siteTimezone());
    if (years.length === 0) years = [todayCtx.year];

    var activeYear = years.indexOf(todayCtx.year) >= 0 ? todayCtx.year : years[0];
    var activeMonth = activeYear === todayCtx.year ? todayCtx.month : 0;

    function refresh() {
      renderHeatmap(container, posts, activeYear, activeMonth || null);
      updateStat(posts, activeYear, activeMonth || null);
      regroupList(listEl, allCards, activeYear, activeMonth || null);
    }

    setupPicker(
      "kanban-year-btn",
      "kanban-year-menu",
      "kanban-year-current",
      years,
      function (year) {
        activeYear = year;
        activeMonth = 0;
        monthPicker.setLabel(0);
        rebuildMonthMenu();
        refresh();
      },
      function (y) {
        return String(y);
      },
    );

    var monthPicker = setupPicker(
      "kanban-month-btn",
      "kanban-month-menu",
      "kanban-month-current",
      [0],
      function (m) {
        activeMonth = m;
        refresh();
      },
      function (m) {
        return MONTH_NAMES[m] || "全年";
      },
    );

    function rebuildMonthMenu() {
      var menu = document.getElementById("kanban-month-menu");
      if (!menu) return;
      menu.replaceChildren(
        ...allMonthOptions().map(function (opt) {
          var item = document.createElement("li");
          var option = document.createElement("button");
          option.type = "button";
          option.className = "archive-year-option";
          option.textContent = MONTH_NAMES[opt];
          option.dataset.value = String(opt);
          option.setAttribute("role", "option");
          option.addEventListener("click", function () {
            activeMonth = opt;
            if (monthPicker) monthPicker.setLabel(opt);
            menu.hidden = true;
            document
              .getElementById("kanban-month-btn")
              .setAttribute("aria-expanded", "false");
            refresh();
          });
          item.appendChild(option);
          return item;
        }),
      );
    }

    rebuildMonthMenu();
    if (monthPicker) monthPicker.setLabel(activeMonth);
    document.getElementById("kanban-year-current").textContent = String(activeYear);
    refresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
