import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import quality from "../../data-quality.js";
import { aggregate, parseYahooMarket } from "../update-data.mjs";
import { marketHealth } from "../lib/market-health.mjs";

const now = new Date().toISOString();
const evidence = (ticker = "TEST", value = 400_000_000, patch = {}) => ({ version: 1, method: "provider-reported",
  ticker, value, currency: "USD", instrumentType: "EQUITY", provider: "Fixture provider", url: "https://example.org/cap",
  asOf: now, collectedAt: now, ...patch });
const signal = (patch = {}) => ({ ticker: "TEST", name: "Test Company", lastPrice: 10, quoteAsOf: now,
  marketMetricsVersion: 2, priceMove: 1, relativeVolume: 2, signalScore: 40, momentum: null, sentiment: null,
  sources: { "Price/Volume": 1 }, latest: [], ...patch });

test("legacy SEC-derived caps, arbitrary cap tiers and share counts cannot classify an issuer", () => {
  for (const ticker of ["SXTC", "GOOG", "GOOGL", "BKYI"]) {
    const raw = signal({ ticker, marketCap: 71_900, capTier: "small", sharesOutstanding: 2000, lastPrice: 500 });
    const safe = quality.normalizeSignal(raw);
    assert.equal(safe.marketCap, null); assert.equal(safe.capTier, null);
    assert.equal(safe.marketCapState, "unverified"); assert.equal(safe.unverifiedMarketCap, 71_900);
    assert.equal(raw.marketCap, 71_900, "raw historical record remains intact");
    assert.deepEqual(quality.normalizeSignal(safe), safe, "normalization must be idempotent");
  }
  assert.equal(quality.normalizeSignal(signal({ capTier: "large" })).capTier, null);
});

test("only attributable, ticker-matched, dated USD equity capitalization is usable", () => {
  const good = signal({ marketCapEvidence: evidence() });
  assert.equal(quality.capitalization(good).marketCap, 400_000_000);
  assert.equal(quality.capitalization(good).capTier, "small");
  assert.equal(quality.capitalization(signal({ marketCapEvidence: evidence("TEST", 500_000_000) })).capTier, "large");
  for (const patch of [{ version: 0 }, { method: "shares-times-price" }, { ticker: "OTHER" }, { instrumentType: "ETF" },
    { value: 0 }, { value: -1 }, { value: null }, { value: "10" }, { value: Infinity }, { value: NaN },
    { provider: "" }, { url: "javascript:alert(1)" }, { url: "https://secret@example.org/cap" }, { url: null },
    { asOf: null }, { asOf: "bad" }, { collectedAt: null }, { collectedAt: "bad" },
    { asOf: "2099-01-01", collectedAt: "2099-01-01" }, { collectedAt: "2000-01-01" }]) {
    const result = quality.capitalization(signal({ marketCapEvidence: evidence("TEST", 5, patch) }));
    assert.equal(result.marketCap, null, JSON.stringify(patch)); assert.equal(result.capTier, null);
  }
  assert.equal(quality.capitalization(signal({ marketCapEvidence: evidence("TEST", 5, { currency: "CAD" }) })).marketCapState, "unsupported-currency");
  assert.equal(quality.capitalization(signal({ instrumentType: "ETF", marketCapEvidence: evidence() })).marketCapState, "not-applicable");
});

test("a fresh quote cannot refresh stale capitalization or override its distinct date", () => {
  const row = signal({ marketCapEvidence: evidence("TEST", 5, { asOf: "2020-01-01T20:00:00Z" }) });
  assert.equal(quality.capitalization(row).marketCapState, "stale");
  assert.equal(quality.normalizeSignal(row).marketCap, null);
  const at = "2026-10-09T20:00:00Z";
  const weekend = signal({ marketCapEvidence: evidence("TEST", 5, { asOf: at, collectedAt: at }) });
  assert.equal(quality.capitalization(weekend, "2026-10-12T12:00:00Z").marketCap, 5);
  assert.equal(quality.capitalization(weekend, "2026-10-14T12:00:00Z").marketCap, null);
});

test("aggregation never carries a prior cap into a newer unknown observation", () => {
  const rows = quality.aggregateSignals([
    { date: "2026-10-12", signals: [signal({ marketCapEvidence: evidence() })] },
    { date: "2026-10-13", signals: [signal({ marketCap: 71900, capTier: "small" })] },
  ]);
  assert.equal(rows[0].marketCap, null); assert.equal(rows[0].capTier, null);
  const collected = aggregate([{ ...signal(), source: "Price/Volume", instrumentType: "ETF" }], { signals: [signal({ marketCapEvidence: evidence() })] });
  assert.equal(collected[0].instrumentType, "ETF");
  assert.equal(collected[0].marketCap, null); assert.equal(collected[0].marketCapState, "not-applicable");
});

