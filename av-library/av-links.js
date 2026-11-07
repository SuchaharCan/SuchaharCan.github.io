(() => {
  const root = document.querySelector(".av-library");
  if (!root) return;

  const CACHE_KEY = "av-library-links-v1";
  const CACHE_TTL = 3 * 24 * 60 * 60 * 1000;
  const TIMEOUT = 9000;

  function missavUrl(code) {
    return `https://missav123.com/cn/${code.toLowerCase()}`;
  }

  function javdbSearchUrl(code) {
    return `https://javdb.com/search?q=${encodeURIComponent(code)}&f=all`;
  }

  function previewUrl(code) {
    return `https://fourhoi.com/${code.toLowerCase()}/preview.mp4`;
  }

  function coverUrl(code) {
    return `https://fourhoi.com/${code.toLowerCase()}/cover.jpg`;
  }

  function readCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeCache(cache) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // Ignore quota errors.
    }
  }

  async function fetchText(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), TIMEOUT);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function fetchMissavHtml(code) {
    const target = missavUrl(code);
    const proxies = [
      (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
      (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
      (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
      (url) => `https://r.jina.ai/http://${url.replace(/^https?:\/\//, "")}`,
    ];

    for (const build of proxies) {
      try {
        const text = await fetchText(build(target));
        if (!text) continue;
        if (text.trim().startsWith("{")) {
          try {
            const parsed = JSON.parse(text);
            if (parsed?.contents) return parsed.contents;
          } catch {
            // Fall through to raw text.
          }
        }
        return text;
      } catch {
        // Try the next proxy.
      }
    }

    return "";
  }

  function extractMeta(html, code) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const canonical =
      doc.querySelector('link[rel="canonical"]')?.href || missavUrl(code);
    const video = [...doc.querySelectorAll("video[src]")]
      .map((node) => node.getAttribute("src"))
      .find((src) => src.includes("fourhoi.com"));
    const cover = [...doc.querySelectorAll("img[src]")]
      .map((node) => node.getAttribute("src"))
      .find((src) => src.includes(`${code.toLowerCase()}/cover`));
    const javdb = [...doc.querySelectorAll('a[href*="javdb.com"]')]
      .map((node) => node.getAttribute("href"))
      .find((href) => /\/v\/[A-Za-z0-9]+/.test(href));

    return {
      missav: canonical,
      javdb: javdb || javdbSearchUrl(code),
      preview: video || previewUrl(code),
      cover: cover || coverUrl(code),
    };
  }

  function extractMetaFromMarkdown(markdown, code) {
    const javdb = markdown.match(/https:\/\/javdb\.com\/v\/[A-Za-z0-9]+/)?.[0];
    const missav = markdown.match(
      /https:\/\/missav123\.com\/(?:[^/]+\/)?cn\/[a-z0-9-]+/i,
    )?.[0];
    return {
      missav: missav || missavUrl(code),
      javdb: javdb || javdbSearchUrl(code),
      preview: previewUrl(code),
      cover: coverUrl(code),
    };
  }

  function applyMeta(card, meta) {
    card.dataset.missav = meta.missav;
    card.dataset.javdb = meta.javdb;
    card.dataset.remotePreview = meta.preview;
    card.dataset.remoteCover = meta.cover;

    for (const link of card.querySelectorAll("[data-link-kind='missav']")) {
      link.href = meta.missav;
    }
    for (const link of card.querySelectorAll("[data-link-kind='javdb']")) {
      link.href = meta.javdb;
    }
    for (const media of card.querySelectorAll("[data-remote-preview]")) {
      if (media.src !== meta.preview) media.src = meta.preview;
    }
    for (const image of card.querySelectorAll("[data-remote-cover]")) {
      if (image.src !== meta.cover) image.src = meta.cover;
    }

    const template = card.querySelector("[data-work-detail]");
    if (template) {
      for (const link of template.content.querySelectorAll("[data-link-kind='missav']")) {
        link.href = meta.missav;
      }
      for (const link of template.content.querySelectorAll("[data-link-kind='javdb']")) {
        link.href = meta.javdb;
      }
      for (const media of template.content.querySelectorAll("[data-remote-preview]")) {
        media.src = meta.preview;
      }
      for (const image of template.content.querySelectorAll("[data-remote-cover]")) {
        image.src = meta.cover;
      }
    }
    card.dataset.links = "resolved";
  }

  async function resolveCard(card, cache) {
    const code = card.dataset.workCode;
    const cached = cache[code];
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      applyMeta(card, cached.meta);
      return;
    }

    const fallback = {
      missav: missavUrl(code),
      javdb: javdbSearchUrl(code),
      preview: previewUrl(code),
      cover: coverUrl(code),
    };

    const html = await fetchMissavHtml(code);
    let meta = fallback;
    if (html) {
      meta = html.includes("<!doctype") || html.includes("<html")
        ? extractMeta(html, code)
        : extractMetaFromMarkdown(html, code);
    }

    applyMeta(card, meta);
    cache[code] = { time: Date.now(), meta };
    writeCache(cache);
  }

  const cards = [...root.querySelectorAll("[data-work-card]")];
  const cache = readCache();
  let cursor = 0;

  async function worker() {
    while (cursor < cards.length) {
      const index = cursor;
      cursor += 1;
      await resolveCard(cards[index], cache);
    }
  }

  const workers = Array.from(
    { length: Math.min(2, cards.length) },
    () => worker(),
  );
  Promise.allSettled(workers);
})();
