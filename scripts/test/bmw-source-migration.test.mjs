import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import { fetchSource, extractFeed, updateSource, sourceDue } from "../lib/technology-monitor.mjs";
import { buildDocumentInventory } from "../lib/research-intelligence.mjs";

const source = config.sources.find(s => s.id === "bmw-news");
const now = "2026-11-02T16:00:00.000Z", oldTime = "2026-10-15T12:00:00.000Z";
const feed = `<rss><channel><item><title>BMW Group begins series production of Gen6 high-voltage batteries in Shenyang</title>
<link>https://newsroom.bmwgroup.com/global/bmw-group-begins-series-production-of-gen6-high-voltage-batteries-in-shenyang/</link>
<description>Battery announcement excerpt; should not be republished.</description><pubDate>Thu, 15 Oct 2026 08:00:00 +0200</pubDate></item>
<item><title>New motorcycle announcement</title><link>https://newsroom.bmwgroup.com/global/motorcycle/</link><pubDate>Thu, 15 Oct 2026 08:00:00 +0200</pubDate></item></channel></rss>`;

test("BMW uses the publisher-linked RSS contract, original dates and metadata only", () => {
  assert.equal(source.format, "rss"); assert.equal(source.metadataOnly, true);
  assert.equal(source.url, "https://newsroom.bmwgroup.com/global/tagfeed/en/tags/focus_news");
  assert.deepEqual(source.allowedHosts, ["newsroom.bmwgroup.com"]);
  const result = extractFeed(feed, source);
  assert.equal(result.extractedEntries, 2); assert.equal(result.items.length, 1);
  assert.equal(result.items[0].publishedAt, "2026-10-15T06:00:00.000Z");
  assert.equal(result.items[0].excerpt, "");
});

test("newsroom migration establishes a baseline, preserves historical documents and does not imply solid-state proof", () => {
  const oldSource = { ...source, url: "https://www.press.bmwgroup.com/global", format: "html", allowedHosts: ["www.press.bmwgroup.com"] };
  const oldResult = { fingerprint: "old", items: [{ url: "https://www.press.bmwgroup.com/global/article/detail/old", title: "BMW battery announcement", publishedAt: "2026-10-15" }] };
  const prior = updateSource(oldSource, null, oldResult, oldTime).state;
  assert.equal(sourceDue(source, prior, now), true);
  const oldDocs = buildDocumentInventory({ sources: [oldSource], themes: registry.themes }, { sources: { [source.id]: prior } }, {}, oldTime);
  const migrated = updateSource(source, prior, extractFeed(feed, source), now);
  assert.deepEqual(migrated.events, []); assert.equal(migrated.state.baselineAt, now);
  const result = buildDocumentInventory({ sources: [source], themes: registry.themes }, { sources: { [source.id]: migrated.state } }, oldDocs, now);
  assert.ok(result.documents.some(d => d.id === oldDocs.documents[0].id && d.detectedAt === oldTime));
  const newDoc = result.documents.find(d => d.url.includes("newsroom.bmwgroup.com"));
  assert.equal(newDoc.changeType, "baseline"); assert.deepEqual(newDoc.themes, []);
  assert.deepEqual(newDoc.associatedThemes, ["solid-state-batteries"]);
  assert.equal(newDoc.publishedAt, "2026-10-15T06:00:00.000Z");
  assert.equal(newDoc.verification, "unreviewed");
});

test("BMW feed does not permit unrelated redirect hosts or disguise access failures", async () => {
  await assert.rejects(fetchSource(source, {}, { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example/feed" } }) }), /allowlisted/);
  await assert.rejects(fetchSource(source, {}, { fetchImpl: async () => new Response("Service unavailable", { status: 503 }) }), /HTTP 503/);
});
