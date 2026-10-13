import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import identity from "../../company-identity.js";
import quality from "../../data-quality.js";
import { registerStock, collectMentions, aggregate, buildMarketNews } from "../update-data.mjs";

const stock = { ticker: "SXTC", name: "China SXT Pharmaceuticals, Inc.", aliases: ["china"] };
const unrelated = "Samsung, SK Hynix shares plunge on China competition fears - Investing.com";
const now = new Date().toISOString();
const article = (title, extra = {}) => ({ source: "Google News", title, published: now, url: "https://example.com/news", ...extra });

test("geography is not an issuer alias, including preexisting unsafe aliases", () => {
  assert.equal(identity.match(stock, unrelated), null);
  assert.equal(identity.match(stock, "Visa gets Beijing's green light after working with China"), null);
  assert.deepEqual(identity.aliasesFor(stock.name), ["china sxt pharmaceuticals"]);
  assert.equal(identity.match(stock, "China SXT Pharmaceuticals reports results").kind, "company-name");
  for (const country of ["China", "Canadian", "European", "American", "Global"]) {
    assert.equal(identity.match({ ticker: "ZZZX", name: `${country} Resources Inc`, aliases: [country] }, `${country} markets rise`), null);
  }
});

test("symbol matching requires whole symbols, respects classes and common words", () => {
  for (const [ticker, title] of [["F", "$FLYE rises"], ["ON", "$ONCO rises"], ["AI", "$AIP rises"], ["ABC", "ABC123 rises"], ["BRK", "$BRK.B rises"], ["BRK", "BRK-B rises"], ["COST", "COST cuts hit industry"], ["ARM", "ARM of government"]]) {
    assert.equal(identity.match({ ticker }, title), null, `${ticker}: ${title}`);
  }
  for (const [ticker, title] of [["F", "$F rises"], ["COST", "NASDAQ: COST rises"], ["BRK.B", "$BRK.B rises"], ["NVDA", "NVDA rises"], ["AI", "$AI rises"]]) {
    assert.ok(identity.match({ ticker }, title), title);
  }
  assert.equal(identity.match({ ticker: "NVDA" }, "nvda"), null, "bare symbols retain case evidence");
});

test("distinctive company names survive punctuation without matching substrings or publishers", () => {
  assert.ok(identity.match({ ticker: "META", name: "Meta Platforms Inc" }, "Meta shares rise"));
  assert.ok(identity.match({ ticker: "BAC", name: "Bank of America" }, "BANK OF AMERICA CORP reports results"));
  assert.equal(identity.match({ ticker: "AAPL", name: "Apple Inc." }, "Apple’s earnings rise").value, "apple");
  assert.equal(identity.match({ ticker: "WDC", name: "Western Digital Corp" }, "Western Digital sinks").value, "western digital");
  assert.equal(identity.match({ ticker: "AAPL", name: "Apple Inc." }, "Pineapple prices jump"), null);
  assert.equal(identity.match({ ticker: "AAPL", name: "Apple Inc." }, "Unrelated product launch - Apple", { source: "Google News" }), null);
  assert.equal(identity.match(stock, "Memory stocks fall example.com China", { source: "GDELT News" }), null);
});

test("actual collection rejects unrelated targeted search results and retains matching provenance", () => {
  registerStock(stock.ticker, stock.name, stock.aliases);
  const events = [];
  collectMentions(events, "Google News", unrelated, "https://example.com/wrong", 3, now, stock.ticker);
  assert.equal(events.length, 0, "target ticker is a filter, not identity evidence");
  collectMentions(events, "Google News", "SXTC reports quarterly results", "https://example.com/right", 3, now, stock.ticker);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].companyMatch, { version: 1, kind: "symbol", value: "SXTC" });
  const output = aggregate(events, {});
  assert.equal(output[0].mentions, 3);
  assert.equal(output[0].latest[0].companyMatch.kind, "symbol");
});

test("saved mismatches are quarantined and affected source totals excluded, never reconstructed", () => {
  const bad = article(unrelated), good = article("SXTC reports quarterly results");
  const raw = { ...stock, sources: { "Google News": 20, ApeWisdom: 5 }, latest: [bad, good], topHeadline: bad,
    previousCoverage: ["Google News", "ApeWisdom"], sentiment: .8, momentum: 100 };
  const clean = quality.normalizeSignal(raw);
  assert.equal(clean.sources["Google News"], 0);
  assert.equal(clean.mentions, 5);
  assert.equal(clean.sentiment, null);
  assert.equal(clean.momentum, null);
  assert.equal(clean.topHeadline, null);
  assert.deepEqual(clean.latest, [good]);
  assert.deepEqual(clean.quarantinedNews, [bad]);
  assert.deepEqual(clean.previousCoverage, ["ApeWisdom"]);
  assert.deepEqual(quality.normalizeSignal(clean), clean, "normalization is idempotent");
  assert.equal(raw.sources["Google News"], 20, "original snapshot is not mutated");
});

