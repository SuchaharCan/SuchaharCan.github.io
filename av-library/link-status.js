(() => {
  const root = document.querySelector(".av-library");
  if (!root) return;

  // Chrome 会忽略 <video> 元素上的 referrerpolicy 属性（实测仍会带 Referer），
  // 这里兜底注入文档级 no-referrer 策略，避免 fourhoi.com 的防盗链返回 403。
  if (!document.querySelector('meta[name="referrer"]')) {
    const referrerMeta = document.createElement("meta");
    referrerMeta.name = "referrer";
    referrerMeta.content = "no-referrer";
    document.head.append(referrerMeta);
  }

  const CHECK_TIMEOUT = 6500;
  const actressSource = document.querySelector("#av-actress-source");
  const wall = root.querySelector("[data-av-wall]");
  const pagination = root.querySelector("[data-av-pagination]");
  const pageSize = Number(wall?.dataset.pageSize || 12);
  let actresses = [];
  let shuffledCards = [];
  let currentPage = 0;
  let missavHealthPromise = null;

  const actorPopover = document.createElement("aside");
  actorPopover.className = "av-actor-popover";
  actorPopover.id = "av-actor-popover";
  actorPopover.setAttribute("role", "tooltip");
  actorPopover.hidden = true;
  document.body.append(actorPopover);

  function escapeHtml(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function normalizeValue(value = "") {
    const clean = value.trim().replaceAll("`", "");
    return clean === "—" || clean === "-" ? "" : clean;
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, window.location.href);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function calculateAge(birthday) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return "";
    const [year, month, day] = birthday.split("-").map(Number);
    const today = new Date();
    let age = today.getFullYear() - year;
    const birthdayPassed =
      today.getMonth() + 1 > month ||
      (today.getMonth() + 1 === month && today.getDate() >= day);
    if (!birthdayPassed) age -= 1;
    return age >= 0 ? `${age}岁` : "";
  }

  const ACTRESS_HEADER_KEYS = {
    id: "id",
    姓名: "name",
    别名: "aliases",
    头像: "image",
    身高: "height",
    三围: "measurements",
    出生日期: "birthday",
    JavDB: "javdb",
  };

  function stripInlineMarkup(value) {
    return String(value)
      .replace(/<[^>]*>/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .trim();
  }

  function parseMarkdownActresses(source) {
    const lines = String(source).split(/\r?\n/);
    const tableLines = [];
    let inTable = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        tableLines.push(trimmed);
        inTable = true;
      } else if (inTable) {
        break;
      }
    }
    if (tableLines.length < 2) return [];

    const splitRow = (line) =>
      line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
    const headers = splitRow(tableLines[0]).map((header) => {
      const key = normalizeValue(header);
      return ACTRESS_HEADER_KEYS[key] || key;
    });

    return tableLines
      .slice(2)
      .map((line) => {
        const values = splitRow(line).map((cell) =>
          normalizeValue(stripInlineMarkup(cell)),
        );
        return Object.fromEntries(
          headers.map((header, index) => [header, values[index] || ""]),
        );
      })
      .filter((row) => row.id);
  }

  function parseActresses(source) {
    const doc = new DOMParser().parseFromString(source, "text/html");
    const table = doc.querySelector("table");
    if (!table) return parseMarkdownActresses(source);

    const headers = [...table.querySelectorAll("thead th")].map((cell) => {
      const header = normalizeValue(cell.textContent);
      return ACTRESS_HEADER_KEYS[header] || header;
    });
    return [...table.querySelectorAll("tbody tr")]
      .map((row) => {
        const values = [...row.querySelectorAll("td")].map((cell) =>
          normalizeValue(cell.textContent),
        );
        return Object.fromEntries(
          headers.map((header, index) => [header, values[index] || ""]),
        );
      })
      .filter((row) => row.id);
  }

  function actorById(id) {
    return actresses.find((actor) => actor.id === id);
  }

  function actorIds(container) {
    return (container.dataset.actorIds || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  function actorVisual(actor) {
    if (actor.image) {
      return `<img class="av-actor-avatar-image no-hover" src="${escapeHtml(actor.image)}" alt="${escapeHtml(actor.name)}头像" width="100" height="100" loading="lazy">`;
    }
    return `<span class="av-actor-initial" aria-hidden="true">${escapeHtml(actor.name.slice(0, 1))}</span>`;
  }

  function actorFacts(actor) {
    const age = calculateAge(actor.birthday);
    const birthday = actor.birthday
      ? `${actor.birthday}${age ? ` · ${age}` : ""}`
      : "生日待补";
    return [actor.height, actor.measurements, birthday]
      .filter(Boolean)
      .map((fact) => `<span class="av-actor-fact">${escapeHtml(fact)}</span>`)
      .join("");
  }

  function actorCardMarkup(actor) {
    const javdb = safeUrl(actor.javdb);
    return `<article class="av-actor-card" data-actor-id="${escapeHtml(actor.id)}"><div class="av-actor-avatar">${actorVisual(actor)}</div><div class="av-actor-copy"><div class="av-actor-heading"><div><p class="av-kicker">ACTRESS / 女优档案</p><p class="av-actor-name">${escapeHtml(actor.name)}</p></div>${javdb ? `<a class="av-actor-link" href="${escapeHtml(javdb)}" target="_blank" rel="noopener noreferrer">JavDB ↗</a>` : ""}</div><p class="av-actor-alias">${escapeHtml(actor.aliases || "别名待补")}</p><div class="av-actor-facts">${actorFacts(actor)}</div></div></article>`;
  }

  function actorTriggerMarkup(actor) {
    return `<button type="button" class="av-work-actress-link" data-actor-trigger="${escapeHtml(actor.id)}" aria-describedby="av-actor-popover">${escapeHtml(actor.name)}</button>`;
  }

  function renderActorBoxes(container) {
    if (!container) return;
    const linksBox = container.querySelector("[data-work-actress-links]");
    const cardsBox = container.querySelector("[data-work-actress-cards]");
    const actors = actorIds(container).map(actorById).filter(Boolean);
    if (linksBox) {
      linksBox.innerHTML = actors.length
        ? actors.map(actorTriggerMarkup).join("")
        : '<span class="av-work-actress-empty">素人</span>';
    }
    if (cardsBox) {
      cardsBox.innerHTML = actors.length
        ? actors.map(actorCardMarkup).join("")
        : '<p class="av-mini-empty">人物资料待补</p>';
    }
  }

  function positionActorPopover(trigger) {
    if (actorPopover.hidden) return;
    const margin = 12;
    const rect = trigger.getBoundingClientRect();
    const box = actorPopover.getBoundingClientRect();
    let left = rect.right + margin;
    let top = rect.top;
    if (left + box.width > window.innerWidth - margin) {
      left = rect.left - box.width - margin;
    }
    if (top + box.height > window.innerHeight - margin) {
      top = window.innerHeight - box.height - margin;
    }
    actorPopover.style.left = `${Math.max(margin, left)}px`;
    actorPopover.style.top = `${Math.max(margin, top)}px`;
  }

  function showActorPopover(actorId, trigger) {
    const actor = actorById(actorId);
    if (!actor) return;
    actorPopover.innerHTML = actorCardMarkup(actor);
    actorPopover.hidden = false;
    positionActorPopover(trigger);
  }

  function hideActorPopover() {
    actorPopover.hidden = true;
  }

  // 基于「日期 + 小时」的种子伪随机：同一小时内顺序完全固定，
  // 翻页、来回翻页看到的一致；跨小时（或第二天）种子变化，顺序更新。
  function hourlySeed() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
    ].join("-");
  }

  function hashSeed(value) {
    let hash = 2166136261 >>> 0; // FNV-1a
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    let state = seed | 0;
    return function next() {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(items) {
    const array = [...items];
    const random = mulberry32(hashSeed(hourlySeed()));
    for (let i = array.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function renderPage(page) {
    currentPage = Math.max(
      0,
      Math.min(page, Math.ceil(shuffledCards.length / pageSize) - 1),
    );
    const start = currentPage * pageSize;
    const slice = shuffledCards.slice(start, start + pageSize);
    for (const card of shuffledCards) {
      const visible = slice.includes(card);
      card.hidden = !visible;
      if (visible) wall.append(card);
    }
    renderPagination();
  }

  function renderPagination() {
    if (!pagination) return;
    const pages = Math.max(1, Math.ceil(shuffledCards.length / pageSize));
    pagination.innerHTML = "";
    for (let page = 0; page < pages; page += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "av-pagination-button";
      button.textContent = String(page + 1);
      button.dataset.page = String(page);
      button.setAttribute("aria-label", `第 ${page + 1} 页`);
      if (page === currentPage) {
        button.classList.add("is-active");
        button.setAttribute("aria-current", "page");
      }
      pagination.append(button);
    }
  }

  function activateTab(workCard, tabName, focusTab = false) {
    const buttons = [...workCard.querySelectorAll("[data-tab-button]")];
    const panels = [...workCard.querySelectorAll("[data-tab-panel]")];
    for (const button of buttons) {
      const selected = button.dataset.tabButton === tabName;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) button.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.tabPanel !== tabName;
    }
  }

  function stageMedia(stage) {
    return {
      stage,
      image:
        stage.querySelector("[data-media-image]") ||
        stage.querySelector("[data-remote-cover]"),
      video: stage.querySelector("[data-remote-preview]"),
      hint: stage.querySelector("[data-media-hint]"),
      indicator: stage.querySelector("[data-media-play-indicator]"),
    };
  }

  function markStagePlaying(stage, playing) {
    stage.classList.toggle("is-playing", playing);
    if (playing) stage.classList.remove("is-error");
    const media = stageMedia(stage);
    if (media.indicator) media.indicator.textContent = playing ? "Ⅱ" : "▶";
    if (media.hint) {
      media.hint.textContent = stage.classList.contains("is-fallback")
        ? "MissAV 预览不可用"
        : stage.classList.contains("is-error")
          ? stage.dataset.errorText || "预览失败"
          : "悬停自动播放 MissAV 预览";
    }
  }

  async function playStage(stage) {
    const media = stageMedia(stage);
    if (!media.video) return;
    if (stage.classList.contains("is-fallback")) {
      markStagePlaying(stage, true);
      return;
    }
    media.video.muted = true;
    try {
      media.video.currentTime = 0;
      await media.video.play();
      markStagePlaying(stage, true);
    } catch (error) {
      stage.classList.add("is-error");
      stage.dataset.errorText = `预览失败：${error.name}`;
      markStagePlaying(stage, false);
    }
  }

  function pauseStage(stage) {
    const media = stageMedia(stage);
    if (media.video && !media.video.paused) {
      media.video.pause();
      media.video.currentTime = 0;
    }
    markStagePlaying(stage, false);
  }

  function useStageFallback(stage) {
    stage.classList.add("is-fallback");
    const code = stage.closest("[data-work-code]")?.dataset.workCode;
    const image =
      stage.querySelector("[data-media-image]") ||
      stage.querySelector("[data-remote-cover]");
    if (image && code && code.toLowerCase() === "ipx-811") {
      image.src = "./image/AV/IPX-811-01.gif";
    }
  }

  function bindStageVideo(video) {
    if (!video || video.dataset.bound) return;
    video.dataset.bound = "true";
    video.setAttribute("referrerpolicy", "no-referrer");
    video.addEventListener("playing", () =>
      markStagePlaying(video.closest("[data-media-stage]"), true),
    );
    video.addEventListener("pause", () => {
      const stage = video.closest("[data-media-stage]");
      if (!stage.classList.contains("is-fallback")) {
        markStagePlaying(stage, false);
      }
    });
    video.addEventListener("error", () => {
      const stage = video.closest("[data-media-stage]");
      stage.classList.add("is-error");
      stage.dataset.errorText = `资源加载失败（code=${video.error?.code || "?"}）`;
      markStagePlaying(stage, false);
    });
  }

  function toggleStage(stage) {
    if (stage.classList.contains("is-playing")) {
      pauseStage(stage);
    } else {
      playStage(stage);
    }
  }

  function readableOrigin(target) {
    try {
      return new URL(target.href).origin;
    } catch {
      return "";
    }
  }

  async function probe(origin) {
    if (!navigator.onLine) return false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CHECK_TIMEOUT);
    try {
      await fetch(`${origin}/`, {
        mode: "no-cors",
        method: "HEAD",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
      });
      return true;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function updateHealth(target, online) {
    target.classList.toggle("is-online", online);
    target.classList.toggle("is-offline", !online);
    const label = target.querySelector("[data-health-label]");
    if (label) label.textContent = online ? "网络可达" : "待维护";
  }

  async function checkMissavOnce() {
    if (missavHealthPromise) return missavHealthPromise;
    const targets = [...root.querySelectorAll('[data-link-health="missav"]')];
    if (!targets.length) return false;
    const origin = readableOrigin(targets[0]);
    if (!origin) {
      for (const target of targets) updateHealth(target, false);
      return false;
    }
    for (const target of targets) target.setAttribute("aria-busy", "true");
    missavHealthPromise = probe(origin);
    const online = await missavHealthPromise;
    for (const target of root.querySelectorAll('[data-link-health="missav"]')) {
      updateHealth(target, online);
    }
    return online;
  }

  async function copyMagnet(button) {
    const source = root.querySelector(button.dataset.copyTarget);
    if (!source) return;
    const label = button.querySelector("[data-copy-label]");
    const originalLabel = label?.textContent || "复制磁力";
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      if (label) label.textContent = "已复制";
    } catch {
      if (label) label.textContent = "复制失败";
    }
    window.setTimeout(() => {
      if (label) label.textContent = originalLabel;
    }, 1600);
  }

  root.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-copy-target]");
    if (copyButton) {
      await copyMagnet(copyButton);
      return;
    }

    const tabButton = event.target.closest("[data-tab-button]");
    if (tabButton) {
      activateTab(
        tabButton.closest("[data-work-card]"),
        tabButton.dataset.tabButton,
      );
      return;
    }

    const stage = event.target.closest("[data-media-stage]");
    if (stage && !event.target.closest("a")) {
      toggleStage(stage);
      return;
    }
  });

  root.addEventListener("keydown", (event) => {
    const stage = event.target.closest("[data-media-stage]");
    if (
      stage &&
      event.target.closest("[data-media-image]") &&
      ["Enter", " "].includes(event.key)
    ) {
      event.preventDefault();
      toggleStage(stage);
      return;
    }

    const tab = event.target.closest("[data-tab-button]");
    if (!tab) return;
    const tabList = tab.closest("[role='tablist']");
    const tabs = [...tabList.querySelectorAll("[data-tab-button]")];
    const currentIndex = tabs.indexOf(tab);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight")
      nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    activateTab(
      tab.closest("[data-work-card]"),
      tabs[nextIndex].dataset.tabButton,
      true,
    );
  });

  root.addEventListener("pointerover", (event) => {
    const trigger = event.target.closest("[data-actor-trigger]");
    if (trigger) showActorPopover(trigger.dataset.actorTrigger, trigger);
    const stage = event.target.closest("[data-media-stage]");
    if (stage) playStage(stage);
  });

  root.addEventListener("pointerout", (event) => {
    const trigger = event.target.closest("[data-actor-trigger]");
    if (trigger && !trigger.contains(event.relatedTarget)) hideActorPopover();
    const stage = event.target.closest("[data-media-stage]");
    if (stage && !stage.contains(event.relatedTarget)) pauseStage(stage);
  });

  root.addEventListener("focusin", (event) => {
    const trigger = event.target.closest("[data-actor-trigger]");
    if (trigger) showActorPopover(trigger.dataset.actorTrigger, trigger);
  });

  root.addEventListener("focusout", (event) => {
    if (!event.relatedTarget?.closest?.("[data-actor-trigger]"))
      hideActorPopover();
  });

  pagination?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (button) renderPage(Number(button.dataset.page));
  });

  window.addEventListener("scroll", hideActorPopover, { passive: true });
  window.addEventListener("resize", hideActorPopover);
  const cards = [...root.querySelectorAll(".av-wall-card")];
  actresses = actressSource ? parseActresses(actressSource.textContent) : [];
  root.querySelectorAll("[data-media-stage]").forEach((stage) => {
    const image = stage.querySelector("img");
    if (image) stage.style.setProperty("--av-cover", `url("${image.src}")`);
  });
  root.querySelectorAll("[data-remote-preview]").forEach(bindStageVideo);
  shuffledCards = shuffle(cards);
  for (const card of cards) renderActorBoxes(card);
  wall.append(...shuffledCards);
  renderPage(0);
  checkMissavOnce();
})();
