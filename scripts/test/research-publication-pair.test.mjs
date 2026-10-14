import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyResearchPublication } from "../verify-publication.mjs";
import { researchHealth } from "../lib/research-health.mjs";
import { companyQuoteFixture } from "./helpers/company-quote.mjs";

const now = "2026-10-14T02:00:00Z", older = "2026-10-14T01:00:00Z";
const scope = { sources: [{ id: "test" }], companies: [{ ticker: "TEST" }] };
const pair = (sourceAt = now, generatedAt = now) => ({
  research: { schemaVersion: 1, generatedAt, sourceCheckedAt: sourceAt, documents: [], reviews: [], coverage: { totalSources: 1 }, companies: { TEST: { ...companyQuoteFixture("TEST", now), factsCheckedAt: now } } },
  monitor: { schemaVersion: 1, generatedAt: sourceAt, events: [], sources: { test: { id: "test", status: "ok", lastSuccessAt: sourceAt } } }
});
const options = { clock: () => Date.parse(now), attempts: 2, sleep: async () => {} };

test("publication waits until both research and the matching source-check file arrive", async () => {
  const expected = pair(); let attempts = 0;
  const result = await verifyResearchPublication(expected.research, expected.monitor, async () => {
    attempts++;
    return attempts === 1 ? { research: expected.research, monitor: pair(older).monitor } : expected;
  }, options);
  assert.equal(result, true); assert.equal(attempts, 2);
});
test("publication rejects persistent mismatches, missing files and invalid schemas with an actionable reason", async () => {
  const expected = pair();
  for (const actual of [
    { ...expected, monitor: pair(older).monitor },
    { ...expected, monitor: null },
    { ...expected, research: { ...expected.research, documents: null } },
    { ...expected, monitor: { ...expected.monitor, sources: { test: null } } }
  ]) await assert.rejects(verifyResearchPublication(expected.research, expected.monitor, async () => actual, options), /Last check: .*different updates|Last check: .*incomplete or invalid/);
  await assert.rejects(verifyResearchPublication(expected.research, expected.monitor, async () => { throw Error("Source-check HTTP 503"); }, options), /Last check: Source-check HTTP 503/);
});
test("a newer assembly cannot disguise older source checks, but a coherent newer collection is accepted", async () => {
  const expected = pair(older, older);
  assert.equal(await verifyResearchPublication(expected.research, expected.monitor, async () => pair(), options), true);
  const current = pair();
  await assert.rejects(verifyResearchPublication(current.research, current.monitor, async () => pair(older), options), /older than the expected collection/);
  const companyRefresh = pair(older);
  assert.equal(await verifyResearchPublication(companyRefresh.research, companyRefresh.monitor, async () => companyRefresh, options), true);
});
test("invalid local publications fail before network polling", async () => {
  const expected = pair(); let calls = 0;
  await assert.rejects(verifyResearchPublication({ ...expected.research, sourceCheckedAt: older }, expected.monitor, async () => { calls++; return expected; }, options), /invalid local research publication/);
  assert.equal(calls, 0);
});
test("watchdog rejects mixed generations even with fresh sources and complete quote coverage", () => {
  const expected = pair();
  assert.equal(researchHealth(expected.research, expected.monitor, Date.parse(now), scope).ok, true);
  const mixed = researchHealth(expected.research, pair(older).monitor, Date.parse(now), scope);
  assert.equal(mixed.ok, false); assert.match(mixed.errors[0], /different updates/);
  assert.equal(mixed.contentChecks, null); assert.match(mixed.sourceCoverage, /Unavailable/);
  assert.match(mixed.quoteCoverage, /Unavailable/);
});
test("watchdog fails safely on malformed records and future dates instead of crashing or reporting coverage", () => {
  const expected = pair();
  for (const actual of [
    { research: null, monitor: null },
    { ...expected, monitor: { ...expected.monitor, sources: { test: null } } },
    { ...expected, research: { ...expected.research, companies: { TEST: null } } },
    { ...expected, research: { ...expected.research, companies: { TEST: [] } } },
    pair("2026-02-30T02:00:00Z"), pair("2026-10-15T02:00:00Z", "2026-10-15T02:00:00Z")
  ]) {
    const result = researchHealth(actual.research, actual.monitor, Date.parse(now), scope);
    assert.equal(result.ok, false); assert.match(result.sourceCoverage, /Unavailable/);
  }
});
test("refresh workflow verifies the public pair and runs health checks against live files", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/refresh-research.yml", import.meta.url), "utf8");
  assert.match(workflow, /node scripts\/verify-publication\.mjs research/);
  assert.match(workflow, /node scripts\/check-research-health\.mjs --live/);
  assert.match(workflow, /"research-loader\.js"/);
  const verifier = readFileSync(new URL("../verify-publication.mjs", import.meta.url), "utf8");
  assert.match(verifier, /Promise\.all\(\[readPublic\("research"\), readPublic\("technology-monitor"\)\]\)/);
});
