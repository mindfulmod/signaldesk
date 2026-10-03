import { test } from "node:test";
import assert from "node:assert/strict";
import { extractFeed, extractFilings, extractSource, updateSource, sourceDue, calendarDay, collectTechnology } from "../lib/technology-monitor.mjs";
import { buildDocuments, discoverTopics, topicPhrases } from "../lib/research-intelligence.mjs";
import { boundedJson } from "../lib/research-fetch.mjs";
import { researchHealth } from "../lib/research-health.mjs";
import { verifyPublication } from "../verify-publication.mjs";

const now = "2026-10-02T16:00:00.000Z";
const source = { id: "news", name: "News", owner: "Lab", tier: "research", url: "https://example.org/feed", allowedHosts: ["example.org"], mode: "links", format: "rss", terms: [], themes: [], discovery: true, cadence: "daily" };
const item = (title, url = "/article", date = "2026-10-01") => '<item><title><![CDATA[' + title + ']]></title><link>https://example.org' + url + '</link><description><![CDATA[<p>A measured result &amp; its limitations</p>]]></description><pubDate>' + date + '</pubDate></item>';
const rss = content => "<rss><channel>" + content + "</channel></rss>";
const feedResponse = body => new Response(body, { headers: { "content-type": "application/rss+xml" } });

