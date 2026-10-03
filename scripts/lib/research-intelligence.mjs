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
  if (/approve|authoriz|licen[cs]|regulat/i.test(title)) return "Regulatory language";
  if (/customer|deliver|commercial|deploy|production|available|launch/i.test(title)) return "Deployment language";
  if (/research|study|test|demonstrat|prototype|experiment/i.test(title)) return "Research / test language";
  return "Announcement / reporting";
}
export function buildDocuments(registry, state, previous = {}, now = new Date().toISOString()) {
  const documents = new Map((previous.documents || []).map(d => [d.id, d]));
  for (const source of registry.sources) {
    const saved = state.sources[source.id];
    if (!saved?.lastSuccessAt || saved.status !== "ok") continue;
    const entries = source.mode === "page" ? [{ url: source.url, title: saved.title || source.name, excerpt: saved.excerpt || "", fingerprint: saved.fingerprint }] : saved.items || [];
    for (const item of entries) {
      const fingerprint = hash(JSON.stringify([item.title, item.excerpt || "", item.publishedAt ? new Date(item.publishedAt).toISOString() : "", item.fingerprint || ""]));
      const id = hash(`${source.id}|${item.url}|${fingerprint}`);
      const old = [...documents.values()].filter(d => d.sourceId === source.id && d.url === item.url).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))[0];
      if (documents.has(id)) { documents.set(id, { ...documents.get(id), publishedAt: item.publishedAt || null }); continue; }
      const text = normal(`${item.title} ${item.excerpt || ""}`);
      const inferred = registry.themes.filter(t => t.aliases.filter(a => a.length > 4).some(a => text.includes(normal(a)))).map(t => t.id);
      documents.set(id, { id, sourceId: source.id, url: item.url, title: item.title, excerpt: item.excerpt || null, owner: source.owner, tier: source.tier,
        themes: [...new Set([...source.themes, ...inferred])], publishedAt: item.publishedAt || null, detectedAt: saved.lastSuccessAt,
        changeType: saved.baselineAt === saved.lastSuccessAt ? "baseline" : old ? "revision" : "new-document", previousId: saved.baselineAt === saved.lastSuccessAt ? null : old?.id || null,
        previousExcerpt: old?.excerpt || null, previousTitle: old?.title || null, discovery: Boolean(source.discovery), headlineSignal: headlineSignal(item.title), verification: "unreviewed" });
    }
  }
  return [...documents.values()].filter(d => days(d.detectedAt, now) <= 180).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt) || a.id.localeCompare(b.id)).slice(0, 800);
}
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
  const coverageKey = hash(JSON.stringify([2, sources.map(s => [s.id, s.url, s.format, s.terms, s.linkPattern]).sort((a, b) => a[0].localeCompare(b[0]))]));
  const healthy = sources.length > 0 && sources.every(s => states[s.id]?.status === "ok" && days(states[s.id].lastSuccessAt, now) >= 0 && days(states[s.id].lastSuccessAt, now) <= 1.5);
  const comparableHistory = previous.coverageKey === coverageKey ? previous.history || [] : [];
  const known = new Set(themes.flatMap(t => [t.name, ...t.aliases]).map(normal));
  const dated = documents.filter(d => d.discovery && sourceIds.includes(d.sourceId) && d.publishedAt && days(d.publishedAt, now) >= 0 && days(d.publishedAt, now) <= 28);
  // One story/version counts once, even when republished or discovered in two feeds.
  const seen = new Set();
  const unique = dated.filter(d => { const key = normal(d.title); if (seen.has(key)) return false; seen.add(key); return true; });
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
