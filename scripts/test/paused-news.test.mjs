import { test } from "node:test";
import assert from "node:assert/strict";
import { collectNewswires } from "../update-data.mjs";
import quality from "../../data-quality.js";

test("retired Yahoo broad-news endpoint makes no request and does not disable prices", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Paused wire must not fetch"); };
  const events = [], failures = [];
  try {
    await collectNewswires(events, failures, new Map(), [{ source: "Yahoo Public News", url: "https://finance.yahoo.com/news/rssindex" }]);
    assert.equal(calls, 0);
    assert.deepEqual(events, []);
    assert.deepEqual(failures, []);
    assert.equal(quality.PAUSED_SOURCES["Price/Volume"], undefined);
  } finally { globalThis.fetch = original; }
});
