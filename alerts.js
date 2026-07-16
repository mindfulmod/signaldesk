(() => {
  // "What changed" feed — THEME_ENGINE.md Layer 4. Reads data/alerts-log.json
  // (the same event list the pipeline optionally pushes to ntfy.sh) and
  // renders it on-site, so lifecycle changes are visible even without a
  // configured push topic.
  let alertsData = null;

  const TYPE_COPY = {
    release: { label: "Release fired", className: "release" },
    "new-coil-hot-theme": { label: "New coil in a hot theme", className: "hot-coil" },
    "dead-coil": { label: "Dead coil demoted", className: "dead-coil" },
    "theme-stage-transition": { label: "Theme stage change", className: "stage" },
    "proof-quarter": { label: "Proof quarter", className: "proof-quarter" },
    "weekly-digest": { label: "Weekly digest", className: "digest" },
  };

  async function install() {
    injectStyles();
    await loadAlerts();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadAlerts(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/alerts-log.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          alertsData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_ALERTS_LOG?.entries) {
      alertsData = window.SIGNALDESK_ALERTS_LOG;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadAlerts(true);
      render();
    });
  }

  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskAlertsPatched) return;
    const original = render;
    render = function patchedRenderWithAlerts() {
      original();
      renderWhatChanged();
    };
    render.__signaldeskAlertsPatched = true;
  }

  function render() {
    renderWhatChanged();
  }

  function renderWhatChanged() {
    const container = document.getElementById("whatChangedFeed");
    if (!container) return;
    const entries = (alertsData?.entries || []).slice(0, 20);
    if (!entries.length) {
      container.innerHTML = `<p class="whatchanged-empty">No lifecycle changes recorded yet — this fills in as coils release, themes shift stage, or coils age out without releasing.</p>`;
      return;
    }
    container.innerHTML = entries.map(entryRow).join("");
  }

  function entryRow(entry) {
    const copy = TYPE_COPY[entry.type] || { label: entry.type, className: "other" };
    const when = relativeTime(entry.date);
    const subject = entry.ticker || entry.theme || "";
    return `
      <div class="whatchanged-row" data-type="${escapeHtml(copy.className)}">
        <span class="wc-badge wc-${escapeHtml(copy.className)}">${escapeHtml(copy.label)}</span>
        <div class="wc-body">
          <p class="wc-message">${subject ? `<strong>${escapeHtml(subject)}</strong> — ` : ""}${escapeHtml(entry.message)}</p>
          <p class="wc-meta">${when}</p>
        </div>
      </div>`;
  }

  function relativeTime(value) {
    if (!value) return "";
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return "";
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-alerts-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-alerts-styles";
    style.textContent = `
      .whatchanged-feed {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 420px;
        overflow-y: auto;
      }
      .whatchanged-empty {
        margin: 0;
        padding: 18px;
        color: var(--muted);
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .whatchanged-row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 11px 13px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .wc-badge {
        flex: 0 0 auto;
        font-size: 0.66rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 8px;
        border-radius: 999px;
        background: var(--panel-3);
        color: var(--muted);
        border: 1px solid var(--line-2);
        white-space: nowrap;
      }
      .wc-badge.wc-release { color: var(--up); border-color: rgba(96, 211, 141, 0.35); background: rgba(96, 211, 141, 0.12); }
      .wc-badge.wc-hot-coil { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .wc-badge.wc-dead-coil { color: var(--down); }
      .wc-badge.wc-stage { color: var(--ink); }
      .wc-badge.wc-proof-quarter { color: var(--accent); border-color: var(--accent-dim); background: var(--accent-dim); }
      .wc-body { min-width: 0; }
      .wc-message {
        margin: 0 0 3px;
        font-size: 0.85rem;
        line-height: 1.4;
        color: var(--ink);
        overflow-wrap: anywhere;
      }
      .wc-meta {
        margin: 0;
        font-size: 0.72rem;
        color: var(--muted);
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
