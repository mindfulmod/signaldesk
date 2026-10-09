(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_RESEARCH_MODEL = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const date = value => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") ? u.href : ""; } catch { return ""; } };
  function ageHours(value, now = Date.now()) { const time = date(value); return time === null ? null : (Number(now) - time) / 3600000; }
  function freshness(value, now = Date.now(), hours = 36) { const age = ageHours(value, now); return age === null ? "missing" : age < -.1 ? "invalid" : age > hours ? "overdue" : "current"; }
  function validateReview(review, { themeIds = [], knownIds = [], documents = [], evidence = [], config } = {}) {
    const errors = [];
    if (!review || typeof review !== "object") return ["Review must be an object"];
    for (const key of ["id", "candidateId", "reviewer", "reviewedAt", "decision", "reason"]) if (typeof review[key] !== "string" || !review[key].trim()) errors.push(`${key} is required`);
    if (!/^[a-zA-Z0-9_-]{6,100}$/.test(review.id || "")) errors.push("Invalid review ID");
    if (!["accepted", "rejected"].includes(review.decision)) errors.push("Decision must be accepted or rejected");
    if (!date(review.reviewedAt) || date(review.reviewedAt) > Date.now() + 300000) errors.push("Invalid review date");
    if ((review.reason || "").trim().length < 10) errors.push("Explain the review decision (at least 10 characters)");
    if ((review.reason || "").length > 2000 || (review.claim || "").length > 2000) errors.push("Review text is too long");
    for (const key of ["reviewer", "metric", "period", "definition", "caveat", "owner", "unit"]) if (typeof review[key] === "string" && review[key].length > (key === "reviewer" ? 100 : 1000)) errors.push(`${key} is too long`);
    const candidate = documents.find(d => d.id === review.candidateId);
    if (documents.length && !candidate) errors.push("The source candidate is no longer in the saved inventory");
    if (candidate && (review.url !== candidate.url || review.owner !== candidate.owner || review.sourceId !== candidate.sourceId)) errors.push("Source provenance must match the saved candidate");
    if (review.decision === "accepted") {
      if (!themeIds.includes(review.themeId)) errors.push("Select a tracked technology");
      if ((review.relevance || "").trim().length < 10) errors.push("Explain why this source is relevant to the selected technology (at least 10 characters)");
      for (const key of ["claim", "metric", "period", "caveat", "owner", "unit", "definition"]) if (typeof review[key] !== "string" || !review[key].trim()) errors.push(`${key} is required for reviewed evidence`);
      if (!safeUrl(review.url)) errors.push("A safe primary-source URL is required");
      if (!["research", "pilot", "rollout", "adoption", "target"].includes(review.kind)) errors.push("Invalid evidence kind");
      if (!["reported", "exact", "lower-bound", "target", "observed-page"].includes(review.qualifier)) errors.push("Invalid qualifier");
      if (review.kind === "target" && review.qualifier !== "target") errors.push("Targets must retain a target qualifier");
      if (review.qualifier === "target" && review.kind !== "target") errors.push("A target qualifier must use target evidence kind");
      if (review.value !== null && (typeof review.value !== "number" || !Number.isFinite(review.value))) errors.push("Numeric value must be a number or null");
      if (["exact", "lower-bound"].includes(review.qualifier) && !Number.isFinite(review.value)) errors.push("A numeric qualifier needs a numeric value");
      if (review.publishedAt && (!date(review.publishedAt) || date(review.publishedAt) > date(review.reviewedAt))) errors.push("Publication cannot be after review");
      if (review.entityId || review.metricKey) {
        const program = config?.programs.find(p => `program:${p.id}` === review.entityId), rollout = config?.rollouts.find(r => `rollout:${r.id}` === review.entityId);
        const metric = (program ? config.batteryMetrics : rollout ? config.satelliteMetrics : [])?.find(m => m.id === review.metricKey);
        if (!metric) errors.push("Select a compatible tracker record and metric");
        else {
          if (review.themeId !== (program ? "solid-state-batteries" : "satellite-phones")) errors.push("Tracker and technology must match");
          if (review.unit !== metric.unit) errors.push(`Tracker metric requires ${metric.unit}; convert explicitly and document the conversion`);
          if (!Number.isFinite(review.value) || review.value < 0 || (metric.unit === "%" && review.value > 100)) errors.push("Tracker observations require a valid nonnegative numeric value (percentages at most 100)");
        }
      }
    }
    if (review.supersedes && (!knownIds.includes(review.supersedes) || review.supersedes === review.id)) errors.push("Correction must reference an existing evidence ID");
    if (review.supersedes && review.decision !== "accepted") errors.push("A rejected candidate cannot replace published evidence");
    if (review.supersedes && evidence.length) {
      const original = evidence.find(e => e.id === review.supersedes);
      if (!original || original.themeId !== review.themeId) errors.push("A correction must stay in the original technology");
      if (evidence.some(e => e.decision === "accepted" && e.supersedes === review.supersedes)) errors.push("This evidence was already corrected; supersede its current revision");
    }
    return errors;
  }
  function activeReviews(reviews = []) {
    const superseded = new Set(reviews.filter(r => r.decision === "accepted").map(r => r.supersedes).filter(Boolean));
    return reviews.filter(r => r.decision === "accepted" && !superseded.has(r.id));
  }
  // Published IDs are immutable, even when the original browser still has a draft.
  function correctionDraft(draft, reviews = []) {
    if (!draft) return {};
    const published = reviews.find(r => r.id === draft.id);
    if (!published) return { ...draft };
    let current = published;
    const visited = new Set();
    while (!visited.has(current.id)) {
      visited.add(current.id);
      const next = reviews.find(r => r.decision === "accepted" && r.supersedes === current.id);
      if (!next || visited.has(next.id)) break;
      current = next;
    }
    return { ...draft, id: undefined, supersedes: current.decision === "accepted" ? current.id : null };
  }
  function reconcileDrafts(drafts, reviews = []) {
    const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
    return drafts.filter(d => !reviews.some(r => r.id === d.id && same(d, r))).map(d => correctionDraft(d, reviews));
  }
  function reviewedThemes(themes, reviews = []) {
    const superseded = new Set(reviews.filter(r => r.decision === "accepted").map(r => r.supersedes).filter(Boolean));
    return themes.map(t => ({ ...t, evidence: [...t.evidence.filter(e => !superseded.has(e.id)), ...activeReviews(reviews).filter(r => r.themeId === t.id).map(r => ({
      ...r, display: r.claim, publisher: r.owner, checkedAt: r.reviewedAt.slice(0, 10), editorialReview: true,
    }))] }));
  }
  function financialContext(company) {
    const f = company?.financials || {}, cash = f.cash, flow = f.operatingCashFlow;
    let runwayMonths = null;
    const duration = flow?.start && flow?.end ? (date(flow.end) - date(flow.start)) / 86400000 + 1 : 0;
    if (!cash?.stale && !flow?.stale && Number.isFinite(cash?.value) && Number.isFinite(flow?.value) && cash.value >= 0 && flow.value < 0 && cash.unit === flow.unit && cash.end === flow.end && duration >= 80 && duration <= 400) runwayMonths = cash.value / -flow.value * duration / 30.4375;
    return { runwayMonths, runwayCaveat: "Cash and equivalents only, divided by historical operating burn. Excludes marketable securities, other liquidity, capital expenditure, financing and future changes. This is not the company's total cash runway or a forecast." };
  }
  function financialDisplay(company) {
    if (company?.factsVersion === 3) return company;
    const filter = rows => Object.fromEntries(Object.entries(rows || {}).filter(([key]) => !["revenue", "shares"].includes(key)));
    return { ...company, financials: filter(company?.financials), histories: filter(company?.histories),
      factsError: [company?.factsError, "Legacy revenue/share selection withheld pending context-aware refresh"].filter(Boolean).join("; ") };
  }
  function buildBrief({ themes = [], research, monitor, followed = [], now = Date.now() }) {
    const followedIds = new Set(followed);
    const selected = themes.filter(t => !followed.length || followedIds.has(t.id));
    const ids = new Set(selected.map(t => t.id));
    const reviews = activeReviews(research?.reviews || []).filter(r => ids.has(r.themeId) && ageHours(r.reviewedAt, now) >= 0 && ageHours(r.reviewedAt, now) <= 168);
    const reviewedIds = new Set((research?.reviews || []).map(r => r.candidateId));
    const documents = (research?.documents || []).filter(d => d.themes.some(t => ids.has(t)) && !reviewedIds.has(d.id) && d.changeType !== "baseline" && ageHours(d.detectedAt, now) >= 0 && ageHours(d.detectedAt, now) <= 168);
    const failures = Object.values(monitor?.sources || {}).filter(s => s.status === "error" || freshness(s.lastSuccessAt, now, 36) !== "current");
    return { selected, reviews, documents, failures, checkedState: freshness(research?.generatedAt, now),
      checkpoints: selected.map(t => ({ id: t.id, name: t.name, check: t.nextCheck, due: t.reviewDue, overdue: date(t.reviewDue) < Number(now) - 86400000 })),
      unknowns: selected.map(t => ({ id: t.id, name: t.name, unknown: t.unknowns[0], risk: t.risk })) };
  }
  return { safeUrl, ageHours, freshness, validateReview, activeReviews, correctionDraft, reconcileDrafts, reviewedThemes, financialContext, financialDisplay, buildBrief };
});
