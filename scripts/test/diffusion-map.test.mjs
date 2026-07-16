import { test } from "node:test";
import assert from "node:assert/strict";
import { twelveMonthReturn, extensionAboveMA, classifyMember, updateDiffusionStateHistory, computeDiffusionMap } from "../lib/diffusion-map.mjs";

test("twelveMonthReturn: computes a 252-session absolute return", () => {
  const closes = Array.from({ length: 260 }, (_, i) => 100 + i * 0.5); // steady climb
  const ret = twelveMonthReturn(closes);
  assert.ok(ret > 0.5, `expected a large positive return, got ${ret}`);
});

test("twelveMonthReturn: null without a full window of history", () => {
  const closes = Array.from({ length: 100 }, () => 100);
  assert.equal(twelveMonthReturn(closes), null);
});

test("extensionAboveMA: positive when price sits well above its 200d average", () => {
  const closes = [...Array.from({ length: 199 }, () => 100), 150];
  const ext = extensionAboveMA(closes);
  assert.ok(ext > 0.3, `expected >30% extension, got ${ext}`);
});

test("classifyMember: springs state 'coiled'/'dead' is authoritative regardless of price", () => {
  const closes = Array.from({ length: 300 }, () => 100);
  assert.equal(classifyMember(closes, "coiled"), "coiled");
  assert.equal(classifyMember(closes, "dead"), "dead");
});

test("classifyMember: a name up 50%+ and 30%+ extended above its 200d MA classifies as ran", () => {
  const closes = [...Array.from({ length: 252 }, (_, i) => 60 + i * 0.16), 160];
  const result = classifyMember(closes, undefined);
  assert.equal(result, "ran");
});

test("classifyMember: a released spring or a fresh 52-week high classifies as running", () => {
  const flatCloses = Array.from({ length: 300 }, () => 100);
  assert.equal(classifyMember(flatCloses, "released"), "running");

  // A modest late uptick to a genuine new high, but nowhere near Ran's 50%
  // 12mo-return / 30%-extension thresholds, so this isolates the Running path.
  const freshHigh = [...Array.from({ length: 290 }, () => 100), ...Array.from({ length: 10 }, (_, i) => 101 + i)];
  assert.equal(classifyMember(freshHigh, undefined), "running");
});

test("classifyMember: everything else defers to the caller as lagging-pending", () => {
  const flatCloses = Array.from({ length: 300 }, () => 100);
  assert.equal(classifyMember(flatCloses, undefined), "lagging-pending");
});

test("updateDiffusionStateHistory: resets the 'since' date when state changes, holds it when unchanged", () => {
  const first = updateDiffusionStateHistory({}, "SOFI", "lagging", "2026-01-01");
  assert.equal(first.since, "2026-01-01");
  assert.equal(first.days, 0);

  const held = updateDiffusionStateHistory({ SOFI: first }, "SOFI", "lagging", "2026-01-11");
  assert.equal(held.since, "2026-01-01");
  assert.equal(held.days, 10);

  const changed = updateDiffusionStateHistory({ SOFI: held }, "SOFI", "running", "2026-01-15");
  assert.equal(changed.since, "2026-01-15");
  assert.equal(changed.days, 0);
});

test("computeDiffusionMap: orders members ran -> running -> coiled -> lagging, skips themes with no classifiable member", () => {
  const spy = Array.from({ length: 300 }, () => 100);
  const ranCloses = [...Array.from({ length: 252 }, (_, i) => 60 + i * 0.16), 160];
  const laggingCloses = Array.from({ length: 300 }, (_, i) => 100 - i * 0.02); // drifting down -> lagging vs flat SPY
  const ledger = {
    tickers: {
      SPY: { rows: spy.map((c, i) => [`d${i}`, 0, 0, c, 1000, null]) },
      RAN1: { meta: { name: "Ran Co" }, rows: ranCloses.map((c, i) => [`d${i}`, 0, 0, c, 1000, null]) },
      LAG1: { meta: { name: "Lag Co" }, rows: laggingCloses.map((c, i) => [`d${i}`, 0, 0, c, 1000, null]) },
      THIN: { meta: { name: "Thin Co" }, rows: [["d0", 0, 0, 100, 1000, null]] }, // not enough history
    },
  };
  const registry = {
    themes: [
      { id: "t1", name: "Theme One", members: [{ t: "RAN1" }, { t: "LAG1" }, { t: "THIN" }] },
      { id: "t2", name: "Empty theme", members: [{ t: "NOPE" }] },
    ],
  };
  const { payload, nextStateHistory } = computeDiffusionMap(ledger, registry, new Map(), {}, "d299");
  assert.equal(payload.themes.length, 1);
  assert.equal(payload.themes[0].id, "t1");
  const states = payload.themes[0].members.map((m) => m.state);
  assert.deepEqual(states, ["ran", "lagging"]);
  assert.ok(nextStateHistory.RAN1);
  assert.ok(nextStateHistory.LAG1);
});
