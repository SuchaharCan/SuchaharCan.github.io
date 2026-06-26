/**
 * AES-GCM + PBKDF2 — compatible with scripts/encrypt-content.mjs build output.
 */
(function (root) {
  "use strict";

  var PBKDF2_ITERATIONS = 100000;

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function bytesToText(bytes) {
    return new TextDecoder().decode(bytes);
  }

  async function deriveKey(passphrase, saltBytes) {
    var enc = new TextEncoder();
    var keyMaterial = await crypto.subtle.importKey(
      "raw",
      enc.encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltBytes,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
  }

  async function decryptPayload(passphrase, payload) {
    if (!payload || payload.algorithm !== "AES-GCM") {
      throw new Error("不支持的加密格式");
    }
    var salt = b64ToBytes(payload.salt);
    var iv = b64ToBytes(payload.iv);
    var ct = b64ToBytes(payload.ciphertext);
    var key = await deriveKey(passphrase, salt);
    var plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    return bytesToText(new Uint8Array(plain));
  }

  root.EncryptionCrypto = {
    decryptPayload: decryptPayload,
  };
})(typeof self !== "undefined" ? self : this);
