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

  function render() {
    renderClusters();
  }

  function renderClusters() {
    const container = document.getElementById("clustersFeed");
    if (!container) return;
    const openScan = '<a class="cluster-scan" href="?techView=discovery&amp;scan=open#research">Explore beyond tracked themes →</a>';
    if (clustersData?.integrityVersion !== 3) {
      container.innerHTML = '<p class="clusters-empty">Older clusters cannot be checked against their original headlines. They are withheld until the next collection with verified company matches. In the meantime, use Discover → Open scan to find leads outside your tracked topics.</p>' + openScan;
      return;
    }
    const date = displayDate(clustersData.generatedAt);
    const status = `<p class="cluster-status">${Number(clustersData.verifiedDocuments) || 0} supporting documents · ${date ? `Checked ${escapeHtml(date)} UTC` : "Check date unavailable"}${clustersData.withheldLegacyDocuments ? ` · ${Number(clustersData.withheldLegacyDocuments)} older records excluded` : ""}</p>`;
    const communities = clustersData?.communities || [];
    if (!communities.length) {
      const nodes = clustersData?.graphNodes || 0;
      container.innerHTML = `${status}<p class="clusters-empty">${nodes ? `Tracking ${nodes} tickers with shared headline evidence; no group meets the experimental cluster rules yet.` : "No eligible shared-headline evidence in the current graph. This does not mean there are no emerging trends."} Next: use Discover → Open scan for technology leads beyond listed companies.</p>${openScan}`;
      return;
    }
    container.innerHTML = `${status}${communities.map(clusterRow).join("")}<p class="cluster-note">Links can repeat the same announcement. Counts are not independent confirmation, adoption measurements or price forecasts.</p>${openScan}`;
  }

  function clusterRow(community) {
    const members = community.members || [];
    const shown = members.slice(0, 10);
    const extra = members.length - shown.length;
    const evidence = (community.evidence || []).filter(item => safeUrl(item.url));
    const documents = Number(community.documentCount) || 0;
    return `
      <div class="cluster-row">
        <div class="cluster-members">
          ${shown.map((t) => `<span>${escapeHtml(t)}</span>`).join("")}
          ${extra > 0 ? `<span class="cluster-member-more">+${extra}</span>` : ""}
        </div>
        <p class="cluster-note"><strong>${documents} supporting document${documents === 1 ? "" : "s"}</strong> linking ${members.length} tickers${documents === 1 ? " — single-document lead, not a repeated trend" : " — a candidate relationship, not a verified theme"}.</p>
        <p class="cluster-next">Next check: do these companies share a real product, customer or deployment milestone?</p>
        <details class="cluster-evidence"><summary>Review headline evidence${documents > evidence.length ? ` (latest ${evidence.length} of ${documents})` : ""}</summary><ul>${evidence.map(item => `<li><a href="${escapeHtml(safeUrl(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a><small>${escapeHtml(item.source)} · ${displayDate(item.published) ? `Published ${escapeHtml(displayDate(item.published))}` : `Publication date unknown · first observed ${escapeHtml(displayDate(item.firstSeen) || "date unknown")}`}</small></li>`).join("")}</ul></details>
      </div>`;
  }

  function safeUrl(value) {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch { return ""; }
  }

  function displayDate(value) {
    if (!value || !Number.isFinite(Date.parse(value))) return "";
    return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
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
      .cluster-status { margin: 0; color: var(--muted); font-size: 0.75rem; line-height: 1.5; }
      .cluster-scan { align-self: flex-start; padding: 10px 0; color: var(--accent); font-size: 0.82rem; font-weight: 600; text-underline-offset: 3px; }
      .cluster-next { margin: 8px 0; color: var(--ink); font-size: 0.82rem; line-height: 1.5; }
      .cluster-evidence { margin-top: 10px; font-size: 0.8rem; }
      .cluster-evidence summary { cursor: pointer; padding: 8px 0; color: var(--ink); }
      .cluster-evidence ul { padding-left: 18px; margin: 8px 0 0; }
      .cluster-evidence li { margin-bottom: 12px; overflow-wrap: anywhere; line-height: 1.5; }
      .cluster-evidence a { color: var(--accent); text-decoration: underline; text-underline-offset: 3px; }
      .cluster-evidence small { display: block; color: var(--muted); margin-top: 4px; }
      .cluster-evidence :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
    `;
    document.head.appendChild(style);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();
