import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import notebook from "../../discovery-notebook.js";
import researchModel from "../../research-model.js";
const now = "2026-10-13T23:00:00Z", today = now.slice(0, 10);
const document = { id: "source", title: "A new sensor", owner: "Lab", url: "https://example.org/paper", publishedAt: "2026-10-01" };
const research = { documents: [document], discovery: { candidates: [{ id: "topic", phrase: "New sensors", documentIds: ["source"] }] } };
const fields = { title: "New sensors", hypothesis: "Customers may use a new low-power sensor", metric: "Customer deliveries", unit: "units", scope: "Quarterly units delivered to external customers in Canada", nextCheck: "Find an original customer delivery report and check repeat orders", reviewOn: "2026-10-20", status: "watching" };
const plan = () => notebook.updatePlan(notebook.seed("story:source", research, now), fields, now);
const observation = extra => ({ id: "obs-1", value: 0, qualifier: "reported", periodEnd: "2026-09-30", publishedAt: "2026-10-01", url: "https://example.org/report", owner: "Supplier", caveat: "Company reported; customer confirmation still needed", recordedAt: now, withdrawn: false, ...extra });
test("investigation seed preserves link metadata but does not invent an adoption metric", () => {
  const draft = notebook.seed("story:source", research, now);
  assert.equal(draft.metric, ""); assert.deepEqual(draft.origins, [document]); assert.deepEqual(draft.observations, []);
  assert.equal(notebook.seed("topic", research, now).title, "New sensors");
  assert.equal(notebook.seed("story:missing", research, now), null);
  assert.ok(notebook.validatePlan(draft, today).length);
});
test("plans require a hypothesis, a defined metric, scope and review checkpoint", () => {
  assert.deepEqual(notebook.validatePlan(plan(), today), []);
  for (const name of ["hypothesis", "scope", "nextCheck", "metric", "unit", "reviewOn"]) assert.throws(() => notebook.updatePlan(plan(), { ...fields, [name]: "" }, now));
  assert.throws(() => notebook.updatePlan(plan(), { ...fields, reviewOn: "2026-02-30" }, now), /date/);
});
test("observations preserve zero and cannot turn missing or invalid numbers into zero", () => {
  assert.deepEqual(notebook.validateObservation(observation(), today), []);
  for (const value of [null, "", "0", NaN, Infinity, -1]) assert.match(notebook.validateObservation(observation({ value }), today).join(" "), /numeric value/);
});
test("reported periods cannot be future or later than the cited publication", () => {
  assert.match(notebook.validateObservation(observation({ periodEnd: "2026-10-20" }), today).join(" "), /future/);
  assert.match(notebook.validateObservation(observation({ periodEnd: "2026-10-02" }), today).join(" "), /after the source/);
  assert.match(notebook.validateObservation(observation({ publishedAt: "2026-10-14" }), today).join(" "), /future/);
  assert.match(notebook.validateObservation(observation({ periodEnd: "2026-02-30" }), today).join(" "), /valid date/);
});
test("targets retain their own qualifier and may refer to a future date", () => {
  const target = observation({ qualifier: "target", periodEnd: "2027-01-01" });
  assert.deepEqual(notebook.validateObservation(target, today), []);
  assert.equal(notebook.addObservation(plan(), target, now).observations[0].qualifier, "target");
});
test("observation provenance rejects unsafe URLs and missing limitations", () => {
  for (const url of ["javascript:alert(1)", "http://example.org", "https://a:b@example.org", "https://example.org:9999/"]) assert.match(notebook.validateObservation(observation({ url }), today).join(" "), /HTTPS/);
  assert.match(notebook.validateObservation(observation({ caveat: "" }), today).join(" "), /limitations/);
});
test("metric definitions cannot silently change after observations, including withdrawn ones", () => {
  const p = notebook.addObservation(plan(), observation({ withdrawn: true }), now);
  for (const key of ["metric", "unit", "scope"]) assert.throws(() => notebook.updatePlan(p, { ...fields, [key]: "Different definition" }, now), /fixed/);
  assert.equal(notebook.updatePlan(p, { ...fields, nextCheck: "Find a corrected primary report" }, now).observations.length, 1);
});
test("observation IDs and series size remain bounded", () => {
  const p = notebook.addObservation(plan(), observation(), now);
  assert.throws(() => notebook.addObservation(p, observation(), now), /unique/);
  assert.match(notebook.validatePlan({ ...plan(), observations: Array.from({ length: 41 }, (_, i) => observation({ id: `obs-${i}` })) }, today).join(" "), /40/);
});
test("backups round-trip without claiming editorial verification", () => {
  const p = notebook.addObservation(plan(), observation(), now), bundle = notebook.bundle([p]);
  assert.match(bundle.note, /Not published verification/);
  assert.deepEqual(notebook.importBundle(JSON.stringify(bundle), [], today), [p]);
  assert.deepEqual(notebook.importBundle(JSON.stringify(bundle), [p], today), [p]);
});
test("conflicting or corrupt imports are atomic and leave existing research untouched", () => {
  const p = plan(), existing = [p], changed = { ...p, title: "Different title" };
  assert.throws(() => notebook.importBundle(JSON.stringify(notebook.bundle([changed])), existing, today), /already exists/);
  assert.deepEqual(existing, [p]);
  for (const raw of ["{", "null", JSON.stringify({ plans: [] }), JSON.stringify(notebook.bundle([p, p])), JSON.stringify(notebook.bundle([{ ...p, observations: [null] }]))]) assert.throws(() => notebook.importBundle(raw, existing, today));
});
test("only active investigations with a due date become review checkpoints", () => {
  assert.equal(notebook.due({ ...plan(), reviewOn: today }, today), true);
  assert.equal(notebook.due(plan(), today), false);
  for (const status of ["paused", "closed"]) assert.equal(notebook.due({ ...plan(), status, reviewOn: today }, today), false);
});
test("imported chronology and percentage ranges cannot fabricate valid observations", () => {
  assert.match(notebook.validatePlan({ ...plan(), unit: "%", observations: [observation({ value: 101 })] }, today).join(" "), /exceed 100/);
  assert.match(notebook.validatePlan({ ...plan(), updatedAt: "2026-10-12T00:00:00Z" }, today).join(" "), /predate/);
  assert.match(notebook.validateObservation(observation({ recordedAt: "2026-10-14T00:00:00Z" }), today).join(" "), /recording date/);
});
const context = { window: { SIGNALDESK_DISCOVERY_NOTEBOOK: notebook, SIGNALDESK_RESEARCH_MODEL: researchModel }, Intl };
vm.runInNewContext(readFileSync(new URL("../../discovery-notebook-views.js", import.meta.url), "utf8"), context);
const views = context.window.SIGNALDESK_NOTEBOOK_VIEWS;
test("notebook UI escapes personal content and distinguishes targets, bounds and withdrawal", () => {
  const p = { ...plan(), title: "<script>alert(1)</script>", observations: [observation({ qualifier: "target", withdrawn: true, periodEnd: "2027-01-01" }), observation({ id: "obs-2", qualifier: "lower-bound" })] };
  const html = views.editor(p, true);
  assert.doesNotMatch(html, /<script>|NaN|undefined/);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /Target—not achieved/); assert.match(html, /Lower bound—not exact/); assert.match(html, /Withdrawn/); assert.match(html, /readonly/);
  assert.match(html, /No automatic growth score/); assert.match(html, /not notifications/);
});
test("empty and saved notebooks have useful recovery and provenance", () => {
  assert.match(views.shelf([]), /Investigate/); assert.match(views.shelf([]), /Import backup/);
  assert.match(views.editor(plan(), true), /Unknown is not zero/);
  assert.match(views.editor(plan(), true), /What sparked this investigation/);
});
test("stock-board column sizing cannot leak into research tables", () => {
  const layout = readFileSync(new URL("../../layout-fix.js", import.meta.url), "utf8");
  assert.doesNotMatch(layout, /^\s+(?:th|td):nth-child/m);
  assert.match(layout, /\.table-panel th:nth-child\(1\)/);
});
