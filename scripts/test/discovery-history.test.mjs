import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryHistory, recordDiscoveryDay } from "../lib/discovery-history.mjs";
import { discoverTopics } from "../lib/research-intelligence.mjs";
import { researchHealth } from "../lib/research-health.mjs";
const sources = ["lab", "community"].map(id => ({ id, url: `https://example.org/${id}`, owner: id, format: "rss", tier: id === "lab" ? "research" : "community", mode: "links", quietAfterDays: 7 }));
const states = checkedAt => Object.fromEntries(sources.map(s => [s.id, { status: "ok", sourceUrl: s.url, extractorVersion: 4, lastSuccessAt: checkedAt, newestPublicationAt: checkedAt, matchedItems: 5, datedItems: 5 }]));
const now = "2026-10-14T12:00:00Z";
const start = (checks = states(now), previous = {}, time = now, scope = sources) => discoveryHistory(scope, checks, previous, time);
const save = audit => ({ ...audit, history: recordDiscoveryDay(audit, ["topic"], 10) });

test("cached successful checks cannot mint a new Toronto collection day", () => {
  const checked = "2026-10-14T03:00:00Z", first = save(start(states(checked), {}, checked));
  assert.equal(first.history[0].date, "2026-10-13");
  const next = start(states(checked), first, "2026-10-14T05:00:00Z");
  assert.equal(next.healthy, true); assert.equal(next.collectedToday, false);
  assert.deepEqual(recordDiscoveryDay(next, [], 10), first.history);
});
test("all sources need actual same-day dated samples, with pauses and identity changes excluded", () => {
  for (const patch of [{ lastSuccessAt: "2026-10-13T12:00:00Z" }, { matchedItems: 0, datedItems: 0 }, { matchedItems: 5, datedItems: null }, { datedItems: 6 }, { sourceUrl: "https://example.org/old" }, { status: "error" }, { status: "paused" }, { newestPublicationAt: "invalid" }]) {
    const checks = states(now); Object.assign(checks.lab, patch);
    assert.equal(start(checks).collectedToday, false, JSON.stringify(patch));
    assert.equal(recordDiscoveryDay(start(checks), [], 0).length, 0);
  }
  assert.equal(start(states(now), {}, now, [{ ...sources[0], accessStatus: "permission-required" }, sources[1]]).healthy, false);
});
test("repeated same-day builds are idempotent and a later failure preserves the earlier receipt", () => {
  const first = save(start());
  assert.deepEqual(save(start(states(now), first)).history, first.history);
  const checks = states(now); checks.lab.status = "error";
  const failed = start(checks, first);
  assert.equal(failed.collectedToday, false);
  assert.deepEqual(recordDiscoveryDay(failed, [], 0), first.history);
});
test("legacy, forged-date and missing-source history stays outside comparisons", () => {
  const first = save(start());
  const rows = [
    { date: "2026-10-13", topics: [] },
    { date: "2026-10-12", topics: [], sourceChecks: [{ id: "lab", checkedAt: "2026-10-12T12:00:00Z" }] },
    { date: "2026-10-11", topics: [], sourceChecks: sources.map(s => ({ id: s.id, checkedAt: "2026-10-10T12:00:00Z" })) }
  ];
  const result = start(states(now), { ...first, history: rows });
  assert.equal(result.comparableHistory.length, 0); assert.equal(result.legacyHistory.length, 3);
  assert.deepEqual(start(states(now), { ...first, history: [], legacyHistory: result.legacyHistory }).legacyHistory, result.legacyHistory);
  const changed = start(states(now), { ...first, coverageKey: "old" });
  assert.equal(changed.comparableHistory.length, 0); assert.equal(changed.legacyHistory.length, 1);
});
test("history contract includes publisher, lane, extractor and sample-health policy", () => {
  const first = save(start());
  for (const patch of [{ owner: "Different owner" }, { tier: "community" }, { quietAfterDays: 14 }, { format: "hn" }, { url: "https://example.org/new" }]) {
    const result = start(states(now), first, now, [{ ...sources[0], ...patch }, sources[1]]);
    assert.notEqual(result.coverageKey, first.coverageKey); assert.equal(result.completeHistory, false);
  }
  const checks = states(now); checks.lab.extractorVersion = 5;
  assert.notEqual(start(checks, first).coverageKey, first.coverageKey);
});
test("future, invalid, conflicting duplicate days and extra source receipts cannot count", () => {
  const first = save(start()), row = first.history[0];
  const result = start(states(now), { ...first, history: [row, { ...row, topics: ["changed"] }, { ...row, date: "2027-01-01" }, { ...row, date: "2026-99-99" }] });
  assert.equal(result.comparableHistory.length, 0);
  assert.equal(start(states(now), { ...first, history: [{ ...row, sourceChecks: [...row.sourceChecks, row.sourceChecks[0]] }] }).comparableHistory.length, 0);
  assert.equal(start(states(now), { ...first, history: [{ ...row, sourceChecks: row.sourceChecks.map(s => ({ ...s, checkedAt: "2026-10-14T23:00:00Z" })) }] }).comparableHistory.length, 0);
});
test("daily receipts span both daylight-saving transitions without missing or double-counting a day", () => {
  for (const end of ["2026-03-15", "2026-11-08"]) {
    let previous = {};
    for (let i = 28; i >= 0; i--) {
      const date = new Date(Date.parse(end) - i * 86400000).toISOString().slice(0, 10), time = `${date}T12:00:00Z`;
      const result = start(states(time), previous, time);
      if (i === 0) assert.equal(result.completeHistory, true);
      previous = save(result);
    }
    assert.equal(previous.history.length, 29);
    assert.equal(new Set(previous.history.map(h => h.date)).size, 29);
  }
});
test("end-to-end topic momentum requires check receipts, not a fabricated list of dates", () => {
  let previous = {};
  for (let i = 28; i >= 1; i--) {
    const date = new Date(Date.parse("2026-10-14") - i * 86400000).toISOString().slice(0, 10), time = `${date}T12:00:00Z`;
    previous = save(start(states(time), previous, time));
  }
  const documents = ["2026-10-10", "2026-09-25"].map((date, i) => ({ id: `doc${i}`, sourceId: "lab", owner: "lab", discovery: true, tier: "research", title: `Quantum error correction ${i ? "improves" : ""}`, publishedAt: date, detectedAt: date, url: `https://example.org/doc${i}` }));
  const good = discoverTopics(documents, [], previous, now, sources, states(now));
  assert.equal(good.candidates[0].momentumPercent, 0);
  const legacy = { ...previous, history: previous.history.map(({ sourceChecks, ...row }) => row) };
  assert.equal(discoverTopics(documents, [], legacy, now, sources, states(now)).candidates[0].momentumPercent, null);
  assert.equal(discoverTopics(documents, [], previous, now, sources, states("2026-10-13T20:00:00Z")).candidates[0].momentumPercent, null);
  const older = { ...good, coverageKey: "old-contract", candidates: good.candidates.map(c => ({ ...c, firstObservedAt: "2026-10-01" })) };
  assert.equal(discoverTopics(documents, [], older, now, sources, states(now)).candidates[0].firstObservedAt, "2026-10-01", "resetting comparison history must not relabel an old lead as newly observed");
  const scope = { sources: sources.map(s => ({ ...s, discovery: true })), companies: [{ ticker: "TEST" }] };
  const research = { generatedAt: now, coverage: { totalSources: 2 }, discovery: good, companies: { TEST: { quote: { asOf: now }, factsCheckedAt: now } } };
  const monitor = { sources: Object.fromEntries(Object.entries(states(now)).map(([id, state]) => [id, { ...state, id }])) };
  assert.equal(researchHealth(research, monitor, Date.parse(now), scope).ok, true);
  const unsupported = { ...research, discovery: { ...good, history: good.history.map(({ sourceChecks, ...row }) => row) } };
  assert.match(researchHealth(unsupported, monitor, Date.parse(now), scope).errors.join(" "), /daily source-check receipts/);
  const wrongCount = { ...research, discovery: { ...good, candidates: good.candidates.map(c => ({ ...c, momentumPercent: 99 })) } };
  assert.match(researchHealth(wrongCount, monitor, Date.parse(now), scope).errors.join(" "), /Invalid story-count momentum/);
});
