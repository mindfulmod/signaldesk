import { test } from "node:test";
import assert from "node:assert/strict";
import { relativeReturn, madeNewHighRecently, computeDecaySignal, computeThemeHeat } from "../lib/theme-heat.mjs";

test("relativeReturn: outperformance vs SPY over the window", () => {
  const spy = Array.from({ length: 200 }, (_, i) => 100 + i * 0.1); // SPY +10% over 100 sessions
  const member = Array.from({ length: 200 }, (_, i) => 50 + i * 0.3); // member +~30% over 100 sessions in absolute terms
  const rel = relativeReturn(member, spy, 100);
  assert.ok(rel > 0, `expected positive relative return, got ${rel}`);
});

test("relativeReturn: null when there isn't a full window of history", () => {
  const spy = Array.from({ length: 50 }, () => 100);
  const member = Array.from({ length: 50 }, () => 50);
  assert.equal(relativeReturn(member, spy, 90), null);
});

test("madeNewHighRecently: true when a trailing-year high occurred inside the lookback", () => {
  const closes = [...Array.from({ length: 252 }, (_, i) => 100 + i * 0.1), 130, 128, 126]; // high near the end, then pulls back
  assert.equal(madeNewHighRecently(closes, { lookback: 60, yearWindow: 252 }), true);
});

test("madeNewHighRecently: false for a series stuck well below its trailing high", () => {
  const closes = [...Array.from({ length: 252 }, (_, i) => 100 + Math.sin(i * 0.3) * 5), ...Array.from({ length: 60 }, () => 80)];
  assert.equal(madeNewHighRecently(closes, { lookback: 60, yearWindow: 252 }), false);
});

// Regression test: today's own close must not be included in the trailing
// max it's compared against, or the check is tautologically true for any
// flat/monotonic-non-decreasing series (the bug this guards against).
test("madeNewHighRecently: a flat series is not a 'new high' every day", () => {
  const closes = Array.from({ length: 300 }, () => 100);
  assert.equal(madeNewHighRecently(closes), false);
});

// Regression test: a ticker with only a couple of ledger rows must not
// register as a "new high" -- Math.max(...[]) is -Infinity, which made any
// finite close look like a record once the prior-window length check was
// satisfied by an (incorrectly) near-empty window.
test("madeNewHighRecently: a brand-new series with almost no history is false, not a trivial true", () => {
  assert.equal(madeNewHighRecently([210.96, 210.96]), false);
  assert.equal(madeNewHighRecently([100]), false);
});

test("computeDecaySignal: detects a theme index falling below its trailing average", () => {
  const spy = Array.from({ length: 150 }, () => 100);
  // Members outperform early, then fade back to flat -- equal-weight index
  // should read "below trailing average" at the end. Needs >= MIN_MEMBERS_WITH_DATA
  // (3) series, since a single-name "theme index" isn't meaningful.
  const makeMember = (offset) => Array.from({ length: 150 }, (_, i) => (i < 100 ? 100 + i * 0.5 + offset : 150 + offset - (i - 100) * 1.2));
  const members = [makeMember(0), makeMember(2), makeMember(-2)];
  const decay = computeDecaySignal(members, spy, 40);
  assert.equal(decay, true);
});

test("computeDecaySignal: null when fewer than MIN_MEMBERS_WITH_DATA series are provided", () => {
  const spy = Array.from({ length: 150 }, () => 100);
  const member = Array.from({ length: 150 }, (_, i) => 100 + i * 0.5);
  assert.equal(computeDecaySignal([member], spy, 40), null);
});

test("computeThemeHeat: a theme with too few members-with-data is marked insufficient-data", () => {
  const ledger = { tickers: { SPY: { rows: [] }, AAA: { rows: [] } } };
  const registry = { themes: [{ id: "t1", name: "Test theme", members: [{ t: "AAA" }, { t: "BBB" }] }] };
  const result = computeThemeHeat(ledger, registry);
  assert.equal(result.themes[0].stage, "insufficient-data");
  assert.equal(result.themes[0].heat, null);
});
