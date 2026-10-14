import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import quality from "../../data-quality.js";
import { aggregate } from "../update-data.mjs";
import { marketHealth } from "../lib/market-health.mjs";

const stock = (counts = { ApeWisdom: 10 }, patch = {}) => ({ ticker: "SXTC", name: "China SXT Pharmaceuticals",
  attentionMetricsVersion: 1, attentionObservedSources: Object.keys(counts), sources: counts, latest: [], ...patch });
const day = (date, signals, health = ["ApeWisdom", "Google News"]) => ({ date,
  generatedAt: `${date}T20:00:00Z`, signals, sourceHealth: health.map(source => ({ source, state: "covered" })) });
const prior = () => day("2026-10-12", [stock()]);
const current = () => day("2026-10-13", [stock({ ApeWisdom: 20 })]);
const compare = (a, b, sources = ["ApeWisdom"]) => quality.scopeSignal(quality.aggregateSignals(a, b)[0], sources);
const badNews = { source: "Google News", title: "Samsung and SK Hynix see China competition", url: "https://example.org/news", published: "2026-10-12T19:00:00Z" };

test("compatible source observations yield a sampled change, including a real observed zero", () => {
  assert.equal(compare([current()], [prior()]).momentum, 100);
  const zero = current(); zero.signals[0].sources.ApeWisdom = 0;
  assert.equal(compare([zero], [prior()]).momentum, -100);
  const zeroPrior = prior(); zeroPrior.signals[0].sources.ApeWisdom = 0;
  assert.equal(compare([current()], [zeroPrior]).momentum, null);
  assert.match(compare([current()], [zeroPrior]).attentionComparisonNote, /zero.*undefined/);
});

test("current and prior coverage, explicit observation, protocol and source counts are all required", () => {
  for (const change of [d => d.sourceHealth[0].state = "partial", d => d.sourceHealth = [],
    d => delete d.signals[0].attentionMetricsVersion, d => d.signals[0].attentionObservedSources = [],
    d => delete d.signals[0].sources.ApeWisdom, d => d.signals[0].sources.ApeWisdom = null,
    d => d.signals[0].sources.ApeWisdom = -1, d => d.signals[0].sources.ApeWisdom = "bad"]) {
    const a = current(); change(a); assert.equal(compare([a], [prior()]).momentum, null);
    const b = prior(); change(b); assert.equal(compare([current()], [b]).momentum, null);
  }
  assert.equal(compare([current()], [prior()], ["ApeWisdom", "Google News"]).momentum, null, "cannot silently compare just the surviving source subset");
});

test("quarantined prior news cannot become a valid zero baseline or enter the collector comparison", () => {
  const b = day("2026-10-12", [stock({ ApeWisdom: 10, "Google News": 30 }, { latest: [badNews], topHeadline: badNews })]);
  const a = day("2026-10-13", [stock({ ApeWisdom: 20, "Google News": 10 })]);
  const both = compare([a], [b], ["ApeWisdom", "Google News"]);
  assert.equal(both.momentum, null); assert.equal(both.previousSources["Google News"], 0);
  assert.ok(!both.previousCoverage.includes("Google News"));
  assert.equal(compare([a], [b], ["ApeWisdom"]).momentum, 100, "unaffected explicitly selected sources can still compare");
  const collected = aggregate([{ ticker: "SXTC", name: "China SXT Pharmaceuticals", source: "ApeWisdom", mentions: 20 }], b,
    { generatedAt: a.generatedAt });
  assert.ok(collected[0].previousExcludedNewsSources.includes("Google News"));
  assert.equal(collected[0].previousSources["Google News"], 0);
  assert.equal(quality.scopeSignal(collected[0], ["ApeWisdom"]).momentum, 100);
  const failed = aggregate([{ ticker: "SXTC", name: "China SXT Pharmaceuticals", source: "ApeWisdom", mentions: 20 }], b,
    { generatedAt: a.generatedAt, failures: ["ApeWisdom: 429 Too Many Requests"] });
  assert.equal(quality.scopeSignal(failed[0], ["ApeWisdom"]).momentum, null);
});

test("window comparisons reject missing tickers, overlapping/duplicate dates and mismatched sample spacing", () => {
  const a = [day("2026-10-12", [stock()]), current()];
  const b = [day("2026-10-10", [stock()]), day("2026-10-11", [stock()])];
  assert.equal(compare(a, b).momentum, 50);
  assert.equal(compare(a, [b[0], day("2026-10-11", [])]).momentum, null);
  assert.equal(compare(a, [b[0]]).momentum, null);
  assert.equal(compare(a, [b[0], b[0]]).momentum, null);
  assert.equal(compare(a, a).momentum, null);
  assert.equal(compare(a, [day("2026-10-09", [stock()]), b[1]]).momentum, null);
  const missingCurrent = [day("2026-10-12", []), current()];
  assert.equal(compare(missingCurrent, b).momentum, null);
  const invalid = prior(); invalid.generatedAt = "invalid";
  assert.equal(compare([current()], [invalid]).momentum, null);
});

