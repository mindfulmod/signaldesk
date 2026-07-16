(() => {
  // Springs board — THEME_ENGINE.md Layer 3. Reads data/springs.json (frozen
  // coil detector output) and renders three honest states: Coiled (watching),
  // Released (the breakout that historically mattered), Dead coil (demoted).
  // Never presented as a buy signal — every card shows the base rates and,
  // where relevant, a risk flag beside the setup.
  let springsData = null;

  const STATE_COPY = {
    coiled: { label: "Coiled — watching", className: "coiled" },
    released: { label: "Release fired", className: "released" },
    dead: { label: "Dead coil — demoted", className: "dead" },
  };

  async function install() {
    injectStyles();
    await loadSprings();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadSprings(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/springs.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          springsData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_SPRINGS?.springs) {
      springsData = window.SIGNALDESK_SPRINGS;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadSprings(true);
      render();
    });
  }

  // The main dashboard's render() is called on load, filter changes, and
  // resize. Re-rendering springs alongside it costs nothing (static per
  // pageload) and keeps the two boards visually in sync during a resize.
  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskSpringsPatched) return;
    const original = render;
    render = function patchedRenderWithSprings() {
      original();
      renderSpringsBoard();
    };
    render.__signaldeskSpringsPatched = true;
  }

  function render() {
    renderSpringsBoard();
  }

  function renderSpringsBoard() {
    const container = document.getElementById("springsBoard");
    if (!container) return;
    const springs = springsData?.springs || [];
    if (!springs.length) {
      container.innerHTML = emptyStateMarkup();
      return;
    }

    const coiled = springs.filter((s) => s.state === "coiled").sort((a, b) => (b.persistence || 0) - (a.persistence || 0)).slice(0, 8);
    const released = springs.filter((s) => s.state === "released").sort((a, b) => String(b.releaseDate || "").localeCompare(String(a.releaseDate || ""))).slice(0, 6);
    const dead = springs.filter((s) => s.state === "dead").sort((a, b) => String(b.regimeEnd || "").localeCompare(String(a.regimeEnd || ""))).slice(0, 6);

    container.innerHTML = [
      springsColumn("Coiled", coiled, "Sustained attention, compressed price. A watch state, not a signal — most coils never release."),
      springsColumn("Released", released, "Closed above its own 60-day high on a volume surge. This is what a coil is for."),
      springsColumn("Dead coils", dead, "Compressed for months, then aged out with no breakout. Shown as the honest counterweight to the released column."),
    ].join("");
  }

  function springsColumn(title, items, subhead) {
    return `
      <div class="springs-column">
        <div class="springs-column-head">
          <h3>${escapeHtml(title)} <span class="springs-count">${items.length}</span></h3>
          <p>${escapeHtml(subhead)}</p>
        </div>
        <div class="springs-cards">
          ${items.length ? items.map(springCard).join("") : `<p class="springs-empty-col">None right now.</p>`}
        </div>
      </div>`;
  }

  function springCard(item) {
    const copy = STATE_COPY[item.state] || STATE_COPY.coiled;
    const sub = [item.sector, item.sub].filter(Boolean).join(" · ");
    const spark = sparkline(item.spark);
    const badges = [];
    if (item.inHotTheme) badges.push(`<span class="spring-badge hot">In a hot theme</span>`);
    if (item.defensiveDiscount) badges.push(`<span class="spring-badge risk">Defensive sector — discounted</span>`);
    if (item.obvSlope === "down") badges.push(`<span class="spring-badge risk">OBV trending down</span>`);
    if (item.obvSlope === "up") badges.push(`<span class="spring-badge">OBV trending up</span>`);
    if (item.attentionSource === "shareOfVoice") badges.push(`<span class="spring-badge muted">Attention: early share-of-voice history</span>`);

    return `
      <article class="spring-card" data-state="${escapeHtml(item.state)}">
        <div class="spring-card-top">
          <span class="state-badge state-${copy.className}">${copy.label}</span>
          <span class="spring-ticker">${escapeHtml(item.ticker)}</span>
        </div>
        <p class="spring-name">${escapeHtml(item.name || item.ticker)}${sub ? ` · <span>${escapeHtml(sub)}</span>` : ""}</p>
        ${spark}
        <div class="spring-stats">
          <span>Persistence <strong>${formatPct(item.persistence)}</strong></span>
          <span>Compression <strong>${formatPct(item.compressionPercentile, true)}</strong></span>
          <span>${item.daysInState}d in state</span>
        </div>
        <p class="spring-note">${escapeHtml(stateNote(item))}</p>
        <div class="spring-baserates">${baseRateLine(item.state)}</div>
        ${badges.length ? `<div class="spring-badges">${badges.join("")}</div>` : ""}
      </article>`;
  }

  function stateNote(item) {
    if (item.state === "coiled") {
      return `Attention has held above its own trailing-year baseline while price stayed unusually tight for ${item.regimeSessions} sessions (since ${item.regimeStart}). This is a watch state — most coils never release.`;
    }
    if (item.state === "released") {
      return `Coiled from ${item.regimeStart} to ${item.regimeEnd}, then closed above its 60-day high on a volume surge on ${item.releaseDate}.`;
    }
    return `Coiled from ${item.regimeStart} to ${item.regimeEnd} (${item.regimeSessions} sessions) with no release within ~6 months. Demoted — treat as a closed case, not a pending one.`;
  }

  function baseRateLine(state) {
    const rates = springsData?.baseRates || {};
    if (state === "released") {
      const r = rates.released || {};
      return `<span>Released coils historically: ${pct(r.winRate)} win · ${signedPct(r.medianReturn)} median · ${pct(r.doubleRate)} reach +50% (${r.horizon || "12mo"})</span>`;
    }
    if (state === "dead") {
      const r = rates.unreleased || {};
      return `<span class="risk">Unreleased coils historically: ${signedPct(r.relMedianReturn)} vs SPY · ${pct(r.winRate)} win · zero doubles (${r.horizon || "12mo vs SPY"})</span>`;
    }
    const released = rates.released || {};
    const unreleased = rates.unreleased || {};
    return `<span>If it releases: ${pct(released.winRate)} win · ${signedPct(released.medianReturn)} median.</span>
      <span class="risk">If it dies unreleased instead: ${signedPct(unreleased.relMedianReturn)} vs SPY, zero doubles.</span>`;
  }

  function sparkline(values) {
    if (!Array.isArray(values) || values.length < 2) return "";
    const finite = values.filter(Number.isFinite);
    if (finite.length < 2) return "";
    const w = 220;
    const h = 40;
    const pad = 3;
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
    return `<svg class="spring-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" data-dir="${dir}" aria-hidden="true"><polyline points="${points}" fill="none" stroke-width="1.6" /></svg>`;
  }

  function emptyStateMarkup() {
    return `<p class="springs-empty">No springs classified yet. The coil detector needs roughly a year of trailing attention and price history per ticker (Wikipedia pageviews or share-of-voice) — this fills in as the daily ledger accumulates.</p>`;
  }

  function formatPct(value, invert = false) {
    if (!Number.isFinite(value)) return "—";
    return `${Math.round(value <= 1 && !invert ? value * 100 : value)}${invert ? "th pct" : "%"}`;
  }

  function pct(value) {
    return Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—";
  }

  function signedPct(value) {
    if (!Number.isFinite(value)) return "—";
    const pctValue = value * 100;
    return `${pctValue >= 0 ? "+" : ""}${pctValue.toFixed(1)}%`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-springs-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-springs-styles";
    style.textContent = `
      .springs-board {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 14px;
        align-items: start;
      }
      .springs-column-head h3 {
        margin: 0 0 4px;
        font-size: 1rem;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .springs-count {
        font-family: var(--mono);
        font-size: 0.78rem;
        color: var(--muted);
        background: var(--panel-3);
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 1px 8px;
      }
      .springs-column-head p {
        margin: 0 0 10px;
        color: var(--muted);
        font-size: 0.82rem;
        line-height: 1.4;
      }
      .springs-cards { display: flex; flex-direction: column; gap: 10px; }
      .springs-empty-col {
        margin: 0;
        padding: 14px;
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        color: var(--muted);
        font-size: 0.85rem;
        text-align: center;
      }
      .springs-empty {
        grid-column: 1 / -1;
        margin: 0;
        padding: 20px;
        text-align: center;
        color: var(--muted);
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .spring-card {
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
        padding: 14px;
      }
      .spring-card[data-state="released"] { border-color: rgba(96, 211, 141, 0.4); }
      .spring-card[data-state="dead"] { opacity: 0.85; }
      .spring-card-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 6px;
      }
      .spring-ticker {
        font-family: var(--mono);
        font-weight: 700;
        font-size: 0.95rem;
      }
      .state-badge {
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
      .state-badge.state-coiled { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .state-badge.state-released { color: var(--up); border-color: rgba(96, 211, 141, 0.35); background: rgba(96, 211, 141, 0.12); }
      .state-badge.state-dead { color: var(--muted); }
      .spring-name {
        margin: 0 0 8px;
        font-size: 0.85rem;
        color: var(--ink);
      }
      .spring-name span { color: var(--muted); }
      .spring-spark {
        width: 100%;
        height: 34px;
        display: block;
        margin-bottom: 8px;
      }
      .spring-spark polyline { stroke: var(--muted); }
      .spring-spark[data-dir="up"] polyline { stroke: var(--up); }
      .spring-spark[data-dir="down"] polyline { stroke: var(--down); }
      .spring-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 0.78rem;
        color: var(--muted);
        margin-bottom: 8px;
      }
      .spring-stats strong { color: var(--ink); }
      .spring-note {
        margin: 0 0 8px;
        font-size: 0.82rem;
        line-height: 1.45;
        color: var(--ink);
      }
      .spring-baserates {
        display: flex;
        flex-direction: column;
        gap: 3px;
        font-size: 0.76rem;
        color: var(--muted);
        margin-bottom: 6px;
      }
      .spring-baserates .risk { color: var(--down); }
      .spring-badges { display: flex; flex-wrap: wrap; gap: 6px; }
      .spring-badge {
        font-size: 0.68rem;
        padding: 2px 7px;
        border-radius: 6px;
        background: var(--panel-3);
        border: 1px solid var(--line-2);
        color: var(--muted);
      }
      .spring-badge.hot { color: var(--accent); border-color: var(--accent-dim); }
      .spring-badge.risk { color: var(--down); }
      @media (max-width: 980px) {
        .springs-board { grid-template-columns: 1fr; }
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
