import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PUBLICATIONS, publicationFiles, parseBundle, validatePublication } from "../lib/publication-safety.mjs";
import { companyQuoteFixture } from "./helpers/company-quote.mjs";
import { publicProcurement } from "../lib/procurement-discovery.mjs";
import { sourceReceipt } from "./helpers/source-receipt.mjs";

const at = "2026-11-02T16:00:00.000Z", now = Date.parse(at);
const scope = { sources: [{ id: "lab" }], companies: [{ ticker: "TEST" }] };
function fixture(kind) {
  const inputs = kind === "market" ? {
    signals: { generatedAt: at, dataMode: "real-public-no-key", signals: Array.from({ length: 75 }, (_, i) => ({
      ticker: `T${i}`, lastPrice: 12, quoteAsOf: at, marketMetricsVersion: 2,
      sources: { "Price/Volume": 1 }, priceMove: 0, relativeVolume: 0,
    })), failures: [] },
  } : {
    research: { schemaVersion: 1, generatedAt: at, sourceCheckedAt: at, documents: [], reviews: [],
      coverage: { totalSources: 1 }, companies: { TEST: { ...companyQuoteFixture("TEST", at), factsCheckedAt: at } } },
    "technology-monitor": { schemaVersion: 1, generatedAt: at, events: [], sources: { lab: { ...sourceReceipt(scope.sources[0]), id: "lab", status: "ok", lastSuccessAt: at } } },
  };
  const files = {};
  if (kind === "research") {
    inputs["procurement-state"] = { schemaVersion: 1, lanes: { recent: {}, delayed: {} } };
    inputs.research.procurement = publicProcurement(inputs["procurement-state"]);
  }
  const put = (name, data) => {
    files[`data/${name}.json`] = JSON.stringify(data);
    if (PUBLICATIONS[kind][name]) files[`data/${name}.js`] = `window.${PUBLICATIONS[kind][name]} = ${JSON.stringify(data, null, 2)};\n`;
  };
  for (const name of Object.keys(PUBLICATIONS[kind])) put(name, inputs[name] || {});
  const read = async path => { if (!(path in files)) throw Error("Missing candidate file"); return files[path]; };
  return { files, inputs, put, check: () => validatePublication(kind, { read, now, scope }) };
}

test("healthy candidates pass without suppressing coverage warnings or changing bytes", async () => {
  for (const kind of ["market", "research"]) {
    const f = fixture(kind), before = { ...f.files }, report = await f.check();
    assert.equal(report.ok, true); assert.equal(report.decision, "eligible-for-publication");
    assert.deepEqual(f.files, before);
    assert.deepEqual(report.files.map(x => x.path), publicationFiles(kind));
    assert.ok(report.files.every(x => x.bytes > 0 && /^[a-f0-9]{64}$/.test(x.sha256)));
    if (kind === "market") assert.match(report.warnings.join(" "), /capitalization/);
  }
});

test("degraded market coverage holds the candidate, preserving missingness", async () => {
  const f = fixture("market");
  f.inputs.signals.signals.slice(31).forEach(row => { row.lastPrice = null; });
  f.put("signals", f.inputs.signals);
  const before = { ...f.files }, report = await f.check();
  assert.equal(report.ok, false); assert.equal(report.decision, "hold-publication");
  assert.match(report.errors.join(" "), /31\/75/); assert.deepEqual(f.files, before);
});

test("public R&D display must match its preserved collection journal", async () => {
  const f = fixture("research");
  f.inputs.research.procurement.lanes.recent.lastSuccessAt = at;
  f.put("research", f.inputs.research);
  const report = await f.check();
  assert.equal(report.ok, false); assert.match(report.errors.join(), /journal/);
});

test("mixed research generations and unreadable sources hold publication", async () => {
  const f = fixture("research");
  f.inputs["technology-monitor"].generatedAt = "2026-11-02T15:00:00.000Z";
  f.put("technology-monitor", f.inputs["technology-monitor"]);
  assert.match((await f.check()).errors.join(" "), /different updates/);
  f.inputs["technology-monitor"].generatedAt = at;
  f.inputs["technology-monitor"].sources.lab.status = "error";
  f.put("technology-monitor", f.inputs["technology-monitor"]);
  assert.equal((await f.check()).ok, false);
});

