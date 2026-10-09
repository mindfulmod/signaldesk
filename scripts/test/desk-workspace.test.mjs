import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import quality from "../../data-quality.js";

const source = readFileSync(new URL("../../script.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../../desk-cleanup.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../../layout-fix.js", import.meta.url), "utf8");

function controller(document = {}) {
  const context = vm.createContext({ document, window: { SIGNALDESK_QUALITY: quality }, Intl, Date, URLSearchParams, console });
  vm.runInContext(source.replace(/\ninit\(\);\s*$/, ""), context);
  vm.runInContext("tickerHistory = () => [];", context);
  return context;
}

const signal = (extra = {}) => ({ ticker: "PEP", name: "Pepsico Inc", lastPrice: 128.34,
  quoteAsOf: new Date().toISOString(), quoteSource: "Public chart", marketMetricsVersion: 2,
  priceMove: 1.5, relativeVolume: 2, signalScore: 50, momentum: 20, sentiment: null,
  sources: { "Price/Volume": 1, StockTwits: 8 }, latest: [], ...extra });

test("comparison columns disappear only when every matching row is unknown", () => {
  const c = controller();
  const unknown = signal({ marketMetricsVersion: undefined, priceMove: null, momentum: null });
  assert.equal(c.boardCoverageState([unknown]).missingMarket, true);
  assert.equal(c.boardCoverageState([unknown]).missingMomentum, true);
  assert.match(c.boardCoverageState([unknown]).note, /unavailable.*not live/);
  for (const rows of [[unknown, signal()], [signal({ priceMove: 0, momentum: 0 })]]) {
    assert.equal(c.boardCoverageState(rows).missingMarket, false);
    assert.equal(c.boardCoverageState(rows).missingMomentum, false);
    assert.equal(c.boardCoverageState(rows).note, "");
  }
  assert.equal(c.boardCoverageState([]).note, "", "no results is not a coverage finding");
});

test("next steps distinguish current, stale and unverified market evidence", () => {
  const c = controller();
  assert.match(c.detailNextSteps(signal()), /Recheck the market move/);
  for (const patch of [{ marketMetricsVersion: undefined }, { quoteAsOf: "2020-01-01" }, { relativeVolume: null }]) {
    const actions = c.detailNextSteps(signal(patch));
    assert.match(actions, /Check current price & volume/);
    assert.match(actions, /confirmation is missing/);
    assert.doesNotMatch(actions, /Recheck the market move/);
  }
  assert.match(c.detailNextSteps(signal()), /href="https:\/\/finance.yahoo.com\/quote\/PEP"/);
  assert.match(c.detailNextSteps(signal()), /data-detail-open="evidence"/);
  vm.runInContext('watchlist = new Set(["PEP"]);', c);
  assert.match(c.detailNextSteps(signal()), /aria-pressed="true"/);
  assert.match(c.detailNextSteps(signal()), /Remove PEP from watchlist/);
});

