// Co-mention graph — THEME_ENGINE.md Layer 0c. Weekly job over the trailing
// 90d of events: nodes = tickers, edge weight = co-appearances in the same
// headline/post. Communities and changing neighbor sets are research leads,
// not evidence of a crystallizing theme, business diffusion or future returns.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isoWeekKey } from "./alerts.mjs";
import { COMMON_WORD_TICKERS } from "./ticker-noise.mjs";
import identity from "../../company-identity.js";

const ROOT = new URL("../../", import.meta.url);
export const CO_MENTION_HISTORY_URL = new URL("data/co-mention-history.json", ROOT);
export const CLUSTERS_URL = new URL("data/clusters.json", ROOT);
export const CLUSTERS_JS_URL = new URL("data/clusters.js", ROOT);

export const CO_MENTION_TRAILING_WEEKS = 13; // ~90 days
export const MIN_COMMUNITY_SIZE = 3;
export const MIN_MODULARITY = 0.05; // conservative placeholder -- not spec'd numerically, flagged here

// Sources that don't represent real text co-occurrence (a synthetic quote
// fetch or a pre-aggregated count), excluded from co-mention pairing.
const EXCLUDED_SOURCES = new Set(["Price/Volume", "FINRA Short Volume", "StockTwits", "ApeWisdom"]);

// Tickers that are also common short English words pollute co-mention
// pairing with noise rather than real cross-ticker signal --
// collectMentions' word-boundary matching in update-data.mjs can't fully
// disambiguate these from ordinary prose. The stopword list lives in
// ticker-noise.mjs (shared with the main mention scanner); see the history
// there for why it's a stopword-style filter rather than an ad hoc list.
// Co-mention excludes these tickers from pairing entirely -- a stricter
// stance than the scanner's cashtag gate, because a single stray pair here
// pollutes a whole community.
const NOISE_TICKERS = COMMON_WORD_TICKERS;

export { isoWeekKey };

export async function loadCoMentionHistory() {
  try {
    const raw = await readFile(CO_MENTION_HISTORY_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.weeks) return parsed;
  } catch {
    // First run.
  }
  return { weeks: {} };
}

export async function saveCoMentionHistory(history) {
  await writeFile(CO_MENTION_HISTORY_URL, JSON.stringify(history));
}

export async function loadClusters() {
  try {
    const raw = await readFile(CLUSTERS_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, communities: [], leaderNeighbors: {} };
}

export async function saveClusters(clusters) {
  const json = JSON.stringify(clusters);
  await writeFile(CLUSTERS_URL, json);
  await writeFile(CLUSTERS_JS_URL, `window.SIGNALDESK_CLUSTERS = ${json};\n`);
}

// Groups this run's events by headline (url) and counts co-occurring ticker
// pairs. Returns a Map<"TICKERA|TICKERB", count> (tickers sorted so each
// pair has one canonical key).
export function extractCoMentionPairs(events, excludeTickers = NOISE_TICKERS) {
  const groups = new Map();
  for (const event of events) {
    if (!verifiedEvent(event)) continue;
    if (excludeTickers.has(event.ticker)) continue;
    // A reused URL is not proof that two different headlines co-mention issuers.
    const key = JSON.stringify([event.url, event.source, event.title]);
    if (!groups.has(key)) groups.set(key, { url: event.url, tickers: new Set() });
    groups.get(key).tickers.add(event.ticker);
  }
  const pairDocuments = new Map();
  for (const { url, tickers } of groups.values()) {
    if (tickers.size < 2) continue;
    const list = [...tickers].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        if (!pairDocuments.has(key)) pairDocuments.set(key, new Set());
        pairDocuments.get(key).add(url);
      }
    }
  }
  return new Map([...pairDocuments].map(([pair, urls]) => [pair, urls.size]));
}

function verifiedEvent(event) {
  if (!event?.ticker || !event.title || !event.source || EXCLUDED_SOURCES.has(event.source)) return false;
  try {
    const url = new URL(event.url);
    if (url.protocol !== "https:" || url.username || url.password) return false;
  } catch { return false; }
  const alias = event.companyMatch?.version === 1 && event.companyMatch.kind === "company-name" ? event.companyMatch.value : "";
  // Bare abbreviations can mean a forum name (SMG), television (TV) or a
  // games console (SNES). Graph connections need stronger issuer evidence.
  return Boolean(identity.match({ ticker: event.ticker, name: event.name, aliases: [alias] }, event.title, { source: event.source, allowBareSymbol: false }));
}

