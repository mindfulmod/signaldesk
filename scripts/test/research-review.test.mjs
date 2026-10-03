import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import model from "../../research-model.js";
import { appendReviews } from "../review-evidence.mjs";

const document = { id: "candidate-1", sourceId: "qs-news", owner: "QuantumScape", url: "https://example.org/article", title: "Source result", themes: ["solid-state-batteries"], changeType: "baseline", detectedAt: "2026-10-02T12:00:00Z" };
const review = { id: "review-test-1", candidateId: document.id, sourceId: document.sourceId, owner: document.owner, url: document.url, reviewer: "Test reviewer", reviewedAt: "2026-10-02T12:00:00Z", decision: "accepted", reason: "The primary source supports this bounded claim.", themeId: "solid-state-batteries", claim: "A pilot was demonstrated.", metric: "Pilot test", period: "2026 sample", caveat: "Not commercial output.", kind: "pilot", qualifier: "reported", value: null, unit: "statement", definition: "Laboratory test only.", publishedAt: null, supersedes: null };
const options = { config, themeIds: registry.themes.map(t => t.id), documents: [document], knownIds: [] };

test("review validation requires provenance, named reviewer and bounded evidence", () => {
  assert.deepEqual(model.validateReview(review, options), []);
  for (const change of [{ owner: "Other company" }, { url: "javascript:alert(1)" }, { sourceId: "other" }, { reason: "ok" }, { reviewer: "" }, { caveat: "" }, { value: NaN }, { qualifier: "exact", value: null }]) assert.ok(model.validateReview({ ...review, ...change }, options).length);
});
test("targets retain their type and numeric lower bounds cannot become exact claims", () => {
  assert.ok(model.validateReview({ ...review, kind: "target" }, options).length);
  assert.ok(model.validateReview({ ...review, qualifier: "target" }, options).length);
  assert.deepEqual(model.validateReview({ ...review, kind: "target", qualifier: "target" }, options), []);
  assert.ok(model.validateReview({ ...review, qualifier: "lower-bound" }, options).length);
  assert.deepEqual(model.validateReview({ ...review, qualifier: "lower-bound", value: 10 }, options), []);
});
test("tracker observations reject wrong dimensions, units, themes and invalid percentages", () => {
  const metric = { ...review, entityId: "program:qs-eagle", metricKey: "yield", unit: "%", value: 90 };
  assert.deepEqual(model.validateReview(metric, options), []);
  for (const change of [{ unit: "GWh" }, { value: 101 }, { value: -1 }, { value: null }, { themeId: "satellite-phones" }, { metricKey: "throughput" }, { entityId: "unknown" }]) assert.ok(model.validateReview({ ...metric, ...change }, options).length);
});
test("review imports are append-only and idempotent; changed IDs require a correction", () => {
  const once = appendReviews({ reviews: [] }, [review], [document]);
  assert.deepEqual(appendReviews(once, [review], [document]), once);
  assert.throws(() => appendReviews(once, [{ ...review, claim: "Edited in place" }], [document]), /immutable/);
  assert.throws(() => appendReviews({ reviews: [] }, [review], []), /Candidate not found/);
});
test("corrections replace active evidence but retain the original in history", () => {
  const replacement = { ...review, id: "review-test-2", supersedes: review.id, claim: "A narrower corrected claim" };
  const result = appendReviews({ reviews: [review] }, [replacement], [document]);
  assert.equal(result.reviews.length, 2);
  assert.deepEqual(model.activeReviews(result.reviews).map(r => r.id), [replacement.id]);
  const themes = model.reviewedThemes(registry.themes, result.reviews);
  assert.ok(themes[0].evidence.some(e => e.id === replacement.id));
  assert.ok(!themes[0].evidence.some(e => e.id === review.id));
  assert.throws(() => appendReviews(result, [{ ...replacement, id: "review-test-3" }], [document]), /already corrected/);
});
test("cross-theme corrections and rejected replacements cannot alter published evidence", () => {
  assert.throws(() => appendReviews({ reviews: [review] }, [{ ...review, id: "review-test-2", supersedes: review.id, themeId: "satellite-phones" }], [document]), /original technology/);
  assert.throws(() => appendReviews({ reviews: [review] }, [{ ...review, id: "review-test-2", supersedes: review.id, decision: "rejected" }], [document]), /rejected candidate/);
});
test("brief excludes baseline backfill and globally reviewed candidates", () => {
  const second = { ...document, id: "new-doc", changeType: "new-document" };
  const research = { generatedAt: "2026-10-02T12:00:00Z", documents: [document, second], reviews: [] };
  const before = model.buildBrief({ themes: registry.themes, research, now: Date.parse("2026-10-02T13:00:00Z") });
  assert.deepEqual(before.documents.map(d => d.id), ["new-doc"]);
  research.reviews = [{ ...review, candidateId: "new-doc", decision: "rejected" }];
  assert.equal(model.buildBrief({ themes: registry.themes, research, now: Date.parse("2026-10-02T13:00:00Z") }).documents.length, 0);
});
test("brief follows the selected theme scope and flags future or stale snapshots", () => {
  const result = model.buildBrief({ themes: registry.themes, followed: ["satellite-phones"], research: { generatedAt: "2027-01-01" }, now: Date.parse("2026-10-02") });
  assert.equal(result.selected.length, 1); assert.equal(result.selected[0].id, "satellite-phones");
  assert.equal(result.checkedState, "invalid"); assert.equal(model.freshness("invalid"), "missing");
});
const context = { window: { SIGNALDESK_RESEARCH_CONFIG: config, SIGNALDESK_RESEARCH_MODEL: model }, URL, Intl, Date };
vm.runInNewContext(readFileSync(new URL("../../research-views.js", import.meta.url), "utf8"), context);
const views = context.window.SIGNALDESK_RESEARCH_VIEWS;
test("company views work without data and never manufacture a zero quote", () => {
  const html = views.companies(registry.themes, null, "QS");
  assert.match(html, /Quote unavailable/); assert.match(html, /Not disclosed \/ unavailable/);
  assert.match(html, /Price alone cannot establish/);
  assert.ok(!html.includes("0 USD"));
});
test("tracker comparisons retain unknowns, source dates and product limitations", () => {
  const state = { compare: [], batteryStage: "all", country: "all", serviceStatus: "all" };
  const battery = views.trackers("batteries", null, state), satellite = views.trackers("satellite", null, state);
  assert.equal((battery.match(/<td><span class="intel-unknown">Not established/g) || []).length, 15);
  assert.match(battery, /original 2023 target/); assert.match(satellite, /South of the 58th parallel/);
  assert.match(satellite, /not proof of conventional voice service/);
});
test("untrusted source and review text is escaped in queues and editors", () => {
  const malicious = { ...document, title: '<img src=x onerror="alert(1)">', excerpt: "<script>bad()</script>" };
  const state = { drafts: [], reviewFilter: "pending", dismissed: [], showDismissed: false, queueLimit: 24 };
  const queue = views.reviewQueue(registry.themes, { documents: [malicious], reviews: [] }, state);
  const editor = views.reviewEditor(malicious, registry.themes, [], { reviewer: '" autofocus onfocus="alert(1)' });
  assert.ok(!queue.includes("<img")); assert.ok(!queue.includes("<script>")); assert.match(queue, /&lt;img/);
  assert.ok(!editor.includes('value="" autofocus')); assert.match(editor, /&quot;/);
});
test("all research scripts load in dependency order and HTTP does not preload large JS twins", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const scripts = ["research-config.js", "technology-registry.js", "research-model.js", "research-views.js", "adoption.js"];
  for (let i = 1; i < scripts.length; i++) assert.ok(html.indexOf('src="' + scripts[i]) > html.indexOf('src="' + scripts[i - 1]));
  assert.ok(!html.includes('src="data/research.js')); assert.match(html, /"research"/);
});
test("seven-day research jobs publish separately and both writers serialize", () => {
  const read = name => readFileSync(new URL("../../.github/workflows/" + name, import.meta.url), "utf8");
  const research = read("refresh-research.yml"), market = read("refresh-data.yml"), watchdog = read("research-watchdog.yml");
  assert.match(research, /43 0,6,12,18 \* \* \*/);
  for (const workflow of [research, market]) { assert.match(workflow, /group: signaldesk-data-writer/); assert.match(workflow, /verify-publication.mjs/); assert.match(workflow, /git pull --rebase origin main/); }
  assert.match(watchdog, /check-research-health.mjs --live/);
  assert.ok(!market.includes("node scripts/update-technology.mjs\n"));
});
