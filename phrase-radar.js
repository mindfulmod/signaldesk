(() => {
  // Phrase radar — THEME_ENGINE.md Layer 0a. Reads data/phrase-radar.json:
  // candidate phrases (novel + accelerating week-over-week) and whether
  // they've been confirmed by both GDELT (news volume) and EDGAR (filing
  // acceleration). Only confirmed phrases feed the Themes rail's language
  // score -- unconfirmed candidates are shown here for visibility, not
  // treated as evidence of anything yet.
  let radarData = null;

  async function install() {
    injectStyles();
    await loadRadar();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadRadar(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/phrase-radar.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          radarData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_PHRASE_RADAR?.phrases) {
      radarData = window.SIGNALDESK_PHRASE_RADAR;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadRadar(true);
      render();
    });
  }

  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskPhraseRadarPatched) return;
    const original = render;
    render = function patchedRenderWithPhraseRadar() {
      original();
      renderPhraseRadar();
    };
    render.__signaldeskPhraseRadarPatched = true;
  }

  function render() {
    renderPhraseRadar();
  }

  function renderPhraseRadar() {
    const container = document.getElementById("phraseRadarFeed");
    if (!container) return;
    const phrases = radarData?.phrases || [];
    if (!phrases.length) {
      container.innerHTML = `<p class="phraseradar-empty">No candidate phrases yet — this fills in as novel, accelerating language shows up in the headline stream and gets checked against GDELT/EDGAR.</p>`;
      return;
    }
    const sorted = [...phrases].sort((a, b) => (b.confirmed ? 1 : 0) - (a.confirmed ? 1 : 0) || b.weekCount - a.weekCount);
    container.innerHTML = sorted.slice(0, 15).map(phraseRow).join("");
  }

  function phraseRow(entry) {
    const badges = [];
    if (entry.confirmed) {
      badges.push(`<span class="pr-badge pr-confirmed">Confirmed</span>`);
    } else {
      badges.push(`<span class="pr-badge pr-pending">Unconfirmed</span>`);
      if (entry.gdelt?.confirmed) badges.push(`<span class="pr-badge pr-partial">GDELT only</span>`);
      if (entry.edgar?.confirmed) badges.push(`<span class="pr-badge pr-partial">EDGAR only</span>`);
    }
    const tickers = (entry.tickers || []).slice(0, 6);
    return `
      <div class="phraseradar-row">
        <div class="pr-top">
          <span class="pr-phrase">"${escapeHtml(entry.phrase)}"</span>
          ${badges.join("")}
        </div>
        <p class="pr-meta">${entry.weekCount} mention${entry.weekCount === 1 ? "" : "s"} this week · ${entry.domains} source domain${entry.domains === 1 ? "" : "s"}${tickers.length ? ` · ${tickers.map(escapeHtml).join(", ")}` : ""}</p>
      </div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-phraseradar-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-phraseradar-styles";
    style.textContent = `
      .phraseradar-feed { display: flex; flex-direction: column; gap: 8px; }
      .phraseradar-empty {
        margin: 0;
        padding: 16px;
        color: var(--muted);
        font-size: 0.85rem;
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .phraseradar-row {
        padding: 11px 14px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .pr-top { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
      .pr-phrase { font-weight: 700; font-size: 0.92rem; color: var(--ink); }
      .pr-badge {
        font-size: 0.66rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 2px 7px;
        border-radius: 999px;
        border: 1px solid var(--line-2);
        color: var(--muted);
        background: var(--panel-3);
      }
      .pr-badge.pr-confirmed { color: var(--up); border-color: rgba(96, 211, 141, 0.35); background: rgba(96, 211, 141, 0.12); }
      .pr-badge.pr-pending { color: var(--muted); }
      .pr-badge.pr-partial { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .pr-meta { margin: 0; font-size: 0.78rem; color: var(--muted); }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