test("legacy embedded comparisons are unknown while validated embedded comparisons survive reload", () => {
  const a = current(), b = prior();
  const legacy = quality.normalizeSignal(stock({ ApeWisdom: 20 }, { previousSources: { ApeWisdom: 10 }, previousCoverage: ["ApeWisdom"] }));
  assert.equal(quality.scopeSignal(legacy, ["ApeWisdom"]).momentum, null);
  a.signals[0] = quality.attachAttentionComparison(a.signals[0], [a], [b]);
  assert.equal(compare([a], []).momentum, 100);
  const relabeled = { ...a, generatedAt: "2026-10-14T20:00:00Z" };
  assert.equal(compare([relabeled], []).momentum, null, "saved comparison cannot be relabeled as a newer snapshot");
  const normalized = quality.normalizeSignal(a.signals[0]);
  assert.deepEqual(quality.normalizeSignal(normalized), normalized);
  normalized.previousSources.ApeWisdom = null;
  assert.equal(quality.scopeSignal(normalized, ["ApeWisdom"]).momentum, null);
  for (const samples of [0, -1, 1.5, Infinity, "1"]) assert.equal(quality.attentionComparisonValid({ ...a.signals[0].attentionComparison, samples }), false);
});

test("history draws only the latest comparable source sequence and never bridges missing rows", () => {
  const old = day("2026-10-10", [stock({ ApeWisdom: 100 }, { attentionMetricsVersion: undefined })]);
  const history = [old, day("2026-10-11", []), prior(), current()];
  const result = quality.attentionHistory(history, "SXTC");
  assert.equal(result.observations.length, 4); assert.equal(result.observations[1].mentions, null);
  assert.deepEqual(result.series.map(s => s.mentions), [10,20]); assert.deepEqual(result.sources, ["ApeWisdom"]);
  assert.equal(quality.attentionHistory([...history, day("2026-10-14", [])], "SXTC").series.length, 0);
  assert.equal(quality.attentionHistory([prior(), day("2026-10-20", [stock()])], "SXTC").series.length, 1);
  const extra = prior(); extra.signals[0] = stock({ ApeWisdom: 10, "Google News": 99 });
  assert.deepEqual(quality.attentionHistory([extra,current()], "SXTC").series.map(s=>s.mentions), [10,20], "series explicitly narrows to the named common sources");
});

test("actual history UI withholds false percentage trends and explains sampled units", () => {
  const c = vm.createContext({ window: { SIGNALDESK_QUALITY: quality }, document: {}, Intl, Date, URLSearchParams, console });
  vm.runInContext(readFileSync(new URL("../../script.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, ""), c);
  c.fixture = { snapshots: [day("2026-10-12", [stock({ ApeWisdom: 100 }, { attentionMetricsVersion: undefined })]), current()] };
  vm.runInContext("history=fixture;", c);
  const withheld = c.detailTrendMarkup({ ticker: "SXTC" });
  assert.match(withheld, /No comparable trend yet/); assert.doesNotMatch(withheld, /<svg|80%/);
  assert.match(withheld, /Saved observations/);
  assert.match(withheld, /data-detail-section="observations"/, "open history disclosure participates in same-stock state preservation");
  c.fixture.snapshots = [prior(), current()];
  const valid = c.detailTrendMarkup({ ticker: "SXTC" });
  assert.match(valid, /\+100%/); assert.match(valid, /Same sources: ApeWisdom/);
  assert.match(valid, /not unique posts or continuous daily coverage/);
});

test("Attention map labels the mixed developing group accurately and retains individual stages", () => {
  const board = { innerHTML: "", querySelectorAll: () => [] };
  const c = vm.createContext({ window: { SIGNALDESK_QUALITY: quality }, document: { getElementById: () => board }, Intl, Date, URLSearchParams, console });
  vm.runInContext(readFileSync(new URL("../../script.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, ""), c);
  vm.runInContext("marketEvidenceCurrent = () => true;", c);
  c.renderMovers([{ ticker: "A", discovery: { tone: "building", stage: "Building", score: 40 } },
    { ticker: "B", discovery: { tone: "early", stage: "Early ignition", score: 30 } }]);
  assert.match(board.innerHTML, /<h3>Developing attention<\/h3>/);
  assert.match(board.innerHTML, /Building · 40/); assert.match(board.innerHTML, /Early ignition · 30/);
  assert.doesNotMatch(board.innerHTML, /<h3>Early ignition<\/h3>/);
});

test("public health rejects a displayed attention percentage that lacks comparable provenance", () => {
  const now = new Date().toISOString();
  const s = stock({ ApeWisdom: 10, "Price/Volume": 1 }, { lastPrice: 5, quoteAsOf: now,
    marketMetricsVersion: 2, priceMove: 1, relativeVolume: 1, momentum: 100 });
  const result = marketHealth({ dataMode: "real-public-no-key", generatedAt: now, signals: [s] }, now, { minTickers: 1 });
  assert.equal(result.ok, false); assert.deepEqual(result.unsupportedAttention, ["SXTC"]);
});
