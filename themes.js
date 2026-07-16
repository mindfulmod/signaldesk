(() => {
  // Themes rail — THEME_ENGINE.md Layer 1. Reads data/themes.json (theme
  // heat scored on breadth in excess of the whole market) and renders a
  // horizontal rail. Heat describes participation breadth, not a forecast —
  // stage copy stays descriptive, never a buy signal.
  let themesData = null;
  let diffusionData = null;
  let selectedThemeId = null;

  const DIFFUSION_STATE_COPY = {
    ran: { label: "Ran", note: "Already up 50%+ over 12mo and extended 30%+ above its 200d average. Late-cycle; crowding risk, not a reason to chase." },
    running: { label: "Running", note: "Released its coil, or made a fresh 52-week high in the last 60 sessions." },
    coiled: { label: "Coiled", note: "Active coil regime right now — see the Springs board for the full detail." },
    lagging: { label: "Lagging", note: "Under +10% vs SPY over 90d with no coil yet — a candidate to watch for coil formation." },
    dead: { label: "Dead coil", note: "Coiled, then aged out without releasing. Demoted." },
  };

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
      note: "Early attention breadth above the market, with a confirmed phrase from the news/filings radar backing it up.",
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
    await Promise.all([loadThemes(), loadDiffusionMap()]);
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

  async function loadDiffusionMap(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/diffusion-map.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          diffusionData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_DIFFUSION_MAP?.themes) {
      diffusionData = window.SIGNALDESK_DIFFUSION_MAP;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await Promise.all([loadThemes(true), loadDiffusionMap(true)]);
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
    renderDiffusionDetail();
  }

  function renderThemesRail() {
    const container = document.getElementById("themesRail");
    if (!container) return;

    const subhead = document.getElementById("themesSubhead");
    if (subhead) {
      subhead.textContent = themesData?.languageAvailable
        ? "How hot each tracked theme is right now, scored on breadth in excess of the whole market (a crash rebound that lifts everything equally won't light this up), plus confirmed phrase velocity from the news/filings radar."
        : "How hot each tracked theme is right now, scored on breadth in excess of the whole market (a crash rebound that lifts everything equally won't light this up). Heat currently excludes the language/phrase-velocity component (no phrase has cleared both the GDELT and EDGAR confirmation bar yet), so scores read conservatively.";
    }

    const themes = themesData?.themes || [];
    if (!themes.length) {
      container.innerHTML = `<p class="themes-empty">No themes registered yet.</p>`;
      return;
    }
    // Heat-ranked already by the backend; insufficient-data themes sink via null heat.
    container.innerHTML = themes.map(themeCard).join("");
    container.querySelectorAll("[data-theme-id]").forEach((card) => {
      const toggle = () => {
        const id = card.dataset.themeId;
        selectedThemeId = selectedThemeId === id ? null : id;
        render();
      };
      card.addEventListener("click", toggle);
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
    });
  }

  function themeCard(theme) {
    const copy = STAGE_COPY[theme.stage] || STAGE_COPY.quiet;
    const heatDisplay = Number.isFinite(theme.heat) ? theme.heat : "—";
    const members = theme.members || [];
    const shown = members.slice(0, 6);
    const extra = members.length - shown.length;
    const hasDiffusion = (diffusionData?.themes || []).some((t) => t.id === theme.id);
    const selected = selectedThemeId === theme.id;
    const phrase = theme.evidence?.phrase;
    const note = theme.stage === "naming" && !phrase
      ? "Early attention breadth above the market. No phrase has cleared both the GDELT and EDGAR confirmation bar for this theme yet, so this reads conservatively."
      : copy.note;

    return `
      <article class="theme-card${selected ? " selected" : ""}" data-stage="${escapeHtml(theme.stage)}" data-theme-id="${escapeHtml(theme.id)}" role="button" tabindex="0" aria-expanded="${selected}">
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
          ${phrase ? `<span>Confirmed phrase <strong>"${escapeHtml(phrase)}"</strong></span>` : ""}
        </div>
        <div class="theme-members">
          ${shown.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          ${extra > 0 ? `<span class="theme-member-more">+${extra}</span>` : ""}
        </div>
        <p class="theme-note">${escapeHtml(note)}</p>
        ${hasDiffusion ? `<p class="theme-expand-hint">${selected ? "Hide" : "View"} supply-chain map ${selected ? "▲" : "▼"}</p>` : ""}
      </article>`;
  }

  function renderDiffusionDetail() {
    const container = document.getElementById("diffusionDetail");
    if (!container) return;
    if (!selectedThemeId) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    const theme = (diffusionData?.themes || []).find((t) => t.id === selectedThemeId);
    const themeName = (themesData?.themes || []).find((t) => t.id === selectedThemeId)?.name || selectedThemeId;
    container.hidden = false;
    if (!theme || !theme.members.length) {
      container.innerHTML = `<p class="diffusion-empty">Not enough members of <strong>${escapeHtml(themeName)}</strong> have enough trailing history yet to place on the supply-chain map.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="diffusion-head">
        <h3>${escapeHtml(themeName)} — supply-chain map</h3>
        <p>Who's already run, who's running now, who's coiled, and who's lagging (a coil-formation watchlist) — ordered ran → running → coiled → lagging.</p>
      </div>
      <div class="diffusion-table" role="table">
        <div class="diffusion-row diffusion-row-head" role="row">
          <span role="columnheader">Ticker</span>
          <span role="columnheader">State</span>
          <span role="columnheader">Trend</span>
          <span role="columnheader">Attention ratio</span>
          <span role="columnheader">Days in state</span>
        </div>
        ${theme.members.map(diffusionRow).join("")}
      </div>`;
  }

  function diffusionRow(member) {
    const copy = DIFFUSION_STATE_COPY[member.state] || { label: member.state, note: "" };
    return `
      <div class="diffusion-row" role="row" data-state="${escapeHtml(member.state)}" title="${escapeHtml(copy.note)}">
        <span class="diffusion-ticker" role="cell">${escapeHtml(member.ticker)}</span>
        <span role="cell"><span class="diffusion-state-badge state-${escapeHtml(member.state)}">${escapeHtml(copy.label)}</span></span>
        <span role="cell">${sparkline(member.spark)}</span>
        <span role="cell">${Number.isFinite(member.attentionRatio) ? `${member.attentionRatio.toFixed(2)}×` : "—"}</span>
        <span role="cell">${member.daysInState}d</span>
      </div>`;
  }

  function sparkline(values) {
    if (!Array.isArray(values) || values.length < 2) return "";
    const finite = values.filter(Number.isFinite);
    if (finite.length < 2) return "";
    const w = 90;
    const h = 26;
    const pad = 2;
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min || 1;
    const step = (w - pad * 2) / (values.length - 1);
    const points = values
      .map((v, i) => {
        const x = pad + i * step;
        const y = Number.isFinite(v) ? h - pad - ((v - min) / range) * (h - pad * 2) : h / 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
    const dir = finite.at(-1) >= finite[0] ? "up" : "down";
    return `<svg class="diffusion-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" data-dir="${dir}" aria-hidden="true"><polyline points="${points}" fill="none" stroke-width="1.4" /></svg>`;
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
        margin: 0 0 6px;
        font-size: 0.78rem;
        line-height: 1.4;
        color: var(--muted);
      }
      .theme-card { cursor: pointer; }
      .theme-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .theme-card.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-dim); }
      .theme-expand-hint {
        margin: 4px 0 0;
        font-size: 0.72rem;
        color: var(--accent);
        font-weight: 600;
      }
      .diffusion-detail {
        margin-top: 14px;
        padding: 16px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .diffusion-head h3 { margin: 0 0 4px; font-size: 1rem; }
      .diffusion-head p { margin: 0 0 12px; font-size: 0.8rem; color: var(--muted); line-height: 1.4; }
      .diffusion-empty { margin: 0; color: var(--muted); font-size: 0.85rem; }
      .diffusion-table { display: flex; flex-direction: column; gap: 2px; }
      .diffusion-row {
        display: grid;
        grid-template-columns: 80px 110px 1fr 110px 90px;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 8px;
      }
      .diffusion-row:not(.diffusion-row-head) { background: var(--panel-3); }
      .diffusion-row-head span {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--muted);
        font-weight: 700;
      }
      .diffusion-ticker { font-family: var(--mono); font-weight: 700; }
      .diffusion-state-badge {
        font-size: 0.68rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 999px;
        background: var(--panel-2);
        border: 1px solid var(--line-2);
        color: var(--muted);
      }
      .diffusion-state-badge.state-ran { color: var(--down); }
      .diffusion-state-badge.state-running { color: var(--up); border-color: rgba(96, 211, 141, 0.35); background: rgba(96, 211, 141, 0.12); }
      .diffusion-state-badge.state-coiled { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .diffusion-state-badge.state-dead { color: var(--muted); }
      .diffusion-spark { width: 100%; max-width: 90px; height: 22px; display: block; }
      .diffusion-spark polyline { stroke: var(--muted); }
      .diffusion-spark[data-dir="up"] polyline { stroke: var(--up); }
      .diffusion-spark[data-dir="down"] polyline { stroke: var(--down); }
      @media (max-width: 680px) {
        .theme-card { width: 230px; }
        .diffusion-row { grid-template-columns: 64px 90px 1fr 80px 60px; font-size: 0.82rem; }
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
