"use strict";

(() => {
  const sliderElements = {
    h: document.getElementById("range-h"),
    s: document.getElementById("range-s"),
    l: document.getElementById("range-l"),
  };

  const outputElements = {
    h: document.getElementById("range-h-value"),
    s: document.getElementById("range-s-value"),
    l: document.getElementById("range-l-value"),
  };

  if (
    Object.values(sliderElements).some((element) => !element) ||
    Object.values(outputElements).some((element) => !element)
  ) {
    return;
  }

  const root = document.documentElement;
  const styles = getComputedStyle(root);

  function readNumber(name, fallback) {
    const value = Number.parseFloat(styles.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function updateAccentColor() {
    const hue = Math.round(Number(sliderElements.h.value));
    const saturation = Math.round(Number(sliderElements.s.value));
    const lightness = Math.round(Number(sliderElements.l.value));

    root.style.setProperty("--accent-h", hue);
    root.style.setProperty("--accent-s", `${saturation}%`);
    root.style.setProperty("--accent-l", `${lightness}%`);
    root.style.setProperty(
      "--accent-color",
      `hsl(${hue}, ${saturation}%, ${lightness}%)`,
    );

    outputElements.h.textContent = hue;
    outputElements.s.textContent = `${saturation}%`;
    outputElements.l.textContent = `${lightness}%`;
  }

  sliderElements.h.value = readNumber("--accent-h", 0);
  sliderElements.s.value = readNumber("--accent-s", 0);
  sliderElements.l.value = readNumber("--accent-l", 0);

  for (const slider of Object.values(sliderElements)) {
    slider.addEventListener("input", updateAccentColor);
  }

  updateAccentColor();
})();
