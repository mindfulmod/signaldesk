(() => {
  // Calibration panel — THEME_ENGINE.md validation plan. Reads
  // data/calibration.json: forward-graded win rate + median return per
  // state/stage at 30/90/180/365 days. This is the engine grading itself,
  // not a promise -- small samples read as small samples, not conviction.
  let calibrationData = null;

  const KEY_COPY = {
    release: { label: "Released coils", className: "release" },
    "dead-coil": { label: "Dead coils", className: "dead" },
    "theme-naming": { label: "Theme → Naming", className: "theme" },
    "theme-diffusion": { label: "Theme → Diffusion", className: "theme" },
    "theme-wave": { label: "Theme → Wave", className: "theme" },
    "theme-decay": { label: "Theme → Decay", className: "theme" },
  };
  const HORIZON_ORDER = ["30d", "90d", "180d", "365d"];
  const MIN_SAMPLE_FOR_CONFIDENCE = 10;

  async function install() {
    injectStyles();
    await loadCalibration();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadCalibration(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/calibration.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          calibrationData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_CALIBRATION) {
      calibrationData = window.SIGNALDESK_CALIBRATION;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadCalibration(true);
      render();
    });
  }

  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskCalibrationPatched) return;
    const original = render;
    render = function patchedRenderWithCalibration() {
      original();
      renderCalibration();
    };
    render.__signaldeskCalibrationPatched = true;
  }

  function render() {
    renderCalibration();
  }

  function renderCalibration() {
    const container = document.getElementById("calibrationSummary");
    if (!container) return;
    const summary = calibrationData?.summary || {};
    const keys = Object.keys(summary);
    if (!keys.length) {
      container.innerHTML = `<p class="calibration-empty">No graded events yet. The lifecycle log (Springs releases, dead coils, theme stage transitions) just started — this panel fills in as those events happen and enough real time passes to grade them.</p>`;
      return;
    }
    const pendingNote = calibrationData?.pending
      ? `<p class="calibration-pending">${calibrationData.pending} logged event${calibrationData.pending === 1 ? "" : "s"} still waiting on at least one horizon.</p>`
      : "";
    container.innerHTML = keys.map((key) => calibrationRow(key, summary[key])).join("") + pendingNote;
  }

  function calibrationRow(key, data) {
    const copy = KEY_COPY[key] || { label: key, className: "other" };
    const cells = HORIZON_ORDER.map((horizon) => horizonCell(data.horizons?.[horizon])).join("");
    return `
      <div class="calibration-row" data-key="${escapeHtml(copy.className)}">
        <div class="calibration-row-head">
          <span class="calibration-label">${escapeHtml(copy.label)}</span>
          <span class="calibration-n">${data.n} logged</span>
        </div>
        <div class="calibration-horizons">${cells}</div>
      </div>`;
  }

  function horizonCell(horizon) {
    if (!horizon || !horizon.graded) {
      return `<div class="calibration-cell empty"><span class="ch-label">—</span></div>`;
    }
    const lowConfidence = horizon.graded < MIN_SAMPLE_FOR_CONFIDENCE;
    const winPct = Number.isFinite(horizon.winRate) ? `${Math.round(horizon.winRate * 100)}%` : "—";
    const medianPct = Number.isFinite(horizon.medianReturn)
      ? `${horizon.medianReturn >= 0 ? "+" : ""}${(horizon.medianReturn * 100).toFixed(1)}%`
      : "—";
    return `
      <div class="calibration-cell${lowConfidence ? " low-confidence" : ""}">
        <span class="ch-win">${winPct} win</span>
        <span class="ch-median">${medianPct} median</span>
        <span class="ch-n">n=${horizon.graded}${lowConfidence ? " (small sample)" : ""}</span>
      </div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-calibration-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-calibration-styles";
    style.textContent = `
      .calibration-summary { display: flex; flex-direction: column; gap: 10px; }
      .calibration-empty {
        margin: 0;
        padding: 18px;
        color: var(--muted);
        font-size: 0.85rem;
        line-height: 1.5;
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .calibration-pending { margin: 4px 0 0; font-size: 0.78rem; color: var(--muted); }
      .calibration-row {
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .calibration-row-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .calibration-label { font-weight: 700; font-size: 0.9rem; color: var(--ink); }
      .calibration-n { font-size: 0.74rem; color: var(--muted); }
      .calibration-horizons {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }
      .calibration-cell {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 8px;
        border-radius: 8px;
        background: var(--panel-3);
        border: 1px solid var(--line-2);
      }
      .calibration-cell.empty { align-items: center; justify-content: center; color: var(--muted); }
      .calibration-cell.low-confidence { border-style: dashed; opacity: 0.85; }
      .ch-win { font-weight: 700; font-size: 0.86rem; color: var(--ink); }
      .ch-median { font-size: 0.78rem; color: var(--muted); }
      .ch-n { font-size: 0.68rem; color: var(--muted); }
      @media (max-width: 680px) {
        .calibration-horizons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
