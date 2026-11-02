import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { procurementSample } from "../lib/procurement-pilot.mjs";
import { appendProcurementHistory, validateProcurementHistory, validateProcurementSnapshot, procurementHistorySummary, refreshProcurementArchive } from "../lib/procurement-history.mjs";
import { main } from "../pilot-procurement.mjs";

const now = "2026-10-14T02:00:00Z", later = "2026-10-15T02:00:00Z";
const raw = patch => ({ generated_internal_id: "CONT_AWD_TEST_8000_NONE_NONE", "Award ID": "TEST", Mod: "P00001", "Action Date": "2026-10-09", "Recipient Name": "EXAMPLE RESEARCH LLC", "Awarding Agency": "Example agency", "Award Type": "DEFINITIVE CONTRACT", "Transaction Amount": 15.25, "Transaction Description": "Materials research", NAICS: { code: "541715" }, ...patch });
const payload = (rows = [raw()], hasNext = false) => ({ limit: 100, results: rows, page_metadata: { page: 1, hasNext } });
const sample = (rows, at = now, hasNext = false) => procurementSample(payload(rows, hasNext), at);
const options = (rows, at = now) => ({ now: at, fetchImpl: async () => new Response(JSON.stringify(payload(rows)), { headers: { "content-type": "application/json" } }) });

