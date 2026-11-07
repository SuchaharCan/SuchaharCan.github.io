(function () {
  "use strict";

  /* APP cards: remember the description height for the hover reveal. */
  function setDescHeights() {
    document.querySelectorAll("#design-app .app-card").forEach(function (card) {
      var desc = card.querySelector("p");
      if (desc) {
        card.style.setProperty("--desc-h", desc.scrollHeight + "px");
      }
    });
  }

  /* CLI / PlugIn cards: show the latest commit on hover or keyboard focus. */
  var COMMIT_CACHE_TTL = 60 * 60 * 1000; // 1 hour, in memory only
  var COMMIT_REQUEST_TIMEOUT = 8000;
  var HOVER_DELAY = 140;
  var snapshotPromise = null;
  var liveCommitCache = Object.create(null);

  // First-level paths that belong to the host, not to an owner/repository pair.
  var RESERVED = Object.create(null);
  [
    "about",
    "account",
    "admin",
    "api",
    "apps",
    "assets",
    "avatars",
    "collections",
    "contact",
    "copilot",
    "customer-stories",
    "dashboard",
    "education",
    "enterprise",
    "events",
    "explore",
    "features",
    "issues",
    "join",
    "login",
    "marketplace",
    "milestones",
    "new",
    "notifications",
    "organizations",
    "orgs",
    "pricing",
    "pulls",
    "readme",
    "repo",
    "search",
    "security",
    "settings",
    "signup",
    "site",
    "sponsors",
    "stars",
    "topics",
    "trending",
    "user",
    "users",
    "watching",
  ].forEach(function (name) {
    RESERVED[name] = true;
  });

  function normalizeHost(hostname) {
    return String(hostname || "")
      .toLowerCase()
      .replace(/^www\./, "");
  }

  /**
   * Only https://github.com/<owner>/<repo> and
   * https://codeberg.org/<owner>/<repo> count as repositories.
   * Profile URLs such as https://github.com/<owner> return null.
   */
  function parseRepoUrl(raw) {
    var url;
    try {
      url = new URL(raw, window.location.href);
    } catch (err) {
      return null;
    }

    var host = normalizeHost(url.hostname);
    var parts = url.pathname
      .replace(/^\/+|\/+$/g, "")
      .split("/")
      .filter(Boolean);
    if (parts.length < 2) return null;

    var owner = parts[0];
    var repo = parts[1].replace(/\.git$/i, "");
    if (!owner || !repo) return null;
    if (RESERVED[owner.toLowerCase()]) {
      return null;
    }

    if (host === "github.com") {
      var githubApi =
        "https://api.github.com/repos/" +
        encodeURIComponent(owner) +
        "/" +
        encodeURIComponent(repo) +
        "/commits?per_page=1";
      return {
        provider: "GitHub",
        url: raw,
        owner: owner,
        repo: repo,
        api: githubApi,
        // Public data only. This read-only relay is used after the anonymous
        // GitHub API rejects a request because of IP-based rate limiting.
        apiSources: [githubApi, "https://gh-proxy.com/" + githubApi],
      };
    }

    if (host === "codeberg.org") {
      return {
        provider: "Codeberg",
        url: raw,
        owner: owner,
        repo: repo,
        api:
          "https://codeberg.org/api/v1/repos/" +
          encodeURIComponent(owner) +
          "/" +
          encodeURIComponent(repo) +
          "/commits?limit=1",
        apiSources: [],
      };
    }

    return null;
  }

  function repoCacheKey(repo) {
    return (
      repo.provider.toLowerCase() +
      "/" +
      repo.owner.toLowerCase() +
      "/" +
      repo.repo.toLowerCase()
    );
  }

  function pickCommit(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return null;
    var item = payload[0] || {};
    var commit = item.commit || {};
    var author = commit.author || commit.committer || {};
    var time = author.date || item.created || "";
    var message = commit.message || item.message || "";
    if (!time && !message) return null;
    return {
      time: time,
      message: message,
      author: author.name || (item.author && item.author.login) || "",
    };
  }

  /**
   * Build-time snapshot written by scripts/fetch-repo-commits.mjs. It is a
   * fallback for API rate limits, transient failures, or CORS regressions.
   */
  function loadCommitSnapshot() {
    if (!snapshotPromise) {
      snapshotPromise = fetch(
        new URL("repo-commits.json", window.location.href),
        { cache: "no-cache" },
      )
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .catch(function () {
          return null;
        });
    }
    return snapshotPromise;
  }

  function fetchCommitSource(url) {
    var controller =
      typeof AbortController === "function" ? new AbortController() : null;
    var timeout = 0;
    if (controller) {
      timeout = window.setTimeout(function () {
        controller.abort();
      }, COMMIT_REQUEST_TIMEOUT);
    }

    return fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: controller ? controller.signal : undefined,
    })
      .then(function (response) {
        if (!response.ok) {
          var error = new Error("HTTP " + response.status);
          error.status = response.status;
          throw error;
        }
        return response.json();
      })
      .then(function (payload) {
        var commit = pickCommit(payload);
        if (!commit) throw new Error("no commit");
        return commit;
      })
      .finally(function () {
        window.clearTimeout(timeout);
      });
  }

  function fetchLiveCommit(repo) {
    var sources =
      repo.apiSources && repo.apiSources.length ? repo.apiSources : [repo.api];
    var lastError = new Error("no API source");

    function trySource(index) {
      if (index >= sources.length) return Promise.reject(lastError);
      return fetchCommitSource(sources[index]).catch(function (error) {
        lastError = error;
        return trySource(index + 1);
      });
    }

    return trySource(0).then(function (commit) {
      commit.source = "live";
      return commit;
    });
  }

  function loadSnapshotCommit(repo) {
    return loadCommitSnapshot().then(function (snapshot) {
      var hit = snapshot && snapshot.repos && snapshot.repos[repo.url];
      if (!hit) return null;
      return Object.assign({}, hit, { source: "snapshot" });
    });
  }

  function getCachedLiveCommit(repo) {
    var cached = liveCommitCache[repoCacheKey(repo)];
    if (cached && Date.now() - cached.at < COMMIT_CACHE_TTL) {
      return cached.commit;
    }
    return null;
  }

  function fetchLatestCommit(repo) {
    var key = repoCacheKey(repo);
    var cached = getCachedLiveCommit(repo);
    if (cached) return Promise.resolve(cached);

    // Live data always has priority. The build-time snapshot is only a
    // fallback for providers / browsers where the public API is unavailable.
    return fetchLiveCommit(repo)
      .then(function (commit) {
        liveCommitCache[key] = { at: Date.now(), commit: commit };
        return commit;
      })
      .catch(function (liveError) {
        return loadSnapshotCommit(repo).then(function (commit) {
          if (commit) return commit;
          throw liveError;
        });
      });
  }

  function formatCommitTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return value || "";
    try {
      return date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (err) {
      return date.toISOString().replace("T", " ").slice(0, 16);
    }
  }

  function formatCommitMessage(value) {
    var text = String(value || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "（无提交说明）";
    if (text.length > 240) text = text.slice(0, 237) + "…";
    return text;
  }

  var AGE_CLASSES = ["is-fresh", "is-aging", "is-stale", "is-old"];

  function clearCommitAge(ageEl) {
    if (!ageEl) return;
    ageEl.textContent = "";
    ageEl.classList.remove.apply(ageEl.classList, AGE_CLASSES);
  }

  function commitAgeState(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return null;
    var days = Math.max(
      0,
      Math.floor((Date.now() - date.getTime()) / 86400000),
    );
    if (days <= 30) {
      return { className: "is-fresh", face: "✅", days: days };
    }
    if (days <= 90) {
      return { className: "is-aging", face: "⚠️", days: days };
    }
    if (days <= 365) {
      return { className: "is-stale", face: "⁉️", days: days };
    }
    return { className: "is-old", face: "x_x", days: days };
  }

  function hideCommitTip(card) {
    var tip = card.querySelector(".design-repo-commit");
    if (!tip) return;
    tip.classList.remove("is-visible");
    var timeEl = tip.querySelector(".design-repo-commit-time");
    var ageEl = tip.querySelector(".design-repo-commit-age");
    var msgEl = tip.querySelector(".design-repo-commit-msg");
    if (timeEl) timeEl.textContent = "";
    clearCommitAge(ageEl);
    if (msgEl) msgEl.textContent = "";
  }

  function showCommitTip(card, state, commit) {
    var tip = card.querySelector(".design-repo-commit");
    if (!tip) return;
    var timeEl = tip.querySelector(".design-repo-commit-time");
    var ageEl = tip.querySelector(".design-repo-commit-age");
    var msgEl = tip.querySelector(".design-repo-commit-msg");

    if (state === "loading") {
      timeEl.textContent = "读取最新提交…";
      clearCommitAge(ageEl);
      msgEl.textContent = "";
    } else if (state === "error" || !commit) {
      timeEl.textContent = "暂无提交信息";
      clearCommitAge(ageEl);
      msgEl.textContent = "";
    } else {
      var meta = formatCommitTime(commit.time);
      if (commit.author) meta += " · " + commit.author;
      if (commit.source === "snapshot") meta += " · 构建时快照";
      timeEl.textContent = meta;
      clearCommitAge(ageEl);
      var age = commitAgeState(commit.time);
      if (age && ageEl) {
        ageEl.textContent = age.face + " " + age.days + " 天";
        ageEl.classList.add(age.className);
      }
      msgEl.textContent = formatCommitMessage(commit.message);
    }

    tip.classList.add("is-visible");
  }

  function initRepoCommits() {
    var cards = document.querySelectorAll(".design-repo-card[data-repo]");
    var hasRepo = false;

    Array.prototype.forEach.call(cards, function (card) {
      var repo = parseRepoUrl(card.getAttribute("data-repo") || "");
      if (!repo) return; // Profile / non-repository URL: show nothing.
      hasRepo = true;

      var hoverTimer = 0;
      var pending = false;

      function reveal() {
        var cached = getCachedLiveCommit(repo);
        if (cached) {
          showCommitTip(card, "ready", cached);
          return;
        }
        if (pending) return;
        pending = true;
        showCommitTip(card, "loading");
        fetchLatestCommit(repo)
          .then(function (commit) {
            showCommitTip(card, "ready", commit);
          })
          .catch(function (err) {
            if (err && err.status === 404) {
              hideCommitTip(card);
              return;
            }
            showCommitTip(card, "error");
          })
          .finally(function () {
            pending = false;
          });
      }

      card.addEventListener("mouseenter", function () {
        window.clearTimeout(hoverTimer);
        hoverTimer = window.setTimeout(reveal, HOVER_DELAY);
      });

      card.addEventListener("mouseleave", function () {
        window.clearTimeout(hoverTimer);
      });

      card.addEventListener("focusin", reveal);
    });

    if (hasRepo) {
      // A normal reload creates a fresh in-memory cache. Also discard it when
      // the page is restored from the browser's back/forward cache.
      window.addEventListener("pageshow", function (event) {
        if (event.persisted) {
          liveCommitCache = Object.create(null);
          snapshotPromise = null;
        }
      });
    }
  }

  function init() {
    setDescHeights();
    initRepoCommits();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.addEventListener("resize", setDescHeights);
})();
