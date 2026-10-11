import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import config from "../../research-config.js";
import model from "../../research-model.js";
import techModel from "../../technology-model.js";
import { communityItem, communityLink, fetchCommunity } from "../lib/research-community.mjs";
import { buildDocumentInventory, discoverTopics, topicPhrases } from "../lib/research-intelligence.mjs";
import { collectTechnology, extractFeed } from "../lib/technology-monitor.mjs";
import { researchHealth } from "../lib/research-health.mjs";

const now = "2026-10-11T02:00:00Z";
const hn = config.sources.find(s => s.id === "hn-discovery");
const lab = { id: "lab", owner: "Lab", name: "Lab feed", tier: "research", url: "https://example.org/feed", mode: "links", format: "rss", themes: [], terms: [], discovery: true, intervalHours: 24 };
const row = (id, extra = {}) => ({ id, type: "story", title: "New technical work", time: Date.parse("2026-10-10T12:00:00Z") / 1000, score: 42, descendants: 8, url: "https://example.org/story", ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const state = sources => Object.fromEntries(sources.map(s => [s.id, { id: s.id, status: "ok", lastSuccessAt: now, newestPublicationAt: now, matchedItems: 10, datedItems: 10 }]));
const doc = (id, title, source = lab, extra = {}) => ({ id, title, owner: source.owner, tier: source.tier, sourceId: source.id, discovery: true, themes: [], url: `https://example.org/${id}`, publishedAt: "2026-10-10", detectedAt: now, ...extra });

test("discovery contracts widen topics without company keyword gates", () => {
  const feeds = config.sources.filter(s => s.discovery);
  assert.equal(feeds.length, 5);
  assert.ok(feeds.every(s => !s.terms.length));
  assert.equal(config.sources.find(s => s.id === "microsoft-news").discovery, undefined);
  assert.equal(config.sources.some(s => s.id === "mit-energy"), false);
  assert.ok(feeds.some(s => s.tier === "community"));
  assert.ok(feeds.every(s => s.purpose && s.limitation && s.quietAfterDays));
});
test("source health labels share the watchdog's 36-hour freshness window", () => {
  const source = config.sources.find(s => s.id === "nsf-research");
  const past = new Date(Date.parse(now) - 40 * 3600000).toISOString();
  assert.equal(techModel.monitorState(source, { status: "ok", lastAttemptAt: past, lastSuccessAt: past }, new Date(now)), "stale");
  assert.ok(config.sources.every(s => s.freshnessHours === 36));
});
test("MIT contract stores link metadata without republishing the feed excerpt", () => {
  const source = config.sources.find(s => s.id === "mit-research");
  const xml = '<rss><channel><item><title>New technique</title><link>https://news.mit.edu/2026/new</link><description>Article excerpt</description><pubDate>2026-10-10</pubDate></item></channel></rss>';
  assert.equal(extractFeed(xml, source).items[0].excerpt, "");
});
test("community keeps submission dates and nullable observations, not a claim of adoption", () => {
  const item = communityItem(row(42, { title: "A &amp; B &#x2014; sensors", score: null, descendants: -1 }), 42, now);
  assert.equal(item.title, "A & B — sensors");
  assert.equal(item.dateKind, "community-submission");
  assert.equal(item.engagement.points, null); assert.equal(item.engagement.comments, null);
  assert.equal(item.url, "https://news.ycombinator.com/item?id=42");
  assert.equal(communityItem(row(42, { deleted: true }), 42, now), null);
  assert.equal(communityItem(row(42, { type: "job" }), 42, now), null);
  assert.throws(() => communityItem(row(42), 43, now), /identity/);
  assert.throws(() => communityItem(row(42, { time: Date.parse(now) / 1000 + 1 }), 42, now), /date/);
});
test("community outbound links reject unsafe targets and strip tracking", () => {
  for (const url of ["javascript:alert(1)", "http://example.org", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/", "https://a.internal/a", "https://user:pass@example.org", "https://example.org:8080/"]) assert.equal(communityLink(url), null);
  assert.equal(communityLink("https://example.org/work?utm_source=hn#part"), "https://example.org/work");
});
test("community collection is bounded, deduplicated and only fetches official API URLs", async () => {
  const requests = [], live = new Set(); let peak = 0;
  const fetchImpl = async (url, init) => {
    requests.push(url); assert.ok(url.startsWith("https://hacker-news.firebaseio.com/v0/")); assert.equal(init.redirect, "error");
    if (url.endsWith("topstories.json")) return json(Array.from({ length: 500 }, (_, i) => i + 1));
    if (url.endsWith("newstories.json")) return json(Array.from({ length: 500 }, (_, i) => i + 21));
    if (url.endsWith("showstories.json")) return json(Array.from({ length: 200 }, (_, i) => i + 101));
    const id = Number(url.match(/item\/(\d+)/)[1]); live.add(id); peak = Math.max(peak, live.size); await Promise.resolve(); live.delete(id);
    return json(row(id, { url: `https://unfetched.example/${id}` }));
  };
  const result = await fetchCommunity(hn, { fetchImpl, now });
  assert.equal(result.items.length, 50); assert.equal(requests.length, 53); assert.ok(peak <= 3);
  const changed = await fetchCommunity(hn, { fetchImpl: async (url, init) => {
    const r = await fetchImpl(url, init), value = await r.json(); return json(Array.isArray(value) ? value : { ...value, score: value.score + 100 });
  }, now });
  assert.equal(result.fingerprint, changed.fingerprint, "vote changes are not new content");
});
test("partial community failures cannot masquerade as complete coverage", async () => {
  let calls = 0;
  const result = await collectTechnology({ sources: [hn] }, {}, { now, fetchImpl: async url => { calls++; return url.includes("stories") ? json([42]) : new Response(null, { status: 403 }); } });
  assert.equal(result.sources[hn.id].status, "error");
  assert.match(result.sources[hn.id].error, /Incomplete community sample/);
  assert.equal(calls, 4);
});
test("engagement changes update the existing record without creating a revision", () => {
  const item = communityItem(row(42), 42, now), registry = { sources: [hn], themes: [] };
  const snapshot = { sources: { [hn.id]: { status: "ok", lastSuccessAt: now, baselineAt: now, items: [item] } } };
  const first = buildDocumentInventory(registry, snapshot, {}, now);
  snapshot.sources[hn.id].items[0].engagement.points = 99;
  const second = buildDocumentInventory(registry, snapshot, first, now);
  assert.equal(second.documents.length, 1); assert.equal(second.documents[0].id, first.documents[0].id);
  assert.equal(second.documents[0].engagement.points, 99); assert.equal(second.documents[0].announcementAt, null);
});
test("open scan includes unexpected terms, excludes mapped themes and balances source volume", () => {
  const documents = [doc("unknown", "A completely unfamiliar gizmo"), doc("mapped", "An existing theme", lab, { themes: ["known"] }), ...Array.from({ length: 30 }, (_, i) => doc(`c${i}`, `New project ${i}`, hn))];
  const result = discoverTopics(documents, [], {}, now, [lab, hn], state([lab, hn]));
  assert.ok(result.openScan.includes("unknown")); assert.ok(!result.openScan.includes("mapped"));
  assert.deepEqual(result.openScan.slice(0, 2), ["unknown", "c0"]);
  assert.equal(result.unmatchedDocuments, 31);
});
test("community reposts of a primary story are not independent corroboration", () => {
  const documents = [doc("primary", "Quantum error correction", lab), doc("discussion", "Quantum error correction is promising", hn, { linkedUrl: "https://example.org/primary" })];
  const result = discoverTopics(documents, [], {}, now, [lab, hn], state([lab, hn]));
  assert.equal(result.candidates[0].recentDocuments, 1);
  assert.deepEqual(result.candidates[0].owners, ["Lab"]);
});
test("fragment cleanup retains the useful technical phrase", () => {
  assert.deepEqual(topicPhrases("Control where semiconductor"), []);
  assert.ok(!topicPhrases("6 eV bandgap semiconductor").includes("ev bandgap semiconductor"));
  assert.ok(topicPhrases("6 eV bandgap semiconductor").includes("bandgap semiconductor"));
});
test("an interrupted monitoring window never yields a growth rate", () => {
  const rows = [doc("recent", "Quantum error correction"), doc("prior", "Quantum error correction improves", lab, { publishedAt: "2026-09-20" })];
  const first = discoverTopics(rows, [], {}, now, [lab], state([lab]));
  first.history = Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.parse(now) - (i === 0 ? 0 : i + 1) * 86400000).toISOString().slice(0, 10), topics: [] }));
  const next = discoverTopics(rows, [], first, now, [lab], state([lab]));
  assert.equal(next.comparableDays, 28); assert.equal(next.candidates[0].momentumPercent, null);
});
test("retention gaps remain flagged after unchanged records are evicted", () => {
  const registry = { sources: [lab], themes: [] };
  const snapshot = { sources: { lab: { status: "ok", lastSuccessAt: now, items: Array.from({ length: 4001 }, (_, i) => ({ title: `Quantum sensor ${i}`, url: `https://example.org/${i}`, publishedAt: "2026-10-10" })) } } };
  const first = buildDocumentInventory(registry, snapshot, {}, now);
  const second = buildDocumentInventory(registry, snapshot, first, now);
  assert.equal(first.discoveryTruncated, true); assert.equal(second.discoveryTruncated, true);
  const discovery = discoverTopics(second.documents, [], {}, now, [lab], state([lab]), second);
  assert.equal(discovery.history.length, 1, "successful checks accumulate while old gaps age out");
  assert.equal(discovery.discoveryTruncated, true);
  assert.ok(discovery.candidates.every(c => c.momentumPercent === null));
});
test("even 28 successful checks cannot produce momentum from a clipped archive", () => {
  const rows = [doc("recent", "Quantum error correction"), doc("prior", "Quantum error correction improves", lab, { publishedAt: "2026-09-20" })];
  const first = discoverTopics(rows, [], {}, now, [lab], state([lab]));
  first.history = Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.parse(now) - (i + 1) * 86400000).toISOString().slice(0, 10), topics: [] }));
  assert.equal(discoverTopics(rows, [], first, now, [lab], state([lab])).candidates[0].momentumPercent, 0);
  assert.equal(discoverTopics(rows, [], first, now, [lab], state([lab]), { discoveryTruncated: true }).candidates[0].momentumPercent, null);
});
test("discovery watchdog detects a lost lane even when total source coverage passes", () => {
  const sources = [hn, ...Array.from({ length: 6 }, (_, i) => ({ ...lab, id: `s${i}` }))];
  const states = state(sources); states[hn.id].status = "error";
  const research = { generatedAt: now, coverage: { totalSources: sources.length }, companies: { QS: { quote: { asOf: now }, factsCheckedAt: now } } };
  const health = researchHealth(research, { sources: states }, Date.parse(now), { sources, companies: [{ ticker: "QS" }] });
  assert.match(health.errors.join(" "), /community lane/); assert.equal(health.sourceCoverage, "6/7 active");
  states[hn.id].status = "ok"; states[hn.id].newestPublicationAt = "2026-09-01";
  assert.match(researchHealth(research, { sources: states }, Date.parse(now), { sources, companies: [{ ticker: "QS" }] }).warnings.join(" "), /readable does not mean fresh content/);
});

