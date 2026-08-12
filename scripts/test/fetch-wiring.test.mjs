import { test } from "node:test";
import assert from "node:assert/strict";

// Why this exists: on 2026-07-31, `const hostGuard = createHostGuard();` was
// deleted from update-data.mjs while its surrounding comment was rewritten.
// `hostGuard` stayed referenced in six places. `node --check` only validates
// syntax, so it passed. The static fetch-timeouts.test.mjs scan also passed --
// it checks for a `signal:` option, not for whether every identifier in scope
// resolves. Nothing caught it until a live run: every guarded fetch helper
// threw `ReferenceError: hostGuard is not defined` on its first call, that
// was caught by the very try/catch blocks meant for real network failures,
// and the run completed "successfully" with zero data from every source and
// no error message naming the actual cause. Two reproducible runs looked
// exactly like a network outage.
//
// This test imports the REAL module (safe: update-data.mjs only runs main()
// when executed directly, see the isMain guard at the bottom of the file) and
// calls the actual exported fetch helpers against a mocked global.fetch. A
// ReferenceError from a missing module-scope binding surfaces here as a
// thrown error whose message does NOT match the expected HTTP-style failure --
// trivially distinguishable, and impossible to get from a real network error.

const REAL_FETCH = global.fetch;

function mockFetchOnce(handler) {
  global.fetch = async (url, options) => handler(url, options);
}

function restoreFetch() {
  global.fetch = REAL_FETCH;
}

function assertNotReferenceError(error, helperName) {
  assert.notEqual(
    error.constructor.name,
    "ReferenceError",
    `${helperName} threw a ReferenceError (likely a missing module-scope declaration): ${error.message}`
  );
}

const { guardedRequest, fetchJson, fetchJsonWithUA, fetchJsonRetry, fetchText, fetchTextWithUA, fetchMarket, hostGuard } =
  await import("../update-data.mjs");

// A 5-day daily chart, the shape fetchYahooMarket parses.
function yahooChart({ symbol = "TEST", closes = [10, 12], volumes = [1000, 3000] } = {}) {
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: { symbol, regularMarketPrice: closes.at(-1), regularMarketTime: 1_700_000_000, shortName: "Test Corp" },
          indicators: { quote: [{ close: closes, volume: volumes }] },
        },
      ],
    },
  });
}

test("guardedRequest: succeeds against a mocked 200 response", async () => {
  mockFetchOnce(async () => new Response("ok body", { status: 200 }));
  try {
    const response = await guardedRequest("https://wiring-test-1.example/x", { Accept: "*/*" });
    assert.equal(await response.text(), "ok body");
  } finally {
    restoreFetch();
  }
});

test("guardedRequest: a real HTTP error is not mistaken for a wiring bug", async () => {
  mockFetchOnce(async () => new Response("", { status: 503, statusText: "Service Unavailable" }));
  try {
    await assert.rejects(() => guardedRequest("https://wiring-test-2.example/x", {}), /503/);
  } finally {
    restoreFetch();
  }
});

