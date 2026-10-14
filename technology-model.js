(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_TECH_MODEL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const stages = { research: "Research", pilot: "Pilot validation", "early-use": "Early commercial", scaling: "Reported scale" };
  const kinds = { research: "Research result", pilot: "Pilot / test", rollout: "Available capability", adoption: "Reported adoption", target: "Company target" };
  const day = value => Date.parse(`${String(value || "").slice(0, 10)}T00:00:00Z`);
  function isOverdue(date, now = new Date()) { return Number.isFinite(day(date)) && day(now.toISOString()) > day(date); }
  function filterThemes(themes, { query = "", sector = "all", stage = "all", followedOnly = false, followed = [] } = {}) {
    const terms = query.toLowerCase().replace(/[-–]/g, " ").trim().split(/\s+/).filter(Boolean);
    return themes.filter(t => {
      const haystack = [t.name, t.sector, ...t.aliases, ...t.companies.flatMap(c => [c.name, c.ticker])].join(" ").toLowerCase().replace(/[-–]/g, " ");
      return terms.every(word => haystack.includes(word)) && (sector === "all" || t.sector === sector) && (stage === "all" || t.stage === stage) && (!followedOnly || followed.includes(t.id));
    });
  }
  function evidenceSummary(theme) {
    const observed = theme.evidence.filter(e => e.kind !== "target");
    return { observations: observed.length, targets: theme.evidence.length - observed.length, owners: new Set(observed.map(e => e.owner)).size,
      latest: observed.map(e => e.publishedAt).filter(Boolean).sort().at(-1) || null };
  }
  function comparableChange(a, b) {
    if (!a || !b || a.kind === "target" || b.kind === "target") return null;
    if (["metric", "unit", "owner", "geography", "definition"].some(k => (a[k] || "") !== (b[k] || ""))) return null;
    if (a.qualifier !== "exact" || b.qualifier !== "exact" || !Number.isFinite(a.value) || !Number.isFinite(b.value) || a.value <= 0 || b.value < 0 || !(day(a.publishedAt) < day(b.publishedAt))) return null;
    return (b.value / a.value - 1) * 100;
  }
  function milestones(themes, now = new Date()) {
    return themes.flatMap(t => [
      { id: `${t.id}-editorial-review`, themeId: t.id, theme: t.name, label: "Review the evidence", kind: "editorial-review", state: isOverdue(t.reviewDue, now) ? "overdue" : "scheduled", due: t.reviewDue, window: t.reviewDue, evidenceNeeded: "Check primary sources, append new observations and revisit unknowns. This is our review date, not a company event." },
      ...t.milestones.map(m => ({ ...m, themeId: t.id, theme: t.name, state: m.state !== "observed" && isOverdue(m.due, now) ? "unverified-past-window" : m.state })),
    ]).sort((a, b) => (day(a.due) || Infinity) - (day(b.due) || Infinity) || a.theme.localeCompare(b.theme));
  }
  function monitorState(source, state, now = new Date()) {
    if (source.accessStatus === "permission-required" || state?.status === "paused") return "paused";
    if (!state?.lastAttemptAt) return "not-checked";
    if (state.status === "error") return "unavailable";
    const succeededAt = Date.parse(state.lastSuccessAt);
    if (!Number.isFinite(succeededAt) || succeededAt > now.getTime() || now.getTime() - succeededAt > (source.freshnessHours || source.intervalHours * 2) * 3600000) return "stale";
    return state.matchedItems === 0 && source.mode === "links" ? "no-matches" : "current";
  }
  function safeUrl(value) { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password ? u.href : ""; } catch { return ""; } }
  function validate(registry) {
    const errors = [], ids = new Set(), observationIds = new Set();
    for (const t of registry.themes || []) {
      if (!t.id || ids.has(t.id)) errors.push(`Duplicate/missing theme: ${t.id}`); ids.add(t.id);
      if (!stages[t.stage] || !t.risk || !t.nextCheck || !t.scope || !Number.isFinite(day(t.reviewDue))) errors.push(`Incomplete theme: ${t.id}`);
      for (const e of t.evidence || []) {
        if (observationIds.has(e.id) || !e.id) errors.push(`Duplicate observation: ${e.id}`); observationIds.add(e.id);
        if (!kinds[e.kind] || !e.caveat || !e.period || !e.owner || !e.metric || !safeUrl(e.url) || !Number.isFinite(day(e.checkedAt)) || (e.publishedAt && !Number.isFinite(day(e.publishedAt)))) errors.push(`Invalid evidence: ${e.id}`);
        if (e.value !== null && !Number.isFinite(e.value)) errors.push(`Invalid value: ${e.id}`);
      }
      for (const m of t.milestones || []) if ((m.due && !Number.isFinite(day(m.due))) || !m.evidenceNeeded || (m.sourceId && !t.evidence.some(e => e.id === m.sourceId))) errors.push(`Invalid milestone: ${m.id}`);
      for (const c of t.companies || []) if (!c.role || !c.materiality || !c.caveat || !safeUrl(c.url) || !Number.isFinite(day(c.asOf))) errors.push(`Invalid exposure: ${c.name}`);
    }
    const sourceIds = new Set();
    for (const s of registry.sources || []) {
      if (sourceIds.has(s.id) || !safeUrl(s.url) || !s.allowedHosts?.includes(new URL(s.url).hostname) || !s.themes.every(id => ids.has(id)) || !["links", "page"].includes(s.mode) || !(s.intervalHours > 0)) errors.push(`Invalid source: ${s.id}`);
      sourceIds.add(s.id);
    }
    return errors;
  }
  return { stages, kinds, isOverdue, filterThemes, evidenceSummary, comparableChange, milestones, monitorState, safeUrl, validate };
});
