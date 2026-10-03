import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUrl, extractSource, updateSource, collectTechnology, fetchSource, publicMonitor, textOnly } from "../lib/technology-monitor.mjs";

const source = { id: "test", url: "https://research.example/news", allowedHosts: ["research.example"], themes: ["battery"], owner: "Test company", name: "Test page", mode: "links", terms: ["battery"], intervalHours: 24 };
const now = "2026-10-02T12:00:00Z", later = "2026-10-03T12:00:00Z";
const page = (link = "/battery-test", label = "Battery pilot production test", extra = "") => `<html><title>Research newsroom</title><main><h1>Battery research</h1><p>${"Public test page with research information. ".repeat(5)}</p><a href="${link}">${label}</a>${extra}</main><footer>Changes every second</footer></html>`;
const response = body => new Response(body, { headers: { "Content-Type": "text/html", ETag: '"baseline"' } });

test("monitor canonicalizes tracking links but retains meaningful query parameters", () => {
  assert.equal(canonicalUrl("/battery?id=4&utm_source=test#x", source.url, source.allowedHosts), "https://research.example/battery?id=4");
  for (const url of ["http://research.example/x", "https://evil.example/x", "https://user:pass@research.example/x", "https://research.example:9000/x", "javascript:alert(1)"]) assert.equal(canonicalUrl(url, source.url, source.allowedHosts), null);
});
test("extractor ignores chrome and deduplicates source links", () => {
  const result = extractSource(page("/battery?utm_source=a", "Battery pilot test", '<a href="/battery?utm_source=b">Battery pilot test</a><a href="https://evil.example/battery">Battery invented</a>'), source);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].url, "https://research.example/battery");
  assert.equal(textOnly('<script>secret()</script><p>A &amp; B &#x2014; &#99999999;</p>'), "A & B —");
});
test("challenges, empty HTML and irrelevant source pages are failures, not healthy zeros", () => {
  assert.throws(() => extractSource('<title>Just a moment</title>' + page(), source), /challenge/);
  assert.throws(() => extractSource('<div id="app"></div>', source), /too little/);
  assert.throws(() => extractSource("<main>" + "Irrelevant news. ".repeat(30) + "</main>", { ...source, mode: "page" }), /terms are absent/);
});
test("an empty article does not hide real content and newsrooms can have no topic matches", () => {
  assert.equal(extractSource("<article></article>" + page(), source).items.length, 1);
  assert.equal(extractSource("<main>" + "Other company news. ".repeat(20) + "</main>", source).items.length, 0);
});
test("unresolved template hrefs never become source links", () => {
  const html = page("/real-battery", "Battery real link", '<a :href="linkDetails.href">Battery bad binding</a><a data-href="/bad">Battery bad data</a><a href="linkDetails.href">Battery unresolved</a>');
  assert.equal(extractSource(html, source).items.length, 1);
});
test("extractor or source changes establish a new baseline, not fake news", () => {
  const first = updateSource(source, null, extractSource(page(), source), now).state;
  assert.equal(updateSource(source, { ...first, extractorVersion: 0 }, extractSource(page("/new-battery"), source), later).events.length, 0);
  assert.equal(updateSource({ ...source, url: "https://research.example/replacement" }, first, extractSource(page(), source), later).events.length, 0);
});
test("first successful check establishes a baseline without false fresh-news alerts", () => {
  const update = updateSource(source, null, extractSource(page(), source), now);
  assert.equal(update.events.length, 0); assert.equal(update.state.baselineAt, now);
  assert.equal(update.state.lastChangedAt, null);
});
test("new links enter an unverified deduplicated queue and reappearing links do not re-alert", () => {
  const first = updateSource(source, null, extractSource(page(), source), now).state;
  const next = updateSource(source, first, extractSource(page("/battery-two"), source), later);
  assert.equal(next.events.length, 1); assert.equal(next.events[0].verification, "unreviewed"); assert.equal(next.events[0].publishedAt, null);
  const repeat = updateSource(source, next.state, extractSource(page(), source), later);
  assert.equal(repeat.events.length, 0);
});
test("page changes are candidates, never parsed into verified numeric claims", () => {
  const s = { ...source, mode: "page" }, first = updateSource(s, null, extractSource(page(), s), now).state;
  const next = updateSource(s, first, extractSource(page("/battery-test", "Battery pilot output changed"), s), later);
  assert.equal(next.events[0].kind, "page-change"); assert.equal(next.events[0].verification, "unreviewed"); assert.equal(next.events[0].value, undefined);
});
test("failure preserves prior evidence baseline and successful time; recovery resets streak", () => {
  const first = updateSource(source, null, extractSource(page(), source), now).state;
  const failed = updateSource(source, first, { error: "HTTP 403" }, later);
  assert.equal(failed.state.lastSuccessAt, now); assert.equal(failed.state.fingerprint, first.fingerprint); assert.equal(failed.state.failureStreak, 1); assert.deepEqual(failed.events, []);
  const recovered = updateSource(source, failed.state, { notModified: true }, later);
  assert.equal(recovered.state.status, "ok"); assert.equal(recovered.state.failureStreak, 0);
  assert.equal(updateSource(source, null, { notModified: true }, now).state.status, "error");
});
test("source cadence avoids repeat requests and empty runs keep last collection time", async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return response(page()); };
  const first = await collectTechnology({ sources: [source] }, {}, { now, fetchImpl });
  const next = await collectTechnology({ sources: [source] }, first, { now: "2026-10-02T18:00:00Z", fetchImpl });
  assert.equal(calls, 1); assert.deepEqual(next, first);
  await collectTechnology({ sources: [source] }, next, { now: later, fetchImpl }); assert.equal(calls, 2);
});
test("one unavailable source does not stop the other checks or erase existing events", async () => {
  const second = { ...source, id: "second", url: "https://research.example/second" };
  const old = { id: "old", detectedAt: now, verification: "unreviewed" };
  const result = await collectTechnology({ sources: [source, second] }, { events: [old] }, { now, fetchImpl: async url => { if (url === source.url) throw new Error("Network failed"); return response(page()); } });
  assert.equal(result.sources.test.status, "error"); assert.equal(result.sources.second.status, "ok"); assert.deepEqual(result.events, [old]);
});
test("304 conditional fetches preserve baseline and validate redirect hosts", async () => {
  let headers;
  const result = await fetchSource(source, { fingerprint: "x", etag: '"test"' }, { fetchImpl: async (_, options) => { headers = options.headers; return new Response(null, { status: 304 }); } });
  assert.equal(result.notModified, true); assert.equal(headers["If-None-Match"], '"test"');
  let calls = 0;
  await assert.rejects(fetchSource(source, {}, { fetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/private" } }); } }), /allowlisted/);
  assert.equal(calls, 1);
});
test("oversized and non-HTML content is rejected before becoming a baseline", async () => {
  await assert.rejects(fetchSource(source, {}, { fetchImpl: async () => new Response("{}", { headers: { "Content-Type": "application/json" } }) }), /HTML/);
  await assert.rejects(fetchSource(source, {}, { maxBytes: 100, fetchImpl: async () => response(page()) }), /size limit/);
});
test("public monitor output omits internal content fingerprints and link history", () => {
  const first = updateSource(source, null, extractSource(page(), source), now).state;
  const publicState = publicMonitor({ sources: { test: first }, events: [] }).sources.test;
  for (const key of ["fingerprint", "items", "seenLinks", "etag"]) assert.equal(publicState[key], undefined);
  assert.equal(publicState.lastSuccessAt, now);
});
