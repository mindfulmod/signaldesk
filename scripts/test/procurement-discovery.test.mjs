import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { collectProcurement, publicProcurement, procurementDue, procurementHealth, validateProcurementState, procurementFreshnessErrors } from "../lib/procurement-discovery.mjs";
import { procurementRequest } from "../lib/procurement-pilot.mjs";
import notebook from "../../discovery-notebook.js";

const now = "2026-11-02T17:00:00.000Z";
const raw = (date, patch = {}) => ({ generated_internal_id: "CONT_AWD_TEST_8000_NONE_NONE", "Award ID": "TEST", Mod: "P00001", "Action Date": date, "Recipient Name": "EXAMPLE RESEARCH LLC", "Awarding Agency": "Example agency", "Award Type": "DEFINITIVE CONTRACT", "Transaction Amount": "-12.25", "Transaction Description": "Research on an unfamiliar material", NAICS: { code: "541715" }, ...patch });
const fetchSample = async (url, init) => {
  const request = JSON.parse(init.body);
  return new Response(JSON.stringify({ limit: 100, results: [raw(request.filters.time_period[0].end_date)], page_metadata: { page: 1, hasNext: true } }), { headers: { "content-type": "application/json" } });
};
const collect = (previous, options = {}) => collectProcurement(previous, { now, fetchImpl: fetchSample, sleep: async () => {}, ...options });
function view(data, query = "", options = {}) {
  const context = { window: {}, Intl, Date };
  vm.runInNewContext(readFileSync(new URL("../../procurement-views.js", import.meta.url), "utf8"), context);
  return context.window.SIGNALDESK_PROCUREMENT_VIEWS.render(data, query, { toolbar: "", now: Date.parse(now), ...options });
}
test("daily R&D intake uses two bounded windows with real observation times and no keyword gate", async () => {
  const requests = [];
  const state = await collect(null, { fetchImpl: async (url, init) => { requests.push(JSON.parse(init.body)); return fetchSample(url, init); } });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], procurementRequest(now, { delayed: true }));
  assert.deepEqual(requests[1].filters.time_period, [{ start_date: "2026-07-06", end_date: "2026-08-04" }]);
  for (const r of requests) { assert.equal(r.filters.keywords, undefined); assert.equal(r.page, 1); assert.equal(r.limit, 100); }
  for (const row of Object.values(state.lanes)) { assert.equal(row.snapshot.observedAt, now); assert.equal(row.history.observations.length, 1); }
  assert.notEqual(state.lanes.recent.snapshot.protocol, state.lanes.delayed.snapshot.protocol);
  assert.equal(publicProcurement(state).lanes.delayed.history, undefined, "full journal is not sent to browser");
});
test("calendar-day schedule, six-hour retry bound and failures preserve both histories", async () => {
  const state = await collect(null); let calls = 0;
  const cached = await collect(state, { now: "2026-11-03T01:00:00.000Z", fetchImpl: () => { calls++; throw Error("unavailable"); } });
  assert.equal(calls, 0, "still November 2 in Toronto"); assert.deepEqual(cached, state);
  const failed = await collect(state, { now: "2026-11-03T12:00:00.000Z", fetchImpl: () => { calls++; throw Error("unavailable"); } });
  assert.equal(calls, 2);
  for (const lane of ["recent", "delayed"]) { assert.equal(failed.lanes[lane].status, "error"); assert.deepEqual(failed.lanes[lane].history, state.lanes[lane].history); assert.equal(failed.lanes[lane].lastSuccessAt, now); }
  assert.equal(procurementDue(failed.lanes.recent, "2026-11-03T17:59:00.000Z"), false);
  assert.equal(procurementDue(failed.lanes.recent, "2026-11-03T18:00:00.000Z"), true);
  assert.match(procurementHealth(publicProcurement(failed), Date.parse("2026-11-03T12:00:00Z")).warnings.join(), /unavailable/);
  assert.deepEqual(procurementFreshnessErrors(publicProcurement(failed), Date.parse("2026-11-03T12:00:00Z")), []);
  assert.equal(procurementFreshnessErrors(publicProcurement(failed), Date.parse("2026-11-04T12:00:00Z")).length, 2);
});
test("protocol swaps and corrupt cached journals are rejected before any requests", async () => {
  const state = await collect(null);
  [state.lanes.recent, state.lanes.delayed] = [state.lanes.delayed, state.lanes.recent];
  await assert.rejects(collect(state, { fetchImpl: () => { assert.fail("must not request"); } }), /protocol/);
  assert.throws(() => validateProcurementState({ schemaVersion: 1, lanes: { wrong: {}, delayed: {} } }), /Invalid/);
  const mismatch = await collect(null);
  mismatch.lanes.delayed.history.protocol = mismatch.lanes.recent.history.protocol;
  await assert.rejects(collect(mismatch, { fetchImpl: () => assert.fail("must not request") }), /protocols disagree/);
});
test("public health rejects contradictory dates, invalid money and swapped sample identity", async () => {
  const data = publicProcurement(await collect(null));
  assert.deepEqual(procurementHealth(data, Date.parse(now)).errors, []);
  for (const mutate of [d => { d.lanes.recent.lastSuccessAt = "2027-01-01"; }, d => { d.lanes.recent.snapshot.records[0].obligationChangeUsd = "missing"; }, d => { d.lanes.recent.snapshot = d.lanes.delayed.snapshot; }]) {
    const bad = structuredClone(data); mutate(bad); assert.ok(procurementHealth(bad, Date.parse(now)).errors.length);
  }
});
test("spending UI deduplicates overlap, distinguishes corrections, filters and escapes source text", async () => {
  const data = publicProcurement(await collect(null));
  data.lanes.delayed.snapshot.records = structuredClone(data.lanes.recent.snapshot.records);
  data.lanes.delayed.snapshot.records[0].obligationChangeUsd = "-15.00";
  data.lanes.recent.snapshot.records[0].recipient = "<script>alert(1)</script>";
  const html = view(data);
  assert.equal((html.match(/data-discovery-item/g) || []).length, 1);
  assert.match(html, /Samples disagree/); assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Amount withheld/); assert.match(html, /Publication date is unknown/);
  assert.match(view(data, "nomatch"), /No actions in this view/);
  assert.match(view(data, "", { lane: "increase" }), /No actions in this view/);
  assert.match(view(undefined), /Awaiting first successful sample/);
  assert.doesNotMatch(view(data), /procurement-coverage" open/);
  data.lanes.recent.status = "error";
  assert.match(view(data), /A sample check needs attention/);
});

test("spending display preserves large signed cents and refuses non-award links", async () => {
  const data = publicProcurement(await collect(null));
  data.lanes.delayed.snapshot.records = [];
  data.lanes.recent.snapshot.records[0].obligationChangeUsd = "-90071992547409.91";
  data.lanes.recent.snapshot.records[0].url = "javascript:alert(1)";
  const html = view(data);
  assert.match(html, /−\$90,071,992,547,409.91/);
  assert.doesNotMatch(html, /href="javascript:/);
});
test("investigation starts with source identity but does not turn obligations into adoption observations", async () => {
  const procurement = publicProcurement(await collect(null));
  const row = procurement.lanes.recent.snapshot.records[0];
  const plan = notebook.seed(`procurement:${row.id}`, { procurement }, now);
  assert.equal(plan.origins[0].publishedAt, null); assert.equal(plan.origins[0].url, row.url);
  assert.deepEqual(plan.observations, []); assert.equal(plan.metric, ""); assert.match(plan.nextCheck, /not revenue/);
  assert.equal(notebook.seed("procurement:missing", { procurement }, now), null);
});
