import { test } from "node:test";
import assert from "node:assert/strict";
import model from "../../research-model.js";
import { collectTechnology, extractFeed, fetchSource, sourceDue, updateSource, publicMonitor } from "../lib/technology-monitor.mjs";
import { buildDocumentInventory } from "../lib/research-intelligence.mjs";
import { discoveryHistory, recordDiscoveryDay } from "../lib/discovery-history.mjs";

const source = { id: "lab", name: "Lab feed", owner: "Lab", tier: "research", url: "https://example.org/feed", allowedHosts: ["example.org"],
  mode: "links", format: "rss", terms: ["battery"], themes: [], cadence: "daily", intervalHours: 24, freshnessHours: 36, discovery: true };
const now = "2026-11-02T12:00:00Z", later = "2026-11-02T13:00:00Z";
const xml = '<rss><channel><item><title>Battery pilot</title><link>https://example.org/battery</link><pubDate>2026-11-01</pubDate></item><item><title>Satellite rollout</title><link>https://example.org/satellite</link><pubDate>2026-11-01</pubDate></item></channel></rss>';
const baseline = () => updateSource(source, null, { ...extractFeed(xml, source), etag: '"stable"', lastModified: "Sun, 01 Nov 2026 12:00:00 GMT" }, now).state;
const response = () => new Response(xml, { headers: { "content-type": "application/rss+xml", etag: '"stable"' } });

test("same-URL keyword changes force a new extraction without reusing conditional validators", async () => {
  const prior = baseline(), changed = { ...source, terms: ["satellite"] };
  assert.equal(sourceDue(source, prior, later), false);
  assert.equal(sourceDue(changed, prior, later), true);
  let request;
  const result = await collectTechnology({ sources: [changed] }, { sources: { lab: prior } }, { now: later, fetchImpl: async (_, options) => {
    request = options; return options.headers["If-None-Match"] ? new Response(null, { status: 304 }) : response();
  } });
  assert.equal(request.headers["If-None-Match"], undefined); assert.equal(request.headers["If-Modified-Since"], undefined);
  assert.deepEqual(result.sources.lab.items.map(i => i.title), ["Satellite rollout"]);
  assert.equal(result.sources.lab.lastSuccessAt, later); assert.equal(result.events.length, 0, "new filter results establish a baseline, not breaking-news alerts");
  assert.equal(model.sourceCompatible(changed, result.sources.lab), true);
  assert.equal(prior.items[0].title, "Battery pilot", "the input archive was not mutated");
});

test("extraction and provenance fields invalidate content, but set order and cadence copy do not", () => {
  const prior = baseline();
  for (const patch of [{ allowedHosts: ["example.org", "other.example"] }, { mode: "page" }, { format: "html" }, { linkPattern: "/new/" },
    { cik: "42" }, { enrichArticles: true }, { metadataOnly: true }, { owner: "Other publisher" }, { name: "Renamed source" }, { themes: ["other"] }, { tier: "community" }, { discovery: false }]) {
    assert.equal(model.sourceCompatible({ ...source, ...patch }, prior), false, JSON.stringify(patch));
  }
  const a = { ...source, terms: ["battery", "satellite"], allowedHosts: ["a.example", "b.example"] };
  const b = { ...a, terms: ["SATELLITE", "battery", "battery"], allowedHosts: ["b.example", "a.example"], intervalHours: 12, limitation: "Clarified caveat" };
  assert.equal(model.sourceContract(a), model.sourceContract(b));
});

test("unchanged contracts retain efficient 304 checks and original publication dates", async () => {
  const prior = baseline(); let headers;
  const fetched = await fetchSource(source, prior, { fetchImpl: async (_, options) => { headers = options.headers; return new Response(null, { status: 304 }); } });
  const update = updateSource(source, prior, fetched, later);
  assert.equal(headers["If-None-Match"], '"stable"'); assert.equal(update.state.lastSuccessAt, later);
  assert.deepEqual(update.state.items, prior.items); assert.equal(update.state.items[0].publishedAt, "2026-11-01");
  assert.deepEqual(update.events, []);
  assert.equal(publicMonitor({ sources: { lab: update.state } }).sources.lab.sourceContract, model.sourceContract(source));
});

