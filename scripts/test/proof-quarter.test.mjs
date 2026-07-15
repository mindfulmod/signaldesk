import { test } from "node:test";
import assert from "node:assert/strict";
import { detectProofQuarter, trailingAvgVolume, computeProofQuarters, PROOF_QUARTER_GAP_THRESHOLD, PROOF_QUARTER_VOLUME_MULT } from "../lib/proof-quarter.mjs";

test("detectProofQuarter: fires only when gap, volume, and earnings vocabulary all align", () => {
  const base = { priceMove: 10, volume: 4_000_000, avgVolume60d: 1_000_000, headlineTexts: ["NVDA beats on guidance, raises outlook"] };
  const result = detectProofQuarter(base);
  assert.ok(result);
  assert.ok(result.volumeRatio >= PROOF_QUARTER_VOLUME_MULT);

  assert.equal(detectProofQuarter({ ...base, priceMove: PROOF_QUARTER_GAP_THRESHOLD - 1 }), null, "gap too small");
  assert.equal(detectProofQuarter({ ...base, volume: 2_000_000 }), null, "volume surge too small");
  assert.equal(detectProofQuarter({ ...base, headlineTexts: ["Stock moved for unrelated reasons"] }), null, "no earnings vocabulary");
  assert.equal(detectProofQuarter({ ...base, headlineTexts: [] }), null, "no headlines at all");
});

test("trailingAvgVolume: averages the trailing window excluding today's own row", () => {
  const rows = Array.from({ length: 65 }, (_, i) => [`d${i}`, 0, 0, 100, i < 64 ? 1_000_000 : 50_000_000]);
  const avg = trailingAvgVolume(rows, 60);
  assert.ok(avg < 2_000_000, `expected today's huge volume to be excluded from the average, got ${avg}`);
});

test("trailingAvgVolume: null when there isn't enough history", () => {
  const rows = Array.from({ length: 10 }, (_, i) => [`d${i}`, 0, 0, 100, 1_000_000]);
  assert.equal(trailingAvgVolume(rows, 60), null);
});

test("computeProofQuarters: detects a new leader, elevates GICS siblings and co-mention neighbors, dedupes an already-active leader", () => {
  const priorRows = Array.from({ length: 60 }, (_, i) => [`d${i}`, 0, 0, 100, 1_000_000]);
  const ledger = {
    tickers: {
      NVDA: { rows: [...priorRows, ["d60", 5, 0.01, 130, 5_000_000, null]] },
    },
  };
  const events = [
    { ticker: "NVDA", source: "Price/Volume", priceMove: 10, volume: 5_000_000, url: "https://finance.yahoo.com/quote/NVDA" },
    { ticker: "NVDA", source: "GDELT News", title: "NVDA beats and raises guidance for next quarter", url: "https://news/1" },
  ];
  const gicsByTicker = { NVDA: { sub: "Semiconductors" }, AMD: { sub: "Semiconductors" }, AAPL: { sub: "Technology Hardware" } };
  const coMentionEdges = new Map([["AVGO|NVDA", 5]]);

  const result = computeProofQuarters({
    events,
    ledger,
    gicsByTicker,
    coMentionEdges,
    prevLeaders: { leaders: [] },
    dateStr: "2026-01-01",
  });

  assert.equal(result.newLeaders.length, 1);
  assert.equal(result.newLeaders[0].ticker, "NVDA");
  assert.deepEqual(result.newLeaders[0].siblings, ["AMD"]);
  assert.deepEqual(result.newLeaders[0].coMentionNeighbors, ["AVGO"]);
  assert.ok(result.hotMonitorPayload.tickers.AMD);
  assert.ok(result.hotMonitorPayload.tickers.AVGO);
  assert.equal(result.leadersPayload.leaders.length, 1);

  // Re-running with NVDA already an active (non-expired) leader should not re-trigger it.
  const second = computeProofQuarters({
    events,
    ledger,
    gicsByTicker,
    coMentionEdges,
    prevLeaders: result.leadersPayload,
    dateStr: "2026-01-02",
  });
  assert.equal(second.newLeaders.length, 0);
  assert.equal(second.leadersPayload.leaders.length, 1);
});

test("computeProofQuarters: an expired leader is pruned and can re-trigger", () => {
  const prevLeaders = { leaders: [{ ticker: "NVDA", detectedDate: "2025-01-01", expiresDate: "2025-06-01", siblings: [], coMentionNeighbors: [] }] };
  const priorRows = Array.from({ length: 60 }, (_, i) => [`d${i}`, 0, 0, 100, 1_000_000]);
  const ledger = { tickers: { NVDA: { rows: [...priorRows, ["d60", 5, 0.01, 130, 5_000_000, null]] } } };
  const events = [
    { ticker: "NVDA", source: "Price/Volume", priceMove: 10, volume: 5_000_000, url: "x" },
    { ticker: "NVDA", source: "GDELT News", title: "NVDA raises guidance", url: "https://news/1" },
  ];
  const result = computeProofQuarters({ events, ledger, gicsByTicker: {}, coMentionEdges: new Map(), prevLeaders, dateStr: "2026-07-01" });
  assert.equal(result.newLeaders.length, 1);
  assert.equal(result.leadersPayload.leaders.length, 1); // old expired one dropped, new one added
});
