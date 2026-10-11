// Editorial observations and automatic change candidates remain separate.
(() => {
  const data = window.SIGNALDESK_TECHNOLOGY, model = window.SIGNALDESK_TECH_MODEL;
  const researchModel = window.SIGNALDESK_RESEARCH_MODEL, views = window.SIGNALDESK_RESEARCH_VIEWS, config = window.SIGNALDESK_RESEARCH_CONFIG;
  const root = document.querySelector(".technology-panel"), content = document.getElementById("techContent");
  if (!data || !model || !root || !content) return;
  const byId = id => document.getElementById(id);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const link = (url, label) => model.safeUrl(url) ? `<a href="${esc(model.safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : `<span>${esc(label)} · link unavailable</span>`;
  const followKey = "signaldesk-adoption-followed-v1", dismissedKey = "signaldesk-tech-dismissed-v1";
  function readList(key) { try { const value = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(value) ? value.filter(x => typeof x === "string") : []; } catch { return []; } }
  let followed = new Set(readList(followKey).filter(id => data.themes.some(t => t.id === id)));
  let dismissed = new Set(readList(dismissedKey));
  const draftKey = "signaldesk-review-drafts-v1", discoveryKey = "signaldesk-discovery-followed-v1";
  let drafts = []; try { const saved = JSON.parse(localStorage.getItem(draftKey) || "[]"); if (Array.isArray(saved)) drafts = saved.filter(d => d && typeof d.candidateId === "string"); } catch { /* session drafts still work */ }
  let discoveryFollowed = readList(discoveryKey), research = null, researchStatus = "loading", selectedCompany = null, reviewingId = null, reviewFilter = "pending", queueLimit = 24;
  let trackerType = "batteries", trackerState = { compare: [], batteryStage: "all", country: "all", serviceStatus: "all" };
  let discoverySavedOnly = false, discoveryMode = "patterns", discoveryLane = "all", discoveryLimit = 24;
  let view = "brief", selectedId = null, monitor = null, monitorStatus = "loading", showDismissed = false;
  const params = new URLSearchParams(location.search);
  if (data.themes.some(t => t.id === params.get("tech"))) selectedId = params.get("tech");
  if (["brief", "radar", "milestones", "inbox", "companies", "trackers", "discovery"].includes(params.get("techView"))) view = params.get("techView");
  if (config.companies.some(c => c.ticker === params.get("company"))) { selectedCompany = params.get("company"); view = "companies"; }
  if (params.get("tracker") === "satellite") trackerType = "satellite";
  if (params.get("scan") === "open") discoveryMode = "open";
  let followedOnly = false, storageWorking = true;
  function save(key, values) { try { localStorage.setItem(key, JSON.stringify([...values])); } catch { storageWorking = false; } }
  function setUrl() {
    try {
      const url = new URL(location.href);
      if (selectedId) url.searchParams.set("tech", selectedId); else url.searchParams.delete("tech");
      if (view !== "brief") url.searchParams.set("techView", view); else url.searchParams.delete("techView");
      if (selectedCompany) url.searchParams.set("company", selectedCompany); else url.searchParams.delete("company");
      if (view === "trackers") url.searchParams.set("tracker", trackerType); else url.searchParams.delete("tracker");
      if (view === "discovery" && discoveryMode === "open" && !discoverySavedOnly) url.searchParams.set("scan", "open"); else url.searchParams.delete("scan");
      window.history.replaceState(null, "", url);
    } catch { /* optional deep links */ }
  }
  const dateTime = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Not checked yet";
  function reviewedThemes() { return researchModel.reviewedThemes(data.themes, research?.reviews); }
  function themeList() { return model.filterThemes(reviewedThemes(), { query: view === "inbox" ? "" : byId("techSearch").value, sector: byId("techSector").value, stage: byId("techStage").value, followedOnly, followed: [...followed] }); }
  function followButton(t) { return `<button type="button" class="tech-button tech-follow" data-follow="${esc(t.id)}" aria-label="${followed.has(t.id) ? "Unfollow" : "Follow"} ${esc(t.name)}" aria-pressed="${followed.has(t.id)}">${followed.has(t.id) ? "Following" : "+ Follow"}</button>`; }
  const stage = t => `<span class="tech-stage stage-${esc(t.stage)}">${esc(model.stages[t.stage])}</span>`;
  function empty(message) { return `<div class="tech-empty"><h3>No matching technologies</h3><p>${esc(message)}</p><button type="button" class="tech-button" data-clear-tech>Clear technology filters</button></div>`; }
  function card(t) {
    const stats = model.evidenceSummary(t);
    return `<article class="tech-card"><div class="tech-card-top"><div class="tech-card-identity">${views.themeMark(t.id)}<span class="tech-sector">${esc(t.sector)}</span></div>${followButton(t)}</div>
      <h3><button type="button" data-open-tech="${esc(t.id)}">${esc(t.name)} <span aria-hidden="true">↗</span></button></h3>
      ${views.stageTrack(t.stage)}<p class="tech-proof">${esc(t.headline)}</p>
      <p class="tech-risk"><span>Watch the gap</span>${esc(t.unknowns[0])}</p>
      <div class="tech-card-foot"><span>${stats.observations} observation${stats.observations === 1 ? "" : "s"} · ${stats.owners} reporting owner${stats.owners === 1 ? "" : "s"}</span><span class="${model.isOverdue(t.reviewDue) ? "tech-warning" : ""}">${model.isOverdue(t.reviewDue) ? "Review overdue" : `Reviewed ${esc(t.reviewedAt)}`}</span></div></article>`;
  }
  function companyCards(themes) {
    return `<div class="tech-company-grid">${themes.flatMap(t => t.companies.map(c => `<article class="tech-company"><div class="tech-company-top"><div><span class="tech-sector">${esc(t.name)}</span><h3>${esc(c.name)}</h3></div><span class="tech-ticker">${esc(c.ticker)}</span></div>
      <p class="tech-role">${esc(c.role)}</p><p>${esc(c.relationship)}</p><p class="tech-meta">Relationship evidence · ${esc(c.asOf)}</p>${link(c.url, "Relationship source")}
      <p class="tech-unknown">${esc(c.materiality)}</p><p class="tech-meta">${esc(c.caveat)}</p><button type="button" class="tech-button" data-open-company="${esc(c.ticker)}">Research ${esc(c.ticker)} economics</button></article>`)).join("")}</div>`;
  }
  function milestoneRow(m) {
    const labels = { "editorial-review": "Our review", "company-target": "Company target", "research-check": "Evidence to watch" };
    const status = m.state === "overdue" ? "Review overdue" : m.state === "unverified-past-window" ? "Window passed · outcome unverified" : m.state === "observed" ? "Observed" : m.window;
    const theme = data.themes.find(t => t.id === m.themeId), evidence = theme?.evidence.find(e => e.id === m.sourceId);
    return `<li class="tech-milestone"><div><span class="tech-sector">${esc(labels[m.kind])}</span><strong class="${/overdue|unverified/.test(m.state) ? "tech-warning" : ""}">${esc(status)}</strong></div><div><button type="button" class="tech-text-button" data-open-tech="${esc(m.themeId)}">${esc(m.theme)}</button><h4>${esc(m.label)}</h4><p>${esc(m.evidenceNeeded)}</p>${evidence ? link(evidence.url, "Original target source") : ""}</div></li>`;
  }
  function dossier(t) {
    const summary = model.evidenceSummary(t);
    const art = { "solid-state-batteries": "battery-cell", "satellite-phones": "satellite-phone" }[t.id];
    return `<article class="tech-dossier"><button type="button" class="tech-text-button tech-back" data-back-tech>← Back to ${esc(view)}</button>
      <div class="tech-dossier-head"><div><p class="tech-sector">${esc(t.sector)}</p><h3 id="techProfileTitle" tabindex="-1">${esc(t.name)}</h3>${stage(t)}</div>${followButton(t)}</div>
      <div class="tech-dossier-intro"><p class="tech-lead">${esc(t.thesis)}</p>${art ? `<figure><img src="assets/art/${art}.webp" width="720" height="480" alt="" decoding="async"><figcaption>Concept illustration</figcaption></figure>` : ""}</div>
      <div class="tech-profile-grid"><div class="tech-thesis"><h4>What is real</h4><p>${esc(t.stageReason)}</p><h4>What could go wrong</h4><p>${esc(t.risk)}</p><details class="intel-disclosure"><summary>Scope, unknowns &amp; next proof</summary><h4>Keep the definitions straight</h4><p>${esc(t.scope)}</p><h4>What would change the view</h4><p>${esc(t.nextCheck)}</p><h4>Still unknown</h4><ul>${t.unknowns.map(u => `<li>${esc(u)}</li>`).join("")}</ul></details><p class="tech-meta">Reviewed ${esc(t.reviewedAt)} · ${model.isOverdue(t.reviewDue) ? "Review overdue" : "Next review"} ${esc(t.reviewDue)}</p></div>
      <div><h4>Evidence ledger</h4><p class="tech-meta">${summary.observations} observation${summary.observations === 1 ? "" : "s"} · ${summary.targets} target${summary.targets === 1 ? "" : "s"} · ${summary.owners} reporting owner${summary.owners === 1 ? "" : "s"}. Company reports are not independent verification.</p>
      <ol class="tech-evidence">${t.evidence.map(e => `<li><span class="tech-kind kind-${esc(e.kind)}">${esc(model.kinds[e.kind])}</span><h5>${esc(e.display)}</h5><p>${esc(e.metric)} · ${esc(e.period)}</p><p class="tech-meta">${e.publishedAt ? `Published ${esc(e.publishedAt)}` : "Publication date not provided"} · checked ${esc(e.checkedAt)}</p>${link(e.url, e.publisher)}<p class="tech-caveat">${esc(e.caveat)}</p></li>`).join("")}</ol></div></div>
      ${["solid-state-batteries", "satellite-phones"].includes(t.id) ? `<button class="tech-button" data-tracker="${t.id === "solid-state-batteries" ? "batteries" : "satellite"}">Open detailed ${t.id === "solid-state-batteries" ? "program comparison" : "rollout tracker"} →</button>` : ""}
      ${(research?.reviews || []).some(r => r.themeId === t.id) ? `<details class="intel-disclosure"><summary>Published review &amp; correction history</summary>${research.reviews.filter(r => r.themeId === t.id).map(r => `<p><strong>${esc(r.decision)} · ${esc(r.reviewer)}</strong> · ${dateTime(r.reviewedAt)}<br>${esc(r.reason)}${r.supersedes ? `<br>Supersedes ${esc(r.supersedes)}; original remains in history.` : ""}</p>`).join("")}</details>` : ""}
      <section class="tech-profile-section" aria-label="Profile milestones"><h4>Next checkpoints</h4><ol class="tech-timeline">${model.milestones([t]).map(milestoneRow).join("")}</ol></section>
      <section class="tech-profile-section" aria-label="Profile company exposure"><h4>Follow the company exposure</h4><p class="tech-meta">A sourced relationship is not evidence of material revenue, an attractive valuation, or a likely stock gain. Desk coverage may be absent.</p>${companyCards([t])}</section>
      <button type="button" class="tech-button" data-export-tech="${esc(t.id)}">Export research JSON</button></article>`;
  }
  function renderInbox(themes) {
    const ids = new Set(themes.map(t => t.id));
    const sources = data.sources.filter(s => !s.themes.length || s.themes.some(id => ids.has(id)));
    const healthLabels = { "paused": "Permission review", "not-checked": "Not checked", "unavailable": "Unavailable", "stale": "Check overdue", "no-matches": "No matching links", "current": "Readable" };
    const intro = monitorStatus === "loading" ? "Loading saved source checks…" : monitorStatus === "error" ? "Saved source checks could not be loaded. This is not proof that sources are unchanged." : `Source collection ${dateTime(monitor?.generatedAt)}. Seven-day scheduling, calendar-day checks and retry opportunities every six hours. Reloading does not trigger collection.`;
    return views.reviewQueue(themes, research, { drafts, reviewFilter, queueLimit, showDismissed, restrictThemes: followedOnly || byId("techSector").value !== "all" || byId("techStage").value !== "all", query: byId("techSearch").value, dismissed: [...dismissed] }) + `
      <label class="tech-check"><input type="checkbox" id="techShowDismissed" ${showDismissed ? "checked" : ""} /> Include locally dismissed changes</label>
      <details class="intel-disclosure" id="researchSourceHealth"><summary>Source health · ${sources.length} configured sources</summary><p>${esc(intro)}</p><button type="button" class="tech-button" data-refresh-monitor ${monitorStatus === "loading" || researchStatus === "loading" ? "disabled" : ""}>Reload saved research</button><div class="tech-source-list">${sources.map(s => { const state = monitor?.sources?.[s.id], health = model.monitorState(s, state); return `<article class="tech-source"><div><h5>${link(s.url, s.name)}</h5><p class="tech-meta">${esc(s.tier)} · ${esc(s.expectedCadence)} · ${state?.matchedItems ?? "—"} matching documents</p><p class="tech-meta">Last success: ${dateTime(state?.lastSuccessAt)} · last attempt: ${dateTime(state?.lastAttemptAt)}</p>${s.accessNote || state?.accessNote ? `<p class="tech-warning">${esc(s.accessNote || state.accessNote)}</p>` : ""}${state?.error ? `<p class="tech-warning">${esc(state.error)} · ${state.failureStreak} failed check${state.failureStreak === 1 ? "" : "s"}. Retry eligible ${dateTime(state.nextAttemptAt)}.</p>` : ""}</div><span class="tech-health health-${health}">${healthLabels[health]}</span></article>`; }).join("")}</div></details>`;
  }
  function render() {
    const themes = themeList(), selected = reviewedThemes().find(t => t.id === selectedId);
    // Compare/filter updates should not close the evidence the reader opened.
    const disclosureState = new Map([...content.querySelectorAll("details[data-disclosure]")].map(node => [node.dataset.disclosure, node.open]));
    const specialized = ["trackers", "discovery"].includes(view) || selectedCompany || selected || reviewingId;
    byId("techFilterDisclosure").hidden = Boolean(specialized);
    byId("techSearch").closest("label").hidden = Boolean(selectedCompany || selected || reviewingId || view === "trackers");
    byId("techScope").hidden = byId("techSearch").closest("label").hidden && byId("techFilterDisclosure").hidden;
    byId("techSearch").closest("label").querySelector("span").textContent = view === "inbox" ? "Search documents, owners & titles" : view === "discovery" ? "Find a discovery lead" : "Find a technology";
    root.querySelectorAll("[data-tech-view]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.techView === view)));
    byId("techFollowedOnly").setAttribute("aria-pressed", String(followedOnly));
    const activeFilters = Number(byId("techSector").value !== "all") + Number(byId("techStage").value !== "all") + Number(followedOnly);
    byId("techFilterLabel").textContent = `Filter ${view === "discovery" ? "leads" : "technologies"}${(view !== "discovery" && activeFilters) || byId("techSearch").value ? " · active" : ""}`;
    byId("techResultStatus").hidden = ["brief", "discovery"].includes(view) && !activeFilters && !byId("techSearch").value && !selected && !selectedCompany && !reviewingId;
    byId("techResultStatus").textContent = reviewingId ? "Local evidence review · not published" : selectedCompany ? `${selectedCompany} · permanent company coverage` : selected ? `${selected.name} · research profile` : view === "discovery" ? "Exploratory leads · not verified adoption" : view === "trackers" ? "Program and service evidence · use the filters below" : `${themes.length} of ${data.themes.length} technologies${followedOnly ? " · following only" : ""}`;
    byId("techRegistryStatus").textContent = `${data.themes.length} themes · ${config.sources.length} sources · ${config.companies.length} permanent companies`;
    byId("adoptionFollowStatus").textContent = storageWorking ? `${followed.size} technologies followed · ${drafts.length} local review drafts. Browser-local saves; no push subscription.` : "Browser storage is unavailable. Changes work for this session only; export drafts before leaving.";
    const candidate = research?.documents?.find(d => d.id === reviewingId);
    if (candidate) content.innerHTML = views.reviewEditor(candidate, data.themes, research.reviews, researchModel.correctionDraft(drafts.find(d => d.candidateId === reviewingId) || research.reviews.filter(r => r.candidateId === reviewingId).at(-1), research.reviews));
    else if (selectedCompany) content.innerHTML = views.companies(themes, research, selectedCompany);
    else if (selected) content.innerHTML = dossier(selected);
    else if (view === "discovery") content.innerHTML = views.discovery(research, byId("techSearch").value, discoveryFollowed, discoverySavedOnly, { mode: discoveryMode, lane: discoveryLane, limit: discoveryLimit, monitor });
    else if (view === "trackers") content.innerHTML = views.trackers(trackerType, research, trackerState);
    else if (!themes.length) content.innerHTML = empty("Try a broader search, another stage, or turn off Following only. Your saved follows will not be deleted.");
    else if (view === "brief") content.innerHTML = views.brief(themes, research, monitor, [...followed], researchStatus);
    else if (view === "radar") content.innerHTML = `<div class="tech-view-head"><div><h3>The technology radar</h3><p>Compare editorial evidence stages, then open a theme for its sources. These are not forecasts.</p></div></div><div class="tech-radar-grid">${themes.map(card).join("")}</div>`;
    else if (view === "milestones") content.innerHTML = `<div class="tech-view-head"><div><h3>Milestones to watch</h3><p>Our review dates, company targets and undated evidence checks are intentionally separate. A passed target window means unverified—not automatically failed.</p></div></div><ol class="tech-timeline">${model.milestones(themes).map(milestoneRow).join("")}</ol>`;
    else if (view === "companies") content.innerHTML = views.companies(themes, research, null);
    else content.innerHTML = renderInbox(themes);
    for (const node of content.querySelectorAll("details[data-disclosure]")) {
      if (disclosureState.has(node.dataset.disclosure)) node.open = disclosureState.get(node.dataset.disclosure);
    }
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
    if (!reviewingId) render();
  }
  async function loadResearch() {
    researchStatus = "loading";
    try {
      let candidate = window.SIGNALDESK_RESEARCH;
      if (location.protocol !== "file:") {
        const response = await fetch(`data/research.json?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("Saved research unavailable"); candidate = await response.json();
      }
      if (candidate?.schemaVersion !== 1 || !Array.isArray(candidate.documents) || !Array.isArray(candidate.reviews) || !candidate.companies) throw new Error("Invalid research payload");
      research = candidate; researchStatus = "ready";
      drafts = researchModel.reconcileDrafts(drafts, research.reviews); save(draftKey, drafts);
    } catch { researchStatus = "error"; }
    if (!reviewingId) render();
  }
  function download(name, value) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportReviews() {
    const bundle = { schemaVersion: 1, exportedAt: new Date().toISOString(), note: "Local drafts, not published verification. Validate with scripts/review-evidence.mjs, then commit through repository review.", reviews: drafts };
    download("signaldesk-review-drafts.json", bundle);
    // A copyable payload also works in embedded browsers that block downloads.
    byId("reviewExportFallback")?.remove();
    const details = document.createElement("details"), summary = document.createElement("summary"), field = document.createElement("textarea");
    details.id = "reviewExportFallback"; details.className = "intel-disclosure intel-export"; details.open = true;
    summary.textContent = "Download requested · copy JSON here if your browser blocks it";
    field.readOnly = true; field.rows = 8; field.setAttribute("aria-label", "Exported review drafts JSON"); field.value = JSON.stringify(bundle, null, 2);
    details.append(summary, field); content.prepend(details); field.focus(); field.select();
  }
  function focusProfile() { byId("techProfileTitle")?.focus({ preventScroll: true }); content.scrollIntoView({ block: "start" }); }
  for (const sector of [...new Set(data.themes.map(t => t.sector))]) { const option = document.createElement("option"); option.value = option.textContent = sector; byId("techSector").appendChild(option); }
  for (const id of ["techSearch", "techSector", "techStage"]) byId(id).addEventListener(id === "techSearch" ? "input" : "change", () => { selectedId = null; selectedCompany = null; reviewingId = null; setUrl(); render(); });
  root.addEventListener("change", event => {
    const target = event.target;
    if (target.id === "techShowDismissed") showDismissed = target.checked;
    else if (target.id === "reviewFilter") { reviewFilter = target.value; queueLimit = 24; }
    else if (target.id === "discoveryLane") { discoveryLane = target.value; discoveryLimit = 24; }
    else if (target.id === "batteryStage") trackerState.batteryStage = target.value;
    else if (target.id === "rolloutCountry") trackerState.country = target.value;
    else if (target.id === "rolloutStatus") trackerState.serviceStatus = target.value;
    else if (target.dataset.compare) trackerState.compare = target.checked ? [...new Set([...trackerState.compare, target.dataset.compare])] : trackerState.compare.filter(id => id !== target.dataset.compare);
    else if (target.name === "kind" && target.value === "target") { target.form.elements.qualifier.value = "target"; return; }
    else if (["entityId", "metricKey"].includes(target.name)) {
      const fields = target.form.elements, battery = fields.entityId.value.startsWith("program:");
      const metric = (battery ? config.batteryMetrics : config.satelliteMetrics).find(m => m.id === fields.metricKey.value);
      if (fields.entityId.value) fields.themeId.value = battery ? "solid-state-batteries" : "satellite-phones";
      if (metric && fields.entityId.value) { fields.unit.value = metric.unit; if (!fields.definition.value) fields.definition.value = metric.definition; }
      return;
    }
    else return;
    const focusId = target.id, compareId = target.dataset.compare; render();
    if (focusId) byId(focusId)?.focus(); else if (compareId) root.querySelector(`[data-compare="${CSS.escape(compareId)}"]`)?.focus();
  });
  root.addEventListener("submit", event => {
    if (event.target.id !== "evidenceReviewForm") return;
    event.preventDefault();
    const document = research?.documents.find(d => d.id === reviewingId); if (!document) return;
    const fields = Object.fromEntries(new FormData(event.target));
    const old = researchModel.correctionDraft(drafts.find(d => d.candidateId === reviewingId), research.reviews);
    const review = { ...fields, id: old?.id || `review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, candidateId: document.id, sourceId: document.sourceId, owner: document.owner, url: document.url,
      reviewedAt: new Date().toISOString(), value: fields.value === "" ? null : Number(fields.value), publishedAt: fields.publishedAt || null, supersedes: fields.supersedes || null };
    const errors = researchModel.validateReview(review, { themeIds: data.themes.map(t => t.id), knownIds: [...data.themes.flatMap(t => t.evidence.map(e => e.id)), ...research.reviews.map(r => r.id)], documents: research.documents, config, evidence: [...data.themes.flatMap(t => t.evidence.map(e => ({ ...e, themeId: t.id }))), ...research.reviews] });
    if (errors.length) { byId("reviewErrors").textContent = errors.join(". "); byId("reviewErrors").scrollIntoView({ block: "center" }); return; }
    drafts = [...drafts.filter(d => d.candidateId !== reviewingId), review]; save(draftKey, drafts); reviewingId = null; render();
    byId("adoptionFollowStatus").textContent = "Review draft saved locally. Export it for repository review; no public evidence was changed.";
    root.querySelector("[data-export-reviews]")?.focus();
  });
  root.addEventListener("click", event => {
    const button = event.target.closest("button"); if (!button) return;
    if (button.dataset.follow) {
      const id = button.dataset.follow;
      if (followed.has(id)) followed.delete(id); else followed.add(id);
      save(followKey, followed); render();
      root.querySelector(`[data-follow="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
    } else if (button.id === "techFollowedOnly") { followedOnly = !followedOnly; selectedId = null; setUrl(); render(); }
    else if (button.hasAttribute("data-show-health")) { view = "inbox"; selectedId = null; selectedCompany = null; reviewingId = null; setUrl(); render(); const health = byId("researchSourceHealth"); health.open = true; health.scrollIntoView({ block: "start" }); health.querySelector("summary").focus(); }
    else if (button.dataset.techView) { view = button.dataset.techView; selectedId = null; selectedCompany = null; reviewingId = null; setUrl(); render(); }
    else if (button.dataset.openTech) { selectedId = button.dataset.openTech; selectedCompany = null; reviewingId = null; setUrl(); render(); focusProfile(); }
    else if (button.dataset.openCompany) { selectedCompany = button.dataset.openCompany; selectedId = null; reviewingId = null; view = "companies"; setUrl(); render(); byId("companyProfileTitle")?.focus({ preventScroll: true }); content.scrollIntoView({ block: "start" }); }
    else if (button.hasAttribute("data-company-back")) { selectedCompany = null; setUrl(); render(); }
    else if (button.dataset.tracker) { trackerType = button.dataset.tracker; selectedId = null; selectedCompany = null; reviewingId = null; view = "trackers"; setUrl(); render(); }
    else if (button.hasAttribute("data-clear-comparison")) { trackerState.compare = []; render(); }
    else if (button.dataset.discoveryMode) { discoveryMode = button.dataset.discoveryMode; discoverySavedOnly = false; discoveryLimit = 24; setUrl(); render(); root.querySelector(`[data-discovery-mode="${discoveryMode}"]`)?.focus({ preventScroll: true }); }
    else if (button.hasAttribute("data-saved-discovery")) { discoverySavedOnly = !discoverySavedOnly; discoveryLimit = 24; setUrl(); render(); root.querySelector("[data-saved-discovery]")?.focus({ preventScroll: true }); }
    else if (button.hasAttribute("data-clear-discovery")) { byId("techSearch").value = ""; discoveryLane = "all"; discoveryLimit = 24; render(); byId("discoveryLane")?.focus({ preventScroll: true }); }
    else if (button.hasAttribute("data-more-discovery")) { const previousLimit = discoveryLimit; discoveryLimit += 24; render(); root.querySelectorAll("[data-discovery-item]")[previousLimit]?.focus(); }
    else if (button.dataset.review) { reviewingId = button.dataset.review; view = "inbox"; selectedId = null; selectedCompany = null; setUrl(); render(); content.scrollIntoView({ block: "start" }); root.querySelector('[name="reviewer"]')?.focus({ preventScroll: true }); }
    else if (button.hasAttribute("data-cancel-review")) { reviewingId = null; render(); }
    else if (button.dataset.discardReview) { drafts = drafts.filter(d => d.candidateId !== button.dataset.discardReview); save(draftKey, drafts); reviewingId = null; render(); }
    else if (button.hasAttribute("data-more-reviews")) { queueLimit += 24; render(); }
    else if (button.hasAttribute("data-export-reviews")) exportReviews();
    else if (button.dataset.followDiscovery) { const id = button.dataset.followDiscovery; discoveryFollowed = discoveryFollowed.includes(id) ? discoveryFollowed.filter(v => v !== id) : [...discoveryFollowed, id]; save(discoveryKey, discoveryFollowed); render(); (root.querySelector(`[data-follow-discovery="${CSS.escape(id)}"]`) || root.querySelector("[data-saved-discovery]"))?.focus({ preventScroll: true }); }
    else if (button.hasAttribute("data-back-tech")) { const id = selectedId; selectedId = null; setUrl(); render(); root.querySelector(`[data-open-tech="${CSS.escape(id)}"]`)?.focus(); }
    else if (button.hasAttribute("data-clear-tech")) { byId("techSearch").value = ""; byId("techSector").value = "all"; byId("techStage").value = "all"; followedOnly = false; selectedId = null; setUrl(); render(); byId("techSearch").focus(); }
    else if (button.dataset.stock) window.SIGNALDESK_FIND_STOCK?.(button.dataset.stock);
    else if (button.hasAttribute("data-refresh-monitor")) { loadMonitor(); loadResearch(); }
    else if (button.dataset.dismiss) { const id = button.dataset.dismiss; if (dismissed.has(id)) dismissed.delete(id); else dismissed.add(id); save(dismissedKey, dismissed); render(); byId("techShowDismissed")?.focus(); }
    else if (button.dataset.exportTech) {
      const t = reviewedThemes().find(t => t.id === button.dataset.exportTech);
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), disclaimer: "Editorial research, not a recommendation. Unknowns and original source dates are preserved.", technology: t }, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = `signaldesk-${t.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  });
  render(); loadMonitor(); loadResearch();
})();
