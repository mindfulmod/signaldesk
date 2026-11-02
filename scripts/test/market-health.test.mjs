import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import quality from "../../data-quality.js";
import { marketHealth } from "../lib/market-health.mjs";

const now = Date.parse("2026-10-13T22:00:00Z");
const ago = hours => new Date(now - hours * 3_600_000).toISOString();
const quote = i => ({ ticker: `T${i}`, lastPrice: 12, quoteAsOf: ago(2),
  marketMetricsVersion: 2, sources: { "Price/Volume": 1 }, priceMove: 0, relativeVolume: 0 });
const snapshot = () => ({ generatedAt: ago(1), dataMode: "real-public-no-key", signals: Array.from({ length: 75 }, (_, i) => quote(i)), failures: [] });

test("market health accepts recent collected quotes and real zero comparisons", () => {
  const result = marketHealth(snapshot(), now);
  assert.equal(result.ok, true);
  assert.equal(result.coverage.collectedQuotes, 75);
  assert.equal(result.coverage.completeComparisons, 75);
  assert.equal(result.capitalization.unknown, 75);
  assert.match(result.warnings.join(" "), /75\/75.*capitalization/);
});

test("partial production-like coverage fails despite a freshly generated snapshot", () => {
  const data = snapshot();
  for (let i = 31; i < 75; i++) data.signals[i].sources = {};
  for (let i = 37; i < 75; i++) data.signals[i].lastPrice = null;
  data.signals[36].quoteAsOf = ago(97);
  data.signals[0].priceMove = null;
  const result = marketHealth(data, now);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /31\/75/);
  assert.deepEqual(result.coverage, { total: 75, recentQuotes: 36, collectedQuotes: 31, retainedQuotes: 5,
    staleQuotes: 1, missingQuotes: 38, priceComparisons: 30, volumeComparisons: 31, completeComparisons: 30 });
});

test("retained quotes and legacy measurements cannot masquerade as successful collection", () => {
  for (const mutation of [s => { s.sources = {}; }, s => { s.marketMetricsVersion = 1; }]) {
    const data = snapshot(); data.signals.forEach(mutation);
    const result = marketHealth(data, now);
    assert.equal(result.ok, false);
    assert.equal(result.coverage.retainedQuotes, 75);
    assert.equal(result.coverage.collectedQuotes, 0);
  }
});

test("quote coverage rejects stale, invalid and future dates and missing prices", () => {
  const data = snapshot();
  data.signals = [quote(0), quote(1), quote(2), quote(3), quote(4), quote(5)];
  data.signals[0].quoteAsOf = ago(97);
  data.signals[1].quoteAsOf = "bad";
  data.signals[2].quoteAsOf = ago(-1);
  data.signals[3].lastPrice = null;
  data.signals[4].lastPrice = 0;
  data.signals[5].lastPrice = "not a price";
  const coverage = quality.marketCoverage(data, now);
  assert.equal(coverage.staleQuotes, 3);
  assert.equal(coverage.missingQuotes, 3);
  assert.equal(coverage.collectedQuotes, 0);
});

test("quarantined comparisons stay unknown while quote availability is measured separately", () => {
  const data = snapshot();
  data.signals[0].priceMove = null;
  data.signals[1].relativeVolume = 26;
  data.signals[2].relativeVolume = null;
  const result = marketHealth(data, now);
  assert.equal(result.ok, true);
  assert.equal(result.coverage.completeComparisons, 72);
  assert.match(result.warnings.join(" "), /3 collected quotes lack/);
  assert.equal(data.signals[0].priceMove, null);
});

test("coverage targets round up and small universes cannot hide an outage", () => {
  const data = snapshot();
  data.signals.slice(56).forEach(s => { s.lastPrice = null; });
  assert.equal(marketHealth(data, now).ok, false);
  data.signals[56] = quote(56);
  assert.equal(marketHealth(data, now).ok, true);
  data.signals = data.signals.slice(0, 49);
  assert.match(marketHealth(data, now).errors.join(" "), /operational floor/);
  assert.equal(marketHealth(data, now, { minTickers: 49 }).ok, true);
});

