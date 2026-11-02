import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import model from "../../research-model.js";
import config from "../../research-config.js";
import { researchHealth } from "../lib/research-health.mjs";

const now = Date.parse("2026-10-14T02:00:00Z");
const source = { id: "test", name: "Test source", mode: "links", url: "https://example.org/feed", intervalHours: 24, freshnessHours: 36, expectedCadence: "Irregular" };
const state = { status: "ok", sourceUrl: source.url, lastSuccessAt: new Date(now).toISOString(), lastAttemptAt: new Date(now).toISOString(), matchedItems: 3, newestPublicationAt: "2026-10-01" };
const audit = (patch = {}, sourcePatch = {}) => model.sourceAudit([{ ...source, ...sourcePatch }], { sources: { test: { ...state, ...patch } } }, now);
const context = { window: { SIGNALDESK_RESEARCH_MODEL: model, SIGNALDESK_RESEARCH_CONFIG: config }, URL, Date, Intl };
vm.runInNewContext(readFileSync(new URL("../../research-views.js", import.meta.url), "utf8"), context);
const views = context.window.SIGNALDESK_RESEARCH_VIEWS;

test("source audit separates readable transport from missing and quiet content", () => {
  assert.equal(audit().groups.readable.length, 1);
  for (const patch of [{ matchedItems: 0 }, { matchedItems: null }, { matchedItems: -1 }, { newestPublicationAt: null }, { newestPublicationAt: "2027-01-01" }, { datedItems: 0 }]) {
    const result = audit(patch);
    assert.equal(result.readable, 1);
    assert.equal(result.contentIssues, 1);
    assert.equal(result.collectionIssues, 0);
  }
  assert.equal(audit({}, { quietAfterDays: 7 }).rows[0].label, "Content quiet");
  assert.equal(audit({}, { quietAfterDays: 30 }).contentIssues, 0);
});

test("irregular filings and undated product pages are not arbitrarily declared stale", () => {
  assert.equal(audit({ newestPublicationAt: "2026-01-01" }, { format: "sec", tier: "filing" }).contentIssues, 0);
  assert.equal(audit({ newestPublicationAt: null, matchedItems: 0 }, { mode: "page" }).contentIssues, 0);
});

test("paused, failed, unknown and mismatched source checks cannot count as readable", () => {
  for (const patch of [{ status: "paused" }, { status: "error", error: "HTTP 403" }, { status: "pending" }, { lastSuccessAt: "2026-10-01" }, { lastSuccessAt: null }, { lastSuccessAt: "2027-01-01" }, { sourceUrl: "https://example.org/old" }]) assert.equal(audit(patch).readable, 0);
  const paused = audit({}, { accessStatus: "permission-required" });
  assert.equal(paused.active, 0); assert.equal(paused.groups.paused.length, 1);
  assert.equal(paused.collectionIssues, 0);
  assert.match(audit({ status: "error", error: "HTTP 403" }).rows[0].next, /Do not bypass/);
});

test("empty and missing monitor states remain unknown, not healthy zero samples", () => {
  const empty = model.sourceAudit([], null, now);
  assert.equal(empty.active, 0); assert.equal(empty.readable, 0);
  const missing = model.sourceAudit([source], null, now);
  assert.equal(missing.collectionIssues, 1); assert.equal(missing.rows[0].label, "Check unconfirmed");
});

test("source triage sorts collection problems first and keeps all sources exactly once", () => {
  const sources = [source, { ...source, id: "failed", name: "Failed" }, { ...source, id: "paused" }, { ...source, id: "ok" }];
  const result = model.sourceAudit(sources, { sources: { test: { ...state, matchedItems: 0 }, failed: { ...state, status: "error" }, paused: { ...state, status: "paused" }, ok: state } }, now);
  assert.equal(result.groups.attention[0].source.id, "failed");
  assert.equal(result.active, 3); assert.equal(result.readable, 2);
  assert.equal(Object.values(result.groups).flat().length, 4);
});

test("health view is compact, escaped, explicit about dates and offers a recovery route", () => {
  const sources = [{ ...source, name: "<script>source</script>", limitation: "<img src=x>" }, { ...source, id: "paused", accessStatus: "permission-required" }];
  const html = views.sourceHealth(sources, { generatedAt: state.lastSuccessAt, sources: { test: { ...state, status: "error", error: "HTTP 403 <script>" } } }, { now });
  assert.match(html, /data-disclosure="sources-attention" open/);
  assert.match(html, /data-disclosure="sources-paused"/);
  assert.doesNotMatch(html, /data-disclosure="sources-paused" open/);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>|<img/);
  for (const text of ["Last success", "Last attempt", "Newest publication", "Active feeds readable", "Content checks", "Collection checks", "not a quality score", "data-open-discovery-scan", "Reloading does not run the collector", "does not automatically establish"]) assert.ok(html.includes(text), text);
  const loading = views.sourceHealth([], null, { loading: true, now });
  assert.match(loading, /data-refresh-monitor disabled/);
});

test("health disclosure persists on rerender and stays reachable under empty theme filters", () => {
  const js = readFileSync(new URL("../../adoption.js", import.meta.url), "utf8");
  assert.ok(js.indexOf('else if (view === "inbox") content.innerHTML = renderInbox(themes)') < js.indexOf('else if (!themes.length)'));
  assert.match(js, /const sources = data.sources/);
  const html = views.sourceHealth([source], { sources: { test: state } }, { now });
  assert.match(html, /id="researchSourceHealth" data-disclosure="source-health"/);
});

test("scheduled watchdog shares source identity checks and warns on non-discovery content gaps", () => {
  const scope = { sources: [source], companies: [{ ticker: "TEST" }] };
  const research = { schemaVersion: 1, documents: [], reviews: [], sourceCheckedAt: state.lastSuccessAt, generatedAt: state.lastSuccessAt, coverage: { totalSources: 1 }, companies: { TEST: { ...companyQuoteFixture("TEST", state.lastSuccessAt), factsCheckedAt: state.lastSuccessAt } } };
  const monitor = { schemaVersion: 1, events: [], generatedAt: state.lastSuccessAt, sources: { test: { ...state, id: "test", matchedItems: 0 } } };
  const result = researchHealth(research, monitor, now, scope);
  assert.equal(result.ok, true); assert.equal(result.contentChecks, 1);
  assert.match(result.warnings.join("\n"), /No matching|no matching/);
  const wrong = researchHealth(research, { ...monitor, sources: { test: { ...state, id: "test", sourceUrl: "https://example.org/retired" } } }, now, scope);
  assert.equal(wrong.ok, false); assert.equal(wrong.sourceCoverage, "0/1 active");
});
import { companyQuoteFixture } from "./helpers/company-quote.mjs";
