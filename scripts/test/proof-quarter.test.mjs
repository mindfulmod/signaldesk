import { test } from "node:test";
import assert from "node:assert/strict";
import { detectProofQuarter, trailingAvgVolume, computeProofQuarters, orderByEvidence, PROOF_QUARTER_GAP_THRESHOLD } from "../lib/proof-quarter.mjs";
const now = "2026-09-25T23:59:59Z";
const news = { text: "NVDA beats earnings and raises guidance", isNews: true, published: "2026-09-25T13:00:00Z", url: "https://example.com/earnings" };
const base = { priceMove: 10, volume: 4_000_000, avgVolume60d: 1_000_000, headlineTexts: [news], now };

test("proof quarter requires unchanged market thresholds and recent reported results", () => {
  assert.ok(detectProofQuarter(base));
  assert.equal(detectProofQuarter({ ...base, priceMove: PROOF_QUARTER_GAP_THRESHOLD - 1 }), null);
  assert.equal(detectProofQuarter({ ...base, volume: 2_000_000 }), null);
  assert.equal(detectProofQuarter({ ...base, avgVolume60d: 0 }), null);
  assert.equal(detectProofQuarter({ ...base, headlineTexts: [] }), null);
});
test("stale, undated, social and generic forecast matches never create leaders", () => {
  for (const headline of [
    { ...news, published: "2026-07-26T12:00:00Z" }, { ...news, published: undefined },
    { ...news, isNews: false }, { ...news, text: "Price to earnings forward of ZW Data" },
    { ...news, text: "TDIC.O Forecast — Price Prediction" },
    { ...news, text: "SCHMID surges after Nvidia considers glass substrates" }, "NVDA beats earnings",
  ]) assert.equal(detectProofQuarter({ ...base, headlineTexts: [headline] }), null);
});
test("trailing average excludes today's volume and requires enough history", () => {
  const rows = Array.from({ length: 65 }, (_, i) => [`d${i}`, 0, 0, 100, i < 64 ? 1_000_000 : 50_000_000]);
  assert.equal(trailingAvgVolume(rows), 1_000_000);
  assert.equal(trailingAvgVolume(rows.slice(0, 10)), null);
});
test("evidence ordering retains publication time and URL", () => {
  const ordered = orderByEvidence([{ title: "chatter", source: "StockTwits" }, { title: news.text, source: "Google News", published: news.published, url: news.url }], new Set(["Google News"]));
  assert.equal(ordered[0].isNews, true);
  assert.equal(ordered[0].published, news.published);
  assert.equal(ordered[0].url, news.url);
  assert.equal(ordered[1].isNews, false);
});
function fixture() {
  return {
    events: [
      { ticker: "NVDA", source: "Price/Volume", priceMove: 10, volume: 5_000_000, lastPrice: 130, quoteAsOf: "2026-09-25T20:00:00Z" },
      { ticker: "NVDA", source: "Google News", title: news.text, published: news.published, url: news.url },
    ],
    ledger: { tickers: { NVDA: { rows: Array.from({ length: 61 }, (_, i) => [`d${i}`, 0, 0, 100, i === 60 ? 5_000_000 : 1_000_000]) } } },
    gicsByTicker: { NVDA: { sub: "Semiconductors" }, AMD: { sub: "Semiconductors" } },
    coMentionEdges: new Map([["AVGO|NVDA", 5]]), prevLeaders: { leaders: [] }, dateStr: "2026-09-25", newsSources: new Set(["Google News"]), now,
  };
}
test("verified leaders retain provenance, elevate siblings, dedupe and expire", () => {
  const input = fixture();
  const result = computeProofQuarters(input);
  assert.equal(result.newLeaders.length, 1);
  assert.equal(result.newLeaders[0].evidenceVersion, 2);
  assert.equal(result.newLeaders[0].headlineUrl, news.url);
  assert.deepEqual(result.newLeaders[0].siblings, ["AMD"]);
  assert.deepEqual(result.newLeaders[0].coMentionNeighbors, ["AVGO"]);
  assert.ok(result.hotMonitorPayload.tickers.AMD);
  assert.equal(computeProofQuarters({ ...input, prevLeaders: result.leadersPayload }).newLeaders.length, 0);
  const expired = { leaders: [{ ...result.newLeaders[0], expiresDate: "2026-09-24" }] };
  assert.equal(computeProofQuarters({ ...input, prevLeaders: expired }).newLeaders.length, 1);
});
test("stale quotes cannot trigger; legacy leaders no longer expand coverage", () => {
  const input = fixture();
  input.events[0].quoteAsOf = "2026-08-14T20:00:00Z";
  input.prevLeaders.leaders = [{ ticker: "CNET", expiresDate: "2027-01-01", siblings: ["FAKE"], coMentionNeighbors: [] }];
  const result = computeProofQuarters(input);
  assert.equal(result.newLeaders.length, 0);
  assert.equal(result.leadersPayload.leaders.length, 0);
  assert.deepEqual(result.hotMonitorPayload.tickers, {});
});