test("missing, malformed, wrong-global and divergent file-mode twins fail closed", async () => {
  for (const mutate of [
    files => { delete files["data/ledger.json"]; },
    files => { files["data/ledger.json"] = "{"; },
    files => { files["data/ledger.json"] = "[]"; },
    files => { files["data/ledger.js"] = "window.SIGNALDESK_OTHER = {};"; },
    files => { files["data/ledger.js"] = "window.SIGNALDESK_LEDGER = {\"changed\":true};"; },
    files => { files["data/ledger.js"] = "window.SIGNALDESK_LEDGER = {}; throw Error('executed');"; },
  ]) {
    const f = fixture("market"); mutate(f.files);
    const report = await f.check(); assert.equal(report.ok, false);
    assert.match(report.errors.join(" "), /ledger:/);
  }
  assert.deepEqual(parseBundle("window.TEST = {\"a\":1};\n", "TEST"), { a: 1 });
});

test("invalid publication targets never read a path", async () => {
  let reads = 0;
  await assert.rejects(validatePublication("../secrets", { read: () => { reads++; } }), /Unknown publication/);
  assert.equal(reads, 0);
});

test("workflow writers are gated, revalidate after rebase and retain diagnostics on failure", () => {
  for (const [kind, filename, collect] of [["market", "refresh-data.yml", "stocks"], ["research", "refresh-research.yml", "collect"]]) {
    const workflow = readFileSync(new URL(`../../.github/workflows/${filename}`, import.meta.url), "utf8");
    const files = workflow.match(/FILES="([^"]+)"/)[1].split(" ");
    assert.deepEqual([...files].sort(), publicationFiles(kind).sort(), "the entire published set is checked");
    const gate = `node scripts/validate-publication.mjs ${kind} "$RUNNER_TEMP/${kind}-publication.json"`;
    assert.equal(workflow.split(gate).length - 1, 2);
    assert.ok(workflow.indexOf(gate) < workflow.indexOf("git commit"));
    assert.ok(workflow.lastIndexOf(gate) > workflow.indexOf("git pull --rebase"));
    assert.ok(workflow.lastIndexOf(gate) < workflow.indexOf("git push"));
    assert.ok(workflow.includes(`if: \${{ !cancelled() && steps.${collect}.outcome == 'success' && steps.preflight.outcome == 'success' }}`));
    assert.ok(workflow.includes("if: ${{ !cancelled() && steps.publish.outcome == 'success' }}"));
    assert.ok(workflow.includes(`failure() && (steps.${collect}.outcome == 'success' || steps.${collect}.outcome == 'failure')`));
    assert.match(workflow, /retention-days: 7/);
    assert.match(workflow, /if-no-files-found: error/);
    assert.match(workflow, /github\.run_attempt/);
    assert.match(workflow, /scripts\/check-(?:market|research)-health\.mjs --live/);
    assert.ok(!workflow.includes("continue-on-error"), "candidate failure must fail the job");
  }
});

test("both publication writers retain queued runs under one non-cancelling lock", () => {
  for (const filename of ["refresh-data.yml", "refresh-research.yml"]) {
    const workflow = readFileSync(new URL(`../../.github/workflows/${filename}`, import.meta.url), "utf8");
    const block = workflow.match(/^concurrency:\n((?:[ \t]+[^\n]*\n)+)/m)?.[1];
    assert.ok(block, `${filename}: workflow-level writer lock required`);
    assert.match(block, /^  group: signaldesk-data-writer$/m);
    assert.match(block, /^  cancel-in-progress: false$/m);
    assert.match(block, /^  queue: max$/m, `${filename}: a single pending slot drops the other writer`);
    assert.equal((workflow.match(/^\s*concurrency:/gm) || []).length, 1, "no nested lock can deadlock or replace this queue");
    assert.match(workflow, /ref: main/, "queued jobs must read current main when they start");
    assert.match(workflow, /timeout-minutes: (?:20|35)/, "writers remain time-bounded");
    assert.match(workflow, /git pull --rebase origin main/);
  }
});