test("multi-day aggregation cannot restore quarantined source weights or lose the audit record", () => {
  const signals = extra => [{ ...stock, sources: { "Google News": 7 }, latest: [], ...extra }];
  const rows = quality.aggregateSignals([
    { date: "2026-10-12", signals: signals({ latest: [article(unrelated)] }) },
    { date: "2026-10-13", signals: signals({ latest: [article("SXTC reports earnings")] }) },
  ]);
  assert.equal(rows[0].sources["Google News"], 0);
  assert.equal(rows[0].quarantinedNews.length, 1);
  assert.equal(rows[0].latest.length, 1);
});

test("market news builder rejects a falsely attached stock even with real fresh price action", () => {
  const quote = { ...stock, source: "Price/Volume", lastPrice: 1, priceMove: -26, relativeVolume: 2, marketMetricsVersion: 2, quoteAsOf: now };
  assert.deepEqual(buildMarketNews([quote, { ...stock, ...article(unrelated) }]), []);
  assert.equal(buildMarketNews([quote, { ...stock, ...article("SXTC reports earnings") }]).length, 1);
});

test("headline gate is shared by collection, both browser aggregation paths and saved news feed", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const enhancements = readFileSync(new URL("../../enhancements.js", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="company-identity.js') < html.indexOf('src="data-quality.js'));
  assert.match(enhancements, /articleMatches\(entry, entry\)/);
  assert.match(enhancements, /articleMatches\(entry, item\)/);
  assert.equal(quality.articleMatches(article(unrelated), stock), false);
});

test("recorded distinctive aliases remain inspectable but cannot override absent text or unsafe aliases", () => {
  const google = article("Google reports earnings", { companyMatch: { version: 1, kind: "company-name", value: "google" } });
  assert.equal(identity.articleMatches(google, { ticker: "GOOGL", name: "Alphabet Inc" }), true);
  assert.equal(identity.articleMatches({ ...google, title: "Unrelated earnings" }, { ticker: "GOOGL", name: "Alphabet Inc" }), false);
  assert.equal(identity.articleMatches(article(unrelated, { companyMatch: { version: 1, kind: "company-name", value: "china" } }), stock), false);
});

test("actual browser news feed uses the HTTP snapshot and remains independent of board filters", () => {
  const context = vm.createContext({ window: { SIGNALDESK_QUALITY: quality }, document: { getElementById: () => null }, localStorage: { getItem: () => null }, Intl, Date, URL, URLSearchParams, console });
  vm.runInContext(readFileSync(new URL("../../script.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, ""), context);
  vm.runInContext(readFileSync(new URL("../../enhancements.js", import.meta.url), "utf8").replace("  install();", "  window.testFeed = marketNewsFeed;"), context);
  const market = { marketMetricsVersion: 2, lastPrice: 10, priceMove: 3, relativeVolume: 2, quoteAsOf: now };
  context.fixture = { signals: [], marketNews: [
    { ...market, ...stock, ...article(unrelated) },
    { ...market, ticker: "WDC", name: "Western Digital", ...article("Western Digital reports earnings") },
  ] };
  vm.runInContext("snapshot=fixture; filteredSignals=()=>[];", context);
  assert.deepEqual(Array.from(context.window.testFeed(4), row => row.ticker), ["WDC"]);
  context.fixture = { signals: [{ ...market, ticker: "WDC", name: "Western Digital", sources: { "Price/Volume": 1 }, latest: [article("Western Digital reports earnings")] }] };
  vm.runInContext("snapshot=fixture;", context);
  assert.deepEqual(Array.from(context.window.testFeed(4), row => row.ticker), ["WDC"], "legacy fallback is global too");
  const markup = context.quarantinedNewsMarkup({ quarantinedNews: [article('<img onerror="bad">', { url: "javascript:alert(1)" }), article("Original report")], excludedNewsSources: ["Google News"] });
  assert.doesNotMatch(markup, /href="javascript:|<img/);
  assert.match(markup, /href="https:\/\/example.com\/news"/);
});

test("market measurements cannot become fallback social chatter after a headline is removed", () => {
  const item = quality.normalizeSignal({ ...stock, sources: { "Price/Volume": 1 }, latest: [article(unrelated), { source: "Price/Volume", title: "SXTC price falls", published: now }] });
  assert.equal(quality.scopeSignal(item, quality.SOURCES).topHeadline, null);
});
