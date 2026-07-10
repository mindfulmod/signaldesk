import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpringEvents, detectThemeEvents, nextSpringStateMap, nextThemeStageMap, isoWeekKey } from "../lib/alerts.mjs";

test("detectSpringEvents: fires a release event when state transitions to released", () => {
  const prev = { SOFI: "coiled" };
  const current = [{ ticker: "SOFI", state: "released", regimeStart: "2026-01-01", regimeEnd: "2026-03-01" }];
  const events = detectSpringEvents(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "release");
  assert.equal(events[0].priority, "high");
});

test("detectSpringEvents: no event when state is unchanged (dedupe)", () => {
  const prev = { SOFI: "coiled" };
  const current = [{ ticker: "SOFI", state: "coiled" }];
  assert.deepEqual(detectSpringEvents(prev, current), []);
});

test("detectSpringEvents: new coil only alerts when inside a hot theme", () => {
  const prev = {};
  const current = [{ ticker: "COHR", state: "coiled", sector: "Information Technology" }];
  const withoutHotTheme = detectSpringEvents(prev, current, new Set());
  assert.equal(withoutHotTheme.length, 0);

  const withHotTheme = detectSpringEvents(prev, current, new Set(["COHR"]));
  assert.equal(withHotTheme.length, 1);
  assert.equal(withHotTheme[0].type, "new-coil-hot-theme");
});

test("detectSpringEvents: dead coil demotion fires regardless of theme", () => {
  const prev = { ALB: "coiled" };
  const current = [{ ticker: "ALB", state: "dead", regimeStart: "2023-01-01", regimeEnd: "2023-03-01", regimeSessions: 40 }];
  const events = detectSpringEvents(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "dead-coil");
  assert.equal(events[0].priority, "normal");
});

test("detectThemeEvents: transition to diffusion is high priority, first-seen is not alerted", () => {
  const prev = { "ai-power": "naming" };
  const current = [{ id: "ai-power", name: "AI power", stage: "diffusion" }];
  const events = detectThemeEvents(prev, current);
  assert.equal(events.length, 1);
  assert.equal(events[0].priority, "high");

  // A theme with no prior recorded stage (first time it becomes computable) should not alert.
  const firstSeen = detectThemeEvents({}, [{ id: "photonics", name: "Photonics", stage: "wave" }]);
  assert.deepEqual(firstSeen, []);
});

test("detectThemeEvents: transitions into quiet/insufficient-data are not alert-worthy", () => {
  const prev = { "ai-power": "wave" };
  const current = [{ id: "ai-power", name: "AI power", stage: "quiet" }];
  assert.deepEqual(detectThemeEvents(prev, current), []);
});

test("nextSpringStateMap / nextThemeStageMap: round-trip into the shape detectors expect", () => {
  const springs = [{ ticker: "A", state: "coiled" }, { ticker: "B", state: "released" }];
  assert.deepEqual(nextSpringStateMap(springs), { A: "coiled", B: "released" });

  const themes = [{ id: "t1", stage: "naming" }];
  assert.deepEqual(nextThemeStageMap(themes), { t1: "naming" });
});

test("isoWeekKey: same calendar week maps to the same key regardless of day", () => {
  const monday = new Date("2026-07-06T12:00:00Z");
  const friday = new Date("2026-07-10T12:00:00Z");
  assert.equal(isoWeekKey(monday), isoWeekKey(friday));

  const nextMonday = new Date("2026-07-13T12:00:00Z");
  assert.notEqual(isoWeekKey(monday), isoWeekKey(nextMonday));
});
