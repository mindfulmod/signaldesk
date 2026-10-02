// Editorial observations and automatic change candidates remain separate.
(() => {
  const data = window.SIGNALDESK_TECHNOLOGY, model = window.SIGNALDESK_TECH_MODEL;
  const root = document.querySelector(".technology-panel"), content = document.getElementById("techContent");
  if (!data || !model || !root || !content) return;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const link = (url, label) => model.safeUrl(url) ? `<a href="${esc(model.safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : `<span>${esc(label)} · link unavailable</span>`;
  const followKey = "signaldesk-adoption-followed-v1", dismissedKey = "signaldesk-tech-dismissed-v1";
  function readList(key) { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter(x => typeof x === "string") : []; } catch { return []; } }
  let followed = new Set(readList(followKey).filter(id => data.themes.some(t => t.id === id)));
  let dismissed = new Set(readList(dismissedKey));
  let view = "radar", selectedId = null, monitor = null, monitorStatus = "loading", showDismissed = false;
  const params = new URLSearchParams(location.search);
  if (data.themes.some(t => t.id === params.get("tech"))) selectedId = params.get("tech");
  if (["radar", "milestones", "inbox", "companies"].includes(params.get("techView"))) view = params.get("techView");
  let followedOnly = false, storageWorking = true;
  function save(key, values) { try { localStorage.setItem(key, JSON.stringify([...values])); } catch { storageWorking = false; } }
  function setUrl() {
    try {
      const url = new URL(location.href);
      if (selectedId) url.searchParams.set("tech", selectedId); else url.searchParams.delete("tech");
      if (view !== "radar") url.searchParams.set("techView", view); else url.searchParams.delete("techView");
      window.history.replaceState(null, "", url);
    } catch { /* optional deep links */ }
  }
  const dateTime = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not checked yet";
  function themeList() { return model.filterThemes(data.themes, { query: byId("techSearch").value, sector: byId("techSector").value, stage: byId("techStage").value, followedOnly, followed: [...followed] }); }
  function followButton(t) { return `<button type="button" class="tech-button tech-follow" data-follow="${esc(t.id)}" aria-label="${followed.has(t.id) ? "Unfollow" : "Follow"} ${esc(t.name)}" aria-pressed="${followed.has(t.id)}">${followed.has(t.id) ? "Following" : "+ Follow"}</button>`; }
  const stage = t => `<span class="tech-stage stage-${esc(t.stage)}">${esc(model.stages[t.stage])}</span>`;
  function empty(message) { return `<div class="tech-empty"><h3>No matching technologies</h3><p>${esc(message)}</p><button type="button" class="tech-button" data-clear-tech>Clear technology filters</button></div>`; }
  function card(t) {
    const stats = model.evidenceSummary(t);
    return `<article class="tech-card"><div class="tech-card-top"><span class="tech-sector">${esc(t.sector)}</span>${followButton(t)}</div>
      <h3><button type="button" data-open-tech="${esc(t.id)}">${esc(t.name)} <span aria-hidden="true">↗</span></button></h3>${stage(t)}
      <p class="tech-proof">${esc(t.headline)}</p><p class="tech-card-thesis">${esc(t.thesis)}</p>
      <p class="tech-risk"><span>Watch the gap</span>${esc(t.unknowns[0])}</p>
      <div class="tech-card-foot"><span>${stats.observations} observation${stats.observations === 1 ? "" : "s"} · ${stats.owners} reporting owner${stats.owners === 1 ? "" : "s"}</span><span class="${model.isOverdue(t.reviewDue) ? "tech-warning" : ""}">${model.isOverdue(t.reviewDue) ? "Review overdue" : `Reviewed ${esc(t.reviewedAt)}`}</span></div></article>`;
  }
  function companyCards(themes) {
    return `<div class="tech-company-grid">${themes.flatMap(t => t.companies.map(c => `<article class="tech-company"><div class="tech-company-top"><div><span class="tech-sector">${esc(t.name)}</span><h3>${esc(c.name)}</h3></div><span class="tech-ticker">${esc(c.ticker)}</span></div>
      <p class="tech-role">${esc(c.role)}</p><p>${esc(c.relationship)}</p><p class="tech-meta">Relationship evidence · ${esc(c.asOf)}</p>${link(c.url, "Relationship source")}
      <p class="tech-unknown">${esc(c.materiality)}</p><p class="tech-meta">${esc(c.caveat)}</p><button type="button" class="tech-button" data-stock="${esc(c.ticker)}">Find ${esc(c.ticker)} on Desk</button></article>`)).join("")}</div>`;
  }
  function milestoneRow(m) {
    const labels = { "editorial-review": "Our review", "company-target": "Company target", "research-check": "Evidence to watch" };
    const status = m.state === "overdue" ? "Review overdue" : m.state === "unverified-past-window" ? "Window passed · outcome unverified" : m.state === "observed" ? "Observed" : m.window;
    const theme = data.themes.find(t => t.id === m.themeId), evidence = theme?.evidence.find(e => e.id === m.sourceId);
    return `<li class="tech-milestone"><div><span class="tech-sector">${esc(labels[m.kind])}</span><strong class="${/overdue|unverified/.test(m.state) ? "tech-warning" : ""}">${esc(status)}</strong></div><div><button type="button" class="tech-text-button" data-open-tech="${esc(m.themeId)}">${esc(m.theme)}</button><h4>${esc(m.label)}</h4><p>${esc(m.evidenceNeeded)}</p>${evidence ? link(evidence.url, "Original target source") : ""}</div></li>`;
  }
  function dossier(t) {
    const summary = model.evidenceSummary(t);
    return `<article class="tech-dossier"><button type="button" class="tech-text-button tech-back" data-back-tech>← Back to ${view === "radar" ? "radar" : view === "inbox" ? "source inbox" : view === "companies" ? "company map" : "milestones"}</button>
      <div class="tech-dossier-head"><div><p class="tech-sector">${esc(t.sector)}</p><h3 id="techProfileTitle" tabindex="-1">${esc(t.name)}</h3>${stage(t)}</div>${followButton(t)}</div>
      <p class="tech-lead">${esc(t.thesis)}</p><div class="tech-profile-grid"><div class="tech-thesis"><h4>What is real</h4><p>${esc(t.stageReason)}</p><h4>Keep the definitions straight</h4><p>${esc(t.scope)}</p><h4>What would change the view</h4><p>${esc(t.nextCheck)}</p><h4>What could go wrong</h4><p>${esc(t.risk)}</p><h4>Still unknown</h4><ul>${t.unknowns.map(u => `<li>${esc(u)}</li>`).join("")}</ul><p class="tech-meta">Reviewed ${esc(t.reviewedAt)} · ${model.isOverdue(t.reviewDue) ? "Review overdue" : "Next review"} ${esc(t.reviewDue)}</p></div>
      <div><h4>Evidence ledger</h4><p class="tech-meta">${summary.observations} observation${summary.observations === 1 ? "" : "s"} · ${summary.targets} target${summary.targets === 1 ? "" : "s"} · ${summary.owners} reporting owner${summary.owners === 1 ? "" : "s"}. Company reports are not independent verification.</p>
      <ol class="tech-evidence">${t.evidence.map(e => `<li><span class="tech-kind kind-${esc(e.kind)}">${esc(model.kinds[e.kind])}</span><h5>${esc(e.display)}</h5><p>${esc(e.metric)} · ${esc(e.period)}</p><p class="tech-meta">${e.publishedAt ? `Published ${esc(e.publishedAt)}` : "Publication date not provided"} · checked ${esc(e.checkedAt)}</p>${link(e.url, e.publisher)}<p class="tech-caveat">${esc(e.caveat)}</p></li>`).join("")}</ol></div></div>
      <section class="tech-profile-section" aria-label="Profile milestones"><h4>Next checkpoints</h4><ol class="tech-timeline">${model.milestones([t]).map(milestoneRow).join("")}</ol></section>
      <section class="tech-profile-section" aria-label="Profile company exposure"><h4>Follow the company exposure</h4><p class="tech-meta">A sourced relationship is not evidence of material revenue, an attractive valuation, or a likely stock gain. Desk coverage may be absent.</p>${companyCards([t])}</section>
      <button type="button" class="tech-button" data-export-tech="${esc(t.id)}">Export research JSON</button></article>`;
  }
  function renderInbox(themes) {
    const ids = new Set(themes.map(t => t.id));
    const sources = data.sources.filter(s => s.themes.some(id => ids.has(id)));
    const events = (monitor?.events || []).filter(e => e.themes?.some(id => ids.has(id)) && (showDismissed || !dismissed.has(e.id)));
    const healthLabels = { "not-checked": "Not checked", "unavailable": "Unavailable", "stale": "Check overdue", "no-matches": "No matching links", "current": "Readable" };
    const intro = monitorStatus === "loading" ? "Loading saved source checks…" : monitorStatus === "error" ? "Saved source checks could not be loaded. Editorial evidence is still available; this is not proof that sources are unchanged." : `Last collection ${dateTime(monitor?.generatedAt)}. Sources are checked at most daily by the repository workflow; this button reloads its saved results.`;
    return `<div class="tech-view-head"><div><h3>Source-change inbox</h3><p>${esc(intro)}</p></div><button type="button" class="tech-button" data-refresh-monitor ${monitorStatus === "loading" ? "disabled" : ""}>Reload saved checks</button></div>
      <p class="tech-inbox-warning">Unverified candidates only. “New link” means newly detected here, not necessarily newly published. Dismissing a change does not verify a claim.</p>
      <label class="tech-check"><input type="checkbox" id="techShowDismissed" ${showDismissed ? "checked" : ""} /> Include locally dismissed changes</label>
      <div class="tech-inbox-list">${events.length ? events.map(e => `<article class="tech-inbox-item"><div><span class="tech-kind">${e.kind === "new-link" ? "New source link" : "Page changed"} · unverified</span><h4>${link(e.url, e.title)}</h4><p class="tech-meta">${esc(e.owner)} · detected ${dateTime(e.detectedAt)} · publication date unverified</p><p class="tech-meta">${e.themes.map(id => data.themes.find(t => t.id === id)?.name || id).map(esc).join(" · ")}</p></div><button type="button" class="tech-button" data-dismiss="${esc(e.id)}">${dismissed.has(e.id) ? "Restore" : "Dismiss locally"}</button></article>`).join("") : `<div class="tech-empty"><h4>${monitorStatus === "error" ? "Source status unavailable" : monitorStatus === "loading" ? "Checking saved monitor state" : "No pending source changes"}</h4><p>${monitorStatus === "ready" ? "The first successful check establishes a baseline. Only later changes enter this inbox. Read source health below; an unavailable source is not an unchanged source." : "No claims are being inferred from missing monitoring data."}</p></div>`}</div>
      <h4 class="tech-health-heading">Source health · ${sources.length} configured pages</h4><div class="tech-source-list">${sources.map(s => { const state = monitor?.sources?.[s.id], health = model.monitorState(s, state); return `<article class="tech-source"><div><h5>${link(s.url, s.name)}</h5><p class="tech-meta">${esc(s.expectedCadence)}</p><p class="tech-meta">Last success: ${dateTime(state?.lastSuccessAt)} · last attempt: ${dateTime(state?.lastAttemptAt)}</p>${state?.error ? `<p class="tech-warning">${esc(state.error)} · ${state.failureStreak} failed check${state.failureStreak === 1 ? "" : "s"}</p>` : ""}</div><span class="tech-health health-${health}">${healthLabels[health]}</span></article>`; }).join("")}</div>`;
  }
  function render() {
    const themes = themeList(), selected = data.themes.find(t => t.id === selectedId);
    root.querySelectorAll("[data-tech-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.techView === view)));
    byId("techFollowedOnly").setAttribute("aria-pressed", String(followedOnly));
    const activeFilters = Number(byId("techSector").value !== "all") + Number(byId("techStage").value !== "all") + Number(followedOnly);
    byId("techFilterLabel").textContent = `Filters & following${activeFilters ? ` · ${activeFilters} active` : ""}`;
    byId("techResultStatus").textContent = selected ? `${selected.name} · research profile` : `${themes.length} of ${data.themes.length} technologies${followedOnly ? " · following only" : ""}`;
    byId("techRegistryStatus").textContent = `${data.themes.length} technologies · editorial registry updated ${data.updatedAt}`;
    byId("adoptionFollowStatus").textContent = storageWorking ? `${followed.size} followed on this browser. No push notifications. Source changes require editorial review.` : "Browser storage is unavailable. Follows and dismissals work for this session only.";
    if (selected) content.innerHTML = dossier(selected);
    else if (!themes.length) content.innerHTML = empty("Try a broader search, another stage, or turn off Following only. Your saved follows will not be deleted.");
    else if (view === "radar") content.innerHTML = `<div class="tech-radar-grid">${themes.map(card).join("")}</div>`;
    else if (view === "milestones") content.innerHTML = `<div class="tech-view-head"><div><h3>Milestones to watch</h3><p>Our review dates, company targets and undated evidence checks are intentionally separate. A passed target window means unverified—not automatically failed.</p></div></div><ol class="tech-timeline">${model.milestones(themes).map(milestoneRow).join("")}</ol>`;
    else if (view === "companies") content.innerHTML = `<div class="tech-view-head"><div><h3>Company exposure map</h3><p>Follow the documented role, not just a ticker associated with a headline. Financial materiality and valuation still need separate work.</p></div></div>${companyCards(themes)}`;
    else content.innerHTML = renderInbox(themes);
  }
  async function loadMonitor() {
    monitorStatus = "loading"; if (view === "inbox" && !selectedId) render();
    try {
      if (location.protocol === "file:") {
        if (!window.SIGNALDESK_TECH_MONITOR) throw new Error("Missing file bundle");
        monitor = window.SIGNALDESK_TECH_MONITOR;
      } else {
        const response = await fetch(`data/technology-monitor.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("Saved checks unavailable");
        const candidate = await response.json();
        if (candidate.schemaVersion !== 1 || !Array.isArray(candidate.events) || !candidate.sources) throw new Error("Invalid monitor payload");
        monitor = candidate;
      }
      monitorStatus = "ready";
    } catch { monitorStatus = "error"; }
    if (view === "inbox" && !selectedId) render();
  }
  function focusProfile() { byId("techProfileTitle")?.focus({ preventScroll: true }); content.scrollIntoView({ block: "start" }); }
  const narrow = window.matchMedia("(max-width: 680px)");
  byId("techFilterDisclosure").open = !narrow.matches;
  narrow.addEventListener("change", () => { byId("techFilterDisclosure").open = !narrow.matches; });
  for (const sector of [...new Set(data.themes.map(t => t.sector))]) { const option = document.createElement("option"); option.value = option.textContent = sector; byId("techSector").appendChild(option); }
  for (const id of ["techSearch", "techSector", "techStage"]) byId(id).addEventListener(id === "techSearch" ? "input" : "change", () => { selectedId = null; setUrl(); render(); });
  root.addEventListener("change", event => { if (event.target.id === "techShowDismissed") { showDismissed = event.target.checked; render(); byId("techShowDismissed")?.focus(); } });
  root.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.follow) {
      const id = button.dataset.follow;
      if (followed.has(id)) followed.delete(id); else followed.add(id);
      save(followKey, followed); render();
      root.querySelector(`[data-follow="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    } else if (button.id === "techFollowedOnly") { followedOnly = !followedOnly; selectedId = null; setUrl(); render(); }
    else if (button.dataset.techView) { view = button.dataset.techView; selectedId = null; setUrl(); render(); }
    else if (button.dataset.openTech) { selectedId = button.dataset.openTech; setUrl(); render(); focusProfile(); }
    else if (button.hasAttribute("data-back-tech")) { const id = selectedId; selectedId = null; setUrl(); render(); root.querySelector(`[data-open-tech="${CSS.escape(id)}"]`)?.focus(); }
    else if (button.hasAttribute("data-clear-tech")) { byId("techSearch").value = ""; byId("techSector").value = "all"; byId("techStage").value = "all"; followedOnly = false; selectedId = null; setUrl(); render(); byId("techSearch").focus(); }
    else if (button.dataset.stock) window.SIGNALDESK_FIND_STOCK?.(button.dataset.stock);
    else if (button.hasAttribute("data-refresh-monitor")) loadMonitor();
    else if (button.dataset.dismiss) { const id = button.dataset.dismiss; if (dismissed.has(id)) dismissed.delete(id); else dismissed.add(id); save(dismissedKey, dismissed); render(); byId("techShowDismissed")?.focus(); }
    else if (button.dataset.exportTech) {
      const t = data.themes.find(t => t.id === button.dataset.exportTech);
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), disclaimer: "Editorial research, not a recommendation. Unknowns and original source dates are preserved.", technology: t }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `signaldesk-${t.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  render(); loadMonitor();
})();