const context = { window: { SIGNALDESK_RESEARCH_CONFIG: config, SIGNALDESK_RESEARCH_MODEL: model }, URL, Intl, Date };
vm.runInNewContext(readFileSync(new URL("../../research-views.js", import.meta.url), "utf8"), context);
const views = context.window.SIGNALDESK_RESEARCH_VIEWS;
test("discovery UI separates traction from attention, escapes sources and exposes evidence", () => {
  const d = doc("safe", "Quantum sensors <script>alert(1)</script>");
  const discovery = discoverTopics([d], [], {}, now, [lab], state([lab]));
  const research = { discovery, documents: [d] };
  const html = views.discovery(research, "", []);
  assert.match(html, /Adoption not established/); assert.match(html, /Next check/);
  assert.match(html, /Coverage &amp; collection method/); assert.match(html, /data-discovery-mode="open"/);
  assert.doesNotMatch(html, /<script>/); assert.doesNotMatch(html, /NaN|undefined|Infinity/);
  const scan = views.discovery(research, "", [], false, { mode: "open" });
  assert.match(scan, /No keyword gate/); assert.match(scan, /&lt;script&gt;/);
});
test("discovery saved and filter empty states keep recovery and retention limits visible", () => {
  assert.match(views.discovery({}, "", ["expired"], true), /Remove unavailable saved lead/);
  assert.match(views.discovery({}, "no match", [], false, { lane: "community" }), /Try All signals/);
  assert.doesNotMatch(views.discovery(null, "", []), /NaN|undefined|Infinity/);
});
