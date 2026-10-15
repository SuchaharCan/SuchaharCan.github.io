(function () {
  "use strict";

  function setDescHeights() {
    document.querySelectorAll("#design-app .app-card").forEach(function (card) {
      var desc = card.querySelector("p");
      if (desc) {
        card.style.setProperty("--desc-h", desc.scrollHeight + "px");
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setDescHeights);
  } else {
    setDescHeights();
  }

  window.addEventListener("resize", setDescHeights);
})();
