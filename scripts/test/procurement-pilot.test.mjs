import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { procurementRequest, procurementRecord, procurementSample, obligationAmount, fetchProcurement, refreshProcurement, PROCUREMENT_ENDPOINT } from "../lib/procurement-pilot.mjs";
import { main } from "../pilot-procurement.mjs";
const now = "2026-10-14T02:00:00Z";
const raw = patch => ({ generated_internal_id: "CONT_AWD_TEST_8000_NONE_NONE", "Award ID": "TEST", Mod: "P00001", "Action Date": "2026-10-09", "Recipient Name": "EXAMPLE RESEARCH LLC", "Awarding Agency": "Example agency", "Award Type": "DEFINITIVE CONTRACT", "Transaction Amount": 15.25, "Transaction Description": "Research on an unfamiliar material", NAICS: { code: "541715" }, ...patch });
const payload = (rows = [raw()]) => ({ limit: 100, results: rows, page_metadata: { page: 1, hasNext: false } });
const response = data => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
test("pilot searches broad R&D contract actions without technology keywords or personal fields", () => {
  const q = procurementRequest(now);
  assert.deepEqual(q.filters.naics_codes, { require: ["5417"] });
  assert.deepEqual(q.filters.award_type_codes, ["A", "B", "C", "D"]);
  assert.equal(q.filters.time_period[0].start_date, "2026-06-17");
  assert.equal(q.filters.time_period[0].end_date, "2026-10-14");
  assert.equal(q.page, 1); assert.equal(q.limit, 100); assert.equal(q.sort, "Action Date");
  assert.equal(q.filters.keywords, undefined); assert.doesNotMatch(q.fields.join(" "), /address|Location|UEI|Loan|Outlays/);
  for (const invalid of ["2026-10-14", "2026-02-30T02:00:00Z", "2026-10-14T24:00:00Z", "2026-10-14T02:00:00-04:00"]) assert.throws(() => procurementRequest(invalid), /observation time/);
  assert.deepEqual(procurementRequest("2026-10-14T02:00:00.123Z"), q);
});
test("obligation changes preserve positive, zero and negative exact cents without coercing missing data", () => {
  assert.deepEqual(obligationAmount("-2000000"), { obligationChangeUsd: "-2000000.00", direction: "decrease" });
  assert.deepEqual(obligationAmount(0), { obligationChangeUsd: "0.00", direction: "no-change" });
  assert.equal(obligationAmount("0.01").obligationChangeUsd, "0.01");
  assert.equal(obligationAmount("1000000000.12").obligationChangeUsd, "1000000000.12");
  for (const value of [null, undefined, true, [], "", "1e5", "1,000", "1.005", NaN, Infinity, "999999999999999999"]) assert.throws(() => obligationAmount(value));
});
test("action date, observation time and unknown publication date stay distinct", () => {
  const result = procurementSample(payload(), now), row = result.records[0];
  assert.equal(row.actionDate, "2026-10-09"); assert.equal(row.publishedAt, null); assert.equal(result.observedAt, now);
  assert.match(row.url, /^https:\/\/www\.usaspending\.gov\/award\/CONT_AWD_/);
  assert.equal(result.coverage.completeCensus, false); assert.match(result.note, /not payments/);
});
test("modified financial details retain identity, but different contract modifications are separate actions", () => {
  const window = procurementRequest(now).filters.time_period[0];
  const original = procurementRecord(raw(), window), corrected = procurementRecord(raw({ "Transaction Amount": 20, "Action Date": "2026-10-08" }), window);
  assert.equal(original.id, corrected.id);
  assert.notEqual(original.id, procurementRecord(raw({ Mod: "P00002" }), window).id);
  const sample = procurementSample(payload([raw(), raw(), raw({ Mod: "P00002" })]), now);
  assert.equal(sample.coverage.distinctActions, 2); assert.equal(sample.coverage.distinctAwards, 1);
  assert.throws(() => procurementSample(payload([raw(), raw({ "Transaction Amount": 20 })]), now), /Conflicting/);
});
test("malformed or out-of-scope records cannot become a seemingly successful sample", () => {
  for (const patch of [{ generated_internal_id: "https://evil.test" }, { generated_internal_id: "ASST_AWD_GRANT" }, { Mod: null }, { "Action Date": "2026-02-30" }, { "Action Date": "2026-10-15" }, { "Action Date": "2026-01-01" }, { NAICS: { code: "541511" } }, { "Transaction Amount": null }]) assert.throws(() => procurementSample(payload([raw(patch)]), now));
  for (const patch of [{ results: null }, { limit: 1000 }, { page_metadata: { page: 2, hasNext: false } }, { page_metadata: { page: 1 } }]) assert.throws(() => procurementSample({ ...payload(), ...patch }, now), /contract changed/);
  const empty = procurementSample(payload([]), now);
  assert.equal(empty.coverage.distinctActions, 0); assert.equal(empty.coverage.newestActionDate, null); assert.equal(empty.coverage.completeCensus, false);
});
test("sampling bounds remain explicit even when provider pagination reports no next page", () => {
  const full = payload(Array.from({ length: 100 }, (_, i) => raw({ Mod: `P${i}` })));
  assert.equal(procurementSample(full, now).coverage.capped, true);
  const more = payload(); more.page_metadata.hasNext = true;
  assert.equal(procurementSample(more, now).coverage.capped, true);
  assert.throws(() => procurementSample(payload(Array.from({ length: 101 }, (_, i) => raw({ Mod: `P${i}` }))), now));
});
test("intake makes one bounded POST to the documented API and never follows redirects", async () => {
  let calls = 0;
  const result = await fetchProcurement({ now, fetchImpl: async (url, init) => {
    calls++; assert.equal(url, PROCUREMENT_ENDPOINT); assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    assert.deepEqual(JSON.parse(init.body), procurementRequest(now));
    return response(payload());
  } });
  assert.equal(calls, 1); assert.equal(result.records.length, 1);
  for (const status of [403, 429, 503]) {
    let attempts = 0;
    await assert.rejects(fetchProcurement({ now, fetchImpl: async () => { attempts++; return new Response(null, { status }); } }), new RegExp(String(status)));
    assert.equal(attempts, 1);
  }
});
test("oversized and non-JSON replies fail without replacing retained evidence", async () => {
  const original = await refreshProcurement({}, { now, fetchImpl: async () => response(payload()) });
  for (const fetchImpl of [async () => new Response("<html>error</html>", { headers: { "content-type": "text/html" } }), async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "750001" } }), async () => { throw Error("timeout"); }]) {
    const failed = await refreshProcurement(original, { now: "2026-10-15T02:00:00Z", fetchImpl });
    assert.equal(failed.status, "error"); assert.equal(failed.snapshot, original.snapshot); assert.equal(failed.lastSuccessAt, now);
    assert.equal(failed.lastAttemptAt, "2026-10-15T02:00:00Z");
  }
});
test("pilot requires explicit live execution and cannot write into published data", async () => {
  await assert.rejects(main([]), /require --live/);
  await assert.rejects(main(["--live", "--output", new URL("../../data/pilot.json", import.meta.url).pathname]), /outside published data/);
  const collector = readFileSync(new URL("../update-technology.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(collector, /procurement-pilot|refreshProcurement/);
});
