import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import search from "../../research-search.js";

const data = {
  themes: [{ id: "battery", name: "Solid-state batteries", aliases: ["solid state", "lithium metal"], sector: "Energy" }],
  companies: [{ ticker: "QS", name: "QuantumScape", role: "Cell technology" }],
  sources: [{ id: "paused", name: "Carrier source", owner: "Carrier", url: "https://example.org/", accessStatus: "permission-required" }],
  research: { documents: [
    { id: "old", sourceId: "news", url: "https://example.org/a", title: "Battery old headline", owner: "Lab", detectedAt: "2026-01-01", publishedAt: "2025-12-01" },
    { id: "new", sourceId: "news", url: "https://example.org/a", title: "Battery revised headline", owner: "Lab", detectedAt: "2026-01-02", publishedAt: "2025-12-01" },
    { id: "bad", url: "javascript:alert(1)", title: "Battery unsafe" },
  ] },
};
test("finder uses a saved snapshot, deduplicates versions and preserves original dates and pauses", () => {
  const original = structuredClone(data), rows = search.index(data);
  assert.deepEqual(data, original);
  assert.equal(rows.filter(r => r.type === "Document").length, 1);
  assert.equal(rows.find(r => r.type === "Document").id, "new");
  assert.match(rows.find(r => r.type === "Document").meta, /2025-12-01/);
  assert.match(rows.find(r => r.type === "Source").meta, /paused/);
});
test("finder matches aliases, exact short tickers, prefixes and all query words", () => {
  const rows = search.index(data);
  assert.equal(search.search(rows, "QS").groups[0].rows[0].id, "QS");
  assert.equal(search.search(rows, "solid-state").groups[0].rows[0].id, "battery");
  assert.equal(search.search(rows, "lithium").total, 1);
  assert.equal(search.search(rows, "quantu").total, 1);
  assert.equal(search.search(rows, "lab revised").total, 1);
  assert.equal(search.search(rows, "lab nonexistent").total, 0);
  assert.equal(search.search(search.index({ companies: [{ ticker: "X", name: "Available tools" }] }), "AI").total, 0);
});
test("results are bounded, suggestions are explicit and missing data stays unknown", () => {
  const rows = search.index({ research: { documents: Array.from({ length: 20 }, (_, i) => ({ id: String(i), url: `https://example.org/${i}`, title: `Quantum paper ${i}` })) } });
  const result = search.search(rows, "quantum");
  assert.equal(result.total, 20); assert.equal(result.groups[0].rows.length, 6);
  assert.match(search.markup(result), /Showing 6 of 20/);
  assert.match(search.markup(result), /Publication date unknown/);
  assert.equal(search.search(search.index(data), "").suggested, true);
  assert.match(search.markup(search.search([], "missing")), /not a search of the whole market/);
});
test("results escape content and disable profile navigation during an open review", () => {
  const rows = search.index({ companies: [{ ticker: "QS", name: '<img src=x onerror="x"> QS' }], sources: [{ name: "Unsafe", url: "https://user:pass@example.org/" }] });
  const html = search.markup(search.search(rows, "QS"), { canNavigate: false });
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img|onerror="x"/);
  assert.match(html, / disabled/); assert.equal(rows.length, 1);
});

function fixture(snapshot = data) {
  const handlers = {}, inputHandlers = {}, focus = [], context = { textContent: "" }, status = { textContent: "" }, results = { innerHTML: "", querySelectorAll: () => [] };
  const input = { value: "", addEventListener: (n, f) => inputHandlers[n] = f, focus: () => focus.push("input") };
  const trigger = { isConnected: true, addEventListener() {}, focus: () => focus.push("trigger") };
  const dialog = { open: false, addEventListener: (n, f) => handlers[n] = f, querySelectorAll: () => [], querySelector: selector => ({ input, "[data-find-results]": results, "[data-find-status]": status, "[data-find-context]": context })[selector], showModal() { this.open = true; }, close() { this.open = false; handlers.close(); } };
  const controller = search.create({ dialog, trigger, snapshot: () => snapshot });
  return { controller, dialog, handlers, inputHandlers, input, focus, context, status, results };
}
test("search open/cancel restores focus; rapid reopen ignores an old close event", () => {
  const f = fixture(); f.controller.open();
  assert.equal(f.dialog.open, true); assert.deepEqual(f.focus, ["input"]);
  f.input.value = "QS"; f.inputHandlers.input(); assert.match(f.results.innerHTML, /QuantumScape/);
  f.handlers.cancel({ preventDefault() {} }); assert.equal(f.dialog.open, false);
  assert.deepEqual(f.focus, ["input", "trigger"]);
  f.controller.open(); f.handlers.close(); assert.equal(f.dialog.open, true);
  f.controller.close(false); assert.deepEqual(f.focus, ["input", "trigger", "input"]);
});
test("Escape closes a populated search on the first press, except during composition", () => {
  const f = fixture(); f.controller.open(); f.input.value = "QS";
  f.handlers.keydown({ key: "Escape", isComposing: true });
  assert.equal(f.dialog.open, true);
  let prevented = false;
  f.handlers.keydown({ key: "Escape", preventDefault: () => prevented = true });
  assert.equal(prevented, true); assert.equal(f.dialog.open, false);
  assert.equal(f.focus.at(-1), "trigger");
});
test("unavailable modal is non-destructive and missing documents are explained", () => {
  const f = fixture(); f.dialog.showModal = null;
  f.controller.open(); assert.equal(f.dialog.open, false); assert.equal(f.results.innerHTML, "");
  const g = fixture(); g.dialog.showModal = () => { throw Error("unsupported"); };
  assert.doesNotThrow(() => g.controller.open());
  const h = fixture({ ...data, research: null }); h.controller.open();
  assert.match(h.context.textContent, /Documents have not loaded/);
  assert.match(h.results.innerHTML, /Solid-state batteries/);
});