test("RSS preserves source dates and bounded excerpts, never inventing dates", () => {
  const result = extractFeed(rss(item("Battery research", "/a") + item("Other research", "/b", "invalid")), source);
  assert.equal(result.items[0].publishedAt, "2026-10-01");
  assert.equal(result.items[1].publishedAt, null);
  assert.equal(result.items[0].excerpt, "A measured result & its limitations");
  assert.equal(result.extractedEntries, 2);
});
test("Atom selects article links instead of the self link; RDF dates are retained", () => {
  const atom = '<feed><entry><title>Quantum computing</title><link rel="self" href="https://evil.example/internal"/><link rel="alternate" href="https://example.org/article"/><published>2026-10-01</published></entry></feed>';
  assert.equal(extractFeed(atom, source).items[0].url, "https://example.org/article");
  const rdf = '<rdf:RDF><item><title>Quantum computing</title><link>https://example.org/article</link><dc:date>2026-10-01</dc:date></item></rdf:RDF>';
  assert.equal(extractFeed(rdf, source).items[0].publishedAt, "2026-10-01");
});
test("broken feeds fail while a valid feed with no relevant topic is a readable zero", () => {
  for (const input of ["<html>Error</html>", "<rss></rss>", rss('<item><title>Hi</title><link>javascript:alert(1)</link></item>')]) assert.throws(() => extractFeed(input, source));
  assert.equal(extractFeed(rss(item("General research")), { ...source, terms: ["satellite"] }).items.length, 0);
});
test("article contracts reject generic navigation, including publisher biographies", () => {
  const html = "<main><p>" + "Research news information ".repeat(10) + '</p><a href="/biography/person">Battery science biography</a></main>';
  assert.throws(() => extractSource(html, { ...source, format: "html", linkPattern: "/news/" }), /article links/);
});
test("SEC filing extraction validates identity, type and canonical accession", () => {
  const sec = { ...source, format: "sec", cik: "0000000042", owner: "Acme", allowedHosts: ["www.sec.gov"] };
  const data = { cik: "42", filings: { recent: { accessionNumber: ["0000000042-26-000001", "0000000042-26-000002"], form: ["10-Q", "4"], primaryDocument: ["report.htm", "insider.xml"], filingDate: ["2026-10-01", "2026-10-01"] } } };
  const rows = extractFilings(JSON.stringify(data), sec).items;
  assert.equal(rows.length, 1); assert.equal(rows[0].form, "10-Q");
  assert.equal(rows[0].url, "https://www.sec.gov/Archives/edgar/data/42/000000004226000001/report.htm");
  assert.throws(() => extractFilings(JSON.stringify({ ...data, cik: 43 }), sec), /identity/);
});
test("daily cadence follows Toronto dates across midnight and daylight-saving boundaries", () => {
  const prior = updateSource(source, null, extractFeed(rss(item("Battery research")), source), "2026-10-02T23:00:00Z").state;
  assert.equal(sourceDue(source, prior, "2026-10-03T03:59:00Z"), false);
  assert.equal(sourceDue(source, prior, "2026-10-03T04:01:00Z"), true);
  assert.equal(calendarDay("2026-11-01T05:30:00Z"), calendarDay("2026-11-01T06:30:00Z"));
});
test("failure retries back off without erasing a successful baseline", () => {
  let prior = updateSource(source, null, extractFeed(rss(item("Battery research")), source), now).state;
  const baseline = prior.fingerprint;
  for (const hours of [1, 2, 4, 6, 6]) {
    prior = updateSource(source, prior, { error: "HTTP 429" }, now).state;
    assert.equal(Date.parse(prior.nextAttemptAt) - Date.parse(now), hours * 3600000);
    assert.equal(prior.fingerprint, baseline);
  }
  assert.equal(sourceDue(source, prior, now), false);
});
test("collector retries transient 5xx once but never immediately retries rate limits", async () => {
  for (const status of [503, 429]) {
    let calls = 0, sleeps = 0;
    const result = await collectTechnology({ sources: [source] }, {}, { now, sleep: async () => { sleeps++; }, fetchImpl: async () => { calls++; return calls === 1 ? new Response(null, { status }) : feedResponse(rss(item("Battery research"))); } });
    assert.equal(calls, status === 503 ? 2 : 1); assert.equal(sleeps, status === 503 ? 1 : 0);
    assert.equal(result.sources.news.status, status === 503 ? "ok" : "error");
  }
});
test("document inventory separates initial backfill, new articles and source revisions", () => {
  const registry = { sources: [source], themes: [{ id: "b", aliases: ["battery"] }] };
  const first = updateSource(source, null, extractFeed(rss(item("Battery research")), source), now).state;
  const a = buildDocuments(registry, { sources: { news: first } }, {}, now);
  assert.equal(a[0].changeType, "baseline"); assert.deepEqual(a[0].themes, ["b"]);
  const later = "2026-10-03T16:00:00Z";
  const second = updateSource(source, first, extractFeed(rss(item("Battery research revised") + item("New battery study", "/b")), source), later).state;
  const b = buildDocuments(registry, { sources: { news: second } }, { documents: a }, later);
  assert.equal(b.length, 3); assert.equal(b.find(d => d.changeType === "revision").previousId, a[0].id);
  assert.ok(b.some(d => d.changeType === "new-document"));
  assert.deepEqual(buildDocuments(registry, { sources: { news: second } }, { documents: b }, later), b);
});
test("discovery extracts technical noun phrases, not loose AI verb fragments", () => {
  assert.ok(topicPhrases("New sodium ion batteries enter pilot manufacturing").includes("sodium ion batteries"));
  assert.deepEqual(topicPhrases("AI igniting the future"), []);
  assert.ok(topicPhrases("Quantum error correction improves").includes("quantum error correction"));
});
const doc = (id, title, date, owner = "Lab") => ({ id, title, publishedAt: date, owner, sourceId: "news", discovery: true, headlineSignal: "Research / test language" });
test("discovery deduplicates syndication and does not infer momentum from backfill", () => {
  const rows = [doc("a", "Quantum error correction", "2026-09-30"), doc("b", "Quantum error correction", "2026-09-30", "Republisher"), doc("c", "Quantum error correction improves", "2026-09-10")];
  const result = discoverTopics(rows, [], {}, now, [source], { news: { status: "ok", lastSuccessAt: now } });
  const lead = result.candidates.find(c => c.phrase === "quantum error correction");
  assert.equal(lead.recentDocuments, 1); assert.equal(lead.owners.length, 1); assert.equal(lead.momentumPercent, null);
  assert.equal(result.history.length, 1);
});
test("discovery coverage changes or failures cannot accumulate comparable monitoring history", () => {
  const first = discoverTopics([], [], {}, now, [source], { news: { status: "ok", lastSuccessAt: now } });
  assert.equal(discoverTopics([], [], first, now, [{ ...source, url: "https://example.org/new" }], {}).history.length, 0);
  assert.equal(discoverTopics([], [], {}, now, [source], { news: { status: "error", lastSuccessAt: now } }).history.length, 0);
});
test("a full comparable history enables story momentum, not adoption growth", () => {
  const rows = [doc("a", "Quantum error correction", "2026-09-30"), doc("b", "Quantum error correction improves", "2026-09-10")];
  const first = discoverTopics(rows, [], {}, now, [source], { news: { status: "ok", lastSuccessAt: now } });
  first.history = Array.from({ length: 28 }, (_, i) => ({ date: new Date(Date.parse(now) - (i + 1) * 86400000).toISOString().slice(0, 10), topics: [] }));
  const result = discoverTopics(rows, [], first, now, [source], { news: { status: "ok", lastSuccessAt: now } });
  assert.equal(result.candidates[0].momentumPercent, 0);
  assert.match(result.candidates[0].caveat, /not a verified/);
});
test("bounded JSON rejects HTTP, content-type and streaming size failures", async () => {
  for (const response of [new Response(null, { status: 403 }), new Response("<html>Error</html>", { headers: { "content-type": "text/html" } }), new Response('{"too":"long"}', { headers: { "content-type": "application/json" } })]) await assert.rejects(boundedJson("https://example.org", { maxBytes: 5, fetchImpl: async () => response }));
});
test("saved discovery leads remain inspectable after leaving the current window", () => {
  const first = discoverTopics([doc("a", "Quantum error correction", "2026-09-30")], [], {}, now, [source], { news: { status: "ok", lastSuccessAt: now } });
  const later = "2026-11-02T12:00:00Z";
  const next = discoverTopics([], [], first, later, [source], { news: { status: "ok", lastSuccessAt: later } });
  assert.equal(next.candidates.length, 0); assert.equal(next.archive.length, 1);
  assert.equal(next.archive[0].lastSeenAt, "2026-10-02");
});
test("health gates missing publications, incomplete coverage and stale prices", () => {
  const research = { generatedAt: now, coverage: { totalSources: 1, companies: 1 }, companies: { QS: { quote: { asOf: now } } } };
  const monitor = { sources: { news: { id: "news", status: "ok", lastSuccessAt: now } } };
  assert.equal(researchHealth(research, monitor, Date.parse(now), { sources: [{ id: "news" }], companies: [{ ticker: "QS" }] }).ok, true);
  assert.equal(researchHealth({ ...research, generatedAt: "2026-09-01" }, monitor, Date.parse(now)).ok, false);
  assert.equal(researchHealth(research, { sources: {} }, Date.parse(now)).ok, false);
  assert.equal(researchHealth({ ...research, companies: { QS: {} } }, monitor, Date.parse(now)).ok, false);
});
test("publication verification waits for the exact or newer public snapshot", async () => {
  const expected = { collectionId: "b", generatedAt: now }; let count = 0;
  assert.equal(await verifyPublication(expected, async () => ++count === 1 ? { collectionId: "a", generatedAt: now } : expected, { sleep: async () => {} }), true);
  assert.equal(count, 2);
  await assert.rejects(verifyPublication(expected, async () => ({ generatedAt: "2026-09-01" }), { attempts: 2, sleep: async () => {} }), /did not reach/);
  let clock = 0;
  await assert.rejects(verifyPublication(expected, async () => { clock += 250000; throw new Error("offline"); }, { clock: () => clock, sleep: async () => {} }), /did not reach/);
});
