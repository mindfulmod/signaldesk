import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// scripts/update-data.mjs calls main() unconditionally at module scope (no
// import guard), so it cannot be imported from a test without running the
// whole scheduled pipeline against live hosts. This test reads it as text
// instead and enforces the one property that matters here: no `await
// fetch(...)` may be unbounded.
//
// Why this exists: fetchJson() had no timeout. nasdaqTickerNews() used it
// against api.nasdaq.com, which hangs (rather than erroring) intermittently
// from GitHub Actions runner IPs under Cloudflare bot-protection. With no
// timeout, that await never settled, the circuit breaker never saw a failure
// to record, and eight consecutive scheduled runs blew past the workflow's
// 35-minute job timeout and were killed mid-refresh -- silently, with no
// failed-run notification, for two days. SignalDesk kept serving Jul 29 data
// throughout. A per-call timeout turns "hangs forever" into "fails after 20s,
// the breaker counts it, the run finishes in minutes like every prior run."
//
// A second, related incident the same day: even after every fetch got its own
// timeout, fetchJsonRetry (GDELT) and fetchJsonWithUA (EDGAR) still called
// fetch directly with no host-level circuit breaker. A degraded host hit once
// per phrase candidate or once per quarter still multiplied a single slow host
// into many minutes, even with each individual call bounded. Every raw fetch
// now routes through guardedRequest(), which is both timeout-bounded AND
// breaker-aware -- this test only checks the timeout half; the breaker half
// has no static signature to grep for, so watch actual run duration too.
const SOURCE_PATH = fileURLToPath(new URL("../update-data.mjs", import.meta.url));
const source = readFileSync(SOURCE_PATH, "utf8");

// Extracts the full argument list of every `fetch(...)` call by balancing
// parens from each match, so a call spanning multiple lines (as all of these
// do, since they pass a headers/signal object) is captured whole.
function fetchCallArgs(text) {
  const calls = [];
  const callRe = /\bfetch\(/g;
  let match;
  while ((match = callRe.exec(text))) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (depth > 0 && i < text.length) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") depth -= 1;
      i += 1;
    }
    calls.push({ args: text.slice(start, i - 1), index: match.index });
  }
  return calls;
}

test("update-data.mjs: every fetch() call is bounded by a signal/timeout", () => {
  const calls = fetchCallArgs(source);
  // Most helpers were consolidated to delegate through one guardedRequest();
  // the two remaining raw call sites are guardedRequest() itself and
  // fetchJsonRetry()'s own backoff loop (kept separate deliberately -- see
  // the comment above it). If this count ever drops, something merged them
  // further; if it climbs, a new raw fetch call site was added outside the
  // shared helper and needs the same scrutiny this test exists to apply.
  assert.equal(calls.length, 2, `expected exactly the 2 known raw fetch() call sites, found ${calls.length}`);
  const unbounded = calls.filter((call) => !/signal\s*:/.test(call.args));
  if (unbounded.length) {
    const lines = unbounded.map((call) => source.slice(0, call.index).split("\n").length);
    assert.fail(
      `fetch() call(s) without a signal/timeout at line(s) ${lines.join(", ")} -- ` +
        `a host that hangs instead of erroring will stall the whole scheduled run ` +
        `past its job timeout instead of failing fast. Pass { signal: AbortSignal.timeout(20000) }.`
    );
  }
});
