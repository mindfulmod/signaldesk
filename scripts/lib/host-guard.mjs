// Per-host request guard for the news path: minimum spacing, a circuit breaker,
// and failure-log summarisation. Kept here (rather than inline in
// update-data.mjs) so the decision logic is unit-testable — the pipeline's
// untested helpers are what let a total feed-parsing failure go unnoticed for
// months, so anything with branching behaviour belongs in lib/ with tests.

export const HOST_MIN_SPACING_MS = 400;
export const HOST_FAILURE_LIMIT = 3;

// Hosts that publish a rate limit stricter than the 400ms default get it
// honoured rather than discovered. GDELT answers a too-fast request with
// "Please limit requests to one every 5 seconds" and a 429; the pipeline makes
// ~6 GDELT calls per run (the news query plus up to 5 phrase confirmations) and
// was firing them back to back, so it spent most runs throttled off a source it
// could have had for free by waiting. Spacing is per host, so this costs the run
// nothing except on the host it applies to.
//
// 8s rather than the documented 5s: measured 2026-08-11 from a residential IP,
// 5s still drew 429s while 8s ran clean. GDELT also penalises a burst well
// beyond the nominal window -- once throttled it kept refusing 12s-spaced
// requests for over a minute -- so the breaker cooldown matters here as much as
// the spacing, and retrying hard against a 429 actively deepens the hole.
export const HOST_SPACING_OVERRIDES = {
  "api.gdeltproject.org": 8_000,
};

// A tripped breaker is a cooldown, not a death sentence. Blocking a host for
// the remainder of the run is right when the run touches that host a handful of
// times (the news wires), and catastrophic when it touches one host once per
// ticker: the price loop hits query1.finance.yahoo.com ~140 times in a burst,
// Yahoo answers a few of those with a 429 as a matter of routine, and under a
// permanent block that single 429 zeroed out every remaining quote for the rest
// of the run. Prices went from ~60/75 tickers to 2/75 on 2026-07-31 for exactly
// that reason, and stayed there for twelve days.
//
// The two failure modes get different cooldowns because they cost different
// amounts to be wrong about. A 429/403 rejects in milliseconds, so probing a
// throttled host again is nearly free and usually works -- rate limiters are
// asking for a pause, not refusing service. A timeout or connection failure can
// cost the full 20s request timeout per probe, which is the budget leak that
// took the refresh down for two days before the 2026-07-31 fix, so those back
// off far harder. Both escalate on repeat, so a host that is genuinely down
// converges to the cap after a few probes instead of being retried forever.
export const HOST_THROTTLE_COOLDOWN_MS = 2_000;
export const HOST_THROTTLE_MAX_COOLDOWN_MS = 60_000;
export const HOST_FAILURE_COOLDOWN_MS = 30_000;
export const HOST_FAILURE_MAX_COOLDOWN_MS = 120_000;

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
}

const THROTTLE_STATUS = /\b(429|403)\b/;

export function createHostGuard({
  minSpacingMs = HOST_MIN_SPACING_MS,
  spacingOverrides = HOST_SPACING_OVERRIDES,
  failureLimit = HOST_FAILURE_LIMIT,
  throttleCooldownMs = HOST_THROTTLE_COOLDOWN_MS,
  throttleMaxCooldownMs = HOST_THROTTLE_MAX_COOLDOWN_MS,
  failureCooldownMs = HOST_FAILURE_COOLDOWN_MS,
  failureMaxCooldownMs = HOST_FAILURE_MAX_COOLDOWN_MS,
} = {}) {
  const blockedUntil = new Map();
  const blockCount = new Map();
  const failureStreak = new Map();
  const lastRequest = new Map();

  // Each consecutive block on the same host doubles its cooldown from the base
  // for that failure kind, so a routine burst throttle costs ~2s while a host
  // that is down for the whole run converges on its cap after a few probes.
  function block(host, now, throttled) {
    const priorBlocks = blockCount.get(host) || 0;
    const base = throttled ? throttleCooldownMs : failureCooldownMs;
    const cap = throttled ? throttleMaxCooldownMs : failureMaxCooldownMs;
    blockCount.set(host, priorBlocks + 1);
    blockedUntil.set(host, now + Math.min(cap, base * 2 ** priorBlocks));
    failureStreak.delete(host);
  }

  return {
    // True while a host is inside its cooldown after throttling us or failing
    // `failureLimit` times in a row. Callers skip the request entirely rather
    // than burning budget on it. Once the cooldown elapses the host is eligible
    // again and the next call through is a probe: it either succeeds (clearing
    // the escalation) or re-blocks for twice as long.
    isBlocked(host, now = Date.now()) {
      const until = blockedUntil.get(host);
      if (until === undefined) return false;
      if (now < until) return true;
      blockedUntil.delete(host);
      return false;
    },

    // Milliseconds the caller should wait before hitting this host again.
    waitFor(host, now = Date.now()) {
      const spacing = spacingOverrides[host] ?? minSpacingMs;
      const since = now - (lastRequest.get(host) || 0);
      return since >= spacing ? 0 : spacing - since;
    },

    markRequest(host, now = Date.now()) {
      lastRequest.set(host, now);
    },

    // A success means the host is answering again: clear the escalation too, so
    // the scattered 429s a long burst normally collects each cost one short
    // cooldown rather than ratcheting toward the cap.
    noteSuccess(host) {
      failureStreak.delete(host);
      blockCount.delete(host);
    },

    // 429/403 trips the breaker immediately — the host is explicitly refusing.
    // Everything else (DNS failure, TLS error, timeout, a bare "fetch failed")
    // trips it only after a streak, since one-off network blips are normal.
    noteFailure(host, error, now = Date.now()) {
      const message = error?.message ?? String(error);
      const throttled = THROTTLE_STATUS.test(message);
      if (throttled) {
        block(host, now, true);
        return;
      }
      // A host that already tripped the breaker and has not answered since does
      // not get a fresh streak allowance: one failed probe re-blocks it, for
      // twice as long. Without this, re-earning the block costs `failureLimit`
      // full 20s timeouts every single cycle against a host that is simply down.
      if ((blockCount.get(host) || 0) > 0) {
        block(host, now, false);
        return;
      }
      const streak = (failureStreak.get(host) || 0) + 1;
      failureStreak.set(host, streak);
      if (streak >= failureLimit) block(host, now, false);
    },
  };
}

// Only a bounded number of failures get published, and a single unreachable
// host can emit dozens of identical per-ticker entries that crowd out every
// other diagnostic. Collapse repeats (the ticker is the only varying part of
// "Nasdaq AAPL: fetch failed") into one counted line, preserving first-seen
// order.
export function summariseFailures(failures, limit) {
  const groups = new Map();
  for (const failure of failures) {
    const key = String(failure).replace(/ [A-Z][A-Z0-9.-]{0,6}:/, " <ticker>:");
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  return [...groups]
    .map(([message, count]) => (count > 1 ? `${count}x ${message}` : message))
    .slice(0, limit);
}
