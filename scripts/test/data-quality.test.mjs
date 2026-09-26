import { test } from "node:test";
import assert from "node:assert/strict";
import quality from "../../data-quality.js";
import watchlist from "../../adoption-watchlist.js";
const now = "2026-09-25T22:30:00Z";

test("quote freshness rejects missing and stale data but tolerates weekends", () => {
  assert.equal(quality.quoteState({ lastPrice: null, quoteAsOf: now }, now), "missing");
  assert.equal(quality.quoteState({ lastPrice: 4.35, quoteAsOf: "2026-08-14T20:00:00Z" }, now), "stale");
  assert.equal(quality.quoteState({ lastPrice: 4, quoteAsOf: now }, now), "current");
  assert.equal(quality.quoteState({ lastPrice: 4 }, now), "stale");
  assert.equal(quality.quoteState({ lastPrice: 4, quoteAsOf: "2026-09-25T20:00:00Z" }, "2026-09-28T12:00:00Z"), "current");
});
test("news excludes stale, undated, future and generic valuation pages", () => {
  for (const entry of [
    { title: "Company reports earnings", published: "2026-07-26T12:00:00Z" },
    { title: "Price to earnings forward of ZW Data", published: now },
    { title: "TDIC.O Forecast — Price Prediction for 2026. Should I Buy?", published: now },
    { title: "Company reports earnings", published: "bad date" },
    { title: "Company reports earnings", published: "2026-10-01T12:00:00Z" },
  ]) assert.equal(quality.usableNews(entry, now), false, entry.title);
  assert.equal(quality.usableNews({ title: "Company reports Q2 earnings", published: now }, now), true);
});
test("price moves, forecasts and short interest are not earnings results", () => {
  for (const text of ["SCHMID surges after Nvidia considers glass substrates", "HCW Biologics Stock Short Interest Rises to 58.43%", "TDIC.O Forecast — Price Prediction", "Price to earnings forward of ZW Data"]) assert.equal(quality.earningsHeadline(text), false, text);
  for (const text of ["NVDA beats earnings estimates", "Acme raises full-year revenue guidance", "Capstone Reports Q2 2026 Results: Revenue Up 67%", "Acme reaffirmed guidance"]) assert.equal(quality.earningsHeadline(text), true, text);
});
test("source coverage handles collapsed failures and distinguishes no matches from outages", () => {
  const statuses = quality.sourceHealth({ generatedAt: now, signals: [{ sources: { StockTwits: 4, "Price/Volume": 1 } }], failures: ["2x StockTwits <ticker>: 404 Not Found", "GDELT News: fetch failed"] });
  const row = name => statuses.find(s => s.source === name);
  assert.equal(row("StockTwits").state, "partial");
  assert.equal(row("Price/Volume").state, "covered");
  assert.equal(row("GDELT News").state, "unavailable");
  assert.equal(row("CNBC").state, "no-matches");
  assert.equal(row("Nasdaq").state, "paused");
});
test("every adoption observation has period, provenance and a caveat", () => {
  const ids = new Set();
  for (const theme of watchlist.themes) {
    assert.ok(theme.risk && theme.nextCheck);
    for (const e of theme.evidence) {
      assert.ok(!ids.has(e.id)); ids.add(e.id);
      assert.ok(e.metric && e.period && e.caveat && e.qualifier && e.unit);
      assert.equal(new URL(e.url).protocol, "https:");
      assert.ok(Number.isFinite(Date.parse(e.publishedAt)) && Number.isFinite(Date.parse(e.checkedAt)));
      assert.ok(e.value === null || Number.isFinite(e.value));
    }
  }
});

test("saved source health survives a truncated failure summary", () => {
  const lastSeen = "2026-09-24T22:30:00Z";
  const sourceHealth = quality.sourceHealth({ generatedAt: now, signals: [{ sources: { StockTwits: 4 } }], failures: ["StockTwits ABC: timeout", "GDELT News: fetch failed"] }, [], [{ source: "GDELT News", lastSeen }]);
  const reloaded = quality.sourceHealth({ generatedAt: now, signals: [{ sources: { StockTwits: 4 } }], failures: [], sourceHealth });
  assert.equal(reloaded.find(row => row.source === "StockTwits").state, "partial");
  assert.equal(reloaded.find(row => row.source === "GDELT News").state, "unavailable");
  assert.equal(reloaded.find(row => row.source === "GDELT News").lastSeen, lastSeen);
});