function documentEvents(record) {
  return (record.observations || []).flatMap(observation => (observation.issuers || []).map(issuer => ({
    ...issuer, url: record.url, source: observation.source, title: observation.title, published: observation.published,
  })));
}

// Folds this run's pairs into the current ISO week's bucket, then prunes to
// the trailing CO_MENTION_TRAILING_WEEKS (~90 days).
export function mergeIntoWeek(history, weekKey, pairCounts) {
  const week = { ...(history.weeks[weekKey] || {}) };
  for (const [pair, count] of pairCounts) {
    week[pair] = (week[pair] || 0) + count;
  }
  const weeks = { ...history.weeks, [weekKey]: week };
  const keys = Object.keys(weeks).sort();
  if (keys.length > CO_MENTION_TRAILING_WEEKS) {
    for (const key of keys.slice(0, keys.length - CO_MENTION_TRAILING_WEEKS)) delete weeks[key];
  }
  return { weeks };
}

// Sums edge weights across all retained weeks into one trailing-90d graph.
export function aggregateTrailingGraph(history) {
  const edges = new Map();
  for (const week of Object.values(history.weeks)) {
    for (const [pair, count] of Object.entries(week)) {
      edges.set(pair, (edges.get(pair) || 0) + count);
    }
  }
  const nodes = new Set();
  for (const pair of edges.keys()) {
    const [a, b] = pair.split("|");
    nodes.add(a);
    nodes.add(b);
  }
  return { nodes: [...nodes], edges };
}

// Single-level Louvain-style greedy modularity optimization -- "greedy
// modularity is enough at this scale" per the spec. Returns an array of
// communities (each an array of tickers), unfiltered by size.
export function greedyModularityCommunities(nodes, edgeMap, { maxPasses = 20 } = {}) {
  if (!nodes.length) return [];
  const degree = new Map(nodes.map((n) => [n, 0]));
  const neighborWeights = new Map(nodes.map((n) => [n, new Map()]));
  let m = 0;
  for (const [pairKey, weight] of edgeMap) {
    const [a, b] = pairKey.split("|");
    if (!degree.has(a) || !degree.has(b) || a === b) continue;
    degree.set(a, degree.get(a) + weight);
    degree.set(b, degree.get(b) + weight);
    neighborWeights.get(a).set(b, (neighborWeights.get(a).get(b) || 0) + weight);
    neighborWeights.get(b).set(a, (neighborWeights.get(b).get(a) || 0) + weight);
    m += weight;
  }
  if (m === 0) return nodes.map((n) => [n]);

  const community = new Map(nodes.map((n) => [n, n]));
  const communityTotalDegree = new Map(nodes.map((n) => [n, degree.get(n)]));

  let improved = true;
  let pass = 0;
  while (improved && pass < maxPasses) {
    improved = false;
    pass += 1;
    for (const node of nodes) {
      const currentComm = community.get(node);
      const ki = degree.get(node);
      communityTotalDegree.set(currentComm, communityTotalDegree.get(currentComm) - ki);

      const candidateGain = new Map();
      for (const [neighbor, w] of neighborWeights.get(node)) {
        if (neighbor === node) continue;
        const c = community.get(neighbor);
        candidateGain.set(c, (candidateGain.get(c) || 0) + w);
      }

      let bestComm = currentComm;
      let bestGain = 0;
      for (const [c, kiIn] of candidateGain) {
        const sigmaTot = communityTotalDegree.get(c) || 0;
        const gain = kiIn - (sigmaTot * ki) / (2 * m);
        if (gain > bestGain) {
          bestGain = gain;
          bestComm = c;
        }
      }
      community.set(node, bestComm);
      communityTotalDegree.set(bestComm, (communityTotalDegree.get(bestComm) || 0) + ki);
      if (bestComm !== currentComm) improved = true;
    }
  }

  const groups = new Map();
  for (const [node, comm] of community) {
    if (!groups.has(comm)) groups.set(comm, []);
    groups.get(comm).push(node);
  }
  return [...groups.values()];
}

