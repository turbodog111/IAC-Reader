(() => {
  "use strict";

  const BLOCKED_BUTTONS = new Set(["startSession", "buzzButton", "startDuel", "duelBuzz"]);
  const PAUSED_VIEWS = new Set(["practice", "notRanked"]);

  function activeView() {
    return document.querySelector(".nav-button.active")?.dataset.view || location.hash.slice(1) || "practice";
  }

  function lockPractice() {
    const labels = {
      startSession: "Practice paused",
      buzzButton: "BUZZ PAUSED",
      startDuel: "AI match paused",
      duelBuzz: "BUZZ PAUSED",
    };
    BLOCKED_BUTTONS.forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = true;
      button.classList.add("practice-paused");
      button.setAttribute("aria-describedby", "practiceMaintenanceNotice");
      button.title = "Buzzing is paused during the IAC-style clue-bank rewrite.";
      if (id === "buzzButton" || id === "duelBuzz") {
        const strong = button.querySelector("strong");
        if (strong) strong.textContent = labels[id];
      } else {
        button.textContent = labels[id];
      }
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || !BLOCKED_BUTTONS.has(button.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.code !== "Space" || !PAUSED_VIEWS.has(activeView())) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener("DOMContentLoaded", lockPractice);
})();
