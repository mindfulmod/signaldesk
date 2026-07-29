import { test } from "node:test";
import assert from "node:assert/strict";
import { createHostGuard, hostOf, summariseFailures } from "../lib/host-guard.mjs";

test("hostOf: extracts the host, and degrades gracefully on junk", () => {
  assert.equal(hostOf("https://api.nasdaq.com/api/news?q=x"), "api.nasdaq.com");
  assert.equal(hostOf("not a url"), "not a url");
});

test("noteFailure: a 429 or 403 trips the breaker immediately", () => {
  for (const status of ["429 Too Many Requests", "403 Forbidden"]) {
    const guard = createHostGuard();
    guard.noteFailure("h", new Error(status));
    assert.equal(guard.isBlocked("h"), true, status);
  }
});

test("noteFailure: generic errors trip only after the streak limit", () => {
  const guard = createHostGuard({ failureLimit: 3 });
  guard.noteFailure("h", new Error("fetch failed"));
  assert.equal(guard.isBlocked("h"), false);
  guard.noteFailure("h", new Error("fetch failed"));
  assert.equal(guard.isBlocked("h"), false);
  guard.noteFailure("h", new Error("The operation was aborted due to timeout"));
  assert.equal(guard.isBlocked("h"), true);
});

test("noteSuccess: resets the streak so blips do not accumulate", () => {
  const guard = createHostGuard({ failureLimit: 3 });
  guard.noteFailure("h", new Error("fetch failed"));
  guard.noteFailure("h", new Error("fetch failed"));
  guard.noteSuccess("h");
  guard.noteFailure("h", new Error("fetch failed"));
  guard.noteFailure("h", new Error("fetch failed"));
  assert.equal(guard.isBlocked("h"), false);
});

test("breaker is per-host, not global", () => {
  const guard = createHostGuard();
  guard.noteFailure("blocked.example", new Error("403 Forbidden"));
  assert.equal(guard.isBlocked("blocked.example"), true);
  assert.equal(guard.isBlocked("fine.example"), false);
});

test("waitFor: enforces minimum spacing, then clears", () => {
  const guard = createHostGuard({ minSpacingMs: 400 });
  assert.equal(guard.waitFor("h", 10_000), 0, "first request is never delayed");
  guard.markRequest("h", 10_000);
  assert.equal(guard.waitFor("h", 10_100), 300);
  assert.equal(guard.waitFor("h", 10_400), 0);
  assert.equal(guard.waitFor("h", 99_999), 0);
});

test("summariseFailures: collapses per-ticker repeats into one counted line", () => {
  const raw = [
    "StockTwits trending: 403 Forbidden",
    "Nasdaq ONFO: fetch failed",
    "Nasdaq NEXR: fetch failed",
    "Nasdaq TV: fetch failed",
    "GDELT News: 429 Too Many Requests",
  ];
  assert.deepEqual(summariseFailures(raw, 20), [
    "StockTwits trending: 403 Forbidden",
    "3x Nasdaq <ticker>: fetch failed",
    "GDELT News: 429 Too Many Requests",
  ]);
});

test("summariseFailures: respects the limit and keeps first-seen order", () => {
  const raw = ["a: x", "b: y", "c: z"];
  assert.deepEqual(summariseFailures(raw, 2), ["a: x", "b: y"]);
});

// The frontend's tape empty-state only claims "throttled" when a news-source
// failure carries a throttle marker; summarised lines must not break that.
test("summariseFailures: preserves throttle markers and source names", () => {
  const out = summariseFailures(["GDELT News: 429 Too Many Requests", "GDELT News: 429 Too Many Requests"], 20);
  assert.equal(out.length, 1);
  assert.match(out[0], /GDELT News/);
  assert.match(out[0], /429/);
});

test("summariseFailures: an unreachable-host line is NOT mistaken for throttling", () => {
  const [line] = summariseFailures(["Nasdaq ONFO: fetch failed", "Nasdaq TV: fetch failed"], 20);
  assert.match(line, /Nasdaq/);
  assert.doesNotMatch(line, /\b(429|403|throttl)/i);
});
