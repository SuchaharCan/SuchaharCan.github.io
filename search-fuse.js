// Based on https://codeberg.org/daudix/duckquill/issues/101#issuecomment-2377169
let searchSetup = false;
let fuse;

async function initIndex() {
  if (searchSetup) return;

  let data;
  if (typeof window.searchIndex !== "undefined") {
    data = window.searchIndex;
  } else {
    const response = await fetch(
      `/search_index.${document.documentElement.lang}.json`,
    );
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    data = await response.json();
  }

  const options = {
    includeScore: false,
    includeMatches: true,
    ignoreLocation: true,
    threshold: 0.15,
    keys: [
      { name: "title", weight: 3 },
      { name: "description", weight: 2 },
      { name: "body", weight: 1 },
    ],
  };

  fuse = new Fuse(data, options);
  searchSetup = true;

  console.log("Search index initialized successfully");
}

function debounce(actual_fn, wait) {
  let timeoutId;

  return (...args) => {
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      actual_fn(...args);
    }, wait);
  };
}

function initSearch() {
  const searchModal = document.getElementById("search-modal"); // Full-screen modal
  const searchModalContent = document.getElementById("search-modal-content"); // Actual modal box
  const searchInput = document.getElementById("search-input"); // Search input
  const searchResults = document.getElementById("search-results"); // Search results
  const searchButton = document.getElementById("search"); // Search button
  const MAX_ITEMS = 10;
  const MAX_RESULTS = 4;

  let currentTerm = "";

  // Open search modal when clicking the search button
  if (searchButton) {
    searchButton.addEventListener("click", function () {
      searchModal.classList.add("active");
      initIndex();
      searchModal.addEventListener(
        "transitionend",
        function handler() {
          searchInput.focus();
          searchModal.removeEventListener("transitionend", handler);
        },
        { once: true },
      );
    });
  }

  // Open search modal on "/" key press
  window.addEventListener("keydown", (event) => {
    if (
      event.key === "/" &&
      document.activeElement.tagName !== "INPUT" &&
      document.activeElement.tagName !== "TEXTAREA"
    ) {
      event.preventDefault();
      initIndex();
      searchModal.classList.add("active");
      searchModal.addEventListener(
        "transitionend",
        function handler() {
          searchInput.focus();
          searchModal.removeEventListener("transitionend", handler);
        },
        { once: true },
      );
    }
  });

  // Close search modal on Escape key
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      searchModal.classList.remove("active");
    }
  });

  // Close search modal when clicking outside search-modal-content
  searchModal.addEventListener("click", function (e) {
    if (!searchModalContent.contains(e.target)) {
      searchModal.classList.remove("active");
    }
  });

  // Prevent clicks inside modal content from closing it
  searchModalContent.addEventListener("click", function (e) {
    e.stopPropagation(); // Stops event from reaching searchModal click handler
  });

  // Search input event
  searchInput.addEventListener(
    "keyup",
    debounce(async function () {
      var term = searchInput.value.trim();
      if (term === currentTerm) return;

      searchResults.style.display = term === "" ? "none" : "flex";
      searchResults.innerHTML = ""; // Clear previous results
      currentTerm = term;
      if (term === "") return;

      await initIndex();
      var results = fuse.search(term, { limit: MAX_ITEMS });
      if (results.length === 0) {
        searchResults.style.display = "none";
        return;
      }

      // Insert formatted search result items
      for (const result of results) {
        searchResults.innerHTML += makeTeaser(result, term);
      }
    }, 150),
  );

  function makeTeaser(result, searchVal) {
    const TEASER_SIZE = 20;
    let output = `<div class="search-result item"><a class="result-title" href=${result.item.url}>${result.item.title}</a>`;

    for (const match of result.matches) {
      if (match.key === "title") continue;

      const indices = match.indices.sort((a, b) => Math.abs(a[1] - a[0] - searchVal.length) - Math.abs(b[1] - b[0] - searchVal.length)).slice(0, MAX_RESULTS);
      const value = match.value;

      for (const ind of indices) {
        const start = Math.max(0, ind[0] - TEASER_SIZE);
        const end = Math.min(value.length - 1, ind[1] + TEASER_SIZE);
        output += "<span>"
          + value.substring(start, ind[0])
          + `<strong>${value.substring(ind[0], ind[1] + 1)}</strong>`
          + value.substring(ind[1] + 1, end)
          + "</span>";
      }

      if (match.indices.length > MAX_RESULTS) {
        const moreMatchesText = document.getElementById("more-matches-text").textContent;
        output += `<span class="more-matches">${moreMatchesText}</span>`.replace("$MATCHES", `+${match.indices.length - MAX_RESULTS}`);
      }
    }
    return output + "</div>";
  }
}

if (
  document.readyState === "complete" ||
  (document.readyState !== "loading" && !document.documentElement.doScroll)
) {
  initSearch();
} else {
  document.addEventListener("DOMContentLoaded", initSearch);
}
