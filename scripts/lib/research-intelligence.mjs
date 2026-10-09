import { createHash } from "node:crypto";
const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
const days = (value, now) => (Date.parse(now) - Date.parse(value)) / 86400000;
const normal = text => String(text).toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set("a an and are as at be been by can could for from has have how in into is it its may more new of on or our the their this to using was were what when why will with world first next research researchers study scientists says shows company companies announces announced results quarter university news technology technologies says towards report reports million billion today us about latest after over under through than that these they you your make makes made we all advances advance".split(" "));
const TECH_WORDS = /\b(battery|batteries|quantum|photonics|photonic|robot|robots|robotics|fusion|hydrogen|semiconductor|chip|chips|computing|compute|nuclear|reactor|satellite|wireless|bioengineering|biomanufacturing|superconductor|superconducting|sodium|lithium|electrolyte|perovskite|solar|carbon|capture|geothermal|storage|neuromorphic|agent|agents|autonomous|synthetic|biological|silicon|optical|laser|lasers|solid|state|ai)\b/;
for (const word of ["between", "during", "without", "versus", "toward", "provides", "brings"]) STOP.add(word);
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
    return [d.id, source ? { ...d, themes: documentThemes(registry, source, d), associatedThemes: source.themes, headlineSignal: headlineSignal(d.title), metadataOnly: d.metadataOnly ?? source.mode !== "page" } : d];
  }));
  // Compact identity memory outlives the bounded text archive. Never expire an
  // identity just because its full excerpt aged out or the archive reached 800.
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
      if (documents.has(id)) { documents.set(id, { ...documents.get(id), originalPublishedAt, publishedAt: item.publishedAt || null }); continue; }
      if (record?.versions[id]) continue; // Unchanged archived version, not news.
      documents.set(id, { id, sourceId: source.id, url: item.url, title: item.title, excerpt: item.excerpt || null, owner: source.owner, tier: source.tier,
        storyId, originalPublishedAt, firstSeenAt: record?.firstSeenAt || saved.lastSuccessAt, announcementAt: item.announcementAt || item.publishedAt || null,
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
  retained.push(...sorted.filter(d => !protectedIds.has(d.id) && days(d.detectedAt, now) <= 180).slice(0, Math.max(0, 800 - retained.length)));
  return { documents: retained.sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id)), documentIndex };
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
export function discoverTopics(documents, themes, previous = {}, now = new Date().toISOString(), sources = [], states = {}) {
  const sourceIds = sources.map(s => s.id);
  const coverageKey = hash(JSON.stringify([3, sources.map(s => [s.id, s.url, s.format, s.terms, s.linkPattern]).sort((a, b) => a[0].localeCompare(b[0]))]));
  const healthy = sources.length > 0 && sources.every(s => states[s.id]?.status === "ok" && days(states[s.id].lastSuccessAt, now) >= 0 && days(states[s.id].lastSuccessAt, now) <= 1.5);
  const comparableHistory = previous.coverageKey === coverageKey ? previous.history || [] : [];
  const known = new Set(themes.flatMap(t => [t.name, ...t.aliases]).map(normal));
  const originalDates = new Map();
  const storyKey = d => d.url || d.storyId || d.id;
  for (const d of documents) {
    const date = d.originalPublishedAt || d.publishedAt;
    const key = storyKey(d);
    if (date && (!originalDates.has(key) || date < originalDates.get(key))) originalDates.set(key, date);
  }
  const dated = documents.map(d => ({ ...d, publishedAt: originalDates.get(storyKey(d)) || null })).filter(d => d.discovery && sourceIds.includes(d.sourceId) && d.publishedAt && days(d.publishedAt, now) >= 0 && days(d.publishedAt, now) <= 28);
  // Latest wording represents a canonical URL once; revision history is retained
  // in documents. Title dedup is a secondary syndication guard, not story identity.
  const seen = new Set(), titles = new Set();
  const unique = [...dated].sort((a, b) => (b.detectedAt || "").localeCompare(a.detectedAt || "")).filter(d => {
    const key = d.url || d.storyId || d.id, title = normal(d.title);
    if (seen.has(key) || titles.has(title)) return false;
    seen.add(key); titles.add(title); return true;
  });
  const groups = new Map();
  for (const d of unique) for (const phrase of topicPhrases(d.title)) {
    if (known.has(phrase) || themes.some(t => normal(t.name).includes(phrase))) continue;
    const group = groups.get(phrase) || { phrase, recent: [], prior: [] };
    group[days(d.publishedAt, now) <= 14 ? "recent" : "prior"].push(d); groups.set(phrase, group);
  }
  const historyDays = new Set(comparableHistory.filter(s => days(s.date, now) <= 29).map(s => s.date));
  const candidates = [...groups.values()].filter(g => g.recent.length).map(g => {
    const owners = [...new Set(g.recent.map(d => d.owner))];
    const weeks = [...new Set(g.recent.map(d => Math.floor(days(d.publishedAt, now) / 7)))];
    const sustained = owners.length >= 2 && g.recent.length >= 3 && weeks.length >= 2;
    const comparable = healthy && historyDays.size >= 28 && g.prior.length > 0;
    return { id: hash(g.phrase), phrase: g.phrase, owners, recentDocuments: g.recent.length, priorDocuments: g.prior.length,
      momentumPercent: comparable ? (g.recent.length / g.prior.length - 1) * 100 : null,
      status: sustained ? "Repeated across sources" : owners.length >= 2 ? "Cross-source lead" : "Single-owner lead",
      evidenceTypes: [...new Set(g.recent.map(d => d.headlineSignal))], documentIds: g.recent.map(d => d.id),
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
  return { generatedAt: now, coverageKey, history, candidates: currentCandidates, archive: [...archive.values()].filter(c => days(c.lastSeenAt, now) <= 90).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)).slice(0, 200), datedDocuments: unique.length, comparableDays: historyDays.size,
    note: `28-day sample of configured research feeds. Momentum needs 28 collected days with unchanged, healthy source coverage; publication backfill alone is not monitoring history.${healthy ? "" : " At least one discovery feed is unavailable or overdue; history accumulation is paused."}` };
}