// Modularity Q of a given community partition (for reporting / filtering).
export function computeModularity(communities, edgeMap) {
  let m = 0;
  const degree = new Map();
  for (const [pairKey, weight] of edgeMap) {
    const [a, b] = pairKey.split("|");
    degree.set(a, (degree.get(a) || 0) + weight);
    degree.set(b, (degree.get(b) || 0) + weight);
    m += weight;
  }
  if (m === 0) return 0;

  const commOf = new Map();
  communities.forEach((members, idx) => members.forEach((n) => commOf.set(n, idx)));

  let internalWeight = new Array(communities.length).fill(0);
  for (const [pairKey, weight] of edgeMap) {
    const [a, b] = pairKey.split("|");
    if (commOf.get(a) === commOf.get(b) && commOf.get(a) !== undefined) {
      internalWeight[commOf.get(a)] += weight;
    }
  }
  const degreeSum = communities.map((members) => members.reduce((sum, n) => sum + (degree.get(n) || 0), 0));

  let q = 0;
  for (let i = 0; i < communities.length; i += 1) {
    q += internalWeight[i] / m - (degreeSum[i] / (2 * m)) ** 2;
  }
  return q;
}

// Top-N neighbors of a ticker by edge weight, for the leader-drift signal.
export function topNeighbors(edgeMap, ticker, limit = 8) {
  const weights = new Map();
  for (const [pairKey, weight] of edgeMap) {
    const [a, b] = pairKey.split("|");
    if (a === ticker) weights.set(b, (weights.get(b) || 0) + weight);
    else if (b === ticker) weights.set(a, (weights.get(a) || 0) + weight);
  }
  return [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

// Orchestrator: folds today's events into the weekly accumulator, rebuilds
// the trailing graph, detects communities (filtered to a minimum size and
// modularity), and reports leader neighbor-set drift for a supplied list of
// candidate leaders (Layer 0b feeds this in). Runs every refresh for the
// merge step (cheap), but community detection is itself cheap enough at
// this scale to also run every refresh -- no separate weekly gate needed
// beyond the trailing-window accumulation already being date-keyed.
export function computeCoMention(history, events, dateStr, leaderTickers = [], prevLeaderNeighbors = {}) {
  // v2 retained only pair counts: no original title or issuer attribution can
  // be rechecked. Preserve those records for audit, never certify them in place.
  const documents = history.version === 3 ? { ...(history.documents || {}) } : {};
  const legacyDocuments = { ...(history.legacyDocuments || {}), ...(history.version === 3 ? {} : history.documents || {}) };
  const grouped = new Map();
  for (const event of events) {
    if (!event.url || !event.title || EXCLUDED_SOURCES.has(event.source)) continue;
    const group = grouped.get(event.url) || []; group.push(event); grouped.set(event.url, group);
  }
  for (const [url, group] of grouped) {
    const id = createHash("sha256").update(url).digest("hex").slice(0, 24), prior = documents[id];
    const published = group.map(e => e.published).filter(d => Number.isFinite(Date.parse(d)) && Date.parse(d) <= Date.parse(dateStr) + 86400000).sort()[0];
    const firstSeen = prior?.firstSeen || dateStr;
    const observations = new Map();
    for (const event of group.filter(verifiedEvent)) {
      const key = JSON.stringify([event.source, event.title]);
      const observation = observations.get(key) || { source: event.source, title: event.title, published: event.published || null, issuers: [] };
      if (!observation.issuers.some(issuer => issuer.ticker === event.ticker)) observation.issuers.push({ ticker: event.ticker, name: event.name || "", companyMatch: event.companyMatch || null });
      observations.set(key, observation);
    }
    const nextObservations = [...observations.values()].map(o => ({ ...o, issuers: o.issuers.sort((a, b) => a.ticker.localeCompare(b.ticker)) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const signature = rows => JSON.stringify((rows || []).map(o => ({ ...o, issuers: [...o.issuers].sort((a, b) => a.ticker.localeCompare(b.ticker)) }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
    const changed = prior && signature(prior.observations) !== signature(nextObservations);
    // Original publication dates never renew. Revised text is a separately dated
    // observation; only the latest version contributes, never a union of titles.
    const effectiveAt = changed ? dateStr : prior?.effectiveAt || published || firstSeen;
    const revisions = [...(prior?.revisions || (prior ? [{ observedAt: prior.firstSeen, effectiveAt: prior.effectiveAt || prior.published || prior.firstSeen, observations: prior.observations }] : []))];
    if (!prior || changed) revisions.push({ observedAt: dateStr, effectiveAt, observations: nextObservations });
    documents[id] = { url, firstSeen, published: prior?.published || published || null,
      effectiveAt, week: isoWeekKey(new Date(effectiveAt)), revisions,
      observations: nextObservations };
  }
  const weeks = {}, cutoff = isoWeekKey(new Date(Date.parse(dateStr) - 12 * 7 * 86400000));
  const supportingDocuments = [];
  for (const record of Object.values(documents)) {
    if (!record.week || record.week < cutoff || record.week > isoWeekKey(new Date(dateStr))) continue;
    // Recompute from original text every run, including retained v3 records.
    const pairs = extractCoMentionPairs(documentEvents(record));
    if (!pairs.size) continue;
    const week = weeks[record.week] ||= {};
    for (const [pair, count] of pairs) week[pair] = (week[pair] || 0) + count;
    supportingDocuments.push({ record, pairs });
  }
  const nextHistory = { version: 3, weeks, documents, legacyDocuments, legacyWeeks: history.legacyWeeks || (history.version >= 2 ? {} : history.weeks) };
  const graph = aggregateTrailingGraph(nextHistory);

  const rawCommunities = greedyModularityCommunities(graph.nodes, graph.edges);
  const overallModularity = computeModularity(rawCommunities, graph.edges);
  // A weak overall partition isn't meaningful evidence of real clustering --
  // MIN_MODULARITY is an unvalidated conservative placeholder (not spec'd
  // numerically), see file header.
  const communities =
    overallModularity >= MIN_MODULARITY
      ? rawCommunities.filter((members) => members.length >= MIN_COMMUNITY_SIZE).map((members) => {
          const memberSet = new Set(members);
          const supporting = supportingDocuments.filter(({ pairs }) => [...pairs.keys()].some(pair => pair.split("|").every(ticker => memberSet.has(ticker))));
          const evidence = supporting.map(({ record }) => {
            const observation = record.observations.find(item => {
              const matches = documentEvents({ ...record, observations: [item] }).filter(verifiedEvent).filter(event => memberSet.has(event.ticker) && !NOISE_TICKERS.has(event.ticker));
              return new Set(matches.map(event => event.ticker)).size >= 2;
            });
            return { url: record.url, title: observation.title, source: observation.source, published: observation.published, firstSeen: record.firstSeen,
              observedAt: record.revisions?.at(-1)?.observedAt || record.firstSeen, effectiveAt: record.effectiveAt };
          }).sort((a, b) => String(b.published || b.firstSeen).localeCompare(String(a.published || a.firstSeen)));
          return { members: members.sort(), documentCount: supporting.length, evidence: evidence.slice(0, 6) };
        })
      : [];

  const leaderNeighbors = {};
  const leaderDrift = [];
  for (const ticker of leaderTickers) {
    const neighbors = topNeighbors(graph.edges, ticker);
    leaderNeighbors[ticker] = neighbors;
    const prior = prevLeaderNeighbors[ticker];
    if (prior) {
      const changed = neighbors.join(",") !== prior.join(",");
      if (changed) leaderDrift.push({ ticker, from: prior, to: neighbors });
    }
  }

  return {
    nextHistory,
    payload: {
      integrityVersion: 3,
      provenanceNote: "One contribution per URL; issuers must match the same original headline. Links may be syndicated or promotional, not independent confirmation or adoption evidence.",
      verifiedDocuments: supportingDocuments.length,
      withheldLegacyDocuments: Object.keys(legacyDocuments).length,
      generatedAt: new Date().toISOString(),
      graphNodes: graph.nodes.length,
      graphEdges: graph.edges.size,
      overallModularity,
      communities,
      leaderNeighbors,
      leaderDrift,
    },
  };
}