test("publication age warns at 36 hours and fails beyond long-weekend tolerance", () => {
  const data = snapshot();
  data.generatedAt = ago(37);
  assert.equal(marketHealth(data, now).ok, true);
  assert.match(marketHealth(data, now).warnings.join(" "), /older than 36/);
  for (const timestamp of [ago(97), ago(-1), null, "invalid"]) {
    data.generatedAt = timestamp;
    assert.match(marketHealth(data, now).errors.join(" "), /publication/);
  }
});

test("invalid universes, diagnostics and data modes fail without crashing the health check", () => {
  for (const data of [null, {}, { ...snapshot(), signals: [null] }, { ...snapshot(), signals: "bad" },
    { ...snapshot(), signals: [quote(1), quote(1)] }, { ...snapshot(), signals: [{ ...quote(1), ticker: "<bad>" }] },
    { ...snapshot(), dataMode: "demo" }, { ...snapshot(), failures: {} }]) {
    assert.equal(marketHealth(data, now).ok, false);
  }
  assert.equal(quality.marketCoverage(null, now).total, 0);
});

test("provider warnings survive healthy coverage without certifying investment quality", () => {
  const data = snapshot(); data.failures = ["Price/Volume XYZ: Yahoo 429", "Unrelated feed warning"];
  const result = marketHealth(data, now);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("Price/Volume XYZ: Yahoo 429"));
  assert.match(result.warnings.join(" "), /capitalization/);
  assert.match(result.note, /Does not certify provider accuracy or licensing/);
});

test("market health runs after publication and independently of research health", () => {
  const refresh = readFileSync(new URL("../../.github/workflows/refresh-data.yml", import.meta.url), "utf8");
  const watchdog = readFileSync(new URL("../../.github/workflows/research-watchdog.yml", import.meta.url), "utf8");
  assert.ok(refresh.indexOf("verify-publication.mjs signals") < refresh.indexOf("check-market-health.mjs --live"));
  assert.match(watchdog, /if: \$\{\{ !cancelled\(\) \}\}\s+run: node scripts\/check-market-health.mjs --live/);
});

test("a quote-healthy publication still fails for falsely attached company headlines", () => {
  const data = snapshot();
  const stock = { ticker: "SXTC", name: "China SXT Pharmaceuticals, Inc." };
  const bad = { source: "Google News", title: "Samsung, SK Hynix shares plunge on China competition fears" };
  data.signals[0] = { ...data.signals[0], ...stock, topHeadline: bad };
  data.marketNews = [{ ...stock, ...bad }];
  const result = marketHealth(data, now);
  assert.equal(result.coverage.collectedQuotes, 75);
  assert.equal(result.ok, false);
  assert.deepEqual(result.identity.headlineMismatches, ["SXTC"]);
  assert.deepEqual(result.identity.newsMismatches, ["SXTC"]);
});

test("quarantined historical evidence is visible but is not a promoted mismatch", () => {
  const data = snapshot();
  data.signals[0].quarantinedNews = [{ source: "CNBC", title: "Unrelated report" }];
  data.marketNews = [{ ticker: "WDC", name: "Western Digital", source: "CNBC", title: "Western Digital reports earnings" }];
  const result = marketHealth(data, now);
  assert.equal(result.ok, true);
  assert.deepEqual(result.identity.quarantinedTickers, ["T0"]);
  assert.match(result.warnings.join(" "), /not verified absence/);
  data.marketNews = {};
  assert.equal(marketHealth(data, now).ok, false);
  for (const row of [null, {}, { ticker: "WDC", title: "WDC rises", source: "Unknown" }, { ticker: "WDC", source: "CNBC" }]) {
    data.marketNews = [row];
    assert.equal(marketHealth(data, now).ok, false);
  }
});
