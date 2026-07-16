import { test } from "node:test";
import assert from "node:assert/strict";
import {
  persistenceSeries,
  compressionSeries,
  mergeRegimes,
  releaseTriggerAt,
  classifyTicker,
  PERSISTENCE_THRESHOLD,
} from "../lib/coil-detector.mjs";

test("persistenceSeries: fraction of hot days in the trailing window", () => {
  const hot = new Array(60).fill(false);
  hot[59] = true;
  assert.equal(persistenceSeries(hot).at(-1), 1 / 60);

  const hot2 = new Array(60).fill(false).map((_, i) => i >= 20); // last 40 of 60 are hot
  assert.equal(persistenceSeries(hot2).at(-1), 40 / 60);

  const allHot = new Array(60).fill(true);
  assert.equal(persistenceSeries(allHot).at(-1), 1);
});

test("compressionSeries: a tight window after a volatile trailing year ranks low percentile", () => {
  const volatile = Array.from({ length: 200 }, (_, i) => 100 + 15 * Math.sin(i * 0.3));
  const tight = Array.from({ length: 60 }, (_, i) => 100 + 0.2 * Math.sin(i * 0.5));
  const closes = [...volatile, ...tight];
  const compression = compressionSeries(closes);
  const last = compression.at(-1);
  assert.ok(last.range < 0.01, `expected a tight range, got ${last.range}`);
  assert.ok(last.percentile <= 15, `expected a low percentile, got ${last.percentile}`);
});

test("compressionSeries: requires a full window before producing a value", () => {
  const closes = Array.from({ length: 30 }, () => 100);
  const compression = compressionSeries(closes, { rangeWindow: 60 });
  assert.ok(compression.every((c) => c.range === null));
});

test("mergeRegimes: bridges short gaps, drops runs under the session minimum", () => {
  const qualifies = [
    ...new Array(10).fill(true), // run of 10 (below minSessions=15 on its own)
    ...new Array(5).fill(false), // gap of 5 (<= tolerance of 10) -> should bridge
    ...new Array(10).fill(true), // run of 10 -> merged total 20 sessions
    ...new Array(20).fill(false), // big gap
    ...new Array(5).fill(true), // isolated short run -> filtered out
  ];
  const regimes = mergeRegimes(qualifies, { gapTolerance: 10, minSessions: 15 });
  assert.equal(regimes.length, 1);
  assert.equal(regimes[0].sessions, 20);
  assert.equal(regimes[0].start, 0);
  assert.equal(regimes[0].end, 24);
});

test("mergeRegimes: does not bridge gaps beyond tolerance", () => {
  const qualifies = [...new Array(20).fill(true), ...new Array(11).fill(false), ...new Array(20).fill(true)];
  const regimes = mergeRegimes(qualifies, { gapTolerance: 10, minSessions: 15 });
  assert.equal(regimes.length, 2);
});

test("releaseTriggerAt: fires only when both price breakout and volume surge align", () => {
  const closes = [...Array.from({ length: 60 }, () => 100), 105];
  const highVolume = [...Array.from({ length: 60 }, () => 1_000_000), 2_000_000];
  assert.equal(releaseTriggerAt(closes, highVolume, 60), true);

  const lowVolume = [...Array.from({ length: 60 }, () => 1_000_000), 1_100_000];
  assert.equal(releaseTriggerAt(closes, lowVolume, 60), false, "volume surge required");

  const noBreakout = [...Array.from({ length: 60 }, () => 100), 99];
  assert.equal(releaseTriggerAt(noBreakout, highVolume, 60), false, "price breakout required");
});

// ---- End-to-end fixtures -------------------------------------------------

function buildCoilingFixture() {
  const days = 300;
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const date = `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    // Attention: quiet baseline, then a sustained hot block from day 190-269.
    const mentions = i >= 190 && i < 270 ? 30 : 10 + (i % 5);
    // Price: volatile early (builds contrast for the percentile), then tight
    // (coiling) from day 150-269, then a breakout with a volume spike at 270.
    let close;
    if (i < 150) close = 100 + 15 * Math.sin(i * 0.3);
    else if (i < 270) close = 100 + 0.2 * Math.sin(i * 0.5);
    else close = 130 + (i - 270) * 0.5;
    const volume = i === 270 ? 6_000_000 : 1_000_000 + (i % 7) * 10_000;
    rows.push([date, mentions, mentions / 1000, close, volume, mentions * 300]);
  }
  return { meta: { name: "COIL", firstSeen: rows[0][0] }, rows };
}

function buildNonCoilingFixture() {
  const days = 300;
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    const date = `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`;
    // Attention spikes for a single isolated day every 10 days -- never a
    // sustained 60%-of-60-session persistence.
    const mentions = i % 10 === 0 ? 30 : 10;
    // Price stays wide/volatile throughout -- never compresses.
    const close = 100 + 12 * Math.sin(i * 0.25);
    const volume = 1_000_000 + (i % 5) * 20_000;
    rows.push([date, mentions, mentions / 1000, close, volume, mentions * 300]);
  }
  return { meta: { name: "NOCOIL", firstSeen: rows[0][0] }, rows };
}

test("classifyTicker: sustained attention + compression + breakout classifies as released", () => {
  const result = classifyTicker(buildCoilingFixture());
  assert.ok(result, "expected a classification, got null");
  assert.equal(result.state, "released");
  assert.ok(result.persistence >= PERSISTENCE_THRESHOLD);
  assert.ok(result.compressionPercentile <= 35);
  assert.ok(result.releaseDate);
});

test("classifyTicker: isolated attention spikes and no compression never coils", () => {
  const result = classifyTicker(buildNonCoilingFixture());
  assert.equal(result, null);
});
