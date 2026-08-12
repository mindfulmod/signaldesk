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

// The regression that took prices down for twelve days: one routine 429 partway
// through a ~140-request burst against a single host used to block that host for
// the entire remaining run.
test("a tripped breaker recovers after its cooldown", () => {
  const guard = createHostGuard({ throttleCooldownMs: 2_000 });
  guard.noteFailure("h", new Error("429 Too Many Requests"), 1_000);
  assert.equal(guard.isBlocked("h", 1_000), true, "blocked immediately");
  assert.equal(guard.isBlocked("h", 2_999), true, "still blocked inside the cooldown");
  assert.equal(guard.isBlocked("h", 3_000), false, "eligible again once the cooldown elapses");
});

// A throttle rejects in milliseconds, so probing again is cheap; a timeout can
// cost the full 20s request timeout per probe, so it has to back off much harder.
test("a throttle recovers far sooner than a connection failure", () => {
  const guard = createHostGuard({ throttleCooldownMs: 2_000, failureCooldownMs: 30_000, failureLimit: 1 });
  const throttled = createHostGuard({ throttleCooldownMs: 2_000, failureCooldownMs: 30_000, failureLimit: 1 });

  guard.noteFailure("h", new Error("The operation was aborted due to timeout"), 0);
  throttled.noteFailure("h", new Error("429 Too Many Requests"), 0);

  assert.equal(throttled.isBlocked("h", 2_001), false, "throttled host is eligible again after 2s");
  assert.equal(guard.isBlocked("h", 2_001), true, "timed-out host is still backing off at 2s");
  assert.equal(guard.isBlocked("h", 30_001), false, "timed-out host recovers at 30s");
});

test("repeat blocks escalate, and a success resets the escalation", () => {
  const guard = createHostGuard({ throttleCooldownMs: 2_000, throttleMaxCooldownMs: 60_000 });
  guard.noteFailure("h", new Error("429"), 0);
  assert.equal(guard.isBlocked("h", 2_000), false, "first block: 2s");

  guard.noteFailure("h", new Error("429"), 2_000);
  assert.equal(guard.isBlocked("h", 5_000), true, "second block doubles to 4s");
  assert.equal(guard.isBlocked("h", 6_000), false);

  // A host that answers again starts its next cooldown back at the base, so the
  // scattered 429s a long burst normally collects never ratchet to the cap.
  guard.noteSuccess("h");
  guard.noteFailure("h", new Error("429"), 6_000);
  assert.equal(guard.isBlocked("h", 8_001), false, "back to a 2s block after recovering");
});

test("cooldown is capped so a dead host stops costing probes", () => {
  const guard = createHostGuard({ throttleCooldownMs: 2_000, throttleMaxCooldownMs: 8_000 });
  for (const at of [0, 2_000, 6_000, 14_000]) guard.noteFailure("h", new Error("429"), at);
  assert.equal(guard.isBlocked("h", 21_999), true, "still inside the capped cooldown");
  assert.equal(guard.isBlocked("h", 22_001), false, "cap holds at 8s, not unbounded doubling");
});

// Recovery must not hand a dead host a fresh streak allowance every cycle: at
// `failureLimit` 20s timeouts per re-block, that is a full minute of run budget
// burned per cooldown against a host that is simply down -- the exact budget
// leak the breaker exists to prevent.
test("an unrecovered host re-blocks on a single failed probe, not a fresh streak", () => {
  const guard = createHostGuard({ failureLimit: 3, failureCooldownMs: 30_000, failureMaxCooldownMs: 120_000 });
  for (const at of [0, 1_000, 2_000]) guard.noteFailure("h", new Error("fetch failed"), at);
  assert.equal(guard.isBlocked("h", 2_000), true, "blocked after the initial streak");

  // Cooldown elapses, the probe fails again: one failure is enough to re-block.
  assert.equal(guard.isBlocked("h", 32_001), false, "eligible for a probe");
  guard.noteFailure("h", new Error("fetch failed"), 32_001);
  assert.equal(guard.isBlocked("h", 32_002), true, "one failed probe re-blocks it");
  assert.equal(guard.isBlocked("h", 92_000), true, "and the cooldown doubled to 60s");
  assert.equal(guard.isBlocked("h", 92_001), false, "expiring 60s after the re-block, not 30s");

  // A host that answers again is fully forgiven and gets the streak back.
  guard.noteSuccess("h");
  guard.noteFailure("h", new Error("fetch failed"), 200_000);
  assert.equal(guard.isBlocked("h", 200_000), false, "a recovered host is back to needing a full streak");
});

test("breaker is per-host, not global", () => {
  const guard = createHostGuard();
  guard.noteFailure("blocked.example", new Error("403 Forbidden"));
  assert.equal(guard.isBlocked("blocked.example"), true);
  assert.equal(guard.isBlocked("fine.example"), false);
});

// GDELT answers a too-fast request with "Please limit requests to one every 5
// seconds". Honouring a published limit is cheaper than discovering it: the
// default 400ms spacing meant most runs threw GDELT away on a 429.
test("waitFor: a host with a published limit gets its own spacing", () => {
  const guard = createHostGuard({ minSpacingMs: 400, spacingOverrides: { "api.gdeltproject.org": 5_000 } });
  guard.markRequest("api.gdeltproject.org", 10_000);
  guard.markRequest("other.example", 10_000);

  assert.equal(guard.waitFor("api.gdeltproject.org", 10_400), 4_600, "still waiting well past the default");
  assert.equal(guard.waitFor("api.gdeltproject.org", 15_000), 0, "clear at 5s");
  assert.equal(guard.waitFor("other.example", 10_400), 0, "other hosts keep the 400ms default");
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
