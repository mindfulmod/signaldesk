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

const { guardedRequest, fetchJson, fetchJsonWithUA, fetchJsonRetry, fetchText, fetchTextWithUA } = await import(
  "../update-data.mjs"
);

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