test("research read and next steps precede optional metrics without discarding warnings", () => {
  const c = controller();
  const detail = c.detailMarkup(signal({ marketMetricsVersion: undefined,
    marketQuality: ["Legacy measurements need a fresh collection"], name: '<script>bad()</script>',
    topHeadline: { title: "Company report", isNewsArticle: true, source: "CNBC", published: new Date().toISOString(), url: "https://example.org/report" },
    latest: [{ title: "Original commentary", source: "StockTwits", published: "2026-10-08", url: "https://example.org/comment" }] }), 1);
  assert.ok(detail.indexOf("setup-assessment") < detail.indexOf("desk-next-steps"));
  assert.ok(detail.indexOf("desk-next-steps") < detail.indexOf('data-detail-section="metrics"'));
  assert.match(detail, /No current price \/ volume/);
  assert.match(detail, /Legacy measurements need a fresh collection/);
  assert.match(detail, /Weighted activity is not a count of posts/);
  assert.match(detail, /class="headline-date">Oct /);
  assert.match(detail, /data-detail-heading tabindex="-1"/);
  assert.match(detail, /Back to list/);
  assert.doesNotMatch(detail, /<script>|id="selected/);
  assert.match(detail, /&lt;script&gt;/);
  for (const name of ["evidence", "metrics", "notes"]) assert.match(detail, new RegExp(`<details[^>]+data-detail-section="${name}">`));
});

test("no-headline and missing-price details give honest recovery paths", () => {
  const c = controller();
  const detail = c.detailMarkup(signal({ lastPrice: null, priceMove: null, relativeVolume: null, momentum: null, quoteAsOf: null }), 1);
  assert.match(detail, /No qualifying headline captured/);
  assert.match(detail, /No additional saved headlines/);
  assert.match(detail, /Quote time unavailable/);
  assert.match(detail, /Quote not verified/);
  assert.match(detail, /Save to watchlist/);
  assert.doesNotMatch(detail, /NaN|undefined/);
});

test("detail rerenders preserve open sections and scroll, while a new stock resets them", () => {
  const c = controller();
  let writes = 0, reopened = 0;
  const root = { dataset: { ticker: "PEP" }, scrollTop: 180,
    set innerHTML(value) { writes++; this.value = value; },
    querySelectorAll: selector => selector === "details[open][data-detail-section]" ? [{ dataset: { detailSection: "evidence" } }] : [],
    querySelector: selector => selector === '[data-detail-section="evidence"]' ? { setAttribute: () => reopened++ } : null };
  vm.runInContext('lastDetailHtml = "<p>one</p>"; detailTicker = "PEP";', c);
  c.updateDetailContent(root, false);
  assert.equal(root.scrollTop, 180); assert.equal(reopened, 1); assert.equal(writes, 1);
  c.updateDetailContent(root, false);
  assert.equal(writes, 1, "resizing must not replace identical content");
  vm.runInContext('lastDetailHtml = "<p>two</p>"; detailTicker = "AAPL";', c);
  c.updateDetailContent(root, true);
  assert.equal(root.scrollTop, 0); assert.equal(reopened, 1); assert.equal(root.dataset.ticker, "AAPL");
});

test("workspace scroll and guidance are scoped to desktop, with accessible recovery controls", () => {
  assert.match(layout, /@media \(min-width: 1181px\)[\s\S]*height: clamp\(520px/);
  assert.match(layout, /\.table-panel th \{ top: 0;/);
  assert.match(layout, /\.dashboard-grid\.board-is-empty[^\n]+height: auto/);
  assert.match(html, /class="table-scroll" tabindex="0" role="region"/);
  assert.match(html, /id="boardCoverage"[^>]+role="status"/);
  assert.match(html, /id="attnAll"[^>]+aria-pressed="true"/);
  assert.match(css, /no-attention-comparison[\s\S]*display: none !important/);
  assert.match(css, /\.table-scroll:focus-visible/);
});

test("the detail rank uses the same filtered ordering as the board", () => {
  const c = controller();
  c.all = [signal({ ticker: "BIG" }), signal({ ticker: "SMALL" })];
  c.filtered = [c.all[1]];
  vm.runInContext(`snapshot = { signals: all }; selectedTicker = "SMALL";
    getState = () => ({ sources: ["StockTwits"] });
    filteredSignals = () => all; visibleSignals = () => filtered;
    updateStatus = updateRangeNote = renderBuyCandidates = renderMovers = updateUrl = () => {};
    renderTable = rows => { window.boardRows = rows; };
    renderDetail = rows => { window.detailRows = rows; };`, c);
  c.render();
  assert.equal(c.window.boardRows[0].ticker, "SMALL");
  assert.equal(c.window.detailRows[0].ticker, "SMALL");
  assert.equal(c.window.detailRows.length, 1);
});

test("failed snapshots provide a retry rather than a blank board or stale selection", () => {
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: "", innerHTML: "", querySelector: tag => node(`${id} ${tag}`) });
    return nodes.get(id);
  };
  const c = controller({ getElementById: node });
  vm.runInContext('renderTable = updateDetailContent = renderDetailSheetContent = () => {};', c);
  c.renderEmptyState();
  assert.equal(node("retrySnapshot").hidden, false);
  assert.equal(node("resetView").hidden, true);
  assert.match(node("boardEmpty h3").textContent, /could not be loaded/);
  assert.match(node("boardEmpty p").textContent, /No sample stocks/);
});