test("missing or malformed publication dates never become collection dates", () => {
  for (const publishedAt of [123, {}, "yesterday", "2026-02-30", null]) {
    const rows = search.index({ research: { documents: [{ id: "x", title: "Paper", url: "https://example.org/", publishedAt, detectedAt: "2026-11-02" }] } });
    assert.match(rows[0].meta, /Publication date unknown/);
    assert.doesNotMatch(rows[0].meta, /2026-11-02/);
  }
});

test("documents sort by original publication and distinguish same-titled source records", () => {
  const rows = search.index({ research: { documents: [
    { id: "unknown", title: "Satellite", url: "https://example.org/111", detectedAt: "2026-11-03" },
    { id: "older", title: "Satellite", url: "https://example.org/222", publishedAt: "2026-10-01" },
    { id: "newer", title: "Satellite network", url: "https://example.org/333", publishedAt: "2026-11-01" },
  ] } });
  const result = search.search(rows, "satellite");
  assert.deepEqual(result.groups[0].rows.map(r => r.id), ["newer", "older", "unknown"]);
  assert.match(search.markup(result), /newest dated first; undated last/);
  assert.match(search.markup(result), /example.org\/222/);
  assert.equal(search.search(rows, "222").total, 1);
});

test("finder distinguishes community submission dates and never promotes a revised article's date", () => {
  const rows = search.index({ research: { documents: [
    { id: "revised", title: "Satellite article", url: "https://example.org/article", publishedAt: "2026-11-02", originalPublishedAt: "2026-10-01" },
    { id: "submission", title: "Satellite discussion", url: "https://news.ycombinator.com/item?id=123", dateKind: "community-submission", publishedAt: "2026-10-15" },
    { id: "unknown", title: "Satellite discussion", url: "https://news.ycombinator.com/item?id=456", dateKind: "community-submission", detectedAt: "2026-11-02" },
  ] } });
  const result = search.search(rows, "satellite");
  assert.deepEqual(result.groups[0].rows.map(r => r.id), ["submission", "revised", "unknown"]);
  assert.match(rows.find(r => r.id === "submission").meta, /Submitted 2026-10-15.*not article publication/);
  assert.match(rows.find(r => r.id === "revised").meta, /Published 2026-10-01/);
  assert.match(rows.find(r => r.id === "unknown").meta, /Submission date unknown/);
  assert.doesNotMatch(search.markup(result), /2026-11-02/);
});

test("arrow navigation wraps results, ignores composition, and leaves Tab native", () => {
  const f = fixture(); f.controller.open();
  const focused = [], items = [0, 1].map(i => ({ focus: () => focused.push(i) }));
  f.results.querySelectorAll = () => items;
  let prevented = 0;
  const key = (key, target, isComposing = false) => f.handlers.keydown({ key, target, isComposing, preventDefault: () => prevented++ });
  key("ArrowDown", f.input); key("ArrowDown", items[0]); key("ArrowDown", items[1]); key("ArrowUp", f.input);
  assert.deepEqual(focused, [0, 1, 0, 1]); assert.equal(prevented, 4);
  key("ArrowDown", f.input, true); key("Tab", f.input); key("ArrowDown", {});
  assert.equal(prevented, 4);
});

test("Tab wraps at modal boundaries while intermediate traversal stays native", () => {
  const f = fixture(), focused = [];
  const first = { focus: () => focused.push("first") }, last = { focus: () => focused.push("last") };
  f.dialog.querySelectorAll = () => [first, f.input, last];
  let prevented = 0;
  const tab = (target, shiftKey) => f.handlers.keydown({ key: "Tab", target, shiftKey, preventDefault: () => prevented++ });
  tab(first, true); tab(last, false); tab(f.input, false);
  assert.deepEqual(focused, ["last", "first"]); assert.equal(prevented, 2);
});

test("finder integration keeps modal outside rerenders and gates review navigation", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="research-search.js') < html.indexOf('src="adoption.js'));
  assert.match(html, /<dialog id="researchFindDialog"[\s\S]*?<\/dialog>\s*<div id="techContent">/);
  assert.match(html, /<\/nav><button[^>]+id="researchFindButton"/);
  const source = readFileSync(new URL("../../adoption.js", import.meta.url), "utf8");
  assert.match(source, /canNavigate: \(\) => !reviewingId/);
  assert.match(source, /if \(reviewingId\) return;[^\n]*\n\s*researchFinder\?\.close\(false\)/);
});
