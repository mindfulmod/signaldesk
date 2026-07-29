// Collapsible sections: the diagnostic panels (theme engine layers, calibration,
// lifecycle feed) default to collapsed so the page leads with actionable content
// instead of a wall of mostly-empty diagnostics. State persists per device.
(() => {
  const STORE_KEY = "signaldesk-panels-v2";
  const isPhone = window.matchMedia("(max-width: 760px)").matches;

  // Tabs (tabs.js) are now the primary decluttering mechanism, so panels no
  // longer need to default closed to keep the page readable -- a tab only ever
  // shows two to four related sections. Collapsing stays available per panel.
  // The key namespace is bumped to v2 so devices carrying the old
  // everything-collapsed state get the new defaults once.
  const PANELS = [
    { selector: ".market-pulse", key: "pulse", defaultOpen: true },
    { selector: ".buy-panel", key: "buy", defaultOpen: true },
    { selector: ".movers-panel", key: "movers", defaultOpen: !isPhone },
    { selector: ".whatchanged-panel", key: "whatchanged", defaultOpen: true },
    { selector: ".themes-panel", key: "themes", defaultOpen: true },
    { selector: ".phraseradar-panel", key: "phraseradar", defaultOpen: true },
    { selector: ".clusters-panel", key: "clusters", defaultOpen: !isPhone },
    { selector: ".springs-panel", key: "springs", defaultOpen: true },
    { selector: ".calibration-panel", key: "calibration", defaultOpen: true },
  ];

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch {
      /* private mode — collapse state just won't persist */
    }
  }

  function setupPanel(panel, config, state) {
    const head = panel.querySelector(".section-head");
    if (!head || head.querySelector(".collapse-toggle")) return;

    const open = config.key in state ? Boolean(state[config.key]) : config.defaultOpen;
    panel.classList.add("collapsible-panel");
    panel.classList.toggle("panel-collapsed", !open);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "collapse-toggle";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Collapse section" : "Expand section");
    button.innerHTML = `<span class="collapse-chevron" aria-hidden="true">▾</span>`;
    head.appendChild(button);

    const toggle = () => {
      const nowOpen = panel.classList.contains("panel-collapsed");
      panel.classList.toggle("panel-collapsed", !nowOpen);
      button.setAttribute("aria-expanded", String(nowOpen));
      button.setAttribute("aria-label", nowOpen ? "Collapse section" : "Expand section");
      const nextState = loadState();
      nextState[config.key] = nowOpen;
      saveState(nextState);
    };

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle();
    });
    // The whole header is a natural tap target, but clicks on real controls or
    // links inside it should keep their own behavior.
    head.addEventListener("click", (event) => {
      if (event.target.closest("a, button, input, select, label")) return;
      toggle();
    });
  }

  function apply() {
    const state = loadState();
    let missing = false;
    for (const config of PANELS) {
      const panel = document.querySelector(config.selector);
      if (panel) setupPanel(panel, config, state);
      else missing = true;
    }
    return missing;
  }

  function start() {
    // .market-pulse is injected by enhancements.js after load, so retry briefly
    // until every known panel has been decorated.
    let attempts = 0;
    const tick = () => {
      const missing = apply();
      if (missing && attempts++ < 20) setTimeout(tick, 250);
    };
    tick();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
