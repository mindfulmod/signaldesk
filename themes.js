(() => {
  // Themes rail — THEME_ENGINE.md Layer 1. Reads data/themes.json (theme
  // heat scored on breadth in excess of the whole market) and renders a
  // horizontal rail. Heat describes participation breadth, not a forecast —
  // stage copy stays descriptive, never a buy signal.
  let themesData = null;

  const STAGE_COPY = {
    "insufficient-data": {
      label: "Not enough history yet",
      className: "pending",
      note: "Fewer than 3 members have enough trailing price/attention history to score. This fills in as the daily ledger accumulates.",
    },
    quiet: {
      label: "Quiet",
      className: "quiet",
      note: "No breadth of participation above the broad market right now.",
    },
    naming: {
      label: "Naming",
      className: "naming",
      note: "Early attention breadth above the market. The language/phrase-velocity signal isn't built yet, so this reads conservatively.",
    },
    diffusion: {
      label: "Diffusion",
      className: "diffusion",
      note: "Attention breadth is elevated above the market while price breadth hasn't caught up yet — historically the early-entry window, and the window this build's Springs board is meant to catch.",
    },
    wave: {
      label: "Wave",
      className: "wave",
      note: "Broad relative-strength breadth across members. The theme is running, which also means more of the move may already be priced in.",
    },
    decay: {
      label: "Decay",
      className: "decay",
      note: "The theme's own equal-weight basket has slipped below its trailing baseline. Historically this is when rotation out begins.",
    },
  };

  async function install() {
    injectStyles();
    await loadThemes();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadThemes(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/themes.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          themesData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_THEMES?.themes) {
      themesData = window.SIGNALDESK_THEMES;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadThemes(true);
      render();
    });
  }

  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskThemesPatched) return;
    const original = render;
    render = function patchedRenderWithThemes() {
      original();
      renderThemesRail();
    };
    render.__signaldeskThemesPatched = true;
  }

  function render() {
    renderThemesRail();
  }

  function renderThemesRail() {
    const container = document.getElementById("themesRail");
    if (!container) return;
    const themes = themesData?.themes || [];
    if (!themes.length) {
      container.innerHTML = `<p class="themes-empty">No themes registered yet.</p>`;
      return;
    }
    // Heat-ranked already by the backend; insufficient-data themes sink via null heat.
    container.innerHTML = themes.map(themeCard).join("");
  }

  function themeCard(theme) {
    const copy = STAGE_COPY[theme.stage] || STAGE_COPY.quiet;
    const heatDisplay = Number.isFinite(theme.heat) ? theme.heat : "—";
    const members = theme.members || [];
    const shown = members.slice(0, 6);
    const extra = members.length - shown.length;

    return `
      <article class="theme-card" data-stage="${escapeHtml(theme.stage)}">
        <div class="theme-card-top">
          <span class="theme-stage-badge stage-${copy.className}">${escapeHtml(copy.label)}</span>
          <span class="theme-heat" title="Heat score (0-100, excess breadth over the market)">${heatDisplay}</span>
        </div>
        <h3 class="theme-name">${escapeHtml(theme.name)}</h3>
        <div class="theme-meter" aria-label="Heat ${heatDisplay}"><span style="width:${Number.isFinite(theme.heat) ? Math.max(0, Math.min(100, theme.heat)) : 0}%"></span></div>
        <div class="theme-evidence">
          <span>Rel. strength breadth <strong>${formatPct(theme.evidence?.relBreadth)}</strong></span>
          <span>New-high breadth <strong>${formatPct(theme.evidence?.newHighBreadth)}</strong></span>
          <span>Attention breadth <strong>${formatPct(theme.evidence?.attnBreadth)}</strong></span>
        </div>
        <div class="theme-members">
          ${shown.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          ${extra > 0 ? `<span class="theme-member-more">+${extra}</span>` : ""}
        </div>
        <p class="theme-note">${escapeHtml(copy.note)}</p>
      </article>`;
  }

  function formatPct(value) {
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-themes-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-themes-styles";
    style.textContent = `
      .themes-rail {
        display: flex;
        gap: 12px;
        overflow-x: auto;
        padding-bottom: 4px;
        -webkit-overflow-scrolling: touch;
      }
      .themes-empty {
        margin: 0;
        padding: 18px;
        color: var(--muted);
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .theme-card {
        flex: 0 0 auto;
        width: 260px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
        padding: 14px;
      }
      .theme-card[data-stage="wave"] { border-color: rgba(96, 211, 141, 0.4); }
      .theme-card[data-stage="decay"] { opacity: 0.85; }
      .theme-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .theme-stage-badge {
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--panel-3);
        color: var(--muted);
        border: 1px solid var(--line-2);
      }
      .theme-stage-badge.stage-wave { color: var(--up); border-color: rgba(96, 211, 141, 0.35); background: rgba(96, 211, 141, 0.12); }
      .theme-stage-badge.stage-diffusion { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .theme-stage-badge.stage-naming { color: var(--ink); }
      .theme-stage-badge.stage-decay { color: var(--down); }
      .theme-stage-badge.stage-pending { color: var(--muted); }
      .theme-heat {
        font-family: var(--mono);
        font-weight: 700;
        font-size: 1.1rem;
      }
      .theme-name {
        margin: 0 0 8px;
        font-size: 0.98rem;
        line-height: 1.3;
      }
      .theme-meter {
        height: 5px;
        border-radius: 999px;
        background: var(--panel-3);
        overflow: hidden;
        margin-bottom: 10px;
      }
      .theme-meter span {
        display: block;
        height: 100%;
        background: var(--accent);
      }
      .theme-evidence {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 0.76rem;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .theme-evidence strong { color: var(--ink); }
      .theme-members {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
        margin-bottom: 8px;
      }
      .theme-members span {
        font-family: var(--mono);
        font-size: 0.68rem;
        padding: 2px 6px;
        border-radius: 6px;
        background: var(--panel-3);
        border: 1px solid var(--line-2);
        color: var(--ink);
      }
      .theme-member-more { color: var(--muted) !important; }
      .theme-note {
        margin: 0;
        font-size: 0.78rem;
        line-height: 1.4;
        color: var(--muted);
      }
      @media (max-width: 680px) {
        .theme-card { width: 230px; }
      }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
