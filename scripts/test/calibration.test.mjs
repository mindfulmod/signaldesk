import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findCloseNear,
  isHorizonReachable,
  addDaysStr,
  themeRelativeReturn,
  buildLogEntries,
  updateCalibrationLog,
  pendingSubjects,
  aggregateCalibration,
  GRADING_HORIZONS,
} from "../lib/calibration.mjs";

test("findCloseNear: picks the closest row within tolerance, null outside it", () => {
  const rows = [
    ["2026-01-01", 0, 0, 100, 0, null],
    ["2026-01-05", 0, 0, 110, 0, null],
    ["2026-01-10", 0, 0, 120, 0, null],
  ];
  assert.equal(findCloseNear(rows, "2026-01-06"), 110);
  assert.equal(findCloseNear(rows, "2026-02-01"), null);
});

test("addDaysStr / isHorizonReachable: horizon math is calendar-day based", () => {
  assert.equal(addDaysStr("2026-01-01", 30), "2026-01-31");
  assert.equal(isHorizonReachable("2026-01-01", 30, "2026-01-31"), true);
  assert.equal(isHorizonReachable("2026-01-01", 30, "2026-01-20"), false);
});

test("themeRelativeReturn: rewards members that beat SPY, penalizes those that lag", () => {
  const ledger = {
    tickers: {
      SPY: { rows: [["2026-01-01", 0, 0, 500, 0, null], ["2026-04-01", 0, 0, 550, 0, null]] }, // +10%
      A: { rows: [["2026-01-01", 0, 0, 10, 0, null], ["2026-04-01", 0, 0, 15, 0, null]] }, // +50%
      B: { rows: [["2026-01-01", 0, 0, 10, 0, null], ["2026-04-01", 0, 0, 11, 0, null]] }, // +10%
    },
  };
  const rel = themeRelativeReturn(["A", "B"], ledger, "2026-01-01", "2026-04-01");
  // avg member return = (0.5 + 0.1)/2 = 0.30; spy = 0.10; rel = 0.20
  assert.ok(Math.abs(rel - 0.2) < 0.001, `expected ~0.20, got ${rel}`);
});

test("buildLogEntries: only release/dead-coil spring events and theme-stage events are gradable", () => {
  const springEvents = [
    { type: "release", ticker: "SOFI" },
    { type: "dead-coil", ticker: "ALB" },
    { type: "new-coil-hot-theme", ticker: "COHR" }, // not gradable on its own
  ];
  const themeEvents = [{ type: "theme-stage-transition", theme: "ai-power", toStage: "wave" }];
  const ledger = { tickers: { SOFI: { rows: [["2026-01-01", 0, 0, 18, 0, null]] }, ALB: { rows: [["2026-01-01", 0, 0, 90, 0, null]] } } };
  const entries = buildLogEntries({ springEvents, themeEvents, ledger, dateStr: "2026-01-01" });
  assert.equal(entries.length, 3);
  assert.ok(entries.some((e) => e.type === "release" && e.ticker === "SOFI" && e.basePrice === 18));
  assert.ok(entries.some((e) => e.type === "dead-coil" && e.ticker === "ALB"));
  assert.ok(entries.some((e) => e.type === "theme-stage" && e.theme === "ai-power" && e.stage === "wave"));
});

test("updateCalibrationLog: dedupes by id, grades reachable horizons, leaves unreachable ones ungraded", () => {
  const rows = [["2026-01-01", 0, 0, 100, 0, null], ["2026-02-01", 0, 0, 120, 0, null]];
  const ledger = { tickers: { SOFI: { rows } } };
  const registry = { themes: [] };
  const entry = { id: "release-SOFI-2026-01-01", type: "release", ticker: "SOFI", theme: null, stage: null, date: "2026-01-01", basePrice: 100, graded: {} };

  const log1 = updateCalibrationLog({ entries: [] }, [entry], ledger, registry, "2026-02-01");
  assert.equal(log1.entries.length, 1);
  assert.ok(Math.abs(log1.entries[0].graded["30d"] - 0.2) < 1e-9); // 120/100 - 1
  assert.ok(!("90d" in log1.entries[0].graded), "90d horizon not reached yet");

  // Re-running with the same (already-logged) entry should not duplicate it.
  const log2 = updateCalibrationLog(log1, [entry], ledger, registry, "2026-02-01");
  assert.equal(log2.entries.length, 1);
});

test("pendingSubjects: only lists tickers/themes with at least one ungraded horizon", () => {
  const horizonLabels = Object.keys(GRADING_HORIZONS);
  const fullyGraded = Object.fromEntries(horizonLabels.map((l) => [l, 0.1]));
  const log = {
    entries: [
      { id: "1", ticker: "DONE", theme: null, graded: fullyGraded },
      { id: "2", ticker: "PENDING", theme: null, graded: {} },
      { id: "3", ticker: null, theme: "ai-power", graded: {} },
    ],
  };
  const { tickers, themes } = pendingSubjects(log);
  assert.ok(tickers.has("PENDING"));
  assert.ok(!tickers.has("DONE"));
  assert.ok(themes.has("ai-power"));
});

test("aggregateCalibration: computes win rate and median return per state/stage", () => {
  const log = {
    entries: [
      { type: "release", ticker: "A", theme: null, stage: null, graded: { "30d": 0.1, "90d": 0.3 } },
      { type: "release", ticker: "B", theme: null, stage: null, graded: { "30d": -0.05 } },
      { type: "dead-coil", ticker: "C", theme: null, stage: null, graded: { "30d": -0.1 } },
    ],
  };
  const result = aggregateCalibration(log);
  assert.equal(result.summary.release.n, 2);
  assert.equal(result.summary.release.horizons["30d"].graded, 2);
  assert.equal(result.summary.release.horizons["30d"].winRate, 0.5);
  assert.equal(result.summary["dead-coil"].horizons["30d"].winRate, 0);
  assert.equal(result.totalEvents, 3);
});
