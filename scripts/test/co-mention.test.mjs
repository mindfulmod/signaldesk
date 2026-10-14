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
  computeCoMention,
} from "../lib/co-mention.mjs";

test("extractCoMentionPairs: two tickers sharing a headline produce a pair; excluded sources and singles do not", () => {
  const events = [
    { ticker: "NVDA", url: "https://news/1", source: "GDELT News" },
    { ticker: "AMD", url: "https://news/1", source: "GDELT News" },
    { ticker: "AAPL", url: "https://news/2", source: "GDELT News" }, // solo headline -> no pair
    { ticker: "SOFI", url: "https://finance.yahoo.com/quote/SOFI", source: "Price/Volume" },
    { ticker: "AMD", url: "https://finance.yahoo.com/quote/SOFI", source: "Price/Volume" }, // excluded source
  ];
  const pairs = extractCoMentionPairs(events.map(event => ({ ...event, title: "$NVDA $AMD $AAPL $SOFI" })));
  assert.equal(pairs.size, 1);
  assert.equal(pairs.get("AMD|NVDA"), 1);
});

test("extractCoMentionPairs: three co-mentioned tickers produce all three pairs", () => {
  const events = [
    { ticker: "NVDA", url: "u1", source: "Reddit Finance" },
    { ticker: "AMD", url: "u1", source: "Reddit Finance" },
    { ticker: "AVGO", url: "u1", source: "Reddit Finance" },
  ];
  const pairs = extractCoMentionPairs(events.map(event => ({ ...event, url: "https://example.com/1", title: "$NVDA $AMD $AVGO" })));
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
  const pairs = extractCoMentionPairs(events.map(event => ({ ...event, url: "https://example.com/1", title: "$NVDA $IT $ALL" })));
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

const headline = (tickers, title = tickers.map(t => `$${t}`).join(" "), url = "https://example.com/story") => tickers.map(ticker => ({ ticker, title, url, source: "CNBC", published: "2026-10-13T12:00:00Z" }));

test("identity is rechecked and different headlines at one URL never fabricate a pair", () => {
  assert.equal(extractCoMentionPairs([...headline(["NVDA"], "$NVDA earnings"), ...headline(["AMD"], "$AMD earnings")]).size, 0);
  assert.equal(extractCoMentionPairs(headline(["NVDA", "AMD"], "$NVDA earnings")).size, 0);
  assert.equal(extractCoMentionPairs(headline(["NVDA", "AMD"], "$NVDA $AMD", "https://user:secret@example.com")).size, 0);
  assert.equal(extractCoMentionPairs(headline(["NVDA", "AMD"], "$NVDA $AMD", "javascript:alert(1)")).size, 0);
  const events = headline(["NVDA", "AMD"]);
  assert.equal(extractCoMentionPairs([...events, ...events.map(event => ({ ...event, source: "Financial Media" }))]).get("AMD|NVDA"), 1);
});

test("v2 pairs remain auditable but cannot contribute or seed neighbor drift", () => {
  const legacy = { version: 2, weeks: { "2026-W42": { "FAKE|NVDA": 20 } }, documents: { old: { week: "2026-W42", pairs: { "FAKE|NVDA": 20 } } }, legacyWeeks: { "2026-W01": { "BAD|OLD": 4 } } };
  const { nextHistory, payload } = computeCoMention(legacy, headline(["NVDA", "AMD"]), "2026-10-14", ["NVDA"]);
  assert.equal(nextHistory.version, 3);
  assert.deepEqual(nextHistory.legacyDocuments, legacy.documents);
  assert.deepEqual(nextHistory.legacyWeeks, legacy.legacyWeeks);
  assert.deepEqual(payload.leaderNeighbors.NVDA, ["AMD"]);
  assert.equal(payload.withheldLegacyDocuments, 1);
  assert.equal(payload.integrityVersion, 3);
  const replay = computeCoMention(nextHistory, [], "2026-10-15");
  assert.deepEqual(replay.nextHistory.weeks, nextHistory.weeks);
  const record = Object.values(nextHistory.documents)[0];
  record.observations[0].title = "No company identities remain";
  assert.equal(computeCoMention(nextHistory, [], "2026-10-15").payload.graphEdges, 0);
});

test("communities expose real document counts and originals, with no repeated-support claim", () => {
  const events = [...headline(["NVDA", "AMD", "AVGO"]), ...headline(["AAPL", "MSFT", "META"], "$AAPL $MSFT $META", "https://example.com/other")];
  const { payload, nextHistory } = computeCoMention({ weeks: {} }, events, "2026-10-14");
  assert.equal(payload.communities.length, 2);
  assert.equal(payload.communities[0].documentCount, 1);
  assert.equal(payload.communities[0].evidence.length, 1);
  assert.ok(payload.communities[0].evidence[0].title);
  assert.equal(computeCoMention(nextHistory, [], "2027-02-01").payload.graphEdges, 0);
});

test("forum names, TV and console acronyms cannot masquerade as issuers", () => {
  assert.equal(extractCoMentionPairs(headline(["SMG", "TV", "SNES"], "/SMG/ stock market general — Financial TV Streams — SNES Edition")).size, 0);
  const events = headline(["NVDA", "AMD"], "NVDA and AMD: Nvidia and Advanced Micro Devices announce products");
  events[0].name = "Nvidia Corp";
  events[1].name = "Advanced Micro Devices";
  assert.equal(extractCoMentionPairs(events).get("AMD|NVDA"), 1, "full company evidence still works when bare symbols are also present");
});
