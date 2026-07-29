// Tabbed shell. SignalDesk had grown to ten heavy panels stacked on one page,
// which made the intended use — a five-minute daily review — into a scroll
// marathon. This groups the existing sections into four tabs by the question
// each one answers. It deliberately does NOT rewrite any panel: sections are
// moved in the DOM, so every panel keeps its own renderer, its ids, and its
// collapse behaviour.
//
// Traps this file has to respect (see UI_PLAYBOOK.md):
//   * `.market-pulse` is injected by enhancements.js AFTER load, so placement
//     retries until it appears.
//   * Panels are re-rendered in place by their own scripts; moving a node does
//     not detach those renderers because they look sections up by id each time.
//   * `render()` runs on resize; nothing here may depend on render order.
(() => {
  const STORE_KEY = "signaldesk-active-tab-v1";

  const TABS = [
    {
      id: "today",
      label: "Today",
      shortLabel: "Today",
      hint: "The five-minute review: what changed, what to look at, and why the market moved.",
      // Order matters — it is the daily reading order.
      selectors: [".whatchanged-panel", ".buy-panel", ".market-pulse", ".movers-panel"],
    },
    {
      id: "themes",
      label: "Themes",
      shortLabel: "Themes",
      hint: "Where breadth is building: theme heat, novel language, and co-mention clusters.",
      selectors: [".themes-panel", ".phraseradar-panel", ".clusters-panel"],
    },
    {
      id: "deepdive",
      label: "Deep dive",
      shortLabel: "Board",
      hint: "The full board: every discovered name, plus the springs lifecycle.",
      selectors: [".springs-panel", ".dashboard-grid"],
    },
    {
      id: "record",
      label: "Track record",
      shortLabel: "Record",
      hint: "Forward-graded outcomes for signals this site has already fired.",
      selectors: [".calibration-panel"],
    },
  ];

  const bySelector = new Map();
  for (const tab of TABS) {
    tab.selectors.forEach((selector, index) => bySelector.set(selector, { tab, index }));
  }

  let activeId = null;

  function readInitialTab() {
    const fromHash = (location.hash || "").replace(/^#/, "").split("=").pop();
    if (TABS.some((tab) => tab.id === fromHash)) return fromHash;
    try {
      const stored = localStorage.getItem(STORE_KEY);
      if (TABS.some((tab) => tab.id === stored)) return stored;
    } catch {
      /* private mode — fall through to the default */
    }
    return TABS[0].id;
  }

  function buildShell() {
    const main = document.querySelector(".main-content");
    if (!main || document.querySelector(".tabbar")) return null;

    const nav = document.createElement("nav");
    nav.className = "tabbar";
    nav.setAttribute("aria-label", "Dashboard sections");

    const list = document.createElement("div");
    list.className = "tabbar-inner";
    list.setAttribute("role", "tablist");

    for (const tab of TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-btn";
      button.id = `tab-${tab.id}`;
      button.dataset.tab = tab.id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `tabpanel-${tab.id}`);
      // Two labels, one shown per breakpoint by CSS — four full-length labels
      // do not fit across a 375px phone without horizontal scrolling.
      button.innerHTML =
        `<span class="tab-label">${tab.label}</span>` +
        `<span class="tab-label-short">${tab.shortLabel || tab.label}</span>` +
        `<span class="tab-count" hidden></span>`;
      list.appendChild(button);
    }
    nav.appendChild(list);

    const hint = document.createElement("p");
    hint.className = "tabbar-hint";
    hint.id = "tabbarHint";
    nav.appendChild(hint);

    // The hero and the freshness notice stay pinned above the tabs; everything
    // else moves into a panel.
    const anchor = document.getElementById("freshnessNotice") || document.querySelector(".page-hero");
    if (anchor && anchor.parentElement === main) anchor.insertAdjacentElement("afterend", nav);
    else main.prepend(nav);

    for (const tab of TABS) {
      const panel = document.createElement("div");
      panel.className = "tab-panel";
      panel.id = `tabpanel-${tab.id}`;
      panel.dataset.tab = tab.id;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tab-${tab.id}`);
      panel.hidden = true;
      main.appendChild(panel);
    }

    list.addEventListener("click", (event) => {
      const button = event.target.closest(".tab-btn");
      if (button) select(button.dataset.tab, { focus: true });
    });

    list.addEventListener("keydown", (event) => {
      const order = TABS.map((tab) => tab.id);
      const current = order.indexOf(activeId);
      let next = null;
      if (event.key === "ArrowRight") next = order[(current + 1) % order.length];
      else if (event.key === "ArrowLeft") next = order[(current - 1 + order.length) % order.length];
      else if (event.key === "Home") next = order[0];
      else if (event.key === "End") next = order[order.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next, { focus: true });
    });

    return nav;
  }

  // Moves any section that has appeared into its tab panel, preserving the
  // configured order. Safe to call repeatedly — a section already in the right
  // place is left alone. Returns true when a section is still missing.
  function placeSections() {
    let missing = false;
    for (const tab of TABS) {
      const panel = document.getElementById(`tabpanel-${tab.id}`);
      if (!panel) continue;
      for (const selector of tab.selectors) {
        const section = document.querySelector(selector);
        if (!section) {
          missing = true;
          continue;
        }
        if (section.parentElement === panel) continue;
        section.dataset.tabIndex = String(bySelector.get(selector).index);
        panel.appendChild(section);
      }
      // Re-sort by configured index so a late arrival (the injected tape panel)
      // lands in its intended slot rather than at the bottom.
      const placed = [...panel.children].sort(
        (a, b) => Number(a.dataset.tabIndex || 0) - Number(b.dataset.tabIndex || 0)
      );
      for (const node of placed) panel.appendChild(node);
    }
    return missing;
  }

  // Live counts on the tab chips. Only real, countable things — a tab with
  // nothing to show gets no badge rather than a zero.
  function refreshCounts() {
    const counts = {
      today: document.querySelectorAll(".whatchanged-feed > *").length,
      themes: document.querySelectorAll(".themes-rail > *").length,
      deepdive: document.querySelectorAll("#rankingBody > tr").length,
      record: 0,
    };
    for (const tab of TABS) {
      const badge = document.querySelector(`#tab-${tab.id} .tab-count`);
      if (!badge) continue;
      const value = counts[tab.id];
      const show = Number.isFinite(value) && value > 0;
      badge.hidden = !show;
      badge.textContent = show ? String(value) : "";
    }
  }

  function select(id, { focus = false } = {}) {
    const tab = TABS.find((entry) => entry.id === id) || TABS[0];
    // Re-selecting the active tab is a no-op beyond the counts. This matters:
    // select() dispatches a resize (which runs a full render()), and callers
    // like the search box invoke it on every keystroke.
    if (tab.id === activeId) {
      refreshCounts();
      if (focus) document.getElementById(`tab-${tab.id}`)?.focus();
      return;
    }
    activeId = tab.id;

    for (const entry of TABS) {
      const button = document.getElementById(`tab-${entry.id}`);
      const panel = document.getElementById(`tabpanel-${entry.id}`);
      const isActive = entry.id === tab.id;
      if (button) {
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
        button.tabIndex = isActive ? 0 : -1;
      }
      if (panel) panel.hidden = !isActive;
    }

    const hint = document.getElementById("tabbarHint");
    if (hint) hint.textContent = tab.hint;
    refreshCounts();

    // Filters only act on the discovery board, so the control is meaningless
    // anywhere else.
    const filterBtn = document.getElementById("toggleSidebar");
    const shell = document.querySelector(".app-shell");
    const filtersRelevant = tab.id === "deepdive";
    if (filterBtn) filterBtn.hidden = !filtersRelevant;
    // NB: script.js's toggleSidebar puts `sidebar-hidden` on `.app-shell`, not
    // on the sidebar itself — mirror that or the rail stays on screen.
    if (shell && !filtersRelevant) {
      shell.classList.add("sidebar-hidden");
      filterBtn?.setAttribute("aria-pressed", "false");
    }

    try {
      localStorage.setItem(STORE_KEY, tab.id);
    } catch {
      /* private mode — tab choice just won't persist */
    }
    // Deep-linking is a nicety, never a dependency: some embedded/webview
    // contexts expose no usable History API, and an unguarded call here used to
    // throw and abort the rest of this function (leaving the tab counts stale).
    try {
      if (location.hash.replace(/^#/, "") !== tab.id) {
        window.history?.replaceState(null, "", `#${tab.id}`);
      }
    } catch {
      /* no History API — the tab still switches, the URL just won't track it */
    }
    if (focus) document.getElementById(`tab-${tab.id}`)?.focus();

    // Panels that lay out from measured widths were hidden until now.
    window.dispatchEvent(new Event("resize"));
    refreshCounts();
  }

  function start() {
    if (!buildShell()) return;
    let attempts = 0;
    const tick = () => {
      const missing = placeSections();
      refreshCounts();
      if (missing && attempts++ < 40) setTimeout(tick, 200);
    };
    tick();
    try {
      select(readInitialTab());
    } catch (error) {
      // A broken tab shell would hide every panel, so fall back to the first tab.
      console.error("SignalDesk tabs: initial select failed", error);
      select(TABS[0].id);
    }

    window.addEventListener("hashchange", () => {
      const id = (location.hash || "").replace(/^#/, "");
      if (id && id !== activeId && TABS.some((tab) => tab.id === id)) select(id);
    });

    // Panels render asynchronously from their own data globals; keep the counts
    // honest without polling forever.
    let refreshes = 0;
    const countTimer = setInterval(() => {
      refreshCounts();
      if (refreshes++ > 30) clearInterval(countTimer);
    }, 1000);
  }

  // Anything that wants to jump the user to a section can use this.
  window.SIGNALDESK_SELECT_TAB = (id) => select(id);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
