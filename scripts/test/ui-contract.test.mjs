import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import quality from "../../data-quality.js";

const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const source = await readFile(new URL("../../script.js", import.meta.url), "utf8");

// Exercise the actual dependency-free presentation helpers without starting
// the network-backed browser app or introducing a DOM runtime dependency.
function presentationHelpers() {
  const context = vm.createContext({ Intl, Date, window: { SIGNALDESK_QUALITY: quality }, shortFmt: new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }) });
  for (const name of ["formatPrice", "capTierFor", "capLabelFor", "formatShortDateTime", "escapeHtml", "formatQuoteCell", "rankBadge", "matchesStockQuery"]) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} must exist`);
    const end = source.indexOf("\nfunction ", start + 1);
    vm.runInContext(source.slice(start, end < 0 ? source.length : end), context);
  }
  return context;
}

test("compact quotes retain stale and undated warnings without throwing", () => {
  const { formatQuoteCell } = presentationHelpers();
  assert.match(formatQuoteCell({ lastPrice: null }), /No quote/);
  assert.match(formatQuoteCell({ lastPrice: 10, quoteAsOf: "invalid" }), /Undated/);
  assert.match(formatQuoteCell({ lastPrice: 10, quoteAsOf: "2020-01-01T12:00:00Z" }), /Stale quote/);
  const fresh = formatQuoteCell({ lastPrice: 10, quoteAsOf: new Date().toISOString(), quoteSource: "Public chart", marketCap: 4_100_000, capTier: "small" });
  assert.match(fresh, /\$4\.1M cap/);
  assert.match(fresh, /title="Public chart/);
  assert.doesNotMatch(fresh, /Stale quote/);
});

test("exact company tickers never substitute prefix matches", () => {
  const { matchesStockQuery } = presentationHelpers();
  assert.equal(matchesStockQuery({ ticker: "QSI", name: "Quantum-Si" }, "$QS"), false);
  assert.equal(matchesStockQuery({ ticker: "QS", name: "QuantumScape" }, "$qs"), true);
  assert.equal(matchesStockQuery({ ticker: "QSI", name: "Quantum-Si" }, "QS"), true);
  assert.equal(matchesStockQuery({ ticker: "QS", name: "QuantumScape" }, "quantum"), true);
});

test("stock URL updates preserve technology deep links and hash while retaining search", () => {
  let saved;
  const context = vm.createContext({ URLSearchParams, location: { search: "?tech=solid-state-batteries&techView=milestones", pathname: "/signaldesk/", hash: "#research" }, window: { history: { replaceState: (_, __, url) => { saved = url; } } }, history: { snapshots: [] }, byId: () => ({ value: "$QS" }), selectedTicker: "", rankMode: "signal", capFilter: "all", attentionFilter: "all", watchlistFilter: false });
  const start = source.indexOf("function updateUrl()");
  vm.runInContext(source.slice(start, source.indexOf("\n}\n", start) + 3), context);
  context.updateUrl();
  const url = new URL(saved, "https://example.org");
  assert.equal(url.searchParams.get("tech"), "solid-state-batteries");
  assert.equal(url.searchParams.get("techView"), "milestones");
  assert.equal(url.searchParams.get("q"), "$QS");
  assert.equal(url.hash, "#research");
});

test("rank changes remain visible without repeating the New label", () => {
  const { rankBadge } = presentationHelpers();
  assert.equal(rankBadge("NEW", 1, new Map()), "");
  assert.match(rankBadge("UP", 2, new Map([["UP", 5]])), /▲3/);
  assert.match(rankBadge("DOWN", 5, new Map([["DOWN", 2]])), /▼3/);
});

test("sort and recovery controls have unique identifiers and real options", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["rankMode", "resetView", "capLarge", "capSmall", "boardEmpty"]) assert.ok(ids.includes(id));
  const select = html.match(/<select id="rankMode">([\s\S]*?)<\/select>/)?.[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(match => match[1]), ["signal", "mentions", "momentum"]);
});

test("the original SVG mark is shared by the favicon and header", async () => {
  const icon = await readFile(new URL("../../favicon.svg", import.meta.url), "utf8");
  assert.match(icon, /viewBox="0 0 32 32"/);
  assert.match(icon, /<path /);
  assert.match(icon, /<circle /);
  assert.doesNotMatch(icon, /<script|<image|<foreignObject|href=/);
  assert.match(html, /rel="icon" href="favicon\.svg\?/);
  assert.match(html, /class="brand-mark" src="favicon\.svg\?/);
});
