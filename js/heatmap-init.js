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

  function getRange(mode, year) {
    const today = startOfDay(new Date());
    if (mode === "article") {
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: new Date(today.getFullYear(), today.getMonth() + 1, 0),
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

  function bindDayCell(cell, items, tooltip) {
    const primary = items[0];
    cell.addEventListener("mouseenter", (event) => {
      tooltip.hidden = false;
      tooltip.textContent = primary.title;
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
    cell.addEventListener("click", () => {
      window.location.href = primary.url;
    });
  }

  function renderHeatmap(container, year) {
    const mode = container.dataset.mode || "archive";
    const posts = parsePosts(JSON.parse(container.dataset.json || "[]"));
    const dateMap = buildDateMap(posts);
    const { start, end, year: activeYear } = getRange(mode, year);
    const weeks = buildWeeks(start, end);
    const labels = monthLabels(weeks, start, end);

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
    grid.style.setProperty("--heatmap-weeks", String(weeks.length));

    weeks.forEach((week) => {
      const column = document.createElement("div");
      column.className = "heatmap-week";
      week.forEach((day) => {
        const key = dayKey(day);
        const items = dateMap.get(key) || [];
        const inRange = day >= start && day <= end;
        const count = inRange ? items.length : 0;
        const level = levelForCount(count);
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "heatmap-day";
        cell.dataset.level = String(level);
        cell.dataset.date = key;
        cell.disabled = count === 0;
        cell.setAttribute(
          "aria-label",
          count > 0 ? `${key}: ${items[0].title}` : key,
        );

        if (count > 0) {
          bindDayCell(cell, items, tooltip);
        }

        column.appendChild(cell);
      });
      grid.appendChild(column);
    });

    const scrollEl = document.createElement("div");
    scrollEl.className = "heatmap-scroll";

    const innerEl = document.createElement("div");
    innerEl.className = "heatmap-inner";
    innerEl.style.setProperty("--heatmap-weeks", String(weeks.length));

    monthsEl.style.setProperty("--heatmap-weeks", String(weeks.length));

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
