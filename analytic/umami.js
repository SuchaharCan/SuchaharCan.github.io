/**
 * Site-wide Umami loader (Umami Cloud).
 * Idempotent: skips if the theme or a prior load already injected the tracker.
 */
(function () {
  const WEBSITE_ID = "cdf54193-b449-4454-884b-029e82434c32";
  const SCRIPT_SRC = "https://cloud.umami.is/script.js";

  if (document.querySelector(`script[data-website-id="${WEBSITE_ID}"]`)) {
    return;
  }

  const script = document.createElement("script");
  script.defer = true;
  script.src = SCRIPT_SRC;
  script.setAttribute("data-website-id", WEBSITE_ID);
  script.setAttribute("data-exclude-hash", "true");
  document.head.appendChild(script);
})();
