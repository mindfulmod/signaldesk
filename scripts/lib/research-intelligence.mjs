import { createHash } from "node:crypto";
const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
const days = (value, now) => (Date.parse(now) - Date.parse(value)) / 86400000;
const normal = text => String(text).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set("a an and are as at be been by can could for from has have how in into is it its may more new of on or our the their this to using was were what when why will with world first next research researchers study scientists says shows company companies announces announced results quarter university news technology technologies says towards report reports million billion today us about latest after over under through than that these they you your make makes made we all advances advance".split(" "));
const TECH_WORDS = /\b(battery|batteries|quantum|photonics|photonic|robot|robots|robotics|fusion|hydrogen|semiconductor|chip|chips|computing|compute|nuclear|reactor|satellite|wireless|bioengineering|biomanufacturing|superconductor|superconducting|sodium|lithium|electrolyte|perovskite|solar|carbon|capture|geothermal|storage|neuromorphic|agent|agents|autonomous|synthetic|biological|silicon|optical|laser|lasers|solid|state|ai)\b/;
for (const word of ["between", "during", "without", "versus", "toward", "provides", "brings", "where", "which", "who", "control", "ev", "improves", "improve", "develop", "develops", "developed", "achieves", "enables", "enable", "reveals", "reveal", "use", "uses", "used", "help", "helps", "helping", "wins", "award", "prize", "across", "via", "throughout"]) STOP.add(word);
// Open-ended noun phrases, not a curated list of future winners. Requiring a
// technical noun at the end avoids verb fragments such as "AI is igniting".
const TECH_END = /^(batter(?:y|ies)|cells?|chips?|semiconductors?|computing|compute|communications?|networks?|robot(?:s|ics)?|fusion|reactors?|hydrogen|storage|capture|photonics|lasers?|optics|electrolytes?|superconductors?|materials?|proteins?|biology|bioengineering|biomanufacturing|agents?|sensors?|correction|processors?|transistors?|fabrication|interfaces?|satellites?|engines?|propulsion|manufacturing)$/;
export function headlineSignal(title) {
  if (/delay|cancel|recall|fail|halt|risk|withdraw|suspend/i.test(title)) return "Risk / setback language";
  if (/\b(FCC|FDA|CPUC|regulator|regulators|regulatory approval|regulatory clearance|regulatory filing|government|legislation|rulemaking)\b|\b(?:approv\w*|authoriz\w*|licen[cs]\w*)\b.{0,60}\b(?:agency|commission|government|service|drug|device)\b/i.test(title)) return "Regulatory language";
  if (/customer|deliver|commercial|deploy|production|available|launch/i.test(title)) return "Deployment language";
  if (/research|study|test|demonstrat|prototype|experiment/i.test(title)) return "Research / test language";
  return "Announcement / reporting";
}
function documentThemes(registry, source, item) {
  const text = normal(`${item.title} ${item.excerpt || ""}`);
  const inferred = registry.themes.filter(t => {
    const issuerNames = (t.companies || []).flatMap(c => [c.name, c.ticker, ...c.name.split(" / ")]).map(normal);
    return t.aliases.filter(a => a.length > 4 && !issuerNames.includes(normal(a))).some(a => text.includes(normal(a)));
  }).map(t => t.id);
  return [...new Set([...(source.mode === "page" ? source.themes : []), ...inferred])];
}
export function buildDocumentInventory(registry, state, previous = {}, now = new Date().toISOString(), reviews = previous.reviews || []) {
  // Reclassifying a heuristic does not create a publication or a new version.
  const documents = new Map((previous.documents || []).map(d => {
    const source = registry.sources.find(s => s.id === d.sourceId);
    return [d.id, source ? { ...d, discovery: Boolean(source.discovery), themes: documentThemes(registry, source, d), associatedThemes: source.themes, headlineSignal: headlineSignal(d.title), metadataOnly: d.metadataOnly ?? source.mode !== "page" } : d];
  }));
  // Compact identity memory outlives the bounded text archive. Never expire an
  // identity just because its full excerpt aged out or the archive reached its cap.
  const documentIndex = structuredClone(previous.documentIndex || {});
  for (const d of documents.values()) {
    const key = hash(`${d.sourceId}|${d.url}`);
    const record = documentIndex[key] ||= { sourceId: d.sourceId, firstSeenAt: d.detectedAt, latestId: d.id, versions: {} };
    record.versions[d.id] = d.detectedAt;
    if (d.publishedAt && (!record.originalPublishedAt || d.publishedAt < record.originalPublishedAt)) record.originalPublishedAt = d.publishedAt;
    if (d.detectedAt < record.firstSeenAt) record.firstSeenAt = d.detectedAt;
    if (d.detectedAt >= (record.versions[record.latestId] || "")) record.latestId = d.id;
  }
  for (const source of registry.sources) {
    const saved = state.sources[source.id];
    if (!saved?.lastSuccessAt || saved.status !== "ok") continue;
    const entries = source.mode === "page" ? [{ ...saved, url: source.url, title: saved.title || source.name, excerpt: saved.excerpt || "", fingerprint: saved.fingerprint }] : saved.items || [];
    for (const item of entries) {
      const fingerprint = hash(JSON.stringify([item.title, item.excerpt || "", item.publishedAt ? new Date(item.publishedAt).toISOString() : "", item.fingerprint || ""]));
      const id = hash(`${source.id}|${item.url}|${fingerprint}`);
      const storyId = hash(`${source.id}|${item.url}`), record = documentIndex[storyId];
      const old = documents.get(record?.latestId);
      const originalPublishedAt = [record?.originalPublishedAt, item.publishedAt].filter(Boolean).sort()[0] || null;
      const attention = { linkedUrl: item.linkedUrl || null, dateKind: item.dateKind || "publication", engagement: item.engagement || null };
      if (documents.has(id)) { documents.set(id, { ...documents.get(id), originalPublishedAt, publishedAt: item.publishedAt || null, ...attention }); continue; }
      if (record?.versions[id]) continue; // Unchanged archived version, not news.
      documents.set(id, { id, sourceId: source.id, url: item.url, title: item.title, excerpt: item.excerpt || null, owner: source.owner, tier: source.tier,
        storyId, originalPublishedAt, ...attention, firstSeenAt: record?.firstSeenAt || saved.lastSuccessAt, announcementAt: item.dateKind === "community-submission" ? null : item.announcementAt || item.publishedAt || null,
        researchPublishedAt: item.researchPublishedAt || null, researchUrl: item.researchUrl || null, metadataOnly: source.mode !== "page" && !item.metadataCheckedAt,
        themes: documentThemes(registry, source, item), associatedThemes: source.themes,
        filingItems: item.filingItems || [], reportDate: item.reportDate || null, acceptedAt: item.acceptedAt || null, exhibitsIndexUrl: item.exhibitsIndexUrl || null,
        publishedAt: item.publishedAt || null, detectedAt: saved.lastSuccessAt,
        changeType: record ? "revision" : saved.baselineAt === saved.lastSuccessAt ? "baseline" : "new-document", previousId: record?.latestId || null,
        previousExcerpt: old?.excerpt || null, previousTitle: old?.title || null, discovery: Boolean(source.discovery), headlineSignal: headlineSignal(item.title), verification: "unreviewed" });
      documentIndex[storyId] = { sourceId: source.id, originalPublishedAt, firstSeenAt: record?.firstSeenAt || saved.lastSuccessAt, latestId: id, versions: { ...record?.versions, [id]: saved.lastSuccessAt } };
    }
  }
  const protectedIds = new Set(reviews.map(r => r.candidateId));
  const sorted = [...documents.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id));
  const retained = sorted.filter(d => protectedIds.has(d.id));
  retained.push(...sorted.filter(d => !protectedIds.has(d.id) && days(d.detectedAt, now) <= 180).slice(0, Math.max(0, 4000 - retained.length)));
  const retainedIds = new Set(retained.map(d => d.id)), discoveryIds = new Set(registry.sources.filter(s => s.discovery).map(s => s.id));
  // The compact index must keep this warning alive on subsequent collections;
  // an evicted but unchanged document cannot silently restore comparability.
  const discoveryTruncated = Object.values(documentIndex).some(d => discoveryIds.has(d.sourceId) && days(d.originalPublishedAt, now) >= 0 && days(d.originalPublishedAt, now) <= 28 && !retainedIds.has(d.latestId));
  return { documents: retained.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id)), documentIndex, discoveryTruncated };
}
export function buildDocuments(...args) { return buildDocumentInventory(...args).documents; }
export function topicPhrases(title) {
  const words = normal(title).split(" ");
  const phrases = new Set();
  for (let size = 2; size <= 4; size++) for (let i = 0; i <= words.length - size; i++) {
    const terms = words.slice(i, i + size), phrase = terms.join(" ");
    if (terms.some(t => STOP.has(t) || t.length < 2 || /^\d+$/.test(t)) || !TECH_WORDS.test(phrase) || !TECH_END.test(terms.at(-1))) continue;
    phrases.add(phrase);
  }
  return [...phrases];
}
export function discoverTopics(documents, themes, previous = {}, now = new Date().toISOString(), sources = [], states = {}, { discoveryTruncated = false } = {}) {
  const sourceIds = sources.map(s => s.id);
  const coverageKey = hash(JSON.stringify([4, sources.map(s => [s.id, s.url, s.format, s.terms, s.linkPattern]).sort((a, b) => a[0].localeCompare(b[0]))]));
  const coverage = sources.map(s => {
    const state = states[s.id], fresh = state?.status === "ok" && days(state.lastSuccessAt, now) >= 0 && days(state.lastSuccessAt, now) <= 1.5;
    const quiet = Boolean(s.quietAfterDays && (!state?.newestPublicationAt || days(state.newestPublicationAt, now) > s.quietAfterDays || days(state.newestPublicationAt, now) < 0));
    return { id: s.id, owner: s.owner, lane: s.tier === "community" ? "community" : "research", fresh, quiet, lastSuccessAt: state?.lastSuccessAt || null, newestPublicationAt: state?.newestPublicationAt || null, matchedItems: state?.matchedItems ?? null, datedItems: state?.datedItems ?? null };
  });
  // Source-check history can accumulate while an old archive gap ages out.
  // Counts remain non-comparable until the retained window is complete.
  const healthy = coverage.length > 0 && coverage.every(s => s.fresh && !s.quiet);
  const comparableHistory = previous.coverageKey === coverageKey ? previous.history || [] : [];
  const known = new Set(themes.flatMap(t => [t.name, ...t.aliases]).map(normal));
  const originalDates = new Map();
  const storyKey = d => d.linkedUrl || d.url || d.storyId || d.id;
  for (const d of documents) {
    const date = d.originalPublishedAt || d.publishedAt;
    const key = storyKey(d);
    if (date && (!originalDates.has(key) || date < originalDates.get(key))) originalDates.set(key, date);
  }
  const dated = documents.map(d => ({ ...d, publishedAt: originalDates.get(storyKey(d)) || null })).filter(d => d.discovery && sourceIds.includes(d.sourceId) && d.publishedAt && days(d.publishedAt, now) >= 0 && days(d.publishedAt, now) <= 28);
  // Latest wording represents a canonical URL once; revision history is retained
  // in documents. Title dedup is a secondary syndication guard, not story identity.
  const seen = new Set(), titles = new Set();
  const unique = [...dated].sort((a, b) => Number(a.tier === "community") - Number(b.tier === "community") || (b.detectedAt || "").localeCompare(a.detectedAt || "")).filter(d => {
    const key = storyKey(d), title = normal(d.title);
    if (seen.has(key) || titles.has(title)) return false;
    seen.add(key); titles.add(title); return true;
  });
  const groups = new Map();
  for (const d of unique) for (const phrase of topicPhrases(d.title)) {
    if (known.has(phrase) || themes.some(t => normal(t.name).includes(phrase))) continue;
    const group = groups.get(phrase) || { phrase, recent: [], prior: [] };
    group[days(d.publishedAt, now) <= 14 ? "recent" : "prior"].push(d); groups.set(phrase, group);
  }
  const historyDays = new Set(comparableHistory.filter(s => days(s.date, now) >= 0 && days(s.date, now) <= 29).map(s => s.date));
  // Each of the preceding 28 UTC collection days must exist. A gap cannot be
  // disguised by 28 non-contiguous observations or several checks in one day.
  const completeHistory = Array.from({ length: 28 }, (_, i) => new Date(Date.parse(now) - (i + 1) * 86400000).toISOString().slice(0, 10)).every(date => historyDays.has(date));
  const candidates = [...groups.values()].filter(g => g.recent.length).map(g => {
    const owners = [...new Set(g.recent.map(d => d.owner))];
    const weeks = [...new Set(g.recent.map(d => Math.floor(days(d.publishedAt, now) / 7)))];
    const sustained = owners.length >= 2 && g.recent.length >= 3 && weeks.length >= 2;
    const comparable = healthy && !discoveryTruncated && completeHistory && g.prior.length > 0;
    const dates = g.recent.map(d => d.publishedAt).sort();
    return { id: hash(g.phrase), phrase: g.phrase, owners, recentDocuments: g.recent.length, priorDocuments: g.prior.length,
      momentumPercent: comparable ? (g.recent.length / g.prior.length - 1) * 100 : null,
      status: sustained ? "Repeated across sources" : owners.length >= 2 ? "Cross-source lead" : "Single-owner lead",
      evidenceTypes: [...new Set(g.recent.map(d => d.headlineSignal))], documentIds: g.recent.map(d => d.id),
      lanes: [...new Set(g.recent.map(d => d.tier === "community" ? "community" : "research"))],
      spanDays: Math.floor((Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000),
      nextCheck: owners.length < 2 ? "Find another reporting owner, then look for customer use." : "Check paying usage, repeat orders or measured deployment—not more headlines.",
      firstObservedAt: comparableHistory.find(s => s.topics.includes(hash(g.phrase)))?.date || now.slice(0, 10),
      caveat: "An extracted headline phrase, not a verified technology category or adoption claim." };
  }).sort((a, b) => b.owners.length - a.owners.length || b.recentDocuments - a.recentDocuments || b.phrase.split(" ").length - a.phrase.split(" ").length || a.phrase.localeCompare(b.phrase));
  // Prefer the most informative overlapping phrase for the same story set.
  const selected = [];
  for (const c of candidates) if (!selected.some(s => (s.phrase.includes(c.phrase) || c.phrase.includes(s.phrase)) && s.documentIds.join() === c.documentIds.join())) selected.push(c);
  const date = now.slice(0, 10), history = comparableHistory.filter(s => s.date !== date && days(s.date, now) <= 90);
  if (healthy) history.push({ date, topics: selected.slice(0, 30).map(c => c.id), documentCount: unique.length });
  const currentCandidates = selected.slice(0, 30).map(c => ({ ...c, lastSeenAt: date }));
  const archive = new Map([...(previous.archive || []), ...(previous.candidates || [])].map(c => [c.id, { ...c, lastSeenAt: c.lastSeenAt || previous.generatedAt?.slice(0, 10) }]));
  currentCandidates.forEach(c => archive.set(c.id, c));
  // No theme or technical-vocabulary gate: unexpected subjects must remain
  // visible even when phrase extraction cannot name them. Balance the preview
  // across feeds so a high-volume community cannot bury scientific sources.
  const unmatched = unique.filter(d => !d.themes?.length && days(d.publishedAt, now) <= 14).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const queues = sources.map(s => unmatched.filter(d => d.sourceId === s.id));
  const openScan = [];
  while (openScan.length < 120 && queues.some(q => q.length)) for (const q of queues) if (q.length && openScan.length < 120) openScan.push(q.shift().id);
  return { generatedAt: now, coverageKey, history, coverage, healthy, discoveryTruncated, openScan, unmatchedDocuments: unmatched.length, candidates: currentCandidates, archive: [...archive.values()].filter(c => days(c.lastSeenAt, now) <= 90).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 200), datedDocuments: unique.length, comparableDays: historyDays.size,
    note: `Daily sample, not whole-market coverage. Pattern grouping uses technical vocabulary; Open scan has no keyword gate. Momentum needs 28 consecutive collected days with unchanged, healthy sources. Backfill, votes and headlines are not adoption.${healthy ? "" : " Coverage is incomplete, quiet or overdue; comparable history is paused."}${discoveryTruncated ? " Older records have left the archive. Counts describe retained records only; momentum is withheld until the comparison window is complete." : ""}` };
}
