import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import registry from "../../technology-registry.js";
import legacy from "../../adoption-watchlist.js";
import model from "../../technology-model.js";

test("technology registry validates all five profiles, sources and exposure citations", () => {
  assert.deepEqual(model.validate(registry), []);
  assert.equal(registry.themes.length, 5);
  for (const id of ["solid-state-batteries", "satellite-phones"]) assert.ok(registry.themes.some(t => t.id === id));
});
test("existing observations keep IDs, dates and values through the upgrade", () => {
  for (const t of legacy.themes) for (const e of t.evidence) {
    const actual = registry.themes.find(row => row.id === t.id).evidence.find(row => row.id === e.id);
    for (const key of Object.keys(e)) assert.deepEqual(actual[key], e[key]);
  }
});
test("technology search matches user language, aliases and company tickers", () => {
  for (const [query, id] of [["solid state", "solid-state-batteries"], ["battery", "solid-state-batteries"], ["satellite internet", "satellite-phones"], ["ASTS", "satellite-phones"], ["QS", "solid-state-batteries"]]) {
    assert.ok(model.filterThemes(registry.themes, { query }).some(t => t.id === id), query);
  }
  assert.equal(model.filterThemes(registry.themes, { query: "nonexistent spaceship" }).length, 0);
});
test("following, stage and sector filters compose without mutating the registry", () => {
  const before = JSON.stringify(registry);
  assert.deepEqual(model.filterThemes(registry.themes, { followedOnly: true, followed: ["solid-state-batteries"], stage: "pilot", sector: "Energy" }).map(t => t.id), ["solid-state-batteries"]);
  assert.equal(model.filterThemes(registry.themes, { followedOnly: true, followed: [] }).length, 0);
  assert.equal(model.filterThemes(registry.themes, { stage: "pilot", sector: "Connectivity" }).length, 0);
  assert.equal(JSON.stringify(registry), before);
});
test("targets do not become adoption observations and one owner is not two confirmations", () => {
  const battery = model.evidenceSummary(registry.themes[0]);
  assert.equal(battery.targets, 1); assert.equal(battery.observations, 2);
  assert.equal(model.evidenceSummary(registry.themes[1]).owners, 1);
});
test("undated availability checks preserve publication unknown instead of inventing today", () => {
  const e = registry.themes[1].evidence.find(e => e.id === "tmobile-availability-2026");
  assert.equal(e.publishedAt, null); assert.equal(e.checkedAt, "2026-10-02");
});
test("lower-bound paid-seat figures never imply exact percentage growth", () => {
  const work = registry.themes.find(t => t.id === "ai-work");
  assert.equal(model.comparableChange(...work.evidence), null);
});
test("only exact, compatible chronological metrics produce a change", () => {
  const a = { metric: "units sold", unit: "units", owner: "Acme", geography: "US", value: 100, qualifier: "exact", kind: "adoption", publishedAt: "2026-01-01" };
  const b = { ...a, value: 150, publishedAt: "2026-04-01" };
  assert.equal(model.comparableChange(a, b), 50);
  for (const patch of [{ qualifier: "over" }, { geography: "Global" }, { kind: "target" }, { metric: "units shipped" }, { value: null }, { publishedAt: a.publishedAt }, { definition: "revised" }]) assert.equal(model.comparableChange(a, { ...b, ...patch }), null);
});
test("milestones distinguish editorial reviews, company targets and undated checks", () => {
  const rows = model.milestones(registry.themes, new Date("2026-10-02T12:00:00Z"));
  assert.equal(rows.filter(m => m.kind === "editorial-review").length, 5);
  const target = rows.find(m => m.id === "toyota-commercialization");
  assert.equal(target.kind, "company-target"); assert.equal(target.due, "2028-12-31"); assert.equal(target.state, "planned");
  assert.ok(rows.filter(m => m.kind === "research-check").every(m => m.due === null));
});
test("past target windows become unverified, never automatically failed or achieved", () => {
  const rows = model.milestones(registry.themes, new Date("2029-01-01T12:00:00Z"));
  assert.equal(rows.find(m => m.id === "toyota-commercialization").state, "unverified-past-window");
  assert.equal(rows.find(m => m.kind === "editorial-review").state, "overdue");
});
test("review dates are inclusive and invalid dates do not become overdue", () => {
  assert.equal(model.isOverdue("2026-10-02", new Date("2026-10-02T23:59:00Z")), false);
  assert.equal(model.isOverdue("2026-10-02", new Date("2026-10-03T00:01:00Z")), true);
  assert.equal(model.isOverdue(null), false);
});
test("source health distinguishes failure, missing checks, stale checks and no links", () => {
  const source = { intervalHours: 24, mode: "links" }, now = new Date("2026-10-02T12:00:00Z");
  const state = { lastAttemptAt: now.toISOString(), lastSuccessAt: now.toISOString(), status: "ok", matchedItems: 2 };
  assert.equal(model.monitorState(source, null, now), "not-checked");
  assert.equal(model.monitorState(source, state, now), "current");
  assert.equal(model.monitorState(source, { ...state, status: "error" }, now), "unavailable");
  assert.equal(model.monitorState(source, { ...state, matchedItems: 0 }, now), "no-matches");
  assert.equal(model.monitorState(source, { ...state, lastSuccessAt: "2026-09-20" }, now), "stale");
  assert.equal(model.monitorState(source, { ...state, lastSuccessAt: "invalid" }, now), "stale");
  assert.equal(model.monitorState(source, { ...state, lastSuccessAt: "2026-10-03" }, now), "stale");
});
test("unsafe provenance links are rejected", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "https://user:pass@example.org/", "invalid"]) assert.equal(model.safeUrl(value), "");
  const broken = structuredClone(registry); broken.themes[0].companies[0].url = "javascript:alert(1)";
  assert.ok(model.validate(broken).some(e => e.includes("Invalid exposure")));
});
test("technology UI, monitor fallback and refresh workflow are all wired", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../../.github/workflows/refresh-data.yml", import.meta.url), "utf8");
  for (const id of ["techSearch", "techSector", "techStage", "techContent", "techFollowedOnly"]) assert.equal((html.match(new RegExp(`id="${id}"`, "g")) || []).length, 1);
  for (const file of ["technology-registry.js", "technology-model.js", "adoption.js"]) assert.ok(html.includes(`src="${file}`));
  assert.ok(html.includes('"technology-monitor"'));
  for (const file of ["data/technology-monitor.json", "data/technology-monitor.js", "data/technology-monitor-state.json", "node scripts/update-technology.mjs"]) assert.ok(workflow.includes(file));
  assert.ok(!workflow.includes("SIGNALDESK_TECH_NTFY"));
});
