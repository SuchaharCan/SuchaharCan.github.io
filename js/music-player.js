(function () {
  "use strict";

  var DEFAULT_VOLUME = 0.25;
  var VOLUME_LEVELS = [0.25, 0.5, 0.75, 1, 0];

  function isSafari() {
    var ua = navigator.userAgent;
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg|OPR/i.test(ua);
  }

  function encodeFileUrl(base, file, ext) {
    return base.replace(/\/$/, "") + "/" + encodeURIComponent(file) + ext;
  }

  function parseFilename(file) {
    var idx = file.indexOf("-");
    if (idx <= 0) return { title: file, artist: "" };
    return {
      artist: file.slice(0, idx).trim(),
      title: file.slice(idx + 1).trim(),
    };
  }

  function parseLrc(text) {
    var meta = { title: "", artist: "" };
    var lines = [];
    var offsetMs = 0;
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      var tag = line.match(/^\[([a-z]+):(.+)\]$/i);
      if (tag) {
        var key = tag[1].toLowerCase();
        var val = tag[2].trim();
        if (key === "ti") meta.title = val;
        if (key === "ar") meta.artist = val;
        if (key === "offset") offsetMs = parseInt(val, 10) || 0;
        return;
      }
      var m = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
      if (!m) return;
      var textPart = m[3].trim();
      if (!textPart || isMetaLyric(textPart)) return;
      var min = parseInt(m[1], 10);
      var sec = parseFloat(m[2]);
      lines.push({
        time: min * 60 + sec + offsetMs / 1000,
        text: textPart,
      });
    });
    lines.sort(function (a, b) {
      return a.time - b.time;
    });
    return { meta: meta, lines: lines };
  }

  function isMetaLyric(text) {
    return /^(作词|作曲|编曲|词[：:]|曲[：:]|编[：:]|演唱|原唱|和声|混音|录音|制作|出品|发行|企划|统筹|吉他|贝斯|鼓|键盘|弦乐|和声编写|母带|混音|录音室|录音师|制作人|监制|OP|SP|发行|出品)/.test(
      text,
    );
  }

  function pickRandomIndex(len, exclude) {
    if (len <= 1) return 0;
    var idx;
    do {
      idx = Math.floor(Math.random() * len);
    } while (idx === exclude);
    return idx;
  }

  function formatTime(seconds) {
    if (!seconds || !isFinite(seconds) || seconds < 0) return "00:00";
    var total = Math.floor(seconds);
    var min = Math.floor(total / 60);
    var sec = total % 60;
    return String(min).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }

  async function fetchLyricsText(url) {
    var res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return null;
    var buf = await res.arrayBuffer();
    var utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    if (!looksMojibake(utf8)) return utf8;
    try {
      var gb = new TextDecoder("gb18030", { fatal: false }).decode(buf);
      if (gb && !looksMojibake(gb)) return gb;
    } catch (e) {
      /* gb18030 unavailable */
    }
    return utf8;
  }

  function looksMojibake(text) {
    if (!text) return false;
    if (text.indexOf("\uFFFD") >= 0) return true;
    var bad = (text.match(/[\u0080-\u009f\u00c0-\u00ff]{3,}/g) || []).length;
    var cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    return bad > 2 && cjk === 0 && /[\u4e00-\u9fff]/.test(text) === false && /[ÃÂÐÑ]/.test(text);
  }

  function sanitizeMetaText(text) {
    if (!text || looksMojibake(text)) return "";
    return text.trim();
  }

  async function resolveAudio(base, file) {
    var mp3 = encodeFileUrl(base, file, ".mp3");
    try {
      var mp3Head = await fetch(mp3, { method: "HEAD", credentials: "same-origin" });
      if (mp3Head.ok) return { url: mp3, ext: ".mp3" };
    } catch (e) {
      /* ignore */
    }
    var flac = encodeFileUrl(base, file, ".flac");
    try {
      var head = await fetch(flac, { method: "HEAD", credentials: "same-origin" });
      if (head.ok) return { url: flac, ext: ".flac" };
    } catch (e) {
      /* ignore */
    }
    return { url: mp3, ext: ".mp3" };
  }

  function lineDuration(lines, index, fallbackEnd) {
    var start = lines[index].time;
    var end = lines[index + 1] ? lines[index + 1].time : fallbackEnd;
    if (!end || end <= start) end = start + 4;
    return Math.max(end - start, 0.35);
  }

  function findLyricIndex(lines, time) {
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].time <= time) idx = i;
      else break;
    }
    return idx;
  }

  function MusicPlayer(widget) {
    this.widget = widget;
    this.base = widget.dataset.base || "/music";
    this.tracks = JSON.parse(widget.dataset.tracks || "[]").map(function (t) {
      return typeof t === "string" ? { file: t } : t;
    });
    this.audio = widget.querySelector(".music-player-audio");
    this.titleEl = widget.querySelector(".music-player-title");
    this.artistEl = widget.querySelector(".music-player-artist");
    this.lyricEl = widget.querySelector(".music-player-lyric");
    this.timeEl = widget.querySelector(".music-player-time");
    this.lyricLitEl = null;
    this.lyricScrollEl = null;
    this.lyricKaraokeEl = null;
    this.toggleBtn = widget.querySelector(".music-player-toggle");
    this.nextBtn = widget.querySelector(".music-player-next");
    this.loopBtn = widget.querySelector(".music-player-loop-btn");
    this.volumeBtn = widget.querySelector(".music-player-volume-btn");
    this.progressWrap = widget.querySelector(".music-player-progress-wrap");
    this.progressFill = widget.querySelector(".music-player-progress-fill");
    this.isSeeking = false;
    this.seekReady = false;
    this.sourceUrl = "";
    this.blobUrl = "";
    this.seekUpgradePromise = null;
    this.pendingSeekTime = undefined;
    this.loopEnabled = false;
    this.volumeStep = 0;
    this.currentIndex = -1;
    this.lrcLines = [];
    this.lyricIndex = -1;
    this.ready = false;
    this.bind();
    this.setVolume(DEFAULT_VOLUME);
    this.syncTimeDisplay();
  }

  MusicPlayer.prototype.bind = function () {
    var self = this;
    this.toggleBtn.addEventListener("click", function () {
      self.onToggle();
    });
    this.widget.addEventListener("click", function (e) {
      if (window.matchMedia("(hover: none)").matches && !e.target.closest(".music-player-bar")) {
        self.widget.classList.toggle("is-touch-open");
      }
    });
    if (this.nextBtn) {
      this.nextBtn.addEventListener("click", function () {
        self.playRandom(self.currentIndex);
      });
    }
    if (this.loopBtn) {
      this.loopBtn.addEventListener("click", function () {
        self.loopEnabled = !self.loopEnabled;
        self.loopBtn.classList.toggle("is-active", self.loopEnabled);
        self.loopBtn.setAttribute("aria-pressed", self.loopEnabled ? "true" : "false");
        self.loopBtn.title = self.loopEnabled ? "取消循环" : "单曲循环";
      });
    }
    if (this.volumeBtn) {
      this.volumeBtn.addEventListener("click", function () {
        self.cycleVolume();
      });
    }
    this.bindProgressSeek();
    this.audio.addEventListener("loadedmetadata", function () {
      self.seekReady = self.isSeekableEnough();
      self.syncProgressFill();
      self.syncTimeDisplay();
      self.setVolume(VOLUME_LEVELS[self.volumeStep]);
    });
    this.audio.addEventListener("durationchange", function () {
      self.syncProgressFill();
      self.syncTimeDisplay();
    });
    this.audio.addEventListener("canplay", function () {
      self.syncProgressFill();
    });
    this.audio.addEventListener("seeked", function () {
      self.pendingSeekTime = undefined;
      self.isSeeking = false;
      if (self.progressWrap) self.progressWrap.classList.remove("is-seeking");
      self.updateControlsPinned();
      self.syncLyric();
      self.syncProgressFill();
      self.syncTimeDisplay();
    });
    this.audio.addEventListener("timeupdate", function () {
      self.syncLyric();
      self.syncProgressFill();
      self.syncTimeDisplay();
    });
    this.audio.addEventListener("ended", function () {
      if (self.loopEnabled) {
        self.audio.currentTime = 0;
        self.audio.play().catch(function () {});
        return;
      }
      self.toggleBtn.classList.remove("is-playing");
      self.updateToggleIcon(false);
    });
    this.audio.addEventListener("play", function () {
      self.widget.classList.remove("is-idle");
      self.toggleBtn.classList.add("is-playing");
      self.updateToggleIcon(true);
    });
    this.audio.addEventListener("pause", function () {
      self.toggleBtn.classList.remove("is-playing");
      self.updateToggleIcon(false);
    });
  };

  MusicPlayer.prototype.isSeekableEnough = function () {
    var audio = this.audio;
    var duration = audio.duration;
    if (!duration || !isFinite(duration)) return false;
    if (!audio.seekable || !audio.seekable.length) return false;
    var end = audio.seekable.end(audio.seekable.length - 1);
    return end >= duration - 1;
  };

  MusicPlayer.prototype.ensureSeekable = function () {
    var self = this;
    if (this.seekReady || this.isSeekableEnough()) {
      this.seekReady = true;
      return Promise.resolve(true);
    }
    if (!this.sourceUrl || this.seekUpgradePromise) {
      return this.seekUpgradePromise || Promise.resolve(false);
    }

    this.seekUpgradePromise = (async function () {
      try {
        var audio = self.audio;
        var wasPlaying = !audio.paused;
        var time = audio.currentTime || 0;
        var volume = audio.volume;
        var res = await fetch(self.sourceUrl, { credentials: "same-origin" });
        if (!res.ok) return false;
        var blob = await res.blob();
        if (self.blobUrl) URL.revokeObjectURL(self.blobUrl);
        self.blobUrl = URL.createObjectURL(blob);
        audio.src = self.blobUrl;
        audio.volume = volume;
        await new Promise(function (resolve, reject) {
          var done = function () {
            audio.removeEventListener("loadedmetadata", done);
            audio.removeEventListener("error", fail);
            resolve();
          };
          var fail = function () {
            audio.removeEventListener("loadedmetadata", done);
            audio.removeEventListener("error", fail);
            reject(new Error("metadata load failed"));
          };
          audio.addEventListener("loadedmetadata", done, { once: true });
          audio.addEventListener("error", fail, { once: true });
          audio.load();
        });
        self.seekReady = self.isSeekableEnough();
        if (self.seekReady && time > 0) {
          audio.currentTime = time;
        }
        if (wasPlaying) {
          await audio.play().catch(function () {});
        }
        return self.seekReady;
      } catch (e) {
        return false;
      } finally {
        self.seekUpgradePromise = null;
      }
    })();

    return this.seekUpgradePromise;
  };

  MusicPlayer.prototype.bindProgressSeek = function () {
    var self = this;
    if (!this.progressWrap) return;

    var seekFromClientX = function (clientX) {
      var duration = self.audio.duration;
      if (!duration || !isFinite(duration)) return;
      var rect = self.progressWrap.getBoundingClientRect();
      if (!rect.width) return;
      var ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      self.seekTo(duration * ratio, true);
    };

    var startSeek = function () {
      self.isSeeking = true;
      self.progressWrap.classList.add("is-seeking");
      self.updateControlsPinned();
    };

    var endSeek = function () {
      self.isSeeking = false;
      self.progressWrap.classList.remove("is-seeking");
      self.updateControlsPinned();
    };

    var beginPointerSeek = function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      startSeek();
      self.ensureSeekable().then(function () {
        seekFromClientX(e.clientX);
        if (self.progressWrap.setPointerCapture) {
          self.progressWrap.setPointerCapture(e.pointerId);
        }
      });
    };

    this.progressWrap.addEventListener("pointerdown", beginPointerSeek);
    this.progressWrap.addEventListener("pointermove", function (e) {
      if (!self.isSeeking) return;
      seekFromClientX(e.clientX);
    });
    this.progressWrap.addEventListener("pointerup", function (e) {
      if (!self.isSeeking) return;
      seekFromClientX(e.clientX);
      if (self.progressWrap.releasePointerCapture) {
        try {
          self.progressWrap.releasePointerCapture(e.pointerId);
        } catch (err) {
          /* ignore */
        }
      }
    });
    this.progressWrap.addEventListener("pointercancel", function () {
      endSeek();
    });
    this.progressWrap.addEventListener("keydown", function (e) {
      var duration = self.audio.duration;
      if (!duration || !isFinite(duration)) return;
      var step = Math.max(duration * 0.02, 1);
      if (e.key === "ArrowRight") {
        e.preventDefault();
        self.ensureSeekable().then(function () {
          self.seekTo(self.audio.currentTime + step);
        });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        self.ensureSeekable().then(function () {
          self.seekTo(self.audio.currentTime - step);
        });
      }
    });
  };

  MusicPlayer.prototype.updateControlsPinned = function () {
    this.widget.classList.toggle("is-controls-open", this.isSeeking);
  };

  MusicPlayer.prototype.seekTo = function (time, dragging) {
    if (!isFinite(time) || time < 0) return;
    var duration = this.audio.duration;
    if (duration && isFinite(duration)) {
      time = Math.min(time, duration);
    }
    if (dragging) {
      this.isSeeking = true;
      this.progressWrap.classList.add("is-seeking");
      this.updateControlsPinned();
    }
    this.pendingSeekTime = time;
    try {
      if (typeof this.audio.fastSeek === "function") {
        this.audio.fastSeek(time);
      } else {
        this.audio.currentTime = time;
      }
    } catch (e) {
      /* ignore seek errors before ready */
    }
    this.syncProgressFill(time);
    this.syncTimeDisplay(time);
    this.syncLyric();
  };

  MusicPlayer.prototype.syncProgressFill = function (overrideTime) {
    if (!this.progressWrap) return;
    if (this.isSeeking && overrideTime === undefined) return;
    var duration = this.audio.duration;
    var current =
      overrideTime !== undefined && isFinite(overrideTime)
        ? overrideTime
        : this.pendingSeekTime !== undefined && this.isSeeking
          ? this.pendingSeekTime
          : this.audio.currentTime || 0;
    if (!duration || !isFinite(duration) || duration <= 0) {
      this.progressWrap.style.setProperty("--progress-pct", "0%");
      this.progressWrap.setAttribute("aria-valuenow", "0");
      return;
    }
    var pct = Math.min(Math.max((current / duration) * 100, 0), 100);
    this.progressWrap.style.setProperty("--progress-pct", pct + "%");
    this.progressWrap.setAttribute("aria-valuenow", String(Math.round(pct)));
  };

  MusicPlayer.prototype.syncTimeDisplay = function (overrideTime) {
    if (!this.timeEl) return;
    var current = formatTime(
      overrideTime !== undefined && isFinite(overrideTime)
        ? overrideTime
        : this.audio.currentTime || 0,
    );
    var total = formatTime(this.audio.duration || 0);
    this.timeEl.textContent = current + " / " + total;
  };

  MusicPlayer.prototype.cycleVolume = function () {
    this.volumeStep = (this.volumeStep + 1) % VOLUME_LEVELS.length;
    this.setVolume(VOLUME_LEVELS[this.volumeStep]);
  };

  MusicPlayer.prototype.setVolume = function (value) {
    var vol = Math.min(Math.max(value, 0), 1);
    this.audio.volume = vol;
    var pct = vol <= 0 ? 0 : Math.round(vol * 100);
    if (this.volumeBtn) {
      this.volumeBtn.dataset.volume = String(pct);
      var fillWrap = this.volumeBtn.querySelector(".music-player-vol-fill-wrap");
      if (fillWrap) {
        fillWrap.style.setProperty("--volume-pct", pct + "%");
      }
      var label = pct === 0 ? "静音，点击切换音量" : "音量 " + pct + "%，点击切换";
      this.volumeBtn.title = label;
      this.volumeBtn.setAttribute("aria-label", label);
    }
  };

  MusicPlayer.prototype.updateToggleIcon = function (playing) {
    this.toggleBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
    this.toggleBtn.title = playing ? "暂停" : "播放";
  };

  MusicPlayer.prototype.onToggle = function () {
    if (!this.ready) {
      this.playRandom(-1);
      return;
    }
    if (this.audio.paused) {
      this.audio.play().catch(function () {});
    } else {
      this.audio.pause();
    }
  };

  MusicPlayer.prototype.playRandom = function (excludeIndex) {
    var idx = pickRandomIndex(this.tracks.length, excludeIndex);
    this.loadTrack(idx);
  };

  MusicPlayer.prototype.setMeta = function (title, artist) {
    this.titleEl.textContent = title || "";
    this.artistEl.textContent = artist || "";
  };

  MusicPlayer.prototype.clearLyric = function () {
    this.lyricIndex = -1;
    this.lyricLitEl = null;
    this.lyricScrollEl = null;
    this.lyricKaraokeEl = null;
    this.lyricEl.innerHTML = "";
  };

  MusicPlayer.prototype.syncLyricScroll = function (progress) {
    if (!this.lyricScrollEl || !this.lyricKaraokeEl) return;
    var viewport = this.lyricScrollEl;
    var wrap = this.lyricKaraokeEl;
    var overflow = wrap.offsetWidth - viewport.clientWidth;
    if (overflow <= 2) {
      wrap.style.transform = "translateX(0)";
      return;
    }
    var offset = -overflow * Math.min(Math.max(progress, 0), 1);
    wrap.style.transform = "translateX(" + offset + "px)";
  };

  MusicPlayer.prototype.renderLyricLine = function (index) {
    var line = this.lrcLines[index];
    if (!line) {
      this.clearLyric();
      return;
    }
    this.lyricIndex = index;
    this.lyricEl.innerHTML = "";
    var scroll = document.createElement("div");
    scroll.className = "music-player-lyric-scroll";
    var wrap = document.createElement("span");
    wrap.className = "music-player-lyric-karaoke";
    var base = document.createElement("span");
    base.className = "music-player-lyric-base";
    base.textContent = line.text;
    var lit = document.createElement("span");
    lit.className = "music-player-lyric-lit";
    lit.textContent = line.text;
    lit.style.setProperty("--progress", "0");
    wrap.appendChild(base);
    wrap.appendChild(lit);
    scroll.appendChild(wrap);
    this.lyricEl.appendChild(scroll);
    this.lyricScrollEl = scroll;
    this.lyricKaraokeEl = wrap;
    this.lyricLitEl = lit;
    var self = this;
    requestAnimationFrame(function () {
      self.syncLyricScroll(0);
    });
  };

  MusicPlayer.prototype.syncLyric = function () {
    if (!this.lrcLines.length) {
      this.clearLyric();
      return;
    }
    var t = this.audio.currentTime;
    var idx = findLyricIndex(this.lrcLines, t);
    if (idx < 0) {
      this.clearLyric();
      return;
    }
    if (idx !== this.lyricIndex) {
      this.renderLyricLine(idx);
    }
    if (!this.lyricLitEl) return;
    var duration = lineDuration(this.lrcLines, idx, this.audio.duration || 0);
    var progress = Math.min(Math.max((t - this.lrcLines[idx].time) / duration, 0), 1);
    this.lyricLitEl.style.setProperty("--progress", String(progress));
    this.syncLyricScroll(progress);
  };

  MusicPlayer.prototype.loadTrack = async function (index) {
    var track = this.tracks[index];
    if (!track || !track.file) return;
    this.widget.classList.remove("is-idle");
    this.currentIndex = index;
    this.ready = false;
    this.lrcLines = [];
    this.clearLyric();

    var fromName = parseFilename(track.file);
    var title = fromName.title;
    var artist = fromName.artist;
    this.setMeta(title, artist);

    var audioInfo = await resolveAudio(this.base, track.file);
    var lrcUrl = encodeFileUrl(this.base, track.file, ".lrc");

    try {
      var lrcText = await fetchLyricsText(lrcUrl);
      if (lrcText) {
        var parsed = parseLrc(lrcText);
        this.lrcLines = parsed.lines;
        var lrcTitle = sanitizeMetaText(parsed.meta.title);
        var lrcArtist = sanitizeMetaText(parsed.meta.artist);
        if (lrcTitle) title = lrcTitle;
        if (lrcArtist) artist = lrcArtist;
      }
    } catch (e) {
      /* no lrc */
    }

    this.setMeta(title, artist);

    this.sourceUrl = audioInfo.url;
    this.seekReady = false;
    this.seekUpgradePromise = null;
    this.pendingSeekTime = undefined;
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = "";
    }

    this.audio.src = audioInfo.url;
    this.audio.load();
    this.syncProgressFill(0);
    this.syncTimeDisplay();
    this.ready = true;
    this.syncLyric();
    this.audio.play().catch(function () {});
  };

  function init() {
    document.querySelectorAll("#music-player-widget").forEach(function (el) {
      if (isSafari()) {
        el.remove();
        return;
      }
      new MusicPlayer(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
