import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import model from "../../research-model.js";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import { researchHealth } from "../lib/research-health.mjs";
import { yahooQuote, alphaQuote, stooqQuote, collectCompanies } from "../lib/company-intelligence.mjs";
import { companyQuoteFixture } from "./helpers/company-quote.mjs";
const now = "2026-10-14T01:00:00Z", row = () => companyQuoteFixture("QS", now);
test("company quotes require more than a recent timestamp", () => {
  assert.equal(model.companyQuote(row(), "QS", Date.parse(now)).current, true);
  for (const price of [null, undefined, NaN, Infinity, 0, -1, "5", true]) {
    const bad = row(); bad.quote.price = price;
    assert.equal(model.companyQuote(bad, "QS", Date.parse(now)).usable, false);
  }
  for (const patch of [{ ticker: "SLDP" }, { quoteCheckedAt: null }, { quoteCheckedAt: "2026-10-15T01:00:00Z" }, { quoteCheckedAt: "2026-10-01T01:00:00Z" }]) assert.equal(model.companyQuote({ ...row(), ...patch }, "QS", Date.parse(now)).usable, false);
  for (const patch of [{ currency: "" }, { currency: "GBp" }, { provider: " " }, { url: "https://user:password@example.org" }, { asOf: "2026-02-30", precision: "day" }, { asOf: "2026-10-15T01:00:00Z" }, { precision: "day" }, { asOf: null }]) {
    const bad = row(); Object.assign(bad.quote, patch);
    assert.equal(model.companyQuote(bad, "QS", Date.parse(now)).usable, false);
  }
});
test("historical quotes remain inspectable but cannot count as current", () => {
  const old = companyQuoteFixture("QS", "2026-10-01T12:00:00Z");
  assert.deepEqual([model.companyQuote(old, "QS", Date.parse(now)).usable, model.companyQuote(old, "QS", Date.parse(now)).current], [true, false]);
  const daily = companyQuoteFixture("QS", "2026-10-13"); daily.quoteCheckedAt = now;
  assert.equal(model.companyQuote(daily, "QS", Date.parse(now)).current, true);
});
test("watchdog rejects timestamp-only prices and unsupported capitalization", () => {
  const scope = { sources: [{ id: "source" }], companies: [{ ticker: "QS" }] };
  const research = { generatedAt: now, coverage: { totalSources: 1 }, companies: { QS: row() } };
  const monitor = { sources: { source: { id: "source", status: "ok", lastSuccessAt: now } } };
  assert.equal(researchHealth(research, monitor, Date.parse(now), scope).quoteCoverage, "1/1");
  research.companies.QS.quote.price = null;
  const bad = researchHealth(research, monitor, Date.parse(now), scope);
  assert.equal(bad.ok, false); assert.equal(bad.quoteCoverage, "0/1"); assert.match(bad.warnings.join(" "), /Price withheld/);
  research.companies.QS = { ...row(), valuation: { marketCap: 100, asOf: now } };
  assert.match(researchHealth(research, monitor, Date.parse(now), scope).errors.join(" "), /unsupported capitalization/);
});
test("quote adapters reject impossible dates and do not turn price metadata into capitalization", () => {
  const meta = { symbol: "QS", regularMarketPrice: 5, regularMarketTime: Date.parse(now) / 1000, currency: "USD", marketCap: 999 };
  assert.equal(yahooQuote({ chart: { result: [{ meta }] } }, "QS", now).marketCap, null);
  assert.throws(() => yahooQuote({ chart: { result: [{ meta: { ...meta, regularMarketPrice: true } }] } }, "QS", now));
  assert.throws(() => alphaQuote({ "Global Quote": { "01. symbol": "QS", "05. price": "5", "07. latest trading day": "2026-02-30" } }, "QS", now), /date/);
  assert.throws(() => stooqQuote("QS.US,2026-02-30,22:00,1,2,1,5,20", "QS", now), /date/);
});
test("collection removes legacy valuation even when quotes use the cache", async () => {
  const previous = { companies: { QS: { ...row(), quoteAttemptAt: now, factsVersion: 3, factsCheckedAt: now, valuation: { marketCap: 999, asOf: now } } } };
  const result = await collectCompanies({ companies: [{ ticker: "QS" }] }, {}, previous, { now, fetchImpl: async () => { throw Error("must use cache"); }, sleep: async () => {} });
  assert.equal(result.companies.QS.valuation, null);
});
test("a valid refresh repairs an invalid retained quote instead of preserving its future timestamp", async () => {
  const broken = row(); broken.quote.asOf = "2027-01-01T00:00:00Z";
  const previous = { companies: { QS: { ...broken, quoteAttemptAt: "2026-10-01T00:00:00Z", factsVersion: 3, factsCheckedAt: now } } };
  const result = await collectCompanies({ companies: [{ ticker: "QS" }] }, {}, previous, { now, sleep: async () => {}, fetchImpl: async () => new Response(JSON.stringify({ chart: { result: [{ meta: { symbol: "QS", regularMarketPrice: 7, regularMarketTime: Date.parse(now) / 1000, currency: "USD" } }] } }), { headers: { "content-type": "application/json" } }) });
  assert.equal(result.companies.QS.quote.price, 7);
  assert.equal(model.companyQuote(result.companies.QS, "QS", Date.parse(now)).current, true);
});
test("company cards and profiles withhold invalid prices and legacy capitalization", () => {
  const context = { window: { SIGNALDESK_RESEARCH_MODEL: model, SIGNALDESK_RESEARCH_CONFIG: config }, Intl, URL, Date };
  vm.runInNewContext(readFileSync(new URL("../../research-views.js", import.meta.url), "utf8"), context);
  const bad = row(); bad.quote.price = 987654; bad.ticker = "WRONG"; bad.valuation = { marketCap: 123456789, currency: "USD", asOf: now };
  for (const ticker of [null, "QS"]) {
    const html = context.window.SIGNALDESK_RESEARCH_VIEWS.companies(registry.themes, { companies: { QS: bad } }, ticker);
    assert.match(html, /Price withheld/); assert.doesNotMatch(html, /987|123\.46|Provider-reported market capitalization/);
    assert.match(html, /Inspect quote source/);
  }
});
