import { test } from "node:test";
import assert from "node:assert/strict";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import model from "../../research-model.js";
import { collectTechnology, fetchSource, extractFeed } from "../lib/technology-monitor.mjs";
import { buildDocumentInventory } from "../lib/research-intelligence.mjs";
import { sourceReceipt } from "./helpers/source-receipt.mjs";

const now = "2026-11-02T18:50:00.000Z", before = "2026-11-02T13:49:21.571Z";
const ast = config.sources.find(s => s.id === "ast-investor");
const paused = config.sources.filter(s => s.accessStatus === "permission-required");

test("AST website access is paused separately from its active SEC source", () => {
  assert.equal(ast.accessStatus, "permission-required");
  assert.equal(ast.termsUrl, "https://ast-science.com/terms-of-service/");
  assert.equal(ast.sourceReviewedAt, "2026-11-02");
  assert.match(ast.accessNote, /AST SEC filings continue separately/);
  const sec = config.sources.find(s => s.id === "sec-asts");
  assert.equal(sec.format, "sec"); assert.equal(sec.cik, "0001780312");
  assert.notEqual(sec.accessStatus, "permission-required");
  assert.ok(config.companies.some(c => c.ticker === "ASTS"));
});

test("direct fetch and adapter dispatch cannot bypass a configured permission pause", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw Error("must not request"); };
  for (const source of [...paused, { ...ast, format: "hn" }]) {
    await assert.rejects(fetchSource(source, {}, { fetchImpl }), /paused pending permission review/);
  }
  assert.equal(calls, 0);
});

test("forced collection preserves historical source receipts and events without making a request", async () => {
  const item = { url: "https://investors.ast-science.com/historical", title: "Historical satellite test", publishedAt: null };
  const previous = { generatedAt: before, sources: { [ast.id]: { id: ast.id, sourceUrl: ast.url, extractorVersion: 4,
    status: "ok", lastSuccessAt: before, lastAttemptAt: before, baselineAt: before, items: [item], seenLinks: [item.url], fingerprint: "saved" } },
    events: [{ id: "prior-event", sourceId: ast.id, detectedAt: before, title: item.title, url: item.url }] };
  const original = structuredClone(previous);
  let calls = 0;
  const next = await collectTechnology({ sources: [ast] }, previous, { now, force: true, retryErrors: true,
    fetchImpl: async () => { calls++; throw Error("must not request"); } });
  assert.equal(calls, 0); assert.deepEqual(previous, original);
  assert.equal(next.sources[ast.id].status, "paused");
  for (const key of ["lastSuccessAt", "lastAttemptAt", "baselineAt", "items", "seenLinks", "fingerprint"]) assert.deepEqual(next.sources[ast.id][key], previous.sources[ast.id][key]);
  assert.deepEqual(next.events, previous.events);
  assert.equal(next.generatedAt, now); // Publication of the pause, not a source check.
  const audit = model.sourceAudit([ast], next, Date.parse(now));
  assert.equal(audit.active, 0); assert.equal(audit.readable, 0); assert.equal(audit.groups.paused.length, 1);
});

test("paused configuration blocks new documents even if an older monitor still says ok", () => {
  const active = { ...ast }; delete active.accessStatus;
  const state = { sources: { [ast.id]: { ...sourceReceipt(active), status: "ok", lastSuccessAt: before, baselineAt: before,
    items: [{ url: "https://investors.ast-science.com/historical", title: "Historical satellite test" }] } } };
  const seed = buildDocumentInventory({ ...registry, sources: [active] }, state, {}, before);
  assert.equal(seed.documents.length, 1);
  state.sources[ast.id].items.push({ url: "https://investors.ast-science.com/not-collected", title: "New satellite headline" });
  const result = buildDocumentInventory({ ...registry, sources: [ast] }, state, seed, now);
  assert.deepEqual(result.documents, seed.documents);
  assert.deepEqual(result.documentIndex, seed.documentIndex);
  const audit = model.sourceAudit([ast], state, Date.parse(now));
  assert.equal(audit.readable, 0); assert.equal(audit.groups.paused.length, 1);
});

test("FCC feed-level build/publication dates never date individual undated documents", () => {
  const source = config.sources.find(s => s.id === "fcc-releases");
  const xml = `<rss><channel><pubDate>Mon, 02 Nov 2026 18:43:04 GMT</pubDate><lastBuildDate>Mon, 02 Nov 2026 18:43:04 GMT</lastBuildDate>
    <item><title>Satellite communications notice</title><link>https://www.fcc.gov/edoc/123</link></item></channel></rss>`;
  const result = extractFeed(xml, source);
  assert.equal(result.items.length, 1); assert.equal(result.items[0].publishedAt, null);
});
