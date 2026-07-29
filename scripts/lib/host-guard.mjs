// Per-host request guard for the news path: minimum spacing, a circuit breaker,
// and failure-log summarisation. Kept here (rather than inline in
// update-data.mjs) so the decision logic is unit-testable — the pipeline's
// untested helpers are what let a total feed-parsing failure go unnoticed for
// months, so anything with branching behaviour belongs in lib/ with tests.

export const HOST_MIN_SPACING_MS = 400;
export const HOST_FAILURE_LIMIT = 3;

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
  failureLimit = HOST_FAILURE_LIMIT,
} = {}) {
  const blocked = new Set();
  const failureStreak = new Map();
  const lastRequest = new Map();

  return {
    // True once a host has throttled us or failed `failureLimit` times in a
    // row. Callers skip the request entirely rather than burning budget on it.
    isBlocked: (host) => blocked.has(host),

    // Milliseconds the caller should wait before hitting this host again.
    waitFor(host, now = Date.now()) {
      const since = now - (lastRequest.get(host) || 0);
      return since >= minSpacingMs ? 0 : minSpacingMs - since;
    },

    markRequest(host, now = Date.now()) {
      lastRequest.set(host, now);
    },

    noteSuccess(host) {
      failureStreak.delete(host);
    },

    // 429/403 trips the breaker immediately — the host is explicitly refusing.
    // Everything else (DNS failure, TLS error, timeout, a bare "fetch failed")
    // trips it only after a streak, since one-off network blips are normal.
    noteFailure(host, error) {
      const message = error?.message ?? String(error);
      if (THROTTLE_STATUS.test(message)) {
        blocked.add(host);
        return;
      }
      const streak = (failureStreak.get(host) || 0) + 1;
      failureStreak.set(host, streak);
      if (streak >= failureLimit) blocked.add(host);
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
