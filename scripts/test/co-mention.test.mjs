import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractCoMentionPairs,
  mergeIntoWeek,
  aggregateTrailingGraph,
  greedyModularityCommunities,
  computeModularity,
  topNeighbors,
  CO_MENTION_TRAILING_WEEKS,
} from "../lib/co-mention.mjs";

test("extractCoMentionPairs: two tickers sharing a headline produce a pair; excluded sources and singles do not", () => {
  const events = [
    { ticker: "NVDA", url: "https://news/1", source: "GDELT News" },
    { ticker: "AMD", url: "https://news/1", source: "GDELT News" },
    { ticker: "AAPL", url: "https://news/2", source: "GDELT News" }, // solo headline -> no pair
    { ticker: "SOFI", url: "https://finance.yahoo.com/quote/SOFI", source: "Price/Volume" },
    { ticker: "AMD", url: "https://finance.yahoo.com/quote/SOFI", source: "Price/Volume" }, // excluded source
  ];
  const pairs = extractCoMentionPairs(events);
  assert.equal(pairs.size, 1);
  assert.equal(pairs.get("AMD|NVDA"), 1);
});

test("extractCoMentionPairs: three co-mentioned tickers produce all three pairs", () => {
  const events = [
    { ticker: "NVDA", url: "u1", source: "Reddit Finance" },
    { ticker: "AMD", url: "u1", source: "Reddit Finance" },
    { ticker: "AVGO", url: "u1", source: "Reddit Finance" },
  ];
  const pairs = extractCoMentionPairs(events);
  assert.equal(pairs.size, 3);
  assert.equal(pairs.get("AMD|AVGO"), 1);
  assert.equal(pairs.get("AMD|NVDA"), 1);
  assert.equal(pairs.get("AVGO|NVDA"), 1);
});

// Regression test: a real pipeline run showed the co-mention graph lumping
// unrelated real tickers together purely because common-English-word
// tickers (IT, GO, ALL, ...) co-occur with everything.
test("extractCoMentionPairs: excludes noise tickers that are also common English words", () => {
  const events = [
    { ticker: "NVDA", url: "u1", source: "GDELT News" },
    { ticker: "IT", url: "u1", source: "GDELT News" },
    { ticker: "ALL", url: "u1", source: "GDELT News" },
  ];
  const pairs = extractCoMentionPairs(events);
  assert.equal(pairs.size, 0, "no pairs should form when the only co-mentioned tickers are noise words");
});

test("mergeIntoWeek + aggregateTrailingGraph: accumulates across weeks and prunes beyond the trailing window", () => {
  let history = { weeks: {} };
  history = mergeIntoWeek(history, "2026-W01", new Map([["A|B", 2]]));
  history = mergeIntoWeek(history, "2026-W01", new Map([["A|B", 1]])); // same week accumulates
  assert.equal(history.weeks["2026-W01"]["A|B"], 3);

  for (let w = 2; w <= CO_MENTION_TRAILING_WEEKS + 3; w += 1) {
    history = mergeIntoWeek(history, `2026-W${String(w).padStart(2, "0")}`, new Map([["C|D", 1]]));
  }
  assert.equal(Object.keys(history.weeks).length, CO_MENTION_TRAILING_WEEKS, "should prune to the trailing window");
  assert.ok(!history.weeks["2026-W01"], "oldest week should have been pruned out");

  const graph = aggregateTrailingGraph(history);
  assert.ok(graph.nodes.includes("C"));
  assert.ok(graph.nodes.includes("D"));
});

test("greedyModularityCommunities: separates two dense clusters joined by a weak bridge", () => {
  const nodes = ["A", "B", "C", "D", "E", "F"];
  const edges = new Map([
    ["A|B", 10], ["A|C", 10], ["B|C", 10], // cluster 1
    ["D|E", 10], ["D|F", 10], ["E|F", 10], // cluster 2
    ["C|D", 1], // weak bridge
  ]);
  const communities = greedyModularityCommunities(nodes, edges);
  const commOf = new Map();
  communities.forEach((members, idx) => members.forEach((n) => commOf.set(n, idx)));
  assert.equal(commOf.get("A"), commOf.get("B"));
  assert.equal(commOf.get("B"), commOf.get("C"));
  assert.equal(commOf.get("D"), commOf.get("E"));
  assert.equal(commOf.get("E"), commOf.get("F"));
  assert.notEqual(commOf.get("A"), commOf.get("D"));
});

test("computeModularity: the natural two-cluster split scores higher than lumping everything together", () => {
  const nodes = ["A", "B", "C", "D", "E", "F"];
  const edges = new Map([
    ["A|B", 10], ["A|C", 10], ["B|C", 10],
    ["D|E", 10], ["D|F", 10], ["E|F", 10],
    ["C|D", 1],
  ]);
  const goodSplit = [["A", "B", "C"], ["D", "E", "F"]];
  const badSplit = [["A", "B", "C", "D", "E", "F"]];
  const goodQ = computeModularity(goodSplit, edges);
  const badQ = computeModularity(badSplit, edges);
  assert.ok(goodQ > badQ, `expected the real split (${goodQ}) to score higher than lumping together (${badQ})`);
});

test("topNeighbors: ranks by edge weight, respects the limit", () => {
  const edges = new Map([
    ["NVDA|AMD", 5],
    ["NVDA|AVGO", 9],
    ["NVDA|MU", 2],
  ]);
  assert.deepEqual(topNeighbors(edges, "NVDA", 2), ["AVGO", "AMD"]);
});
