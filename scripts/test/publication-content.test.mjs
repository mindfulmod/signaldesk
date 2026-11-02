import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyPublication, verifyResearchPublication } from "../verify-publication.mjs";

const at = "2026-11-02T18:00:00.000Z", now = Date.parse(at);
const options = { attempts: 1, clock: () => now, sleep: async () => {} };
const snapshot = () => ({ generatedAt: at, collectionId: "candidate-1", signals: [{ ticker: "TEST", lastPrice: 12 }], failures: [] });
const pair = () => ({
  research: { schemaVersion: 1, generatedAt: at, sourceCheckedAt: at, collectionId: "research-1",
    documents: [{ id: "doc", title: "Retained evidence" }], reviews: [], companies: {} },
  monitor: { schemaVersion: 1, generatedAt: at, events: [], sources: { source: { status: "ok", lastSuccessAt: at } } },
});

test("matching timestamp and collection ID cannot conceal missing or changed snapshot content", async () => {
  const expected = snapshot();
  for (const actual of [
    { ...expected, signals: [] },
    { ...expected, signals: [{ ticker: "TEST", lastPrice: 120 }] },
    { ...expected, failures: ["provider failed"] },
    { generatedAt: at, collectionId: expected.collectionId },
    { ...expected, collectionId: "different-candidate" },
    { ...expected, generatedAt: "2026-11-02T18:01:00.000Z" },
  ]) await assert.rejects(verifyPublication(expected, async () => actual, options), /contents do not match/);
});

test("malformed or future public timestamps fail rather than taking a newer-date shortcut", async () => {
  for (const actual of [null, [], {}, { ...snapshot(), generatedAt: "2099-01-01T00:00:00Z" },
    { ...snapshot(), generatedAt: "2026-02-30T00:00:00Z" }, { ...snapshot(), generatedAt: at.slice(0, 10) }]) {
    await assert.rejects(verifyPublication(snapshot(), async () => actual, options), /missing, invalid or future/);
  }
});

test("invalid local timestamps fail before network access", async () => {
  let requests = 0;
  for (const expected of [null, {}, [], { ...snapshot(), generatedAt: "2099-01-01T00:00:00Z" }]) {
    await assert.rejects(verifyPublication(expected, async () => { requests++; }, options), /invalid local snapshot/);
  }
  assert.equal(requests, 0);
});

test("equivalent parsed JSON passes regardless of object property order without mutating either snapshot", async () => {
  const expected = snapshot();
  const actual = { failures: [], signals: [{ lastPrice: 12, ticker: "TEST" }], collectionId: "candidate-1", generatedAt: at };
  const before = structuredClone({ expected, actual });
  assert.equal(await verifyPublication(expected, async () => actual, options), true);
  assert.deepEqual({ expected, actual }, before);
});

test("mismatched CDN content can recover inside the existing bounded polling window", async () => {
  const expected = snapshot(); let calls = 0, sleeps = 0;
  assert.equal(await verifyPublication(expected, async () => ++calls === 1 ? { ...expected, signals: [] } : structuredClone(expected),
    { ...options, attempts: 2, sleep: async () => sleeps++ }), true);
  assert.equal(calls, 2); assert.equal(sleeps, 1);
});

test("research requires exact source-check content even with coherent timestamps", async () => {
  const expected = pair();
  for (const mutate of [
    p => p.monitor.sources.source.status = "error",
    p => p.monitor.events.push({ id: "unexpected-event" }),
    p => p.monitor.sources = {},
  ]) {
    const actual = structuredClone(expected); mutate(actual);
    await assert.rejects(verifyResearchPublication(expected.research, expected.monitor, async () => actual, options), /source-check contents do not match/);
  }
});

test("research requires the intended document inventory, not just a valid source-check pair", async () => {
  const expected = pair(), actual = structuredClone(expected); actual.research.documents = [];
  await assert.rejects(verifyResearchPublication(expected.research, expected.monitor, async () => actual, options), /snapshot contents do not match/);
  assert.equal(await verifyResearchPublication(expected.research, expected.monitor, async () => structuredClone(expected), options), true);
});

test("both refresh workflows trigger on verifier changes and verify after publishing", () => {
  for (const [file, target] of [["refresh-data.yml", "signals"], ["refresh-research.yml", "research"]]) {
    const text = readFileSync(new URL(`../../.github/workflows/${file}`, import.meta.url), "utf8");
    assert.match(text, /- "scripts\/verify-publication.mjs"/);
    assert.ok(text.indexOf(`node scripts/verify-publication.mjs ${target}`) > text.indexOf("git push"));
    assert.match(text, /group: signaldesk-data-writer/);
    assert.match(text, /cancel-in-progress: false/);
  }
});