test("Yahoo quote fields do not invent a capitalization observation or reuse quote time", () => {
  const meta = { symbol: "TEST", instrumentType: "EQUITY", regularMarketPrice: 10, regularMarketTime: Date.parse(now)/1000, marketCap: 100, sharesOutstanding: 20 };
  const result = parseYahooMarket({ chart: { result: [{ meta }] } }, "TEST");
  assert.equal(result.instrumentType, "EQUITY"); assert.equal(result.marketCap, undefined);
  assert.equal(result.marketCapEvidence, undefined, "undated extra fields are not proof of a dated capitalization");
  const collector = readFileSync(new URL("../update-data.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(collector, /fetchSharesOutstanding|enrichMarketCaps|shares \* signal\.lastPrice/);
});

function controller(enhanced) {
  let downloaded;
  const document = { getElementById: id => id === "tickerSearch" ? { value: "" } : id === "signaldesk-enhancement-styles" ? {} : null,
    querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click() {} }) };
  const context = vm.createContext({ document, window: { SIGNALDESK_QUALITY: quality }, localStorage: { getItem: () => null },
    URL: { createObjectURL: blob => { downloaded = blob; return "blob:test"; }, revokeObjectURL() {} },
    URLSearchParams, Intl, Date, Blob, console, location: { search: "", hash: "", pathname: "/" } });
  vm.runInContext(readFileSync(new URL("../../script.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, ""), context);
  if (enhanced) vm.runInContext(readFileSync(new URL("../../enhancements.js", import.meta.url), "utf8"), context);
  vm.runInContext("tickerHistory = () => [];", context);
  return { context, downloaded: () => downloaded };
}

for (const enhanced of [false, true]) test(`${enhanced ? "enhanced" : "fallback"} UI, filters, risk labels and CSV exclude legacy capitalization`, async () => {
  const { context: c, downloaded } = controller(enhanced);
  const old = signal({ marketCap: 71_900, capTier: "small" });
  const good = signal({ ticker: "GOOD", marketCapEvidence: evidence("GOOD", 20_000_000) });
  c.fixture = { generatedAt: now, signals: [old, good] };
  vm.runInContext('snapshot=fixture; history={snapshots:[]}; getState=()=>({sources:["Price/Volume"],query:"",start:"",end:""}); capFilter="small";', c);
  assert.deepEqual(Array.from(c.visibleSignals(), s => s.ticker), ["GOOD"]);
  vm.runInContext('capFilter="unknown";', c);
  assert.deepEqual(Array.from(c.visibleSignals(), s => s.ticker), ["TEST"]);
  assert.ok(!c.discoveryProfile(old).risks.includes("Micro-cap volatility"));
  assert.ok(c.discoveryProfile(old).risks.includes("Company size unknown"));
  assert.ok(c.discoveryProfile(good).risks.includes("Micro-cap volatility"));
  assert.doesNotMatch(c.formatQuoteCell(old), /71\.9K/);
  assert.match(c.detailMarkup(old, 1), /Unknown.*excluded from size filters/s);
  assert.match(c.detailMarkup(good, 1), /Fixture provider/);
  assert.match(c.detailMarkup(good, 1), /https:\/\/example.org\/cap/);
  c.exportCsv();
  const csv = await downloaded().text();
  assert.match(csv, /market_cap_usd,market_cap_state,market_cap_as_of/);
  assert.doesNotMatch(csv, /71900|Micro-cap volatility|GOOD/);
  assert.match(csv, /unverified/);
});

test("health check rejects unsupported raw capitalization but accepts honest unknowns", () => {
  const snapshot = { generatedAt: now, dataMode: "real-public-no-key", signals: [signal({ marketCap: 71_900, capTier: "small" })] };
  const bad = marketHealth(snapshot, now, { minTickers: 1 });
  assert.equal(bad.ok, false); assert.deepEqual(bad.capitalization.unsupported, ["TEST"]);
  snapshot.signals = snapshot.signals.map(quality.normalizeSignal);
  const safe = marketHealth(snapshot, now, { minTickers: 1 });
  assert.equal(safe.ok, true); assert.equal(safe.capitalization.unknown, 1);
  assert.match(safe.warnings.join(" "), /cannot classify/);
});

test("Unknown filter selection and reset stay visible to keyboard and screen-reader users", () => {
  const { context: c } = controller(false);
  const controls = Object.fromEntries(["capLarge", "capSmall", "capUnknown"].map(id => [id, {
    classList: { toggle(_name, value) { this.active = value; } }, setAttribute(name, value) { this[name] = value; },
  }]));
  c.controls = controls;
  vm.runInContext("document.getElementById = id => controls[id]; render = () => {};", c);
  for (const filter of ["unknown", "large", "small", "all"]) {
    c.setCapFilter(filter);
    for (const [id, value] of [["capLarge", "large"], ["capSmall", "small"], ["capUnknown", "unknown"]]) {
      assert.equal(controls[id]["aria-pressed"], String(filter === value));
      assert.equal(controls[id].classList.active, filter === value);
    }
  }
});