test("unsolicited 304 after a contract change cannot re-certify old filtered items", async () => {
  const prior = baseline(), changed = { ...source, terms: ["satellite"] };
  const next = await collectTechnology({ sources: [changed] }, { sources: { lab: prior } }, { now: later, fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(next.sources.lab.status, "error"); assert.equal(next.sources.lab.lastSuccessAt, now);
  assert.equal(next.sources.lab.sourceContract, prior.sourceContract); assert.deepEqual(next.sources.lab.items, prior.items);
  assert.equal(model.sourceAudit([changed], next, Date.parse(later)).readable, 0);
  assert.equal(sourceDue(changed, next.sources.lab, later), false, "failed migration respects backoff");
  assert.equal(sourceDue(changed, next.sources.lab, "2026-11-02T14:00:00Z"), true);
  assert.equal(sourceDue(source, next.sources.lab, later), true, "reverting settings does not inherit another contract's retry deadline");
});

test("legacy receipts remain historical until actually re-collected; no synthetic migration stamps", async () => {
  const legacy = baseline(); delete legacy.sourceContract;
  assert.equal(sourceDue(source, legacy, later), true);
  const audit = model.sourceAudit([source], { sources: { lab: legacy } }, Date.parse(later));
  assert.equal(audit.readable, 0); assert.match(audit.rows[0].label, /unconfirmed/);
  const next = await collectTechnology({ sources: [source] }, { sources: { lab: legacy } }, { now: later, fetchImpl: async (_, options) => {
    assert.equal(options.headers["If-None-Match"], undefined); return response();
  } });
  assert.equal(model.sourceAudit([source], next, Date.parse(later)).readable, 1);
  assert.equal(next.events.length, 0);
});

test("the publication-date parser migration cannot renew an old Atom cache with a 304", async () => {
  const prior = baseline();
  prior.extractorVersion = 4;
  const oldContract = JSON.parse(prior.sourceContract);
  oldContract[1] = 4; prior.sourceContract = JSON.stringify(oldContract);
  const original = structuredClone(prior);
  const atom = '<feed><entry><title>Battery pilot</title><link href="https://example.org/battery"/><updated>2026-11-02T11:00:00Z</updated></entry></feed>';
  const next = await collectTechnology({ sources: [source] }, { sources: { lab: prior } }, { now: later, fetchImpl: async (_, options) => {
    assert.equal(options.headers["If-None-Match"], undefined);
    assert.equal(options.headers["If-Modified-Since"], undefined);
    return new Response(atom, { headers: { "content-type": "application/atom+xml" } });
  } });
  assert.equal(model.sourceCompatible(source, next.sources.lab), true);
  assert.equal(next.sources.lab.items[0].publishedAt, null);
  assert.equal(next.sources.lab.items[0].sourceModifiedAt, "2026-11-02T11:00:00.000Z");
  assert.equal(next.sources.lab.datedItems, 0);
  assert.deepEqual(next.events, []);
  assert.deepEqual(prior, original, "the old receipt remains an unchanged historical record");
});

test("incompatible source data cannot enter current inventory or create a daily discovery receipt", () => {
  const prior = baseline(), changed = { ...source, terms: ["satellite"] };
  const registry = { sources: [source], themes: [] };
  const first = buildDocumentInventory(registry, { sources: { lab: prior } }, {}, now);
  const retained = buildDocumentInventory({ ...registry, sources: [changed] }, { sources: { lab: prior } }, first, later);
  assert.deepEqual(retained.documents, first.documents);
  const audit = discoveryHistory([changed], { lab: prior }, {}, later);
  assert.equal(audit.healthy, false); assert.equal(audit.collectedToday, false);
  assert.deepEqual(recordDiscoveryDay(audit, [], 0), []);
});

test("legacy comparison history is retained outside the new contract's comparable window", () => {
  const state = baseline();
  const previous = { coverageKey: "pre-contract", history: [{ date: "2026-11-01", topics: [], sourceChecks: [{ id: source.id, checkedAt: "2026-11-01T12:00:00Z" }] }] };
  const audit = discoveryHistory([source], { lab: state }, previous, later);
  assert.equal(audit.comparableHistory.length, 0); assert.equal(audit.legacyHistory.length, 1); assert.equal(audit.completeHistory, false);
});

test("paused sources remain unrequested even during contract migration", async () => {
  let calls = 0;
  const paused = { ...source, accessStatus: "permission-required" };
  const result = await collectTechnology({ sources: [paused] }, { sources: { lab: baseline() } }, { now: later, force: true, fetchImpl: async () => { calls++; return response(); } });
  assert.equal(calls, 0); assert.equal(result.sources.lab.status, "paused");
  assert.equal(sourceDue(source, result.sources.lab, later), true, "a deliberate future unpause needs a new check");
});

test("contract migrations retain seen URLs so returning older stories do not re-alert", () => {
  const prior = baseline(), changed = { ...source, terms: ["satellite"] };
  const migrated = updateSource(changed, prior, extractFeed(xml, changed), later).state;
  assert.ok(migrated.seenLinks.includes("https://example.org/battery"));
  const returned = xml.replace("Battery pilot", "Satellite battery pilot");
  const next = updateSource(changed, migrated, extractFeed(returned, changed), "2026-11-03T12:00:00Z");
  assert.equal(next.events.length, 0);
  assert.equal(next.state.items.length, 2, "the revised story remains available to the document revision inventory");
});
