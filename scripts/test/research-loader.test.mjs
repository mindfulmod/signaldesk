import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import loader from "../../research-loader.js";
const now = Date.parse("2026-10-14T02:00:00Z");
const pair = (time = "2026-10-14T01:00:00Z") => ({ research: { schemaVersion: 1, generatedAt: time, sourceCheckedAt: time, documents: [], reviews: [], companies: {} }, "technology-monitor": { schemaVersion: 1, generatedAt: time, events: [], sources: {} } });
test("only a compatible research/source-check pair becomes visible", async () => {
  const data = pair(), events = [];
  const session = loader.create({ now: () => now, read: async name => data[name], onChange: state => events.push(state) });
  const result = await session.load();
  assert.equal(result.status, "ready"); assert.equal(result.research, data.research); assert.equal(result.monitor, data["technology-monitor"]);
  assert.deepEqual(events.map(s => s.status), ["loading", "ready"]);
  assert.equal(events[0].research, null); assert.equal(result.loadedAt, "2026-10-14T02:00:00.000Z");
});
test("overlapping reload requests share one in-flight pair without out-of-order commits", async () => {
  const data = pair(), pending = new Map(); let calls = 0;
  const session = loader.create({ now: () => now, read: name => { calls++; return new Promise(resolve => pending.set(name, resolve)); } });
  const first = session.load(), second = session.load();
  assert.equal(first, second);
  await Promise.resolve(); await Promise.resolve();
  pending.get("research")(data.research); await Promise.resolve();
  assert.equal(session.state.research, null);
  pending.get("technology-monitor")(data["technology-monitor"]); await first;
  assert.equal(calls, 2); assert.equal(session.state.status, "ready");
});
test("partial failure retains the last complete pair and retry can recover", async () => {
  let data = pair(), fail = false;
  const session = loader.create({ now: () => now, read: name => { if (fail && name === "technology-monitor") throw Error("network"); return data[name]; } });
  const original = await session.load();
  data = pair("2026-10-14T01:30:00Z"); fail = true;
  const failed = await session.load();
  assert.equal(failed.status, "error"); assert.match(failed.error, /Source checks could not/);
  assert.equal(failed.research, original.research); assert.equal(failed.monitor, original.monitor); assert.equal(failed.loadedAt, original.loadedAt);
  fail = false;
  assert.equal((await session.load()).research, data.research);
});
test("initial failures and malformed file bundles are not rendered as empty successful research", async () => {
  const session = loader.create({ now: () => now, read: () => { throw Error("unavailable"); } });
  const failed = await session.load();
  assert.equal(failed.status, "error"); assert.equal(failed.research, null); assert.match(failed.error, /Research and Source checks/);
  const data = pair();
  const impossible = pair("2026-02-30T01:00:00Z");
  assert.match(loader.validatePair(impossible.research, impossible["technology-monitor"], now), /dates/);
  for (const patch of [{ documents: [null] }, { companies: [] }, { reviews: null }, { schemaVersion: 2 }, { generatedAt: "2027-01-01" }, { sourceCheckedAt: null }]) assert.ok(loader.validatePair({ ...data.research, ...patch }, data["technology-monitor"], now));
  for (const patch of [{ events: [null] }, { sources: [] }, { sources: { failed: null } }, { schemaVersion: 2 }]) assert.ok(loader.validatePair(data.research, { ...data["technology-monitor"], ...patch }, now));
});
test("mixed publication generations and older responses never replace the visible pair", async () => {
  let data = pair();
  const session = loader.create({ now: () => now, read: name => data[name] });
  const original = await session.load();
  data = pair("2026-10-14T01:30:00Z"); data.research.sourceCheckedAt = "2026-10-14T01:00:00Z";
  assert.match((await session.load()).error, /different updates/);
  assert.equal(session.state.research, original.research);
  data = pair("2026-10-13T01:00:00Z");
  assert.match((await session.load()).error, /older publication/);
  assert.equal(session.state.research, original.research);
});
test("old but internally consistent snapshots remain available for dated historical context", () => {
  const old = pair("2026-09-01T01:00:00Z");
  assert.equal(loader.validatePair(old.research, old["technology-monitor"], now), "");
  const current = pair(); current.research.generatedAt = "2026-10-14T01:30:00Z";
  assert.equal(loader.validatePair(current.research, current["technology-monitor"], now), "", "company refresh may be newer than source collection");
});
test("refresh status is shared across views and does not replace dirty editors", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8"), source = readFileSync(new URL("../../adoption.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('id="techRefreshStatus"') < html.indexOf('id="techContent"'));
  assert.ok(html.indexOf('src="research-loader.js') < html.indexOf('src="adoption.js'));
  assert.match(source, /state.status !== "loading" && !reviewingId && !notebookDirty/);
  assert.match(source, /else updateSnapshotStatus\(\)/);
  assert.match(source, /No automatic research snapshot is loaded; empty results do not mean no activity/);
  assert.match(source, /Reopen this page to load changed files/);
  assert.match(source, /state.status === "loading"\) refreshFocusTarget/);
  assert.match(source, /refreshFocusTarget\?\.view === view/);
});
