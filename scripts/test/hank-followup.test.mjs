import { test } from "node:test";
import assert from "node:assert/strict";
import identity from "../../company-identity.js";
import quality from "../../data-quality.js";
import registry from "../../technology-registry.js";
import { aggregate, registerStock, isCompanyMatch } from "../update-data.mjs";
import { computeCoMention, isoWeekKey } from "../lib/co-mention.mjs";
import { buildDocumentInventory } from "../lib/research-intelligence.mjs";
import { upsertRow, mergeBackfillRows } from "../lib/ledger.mjs";

const now = "2026-10-16T12:00:00.000Z";
test("Hank: VINCI COMPASS and SEC MA/A form tokens are not the tracked issuers", () => {
  const compass = { ticker: "CMPS", name: "Compass Pathways plc", aliases: ["compass"] };
  assert.equal(identity.match(compass, "VINCI COMPASS announces a strategic partnership", { source: "Press Releases" }), null);
  assert.equal(identity.match(compass, "MA/A - Compass Securities Corporation", { source: "SEC Filings" }), null);
  assert.equal(identity.match({ ticker: "MA", name: "Mastercard Incorporated" }, "MA/A - Pickwick Capital Partners, LLC (0001459183) (Filer)", { source: "SEC Filings" }), null);
  assert.ok(identity.match(compass, "Compass Pathways reports clinical results"));
  assert.ok(identity.match({ ticker: "MA", name: "Mastercard Incorporated" }, "10-K - Mastercard Incorporated", { source: "SEC Filings" }));
  assert.ok(identity.match({ ticker: "MA" }, "NYSE: MA reports earnings"));
});

test("Hank: Applied Digital prefix match is rejected in collection and saved display", () => {
  const summary = { title: "Applied Digital Data Systems", type: "standard", description: "American computer company", extract: "Applied Digital Data Systems was an American computer company." };
  assert.equal(isCompanyMatch("Applied Digital", summary), false);
  assert.equal(isCompanyMatch("Applied Digital", { ...summary, title: "Applied Digital", extract: "Applied Digital is an American data center company." }), true);
  for (const version of [2, 3]) assert.equal(quality.normalizeSignal({ ticker: "APLD", name: "Applied Digital", profileIdentityVersion: version, profileTitle: summary.title, description: summary.extract }).description, null);
  assert.equal(quality.normalizeSignal({ ticker: "APLD", name: "Applied Digital", profileIdentityVersion: 3, profileTitle: "Applied Digital Corporation", description: "Verified title." }).description, "Verified title.");
});

test("Hank: authoritative CIK identity replaces social names before aggregation", () => {
  registerStock("CD", "Chindata Group Holdings", ["chindata"]);
  registerStock("CD", "Chaince Digital Holdings Inc.", [], { title: "Chaince Digital Holdings Inc.", cik: "1527762" }, now);
  const [row] = aggregate([{ ticker: "CD", name: "Chindata Group Holdings", source: "ApeWisdom", mentions: 3, published: now }], {
    signals: [{ ticker: "CD", name: "Chindata Group Holdings", lastPrice: 8, quoteAsOf: "2023-01-01", sources: {} }],
  }, { generatedAt: now });
  assert.equal(row.name, "Chaince Digital Holdings Inc.");
  assert.equal(row.issuerIdentity.cik, "0001527762");
  assert.deepEqual(row.providerNames, ["Chindata Group Holdings"]);
  assert.equal(row.lastPrice, null, "a prior issuer's quote is not carried forward");
  assert.ok(!row.aliases.includes("chindata"));
  const old = { ticker: "CD", name: "Chindata Group Holdings", sources: { ApeWisdom: 99 }, latest: [] };
  const current = { ...row, sources: { ApeWisdom: 3 } };
  const mixed = quality.aggregateSignals([{ date: "2023-01-01", signals: [old] }, { date: "2026-10-16", signals: [current] }]);
  assert.equal(mixed[0].name, current.name); assert.equal(mixed[0].mentions, 3);
  assert.equal(quality.aggregateSignals([{ date: "2023-01-01", signals: [old] }])[0].name, old.name, "old observations are not relabeled");
  assert.equal(identity.sameIssuer({ ...current, issuerIdentity: { cik: "1" } }, current), false);
});

