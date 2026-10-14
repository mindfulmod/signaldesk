import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

async function render(payload) {
  const feed = { innerHTML: "" };
  const document = {
    readyState: "complete", head: { appendChild() {} }, createElement: () => ({}),
    getElementById: id => id === "clustersFeed" ? feed : null,
  };
  vm.runInNewContext(readFileSync(new URL("../../clusters.js", import.meta.url), "utf8"), {
    document, window: { SIGNALDESK_CLUSTERS: payload }, location: { protocol: "file:" }, URL, Date,
  });
  await Promise.resolve();
  return feed.innerHTML;
}

test("clusters with old identity provenance are withheld with an alternative next step", async () => {
  const html = await render({ integrityVersion: 2, communities: [{ members: ["FAKE"] }] });
  assert.match(html, /withheld/);
  assert.match(html, /Open scan/);
  assert.doesNotMatch(html, /FAKE/);
});

test("cluster cards expose counts, safe originals, honest dates and an actionable research check", async () => {
  const html = await render({ integrityVersion: 3, verifiedDocuments: 1, withheldLegacyDocuments: 21, generatedAt: "2026-10-14T02:00:00Z", communities: [{
    members: ["NVDA", "AMD", "AVGO"], documentCount: 1,
    evidence: [{ title: "NVDA & AMD <shared> headline", source: "CNBC", url: "https://example.com/story", published: null, firstSeen: "2026-10-13" }, { title: "UNSAFE", url: "javascript:alert(1)" }],
  }] });
  assert.match(html, /single-document lead, not a repeated trend/);
  assert.match(html, /Next check:/);
  assert.match(html, /21 older records excluded/);
  assert.match(html, /NVDA &amp; AMD &lt;shared&gt; headline/);
  assert.match(html, /Publication date unknown/);
  assert.match(html, /<details/);
  assert.doesNotMatch(html, /UNSAFE|javascript:|keep appearing/);
});

test("empty graph does not imply absence of emerging technologies", async () => {
  assert.match(await render({ integrityVersion: 3, communities: [], graphNodes: 0 }), /does not mean there are no emerging trends/);
});