test("unchanged repeated observations reuse immutable records, not independent evidence", () => {
  const first = appendProcurementHistory(null, sample());
  const second = appendProcurementHistory(first, sample(undefined, later));
  assert.equal(first.observations.length, 1); assert.equal(second.observations.length, 2);
  assert.equal(second.versions.length, 1);
  assert.equal(procurementHistorySummary(second).unchangedActions, 1);
  assert.match(procurementHistorySummary(second).note, /not independent evidence/);
  second.versions[0].record.description = "changed by caller";
  assert.equal(first.versions[0].record.description, "Materials research");
});
test("corrections and reversions preserve all record versions without inflating action identity", () => {
  const a = sample(), b = sample([raw({ "Transaction Amount": -5, "Action Date": "2026-10-08" })], later);
  let history = appendProcurementHistory(appendProcurementHistory(null, a), b);
  assert.equal(history.versions.length, 2); assert.equal(procurementHistorySummary(history).changedActions, 1);
  assert.equal(new Set(history.versions.map(v => v.record.id)).size, 1);
  history = appendProcurementHistory(history, sample(undefined, "2026-10-16T02:00:00Z"));
  assert.equal(history.versions.length, 2); assert.equal(history.observations.length, 3);
  assert.equal(procurementHistorySummary(history).changedActions, 1);
  assert.deepEqual(history.observations[0].versions, history.observations[2].versions);
});
test("absence from capped or empty samples retains prior records without implying cancellation", () => {
  let history = appendProcurementHistory(null, sample());
  history = appendProcurementHistory(history, sample([raw({ Mod: "P00002" })], later, true));
  assert.equal(procurementHistorySummary(history).firstObservedActions, 1);
  assert.equal(procurementHistorySummary(history).notInLatestSample, 1);
  history = appendProcurementHistory(history, sample([], "2026-10-16T02:00:00Z"));
  assert.equal(history.versions.length, 2); assert.equal(procurementHistorySummary(history).notInLatestSample, 2);
  assert.match(procurementHistorySummary(history).note, /does not mean cancelled/);
  assert.equal(history.observations[2].coverage.completeCensus, false);
});
test("replay is idempotent and conflicting or older observation times cannot replace history", () => {
  const history = appendProcurementHistory(null, sample());
  assert.deepEqual(appendProcurementHistory(history, sample()), history);
  assert.throws(() => appendProcurementHistory(history, sample([raw({ "Transaction Amount": 20 })])), /conflicting/);
  assert.throws(() => appendProcurementHistory(history, sample(undefined, "2026-10-13T02:00:00Z")), /Older/);
});
test("duplicate raw counts and source metadata remain verifiable after archival", () => {
  const snapshot = sample([raw(), raw()]);
  assert.equal(snapshot.coverage.returnedRows, 2); assert.equal(snapshot.records.length, 1);
  assert.equal(validateProcurementSnapshot(snapshot), snapshot);
  assert.doesNotThrow(() => validateProcurementHistory(appendProcurementHistory(null, snapshot)));
  const truncated = sample([raw({ "Transaction Description": "a".repeat(319) + " more text" })]);
  assert.equal(truncated.records[0].description, "a".repeat(319) + " ");
  assert.doesNotThrow(() => validateProcurementHistory(appendProcurementHistory(null, truncated)));
  for (const patch of [{ sourceUrl: "https://evil.test" }, { protocol: "different" }, { observedAt: "2026-02-30T02:00:00Z" }, { coverage: { ...snapshot.coverage, completeCensus: true } }]) {
    assert.throws(() => validateProcurementSnapshot({ ...snapshot, ...patch }));
  }
});
test("corrupt identities, versions, references, coverage and ordering fail before network access", async () => {
  const original = await refreshProcurementArchive({}, options());
  const edits = [
    s => { s.history.versions[0].record.obligationChangeUsd = "500.00"; },
    s => { s.history.versions[0].version = "bad"; },
    s => { s.history.observations[0].versions = ["missing"]; },
    s => { s.history.observations[0].coverage.returnedRows = 0; },
    s => { s.history.observations.push(s.history.observations[0]); },
    s => { s.history.versions.push(s.history.versions[0]); },
    s => { s.history.observations = []; },
    s => { s.snapshot.records[0].publishedAt = now; },
    s => { s.lastSuccessAt = later; },
    s => { delete s.snapshot; }
  ];
  for (const edit of edits) {
    const state = structuredClone(original); edit(state);
    let calls = 0;
    await assert.rejects(refreshProcurementArchive(state, { now: later, fetchImpl: async () => { calls++; throw Error("must not fetch"); } }));
    assert.equal(calls, 0);
  }
});
test("legacy pilot migration retains original observation; failure preserves the complete prior archive", async () => {
  const legacy = { schemaVersion: 1, status: "ok", snapshot: sample(), lastSuccessAt: now, lastAttemptAt: now, error: null };
  const migrated = await refreshProcurementArchive(legacy, options(undefined, later));
  assert.equal(migrated.history.observations.length, 2);
  assert.equal(migrated.history.observations[0].observedAt, now);
  assert.equal(legacy.history, undefined);
  const failed = await refreshProcurementArchive(migrated, { now: "2026-10-16T02:00:00Z", fetchImpl: async () => { throw Error("HTTP 503"); } });
  assert.equal(failed.status, "error"); assert.deepEqual(failed.history, migrated.history);
  assert.deepEqual(failed.snapshot, migrated.snapshot); assert.equal(failed.lastSuccessAt, later);
  const rollback = await refreshProcurementArchive(migrated, options());
  assert.equal(rollback.status, "error"); assert.deepEqual(rollback.history, migrated.history);
  assert.equal(rollback.lastSuccessAt, later);
});
test("retention cap fails visibly instead of silently pruning evidence", () => {
  const snapshot = sample([]);
  const history = { schemaVersion: 1, protocol: snapshot.protocol, versions: [], observations: Array.from({ length: 400 }, (_, i) => ({ observedAt: new Date(Date.parse(now) + i * 1000).toISOString(), coverage: snapshot.coverage, versions: [] })) };
  validateProcurementHistory(history);
  assert.throws(() => appendProcurementHistory(history, sample([], later)), /retention limit/);
  assert.equal(history.observations.length, 400);
});
test("CLI resumes destination history automatically and leaves corrupt files untouched", async () => {
  const dir = await mkdtemp(join(tmpdir(), "procurement-history-")), path = join(dir, "pilot.json");
  try {
    await main(["--live", "--output", path], options());
    const next = await main(["--live", "--output", path], options(undefined, later));
    assert.equal(next.history.observations.length, 2);
    for (const corrupt of ['{"broken":true}', 'null', 'false', '0', '{}', '[]']) {
      await writeFile(path, corrupt);
      await assert.rejects(main(["--live", "--output", path], options()), /archive contract/);
      assert.equal(await readFile(path, "utf8"), corrupt);
      await assert.rejects(access(path + ".lock"));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("CLI prevents overlapping writers and replacement from a different archive", async () => {
  const dir = await mkdtemp(join(tmpdir(), "procurement-lock-")), path = join(dir, "pilot.json");
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  try {
    const first = main(["--live", "--output", path], { now, fetchImpl: async (...args) => { entered(); await gate; return options().fetchImpl(...args); } });
    await ready;
    await assert.rejects(main(["--live", "--output", path], options()), /archive is locked/);
    release(); await first;
    const saved = await readFile(path, "utf8");
    await assert.rejects(main(["--live", "--output", path, "--previous", join(dir, "different.json")], options()), /different --previous/);
    assert.equal(await readFile(path, "utf8"), saved);
    await assert.rejects(access(path + ".lock"));
  } finally { release(); await rm(dir, { recursive: true, force: true }); }
});
