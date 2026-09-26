import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMarketNews } from "../update-data.mjs";

test("market-news builder pairs only fresh usable stories with recent prices", () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 61 * 86400_000).toISOString();
  const quote = ticker => ({ ticker, source: "Price/Volume", lastPrice: 5, priceMove: 10, relativeVolume: 3, quoteAsOf: now });
  const story = ticker => ({ ticker, source: "Google News", title: "Company reports earnings above expectations", url: "https://example.com/results", published: now });
  const rows = buildMarketNews([
    quote("FRESH"), story("FRESH"),
    quote("OLDNEWS"), { ...story("OLDNEWS"), published: old },
    { ...quote("OLDQUOTE"), quoteAsOf: old }, story("OLDQUOTE"),
    quote("GENERIC"), { ...story("GENERIC"), title: "Price to earnings forward of Company" },
    quote("UNDATED"), { ...story("UNDATED"), published: "" },
  ]);
  assert.deepEqual(rows.map(row => row.ticker), ["FRESH"]);
  assert.equal(rows[0].quoteAsOf, now);
});
