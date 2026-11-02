import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import loader from "../../stock-history-loader.js";

const archive = (updatedAt = "2026-11-02T18:00:00Z") => ({ dataMode: "real-public-no-key-history", updatedAt,
  snapshots: [{ date: "2026-11-02", signals: [{ ticker: "AAPL" }] }] });
test("history is idle until requested, shared in flight and reused after success", async () => {
  let calls = 0, resolve; const statuses = [];
  const session = loader.create({ read: () => { calls++; return new Promise(r => { resolve = r; }); }, onChange: s => statuses.push(s.status) });
  assert.equal(calls, 0); assert.equal(session.state.status, "idle");
  const first = session.load(); assert.equal(first, session.load());
  await Promise.resolve(); await Promise.resolve(); resolve(archive());
  await first; await session.load();
  assert.equal(calls, 1); assert.deepEqual(statuses, ["loading", "ready"]);
});
test("network or validation errors retain loaded history and an explicit retry recovers", async () => {
  let value = archive(), fail = false;
  const session = loader.create({ read: () => { if (fail) throw Error("offline"); return value; } });
  const original = (await session.load()).data;
  fail = true; assert.equal((await session.load(true)).status, "error");
  assert.equal(session.state.data, original);
  fail = false; value = { ...archive(), snapshots: [null] };
  assert.match((await session.load(true)).error, /invalid/); assert.equal(session.state.data, original);
  value = archive("2026-11-01T00:00:00Z");
  assert.match((await session.load(true)).error, /older/); assert.equal(session.state.data, original);
  value = archive("2026-11-02T19:00:00Z");
  assert.equal((await session.load(true)).data, value);
});
test("timeout aborts transport, late completion cannot overwrite a successful retry", async () => {
  let oldResolve, signal, calls = 0;
  const session = loader.create({ timeoutMs: 10, read: s => { calls++; signal = s; return calls === 1 ? new Promise(r => { oldResolve = r; }) : archive(); } });
  assert.equal((await session.load()).status, "error"); assert.equal(signal.aborted, true);
  const result = await session.load(); assert.equal(result.status, "ready");
  oldResolve(archive("2026-11-01T00:00:00Z")); await Promise.resolve();
  assert.equal(session.state.data, result.data);
});
test("initial invalid history is an error, not a successful empty archive", async () => {
  for (const data of [null, {}, { ...archive(), updatedAt: null }, { ...archive(), updatedAt: "2026-02-30T01:00:00Z" }, { ...archive(), snapshots: [{ date: "2026-02-30", signals: [] }] }, { ...archive(), snapshots: [{ date: "bad", signals: [] }] }]) {
    const session = loader.create({ read: () => data });
    assert.equal((await session.load()).status, "error"); assert.equal(session.state.data, null);
  }
  assert.equal(loader.valid(JSON.parse(readFileSync(new URL("../../data/history.json", import.meta.url)))), true);
});
const source = readFileSync(new URL("../../script.js", import.meta.url), "utf8");
function controller(extra = {}) {
  const context = vm.createContext({ window: {}, document: { getElementById: () => null }, location: { protocol: "https:" }, Intl, Date, console, ...extra });
  vm.runInContext(source.replace(/\ninit\(\);\s*$/, ""), context);
  return context;
}
test("latest snapshot loading does not request or await history", async () => {
  const requests = [];
  const c = controller({ fetch: async url => { requests.push(url); return { ok: true, json: async () => ({ dataMode: "real-public-no-key", signals: [] }) }; } });
  assert.equal(await c.loadSnapshot(), true);
  assert.equal(requests.length, 1); assert.match(requests[0], /signals.json/);
  assert.equal(vm.runInContext("historyState", c), "idle");
});
test("file mode reuses the existing archive without attempting a network request", async () => {
  const data = archive();
  const c = controller({ location: { protocol: "file:" }, window: { SIGNALDESK_HISTORY: data, SIGNALDESK_HISTORY_LOADER: loader }, fetch: () => { throw Error("unexpected fetch"); } });
  vm.runInContext("deskInitialized = true; renderAfterHistoryChange = () => {};", c);
  assert.equal(await c.loadHistory(true), true);
  assert.equal(vm.runInContext("history", c), data);
});
test("history is only activated by stock surfaces and never mislabels unloaded data as insufficient history", () => {
  const c = controller();
  assert.match(c.detailTrendMarkup({ ticker: "AAPL" }), /loads when you open/);
  vm.runInContext('historyState = "loading"', c);
  assert.match(c.detailTrendMarkup({ ticker: "AAPL" }), /not ready yet/);
  vm.runInContext('historyState = "error"', c);
  assert.match(c.detailTrendMarkup({ ticker: "AAPL" }), /could not be loaded/);
  const tabs = readFileSync(new URL("../../tabs.js", import.meta.url), "utf8");
  assert.match(tabs, /if \(tab.id === "desk"\) window.SIGNALDESK_LOAD_HISTORY/);
  assert.match(tabs, /if \(event.currentTarget.open\) window.SIGNALDESK_LOAD_HISTORY/);
  const enhancements = readFileSync(new URL("../../enhancements.js", import.meta.url), "utf8");
  assert.match(enhancements, /dataWindowMode === "history" && history/);
  assert.match(enhancements, /Full history is not available yet/);
});

test("history rerenders restore the same stock control after reorder, not the old row index", () => {
  let focused = "";
  const root = { children: [], querySelectorAll: () => root.children, querySelector: () => null };
  const button = ticker => ({ tagName: "BUTTON", textContent: ticker, dataset: { ticker }, parentElement: root,
    isConnected: true, getAttribute: () => null, closest: selector => selector === "[data-ticker]" ? { dataset: { ticker } } : root,
    focus: () => { focused = ticker; } });
  const before = button("AAPL"); root.children = [before];
  const c = controller({ document: { activeElement: before, getElementById: () => null } });
  c.render = () => { before.isConnected = false; root.children = [button("TSLA"), button("AAPL")]; };
  c.renderAfterHistoryChange();
  assert.equal(focused, "AAPL");
});

test("history completion does not move focus away from an unchanged editor", () => {
  let renders = 0, focused = false;
  const activeElement = { isConnected: true, closest: () => null, getAttribute: () => null, focus: () => { focused = true; } };
  const c = controller({ document: { activeElement, getElementById: () => null } });
  c.render = () => { renders++; };
  c.renderAfterHistoryChange();
  assert.equal(renders, 1); assert.equal(focused, false);
});
