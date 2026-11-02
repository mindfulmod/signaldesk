import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { aggregateCalibration } from "../lib/calibration.mjs";

async function render(file, id, window) {
  const container = { innerHTML: "" }; let install;
  const document = { readyState: "loading", addEventListener: (_, fn) => { install = fn; },
    getElementById: key => key === id ? container : key.includes("styles") ? {} : null };
  vm.runInNewContext(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { document, window, location: { protocol: "file:" }, Date });
  await install(); return container.innerHTML;
}

test("fresh assembly cannot certify legacy calibration grades", async () => {
  const data = aggregateCalibration({ entries: [{ type: "release", graded: { "30d": 0 } }] });
  assert.equal(data.validation.status, "unverified");
  assert.equal(data.summary.release.horizons["30d"].medianReturn, 0, "raw diagnostic data is preserved");
  for (const input of [data, { ...data, validation: undefined }]) {
    const html = await render("calibration.js", "calibrationSummary", { SIGNALDESK_CALIBRATION: input });
    assert.match(html, /Performance estimates withheld/);
    assert.doesNotMatch(html, /0% win|0.0% median/);
    assert.match(html, /calibration-log.json/);
  }
});

test("legacy alert percentages are withheld without rewriting the raw archive", async () => {
  const entry = { type: "release", ticker: "PGY", date: "2026-10-06", message: "PGY released: crossed its range. Released coils have historically won 65% of the time, +12.6% median at 12mo -- a base rate, not a guarantee." };
  const html = await render("alerts.js", "whatChangedFeed", { SIGNALDESK_ALERTS_LOG: { entries: [entry] }, SIGNALDESK_QUALITY: { recent: () => false } });
  assert.match(html, /PGY released: crossed its range/);
  assert.match(html, /Historical performance claim withheld/);
  assert.doesNotMatch(html, /65%|12.6%/);
  assert.match(entry.message, /65%/);
  assert.doesNotMatch(readFileSync(new URL("../lib/alerts.mjs", import.meta.url), "utf8"), /historically won|65%|12.6%/);
});