test("Hank: ledger identity boundaries retain old rows separately and reject cross-boundary backfill", () => {
  const old = { meta: { name: "Chindata Group", article: "Chindata", firstSeen: "2023-01-01" }, rows: [["2023-01-01", 2, .1, 8, 100, 9]] };
  const ledger = { tickers: { CD: structuredClone(old) } };
  const meta = { name: "Chaince Digital Holdings", issuerIdentity: { cik: "0001527762" } };
  upsertRow(ledger, "CD", meta, ["2026-10-16", 3, .1, 2, 200, null]);
  assert.deepEqual(ledger.issuerArchives.CD[0].rows, old.rows);
  assert.equal(ledger.tickers.CD.meta.article, undefined);
  mergeBackfillRows(ledger, "CD", [["2023-01-01", 8, 100], ["2026-10-16", 2, 200]]);
  assert.equal(ledger.tickers.CD.rows.length, 1);
  upsertRow(ledger, "CD", meta, ["2026-10-17", 4, .1, 3, 300, null]);
  assert.equal(ledger.issuerArchives.CD.length, 1);
});

const graphEvents = (title, published, tickers = ["AAPL", "NVDA"]) => tickers.map(ticker => ({ ticker, title, published, url: "https://example.org/reused", source: "Press Releases" }));
test("Hank: revised URL evidence uses its observation week, preserving original publication and revisions", () => {
  for (const original of ["2026-10-06", "2026-07-01"]) {
    const first = computeCoMention({}, graphEvents("$AAPL and $AMD initial report", original, ["AAPL", "AMD"]), original);
    const revised = computeCoMention(first.nextHistory, graphEvents("$AAPL and $NVDA new agreement", original), "2026-10-14");
    const record = Object.values(revised.nextHistory.documents)[0];
    assert.equal(record.published, original);
    assert.equal(record.week, isoWeekKey(new Date("2026-10-14")));
    assert.equal(record.revisions.length, 2);
    assert.equal(record.revisions[0].observations[0].title, "$AAPL and $AMD initial report");
    assert.deepEqual(revised.nextHistory.weeks[record.week], { "AAPL|NVDA": 1 });
    const replay = computeCoMention(revised.nextHistory, graphEvents("$AAPL and $NVDA new agreement", original), "2026-10-21");
    assert.deepEqual(replay.nextHistory.documents, revised.nextHistory.documents, "replay does not renew the observation");
    const correction = computeCoMention(replay.nextHistory, graphEvents("$AAPL corrected solo report", original, ["AAPL"]), "2026-10-22");
    assert.deepEqual(correction.nextHistory.weeks, {}, "latest version replaces, never unions, headline issuers");
  }
});

const source = { id: "bmw", owner: "BMW", mode: "links", themes: ["solid-state-batteries"], discovery: true };
const scope = { sources: [source], themes: registry.themes };
const state = (title, extra = {}) => ({ sources: { bmw: { status: "ok", lastSuccessAt: now, items: [{ title, url: "https://example.org/story", publishedAt: "2026-10-15", ...extra }] } } });
test("Hank: BMW Gen6 is related context, not direct solid-state evidence; AI glasses is discoverable", () => {
  const title = "BMW Group starts Gen6 high-voltage battery series production";
  const first = buildDocumentInventory(scope, state(title), {}, now);
  assert.deepEqual(first.documents[0].themes, []);
  assert.deepEqual(first.documents[0].associatedThemes, ["solid-state-batteries"]);
  const previous = structuredClone(first); previous.documents[0].themes = ["solid-state-batteries"];
  const corrected = buildDocumentInventory(scope, state(title), previous, now);
  assert.equal(corrected.documents[0].id, first.documents[0].id);
  assert.deepEqual(corrected.documents[0].themes, []);
  for (const positive of ["BMW tests all-solid-state battery cells", "Solid-state lithium-metal batteries enter tests", "ASSB research advances"]) {
    assert.deepEqual(buildDocumentInventory(scope, state(positive), {}, now).documents[0].themes, ["solid-state-batteries"]);
  }
  assert.deepEqual(buildDocumentInventory(scope, state("AI glasses enter customer trials"), {}, now).documents[0].themes, ["ai-glasses"]);
  for (const title of ["EssilorLuxottica reports annual earnings", "Waymo hires a finance executive", "Microsoft reports earnings", "Starlink launches more satellites"]) {
    assert.deepEqual(buildDocumentInventory(scope, state(title), {}, now).documents[0].themes, [], title);
  }
});

test("Hank: unchanged evicted text can be restored without new dates or document identity", () => {
  const first = buildDocumentInventory(scope, state("AI glasses customer test"), {}, now);
  const original = first.documents[0];
  const evicted = { ...first, documents: [] };
  const restored = buildDocumentInventory(scope, state("AI glasses customer test"), evicted, now);
  assert.equal(restored.documents.length, 1);
  assert.equal(restored.documents[0].id, original.id);
  assert.equal(restored.documents[0].detectedAt, original.detectedAt);
  assert.equal(restored.documents[0].firstSeenAt, original.firstSeenAt);
  assert.equal(restored.documents[0].changeType, "baseline");
  assert.deepEqual(restored.documentIndex, first.documentIndex);
  assert.equal(restored.discoveryTruncated, false);
});
