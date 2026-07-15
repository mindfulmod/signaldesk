(() => {
  // Emerging clusters — THEME_ENGINE.md Layer 0c. Reads data/clusters.json
  // (greedy-modularity communities over the trailing ~90d co-mention graph).
  // Explicitly not a curated theme: a co-mention cluster is a pattern in
  // headline/post co-occurrence, not vetted membership. Human review, not
  // an auto-promoted theme -- consistent with the registry's own "human eye
  // stays in the loop" stance on manual overrides.
  let clustersData = null;

  async function install() {
    injectStyles();
    await loadClusters();
    render();
    bindEvents();
    patchExistingRender();
  }

  async function loadClusters(force = false) {
    const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
    if (canFetchJson || force) {
      try {
        const response = await fetch(`data/clusters.json?ts=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          clustersData = await response.json();
          return true;
        }
      } catch {
        // fall through to the bundled window global
      }
    }
    if (window.SIGNALDESK_CLUSTERS) {
      clustersData = window.SIGNALDESK_CLUSTERS;
      return true;
    }
    return false;
  }

  function bindEvents() {
    const refreshButton = document.getElementById("refreshData");
    if (!refreshButton) return;
    refreshButton.addEventListener("click", async () => {
      await loadClusters(true);
      render();
    });
  }

  function patchExistingRender() {
    if (typeof render !== "function" || render.__signaldeskClustersPatched) return;
    const original = render;
    render = function patchedRenderWithClusters() {
      original();
      renderClusters();
    };
    render.__signaldeskClustersPatched = true;
  }

  function render() {
    renderClusters();
  }

  function renderClusters() {
    const container = document.getElementById("clustersFeed");
    if (!container) return;
    const communities = clustersData?.communities || [];
    if (!communities.length) {
      const nodes = clustersData?.graphNodes || 0;
      container.innerHTML = `<p class="clusters-empty">${nodes ? `Tracking a ${nodes}-ticker co-mention graph, but nothing dense enough to call a cluster yet.` : "No co-mention graph yet — this builds up as headlines and posts naming multiple tickers accumulate over the trailing ~90 days."}</p>`;
      return;
    }
    container.innerHTML = communities.map(clusterRow).join("");
  }

  function clusterRow(community) {
    const members = community.members || [];
    const shown = members.slice(0, 10);
    const extra = members.length - shown.length;
    return `
      <div class="cluster-row">
        <div class="cluster-members">
          ${shown.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          ${extra > 0 ? `<span class="cluster-member-more">+${extra}</span>` : ""}
        </div>
        <p class="cluster-note">${members.length} tickers keep appearing together in the same headlines/posts. Worth a look for an emerging theme GICS and the manual override list haven't caught yet.</p>
      </div>`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-clusters-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-clusters-styles";
    style.textContent = `
      .clusters-feed { display: flex; flex-direction: column; gap: 10px; }
      .clusters-empty {
        margin: 0;
        padding: 16px;
        color: var(--muted);
        font-size: 0.85rem;
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .cluster-row {
        padding: 12px 14px;
        border: 1px solid var(--line);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .cluster-members { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
      .cluster-members span {
        font-family: var(--mono);
        font-size: 0.72rem;
        font-weight: 700;
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--panel-3);
        border: 1px solid var(--line-2);
        color: var(--ink);
      }
      .cluster-member-more { color: var(--muted) !important; font-weight: 600 !important; }
      .cluster-note { margin: 0; font-size: 0.8rem; color: var(--muted); line-height: 1.4; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