test("fetchJson: parses a mocked JSON body without hitting a ReferenceError", async () => {
  mockFetchOnce(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
  try {
    const json = await fetchJson("https://wiring-test-3.example/x");
    assert.deepEqual(json, { ok: true });
  } catch (error) {
    assertNotReferenceError(error, "fetchJson");
    throw error;
  } finally {
    restoreFetch();
  }
});

test("fetchJsonWithUA: parses a mocked JSON body without hitting a ReferenceError", async () => {
  mockFetchOnce(async () => new Response(JSON.stringify({ hits: 1 }), { status: 200 }));
  try {
    const json = await fetchJsonWithUA("https://wiring-test-4.example/x", "test-ua");
    assert.deepEqual(json, { hits: 1 });
  } catch (error) {
    assertNotReferenceError(error, "fetchJsonWithUA");
    throw error;
  } finally {
    restoreFetch();
  }
});

test("fetchText: returns a mocked text body without hitting a ReferenceError", async () => {
  mockFetchOnce(async () => new Response("<rss></rss>", { status: 200 }));
  try {
    const text = await fetchText("https://wiring-test-5.example/x");
    assert.equal(text, "<rss></rss>");
  } catch (error) {
    assertNotReferenceError(error, "fetchText");
    throw error;
  } finally {
    restoreFetch();
  }
});

test("fetchTextWithUA: returns a mocked text body without hitting a ReferenceError", async () => {
  mockFetchOnce(async () => new Response("<rss></rss>", { status: 200 }));
  try {
    const text = await fetchTextWithUA("https://wiring-test-6.example/x", "test-ua");
    assert.equal(text, "<rss></rss>");
  } catch (error) {
    assertNotReferenceError(error, "fetchTextWithUA");
    throw error;
  } finally {
    restoreFetch();
  }
});

test("fetchJsonRetry: succeeds on the first attempt against a mocked 200 response", async () => {
  mockFetchOnce(async () => new Response(JSON.stringify({ articles: [] }), { status: 200 }));
  try {
    const json = await fetchJsonRetry("https://wiring-test-7.example/x");
    assert.deepEqual(json, { articles: [] });
  } catch (error) {
    assertNotReferenceError(error, "fetchJsonRetry");
    throw error;
  } finally {
    restoreFetch();
  }
});

test("fetchJsonRetry: exhausting retries against a mocked 500 is not mistaken for a wiring bug", async () => {
  mockFetchOnce(async () => new Response("", { status: 500, statusText: "Internal Server Error" }));
  try {
    await assert.rejects(() => fetchJsonRetry("https://wiring-test-8.example/x", { retries: 1, baseDelay: 1 }), /500/);
  } finally {
    restoreFetch();
  }
});

// FINRA publishes CNMSshvol<date>.txt only after the close, so the date walk in
// fetchRecentFinraShortFile expects the first date or two to 403 and falls back
// through up to 9 market dates. Tripping the breaker on that 403 blocked every
// remaining date, costing the run its whole short-volume seed on the 3 of 4
// daily refreshes that run before publication.
test("missingIsAnswer: a 403 on a probed file does not block the fallback dates", async () => {
  const host = "finra-walk-test.example";
  let attempts = 0;
  mockFetchOnce(async (url) => {
    attempts += 1;
    // Only the third date exists, exactly like a pre-publication FINRA walk.
    if (String(url).endsWith("3.txt")) return new Response("short volume rows", { status: 200 });
    return new Response("", { status: 403, statusText: "Forbidden" });
  });
  try {
    let body = null;
    for (const n of [1, 2, 3]) {
      try {
        body = await fetchText(`https://${host}/CNMSshvol${n}.txt`, { missingIsAnswer: true });
        break;
      } catch {
        // keep walking back, which is the whole point
      }
    }
    assert.equal(body, "short volume rows", "the walk reached the date that exists");
    assert.equal(attempts, 3, "all three dates were actually requested, none skipped");
    assert.equal(hostGuard.isBlocked(host), false, "an expected miss must not trip the breaker");
  } finally {
    restoreFetch();
  }
});

test("missingIsAnswer: a real throttle still trips the breaker", async () => {
  const host = "finra-throttle-test.example";
  mockFetchOnce(async () => new Response("", { status: 429, statusText: "Too Many Requests" }));
  try {
    await assert.rejects(() => fetchText(`https://${host}/x.txt`, { missingIsAnswer: true }), /429/);
    assert.equal(hostGuard.isBlocked(host), true, "429 is a refusal, not a missing file");
  } finally {
    restoreFetch();
  }
});

// fetchMarket is the only fetch path in the pipeline that cannot throw: both
// quote legs go through Promise.allSettled, so a failure returns null and the
// caller's try/catch never fires. That is how a 100% price outage ran for twelve
// days (2026-07-31 to 2026-08-11) with an empty failure list and a clean exit 0.
test("fetchMarket: a working quote source returns a price and reports nothing", async () => {
  mockFetchOnce(async (url) => {
    if (String(url).includes("finance.yahoo.com")) return new Response(yahooChart({ symbol: "TEST" }), { status: 200 });
    return new Response("", { status: 500, statusText: "Internal Server Error" });
  });
  const failures = [];
  try {
    const market = await fetchMarket("TEST", failures);
    assert.equal(market?.lastPrice, 12);
    assert.deepEqual(failures, [], "a ticker that got a quote must not leave a failure line");
  } finally {
    restoreFetch();
  }
});

test("fetchMarket: losing every quote source reports why instead of failing silently", async () => {
  // 500 rather than 429 on purpose: a throttle status would trip the shared
  // module-level breaker for these hosts and leak into later tests.
  mockFetchOnce(async () => new Response("", { status: 500, statusText: "Internal Server Error" }));
  const failures = [];
  try {
    const market = await fetchMarket("TEST", failures);
    assert.equal(market, null);
    assert.equal(failures.length, 1, "a ticker with no quote at all must leave exactly one failure line");
    // summariseFailures collapses on the "<SOURCE> <TICKER>:" shape, so the
    // ticker has to sit right before the colon for a run-wide outage to read as
    // one counted line rather than 140 near-identical ones.
    assert.match(failures[0], /^Price\/Volume TEST: /);
    assert.match(failures[0], /Yahoo .*500/, "names the Yahoo failure");
    assert.match(failures[0], /Stooq .*500/, "names the Stooq failure");
  } finally {
    restoreFetch();
  }
});
