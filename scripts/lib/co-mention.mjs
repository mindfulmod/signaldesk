// Co-mention graph — THEME_ENGINE.md Layer 0c. Weekly job over the trailing
// 90d of events: nodes = tickers, edge weight = co-appearances in the same
// headline/post. Signals: (i) a new dense cluster forming = theme
// crystallizing (greedy modularity community detection); (ii) a leader's
// neighbor set changing = diffusion direction.
import { readFile, writeFile } from "node:fs/promises";
import { isoWeekKey } from "./alerts.mjs";

const ROOT = new URL("../../", import.meta.url);
export const CO_MENTION_HISTORY_URL = new URL("data/co-mention-history.json", ROOT);
export const CLUSTERS_URL = new URL("data/clusters.json", ROOT);
export const CLUSTERS_JS_URL = new URL("data/clusters.js", ROOT);

export const CO_MENTION_TRAILING_WEEKS = 13; // ~90 days
export const MIN_COMMUNITY_SIZE = 3;
export const MIN_MODULARITY = 0.05; // conservative placeholder -- not spec'd numerically, flagged here

// Sources that don't represent real text co-occurrence (a synthetic quote
// fetch or a pre-aggregated count), excluded from co-mention pairing.
const EXCLUDED_SOURCES = new Set(["Price/Volume", "FINRA Short Volume", "StockTwits"]);

// Tickers that are also common short English words pollute co-mention
// pairing with noise rather than real cross-ticker signal --
// collectMentions' word-boundary matching in update-data.mjs can't fully
// disambiguate these from ordinary prose. A live run's co-mention graph
// lumped a first, narrower hand-picked list (ALL/BE/GO/IT/...) in with
// unrelated real tickers, and after excluding those, a *second* wave of
// noise surfaced (AS/BY/HE/HOUR/IQ/JUST/RE/S/TH/WAY/...) -- confirming this
// isn't a short fixed list of offenders but the general shape of the
// problem: any function word, pronoun, preposition, or common short word
// that happens to also be a valid 1-5 letter ticker string. A stopword-
// style filter (rather than an ever-growing ad hoc list) is the right
// shape of fix. This trades away a handful of real short tickers that are
// also common words (e.g. HP, IQ, MA) for co-mention purposes specifically
// -- they still fully participate everywhere else in the dashboard (this
// filter is local to extractCoMentionPairs, not the ranking pipeline).
const NOISE_TICKERS = new Set([
  "A", "ABOUT", "AFTER", "AGAIN", "AGO", "ALL", "ALSO", "AM", "AN", "ANY", "ARE", "AS", "AT",
  "BACK", "BE", "BEEN", "BEST", "BIG", "BUT", "BY",
  "CAN", "COULD",
  "DAY", "DID", "DO", "DOES", "DOWN",
  "EACH", "EU", "EVEN", "EVERY",
  "FEW", "FOR", "FROM",
  "GET", "GO", "GOT",
  "HAD", "HAS", "HAVE", "HE", "HER", "HERE", "HIM", "HIS", "HOUR", "HOW",
  "IF", "IN", "INTO", "IS", "IT", "ITS",
  "JUST",
  "KEEP", "KNOW",
  "LAST", "LESS", "LET", "LIKE", "LONG", "LOT",
  "MADE", "MANY", "MAY", "ME", "MORE", "MOST", "MUCH", "MUST", "MY",
  "NEED", "NET", "NEW", "NEXT", "NO", "NONE", "NOR", "NOT", "NOW",
  "OF", "OFF", "OG", "ON", "ONE", "ONLY", "OR", "OTHER", "OUR", "OUT", "OVER", "OWN",
  "PART", "PAST", "PER",
  "RE", "REAL",
  "S", "SAID", "SAME", "SAW", "SAY", "SEE", "SET", "SHE", "SO", "SOME", "STILL",
  "T", "THAN", "THAT", "THE", "THEM", "THEN", "THERE", "THEY", "THIS", "TH",
  "TO", "TOO", "TOP", "TWO",
  "UP", "US", "USE",
  "VERY",
  "WANT", "WAS", "WAY", "WE", "WELL", "WENT", "WERE", "WHAT", "WHEN", "WHERE",
  "WHICH", "WHILE", "WHO", "WHY", "WILL", "WITH", "WOULD",
  "YET", "YOU", "YOUR",
]);

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
    if (!event.ticker || !event.url || EXCLUDED_SOURCES.has(event.source)) continue;
    if (excludeTickers.has(event.ticker)) continue;
    if (!groups.has(event.url)) groups.set(event.url, new Set());
    groups.get(event.url).add(event.ticker);
  }
  const pairCounts = new Map();
  for (const tickers of groups.values()) {
    if (tickers.size < 2) continue;
    const list = [...tickers].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }
  return pairCounts;
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
  const weekKey = isoWeekKey(new Date(dateStr));
  const pairCounts = extractCoMentionPairs(events);
  const nextHistory = mergeIntoWeek(history, weekKey, pairCounts);
  const graph = aggregateTrailingGraph(nextHistory);

  const rawCommunities = greedyModularityCommunities(graph.nodes, graph.edges);
  const overallModularity = computeModularity(rawCommunities, graph.edges);
  // A weak overall partition isn't meaningful evidence of real clustering --
  // MIN_MODULARITY is an unvalidated conservative placeholder (not spec'd
  // numerically), see file header.
  const communities =
    overallModularity >= MIN_MODULARITY
      ? rawCommunities.filter((members) => members.length >= MIN_COMMUNITY_SIZE).map((members) => ({ members: members.sort() }))
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
