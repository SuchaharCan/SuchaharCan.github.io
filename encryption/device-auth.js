/**
 * Browser-visible device gate for admin mode.
 *
 * A static site cannot read a Mac serial number or its exact chip through the
 * browser. This module therefore compares a stable, browser-exposed profile
 * against a SHA-256 hash configured in zola.toml. It is a device gate, not a
 * substitute for authenticated server-side content delivery.
 */
(function (root) {
  "use strict";

  var PROFILE_VERSION = 2;
  var REQUIRED = {
    platform: "macOS",
    platform_major: "27",
    architecture: "arm",
    bitness: "64",
    chip: "Apple M4",
    cpu_cores: 10,
    timezone: "Asia/Shanghai",
    language: "zh-CN",
  };

  function toHex(buffer) {
    return Array.prototype.map
      .call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, "0");
      })
      .join("");
  }

  function chipFromRenderer(renderer) {
    var match = String(renderer || "").match(
      /\bApple\s+M\d+(?:\s+(?:Pro|Max|Ultra))?\b/i,
    );
    return match ? match[0].replace(/\s+/g, " ") : "";
  }

  function webglRenderer() {
    var canvas = document.createElement("canvas");
    var gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ||
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl) return "";
    var info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return "";
    return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || "");
  }

  async function collectProfile() {
    var uaData = navigator.userAgentData;
    if (!uaData || typeof uaData.getHighEntropyValues !== "function") {
      throw new Error("browser_unsupported");
    }

    var high = await uaData.getHighEntropyValues([
      "architecture",
      "bitness",
      "model",
      "platformVersion",
    ]);
    var renderer = webglRenderer();
    var timezone = "";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_) {}

    return {
      version: PROFILE_VERSION,
      platform: String(high.platform || uaData.platform || ""),
      platform_major: String(high.platformVersion || "").split(".")[0],
      architecture: String(high.architecture || ""),
      bitness: String(high.bitness || ""),
      chip: chipFromRenderer(renderer),
      cpu_cores: Number(navigator.hardwareConcurrency || 0),
      timezone: timezone,
      language: String(navigator.language || ""),
    };
  }

  function mismatchedRequirements(profile) {
    var mismatches = [];
    for (var key in REQUIRED) {
      if (
        Object.prototype.hasOwnProperty.call(REQUIRED, key) &&
        profile[key] !== REQUIRED[key]
      ) {
        mismatches.push(key);
      }
    }
    return mismatches;
  }

  async function hashProfile(profile) {
    var bytes = new TextEncoder().encode(JSON.stringify(profile));
    return toHex(await crypto.subtle.digest("SHA-256", bytes));
  }

  async function verify(config) {
    var expected = String(
      (config && config.admin_device_profile_hash) || "",
    ).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      return { ok: false, reason: "missing_profile_hash", profile: null };
    }

    try {
      var profile = await collectProfile();
      var mismatches = mismatchedRequirements(profile);
      if (mismatches.length) {
        return {
          ok: false,
          reason: "device_mismatch",
          profile: profile,
          mismatches: mismatches,
        };
      }
      var actual = await hashProfile(profile);
      return {
        ok: actual === expected,
        reason: actual === expected ? "ok" : "profile_hash_mismatch",
        profile: profile,
        digest: actual,
        mismatches: [],
      };
    } catch (err) {
      return {
        ok: false,
        reason: err && err.message ? err.message : "device_check_failed",
        profile: null,
      };
    }
  }

  root.EncryptionDeviceAuth = {
    collectProfile: collectProfile,
    hashProfile: hashProfile,
    verify: verify,
  };
})(typeof self !== "undefined" ? self : this);
