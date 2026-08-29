import { test } from "node:test";
import assert from "node:assert/strict";
import { selectPageviewBatch, selectArticleBatch } from "../lib/ledger.mjs";

function entry({ article, name, pageviewsAt, articleTriedAt, rows = 0 }) {
  return { meta: { article, name, pageviewsAt, articleTriedAt }, rows: Array(rows).fill([]) };
}

// The bug this replaces: the batch was `.slice(0, limit)` over Object.entries,
// a fixed head that re-fetched the same tickers every run forever. Measured
// 2026-08-29 the first 150 had 100% pageview coverage and the 265 behind them
// had 23%, which starved the coil detector of its attention series.
test("selectPageviewBatch: rotates instead of pinning the same head", () => {
  const tickers = {
    A: entry({ article: "A", pageviewsAt: "2026-08-29" }),
    B: entry({ article: "B", pageviewsAt: "2026-08-29" }),
    C: entry({ article: "C", pageviewsAt: "2026-08-01" }),
    D: entry({ article: "D", pageviewsAt: "2026-08-15" }),
  };
  assert.deepEqual(selectPageviewBatch(tickers, 2).map(([t]) => t), ["C", "D"], "oldest first");
});

test("selectPageviewBatch: never-fetched tickers go first", () => {
  const tickers = {
    A: entry({ article: "A", pageviewsAt: "2026-01-01" }),
    B: entry({ article: "B" }),
    C: entry({ article: "C", pageviewsAt: "2026-08-29" }),
  };
  assert.deepEqual(selectPageviewBatch(tickers, 1).map(([t]) => t), ["B"]);
});

test("selectPageviewBatch: skips tickers with no article", () => {
  const tickers = { A: entry({ name: "Acme" }), B: entry({ article: "B", name: "B" }) };
  assert.deepEqual(selectPageviewBatch(tickers, 10).map(([t]) => t), ["B"]);
});

test("selectArticleBatch: prefers the deepest history", () => {
  const tickers = {
    SHALLOW: entry({ name: "Shallow", rows: 10 }),
    DEEP: entry({ name: "Deep", rows: 400 }),
    MID: entry({ name: "Mid", rows: 200 }),
  };
  assert.deepEqual(selectArticleBatch(tickers, 2, "2026-08-01").map(([t]) => t), ["DEEP", "MID"]);
});

test("selectArticleBatch: skips tickers that already have an article or lack a name", () => {
  const tickers = {
    HAS: entry({ article: "Has", name: "Has", rows: 400 }),
    NONAME: entry({ rows: 400 }),
    OK: entry({ name: "Ok", rows: 1 }),
  };
  assert.deepEqual(selectArticleBatch(tickers, 10, "2026-08-01").map(([t]) => t), ["OK"]);
});

// Without the stamp the batch fills every run with the same known-absent names
// -- half the unresolved universe genuinely has no article -- and never reaches
// anything new. With it expiring, an article created later is still found.
test("selectArticleBatch: skips recent misses but retries stale ones", () => {
  const tickers = {
    RECENT: entry({ name: "Recent", rows: 400, articleTriedAt: "2026-08-20" }),
    STALE: entry({ name: "Stale", rows: 300, articleTriedAt: "2026-06-01" }),
    NEVER: entry({ name: "Never", rows: 200 }),
  };
  const picked = selectArticleBatch(tickers, 10, "2026-07-30").map(([t]) => t);
  assert.deepEqual(picked, ["STALE", "NEVER"]);
});
