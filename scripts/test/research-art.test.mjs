import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import vm from "node:vm";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import model from "../../research-model.js";

const context = { window: { SIGNALDESK_RESEARCH_CONFIG: config, SIGNALDESK_RESEARCH_MODEL: model }, URL, Intl, Date };
vm.runInNewContext(readFileSync(new URL("../../research-views.js", import.meta.url), "utf8"), context);
const views = context.window.SIGNALDESK_RESEARCH_VIEWS;
const state = { compare: [], batteryStage: "all", country: "all", serviceStatus: "all" };
const snapshot = () => ({ generatedAt: new Date().toISOString(), documents: [], reviews: [], companies: {}, coverage: { readableSources: 0 } });

test("brief art is decorative, dimensioned, labeled as conceptual and locally served", () => {
  const html = views.brief(registry.themes, snapshot(), null, [], "ready");
  for (const name of ["battery-cell", "satellite-phone"]) {
    assert.ok(html.includes('src="assets/art/' + name + '.webp" width="720" height="480" alt=""'));
    const asset = new URL("../../assets/art/" + name + ".webp", import.meta.url);
    assert.ok(statSync(asset).size < 60000, "compact cards should not ship giant hero assets");
    const bytes = readFileSync(asset);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
    assert.ok(bytes.includes(Buffer.from("ALPH")), "preserve transparency in both themes");
  }
  assert.match(html, /Concept illustrations/);
  assert.match(html, /not a forecast of returns/);
  assert.match(html, /No new document changes/);
  assert.doesNotMatch(html, /What changed\.<br>/);
});

test("focus artwork and adoption rows respect the followed brief scope", () => {
  const html = views.brief(registry.themes, snapshot(), null, ["satellite-phones"], "ready");
  assert.match(html, /satellite-phone\.webp/);
  assert.doesNotMatch(html, /battery-cell\.webp/);
  assert.doesNotMatch(html, /data-open-tech="ai-glasses"/);
});

test("brief document counts use the intersection of active filters and follows", () => {
  const themes = registry.themes.filter(t => t.id === "solid-state-batteries");
  const research = snapshot();
  research.documents = [{ id: "outside-scope", themes: ["satellite-phones"], changeType: "new-document", detectedAt: research.generatedAt }];
  const brief = model.buildBrief({ themes, research, followed: ["satellite-phones"] });
  assert.equal(brief.selected.length, 0);
  assert.equal(brief.documents.length, 0);
  const html = views.brief(themes, research, null, ["satellite-phones"], "ready");
  assert.match(html, /No followed technologies match/);
  assert.match(html, /data-clear-tech/);
});

test("unreviewed brief changes stay distinct from accepted evidence and escape source text", () => {
  const research = snapshot();
  research.documents = Array.from({ length: 5 }, (_, i) => ({ id: "doc-" + i, themes: ["solid-state-batteries"], owner: "<script>bad()</script>", title: "Update " + i, changeType: "new-document", detectedAt: research.generatedAt }));
  const html = views.brief(registry.themes, research, null, [], "ready");
  assert.match(html, /5 unreviewed/);
  assert.equal((html.match(/data-review=/g) || []).length, 3);
  assert.match(html, /not a verified claim/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("visual stage tracks mark only the editorial stage, not completed milestones", () => {
  for (const stage of ["research", "pilot", "early-use", "scaling"]) {
    const html = views.stageTrack(stage);
    assert.equal((html.match(/aria-current="step"/g) || []).length, 1);
    assert.match(html, /not a forecast/);
    assert.doesNotMatch(html, /progressbar|percent|completed/);
  }
  assert.equal((views.stageTrack("unknown").match(/aria-current/g) || []).length, 0);
});

test("tracker disclosures retain source limitations, definitions and unknown metrics", () => {
  const battery = views.trackers("batteries", snapshot(), state);
  assert.match(battery, /Next proof &amp; technical details/);
  assert.match(battery, /comparable values not yet established/);
  assert.doesNotMatch(battery, /intel-comparison" open/);
  assert.equal((battery.match(/Not established<\/span>/g) || []).length, 15);
  for (const p of config.programs) assert.ok(battery.includes(p.scope));
  const satellite = views.trackers("satellite", snapshot(), state);
  for (const r of config.rollouts) {
    assert.ok(satellite.includes(r.broadband));
    assert.ok(satellite.includes(r.limitations));
    assert.ok(satellite.includes(r.coverage));
    assert.ok(satellite.includes(r.checkedAt));
  }
  assert.match(satellite, /Devices, coverage &amp; pricing/);
});

test("company overview keeps unknown revenue and risk flags outside disclosures", () => {
  const html = views.companies(registry.themes, null, null);
  assert.equal((html.match(/Technology revenue share: not established/g) || []).length, config.companies.length);
  assert.equal((html.match(/aria-label="Risks to investigate"/g) || []).length, config.companies.length);
  assert.match(html, /Saved quotes, not live prices/);
  assert.match(html, /Quote unavailable/);
  assert.ok(html.indexOf('aria-label="Risks to investigate"') < html.indexOf("<details"));
});

test("available operating metrics expand with their conditions; filtered-out metrics do not", () => {
  const research = snapshot();
  research.reviews = [{ id: "review-yield", decision: "accepted", entityId: "program:qs-eagle", metricKey: "yield", value: 90, unit: "%", qualifier: "reported", kind: "pilot", period: "Test period", definition: "Defined sample only", caveat: "Not commercial output", owner: "Test source", url: "https://example.org/evidence", reviewedAt: research.generatedAt }];
  const html = views.trackers("batteries", research, state);
  assert.match(html, /intel-comparison" open/);
  assert.match(html, /90 %/);
  assert.match(html, /Defined sample only/);
  assert.match(html, /Not commercial output/);
  const filtered = views.trackers("batteries", research, { ...state, compare: ["sldp-bmw"] });
  assert.doesNotMatch(filtered, /intel-comparison" open/);
});

test("technology navigation precedes optional filters and native disclosures keep keyboard access", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('class="tech-views"') < html.indexOf('id="techScope"'));
  assert.match(html, /<details id="techScope" class="tech-scope">/);
  assert.match(html, /<summary id="techFilterLabel">/);
  const css = readFileSync(new URL("../../technology.css", import.meta.url), "utf8");
  assert.match(css, /summary:focus-visible/);
});
