import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractNgrams,
  extractCandidatesFromEvents,
  isNovel,
  wowAcceleration,
  parseGdeltTimeline,
  assessGdeltVolume,
  assessEdgarAcceleration,
  shortlistCandidates,
  confirmCandidates,
  phraseScore,
  matchPhrasesToThemes,
} from "../lib/phrase-velocity.mjs";

test("extractNgrams: pulls meaningful bigrams/trigrams, drops all-stopword n-grams", () => {
  const ngrams = extractNgrams("Analysts say co-packaged optics is the next data center power play");
  assert.ok(ngrams.includes("co-packaged optics"));
  assert.ok(ngrams.includes("data center") || ngrams.includes("center power"));
  assert.ok(!ngrams.includes("is the"), "an all-stopword bigram should be dropped");
});

// Regression test: a live pipeline run generated "volume 1"/"volume 2"/...
// as top phrase candidates purely from Price/Volume's synthetic
// "$X.XX, price +Y%, volume Z.Zx" title template -- not real prose.
test("extractCandidatesFromEvents: ignores synthetic/templated titles from non-news sources", () => {
  const events = [
    { title: "SOFI $18.95, price +2.1%, volume 1.2x", url: "https://finance.yahoo.com/quote/SOFI", source: "Price/Volume", ticker: "SOFI" },
    { title: "AAPL FINRA short volume 40% of reported volume (500,000 shares)", url: "https://finra.org/x", source: "FINRA Short Volume", ticker: "AAPL" },
    { title: "12,345 social mentions on ApeWisdom (up from 1,000 a day ago)", url: "https://apewisdom.io/stocks/NVDA/", source: "ApeWisdom", ticker: "NVDA" },
  ];
  const candidates = extractCandidatesFromEvents(events);
  assert.equal(candidates.size, 0, "synthetic-title sources should contribute no phrase candidates");
});

// Second regression test: a live run's second wave of noise was generic
// conversational bigrams ("due to", "trying to", "need a") from casual
// Reddit/WSB prose -- these pass the novelty filter on a cold start (they
// haven't recurred yet to get disqualified) but aren't the kind of specific
// emergent terminology the spec cares about. Fixed by restricting candidate
// generation to edited news sources rather than trying to denylist an
// unbounded set of generic English phrases.
test("extractCandidatesFromEvents: ignores casual social-source prose, even with real distinctive phrases", () => {
  const events = [
    { title: "trying to figure out why everyone is talking about co-packaged optics", url: "https://reddit.com/r/wallstreetbets/1", source: "Wallstreetbets", ticker: "COHR" },
    { title: "need a good DD on this before I buy the dip", url: "https://reddit.com/r/stocks/2", source: "Reddit Finance", ticker: "AAPL" },
  ];
  assert.equal(extractCandidatesFromEvents(events).size, 0);
});

test("extractCandidatesFromEvents: counts mentions, tracks distinct source domains and co-occurring tickers", () => {
  const events = [
    { title: "NVDA leads the co-packaged optics wave", url: "https://reuters.com/a", source: "GDELT News", ticker: "NVDA" },
    { title: "Co-packaged optics adoption accelerating", url: "https://cnbc.com/b", source: "CNBC", ticker: "COHR" },
    { title: "", url: "https://x.com/c", source: "GDELT News", ticker: "AAPL" }, // no title -> ignored
  ];
  const candidates = extractCandidatesFromEvents(events);
  const entry = candidates.get("co-packaged optics");
  assert.ok(entry);
  assert.equal(entry.count, 2);
  assert.equal(entry.domains.size, 2);
  assert.deepEqual([...entry.tickers].sort(), ["COHR", "NVDA"]);
});

test("isNovel: true for a brand-new phrase or one with little prior history, false for an established one", () => {
  const history = { weeks: { "2026-W01": { "ai accelerator": 50 }, "2026-W02": { "ai accelerator": 40 } } };
  assert.equal(isNovel(history, "ai accelerator", "2026-W03"), false);
  assert.equal(isNovel(history, "co-packaged optics", "2026-W03"), true);
});

test("wowAcceleration: true when this week's count is well above the trailing-4-week average", () => {
  const history = { weeks: { "2026-W01": { p: 2 }, "2026-W02": { p: 3 }, "2026-W03": { p: 2 } } };
  assert.equal(wowAcceleration(history, "p", "2026-W04", 20), true);
  assert.equal(wowAcceleration(history, "p", "2026-W04", 3), false);
});

test("parseGdeltTimeline: extracts points from the expected shape, null on an unexpected one", () => {
  const good = { timeline: [{ series: "Volume Intensity", data: [{ date: "20260101", value: 1.2 }, { date: "20260102", value: 1.4 }] }] };
  const points = parseGdeltTimeline(good);
  assert.equal(points.length, 2);
  assert.equal(parseGdeltTimeline({ unexpected: true }), null);
  assert.equal(parseGdeltTimeline(null), null);
});

// Date strings must be zero-padded (or otherwise lexicographically sortable
// in true chronological order) since assessGdeltVolume sorts by string.
const padDate = (i) => `d${String(i).padStart(4, "0")}`;

test("assessGdeltVolume: confirms when the trailing-90d average is well above the prior-window average", () => {
  const priorLow = Array.from({ length: 275 }, (_, i) => ({ date: padDate(i), value: 0.1 }));
  const recentHigh = Array.from({ length: 90 }, (_, i) => ({ date: padDate(275 + i), value: 0.5 }));
  const result = assessGdeltVolume([...priorLow, ...recentHigh]);
  assert.ok(result.confirmed);
  assert.ok(result.ratio >= 2);
});

test("assessGdeltVolume: not confirmed for flat volume, null with too little data", () => {
  const flat = Array.from({ length: 365 }, (_, i) => ({ date: padDate(i), value: 0.3 }));
  assert.equal(assessGdeltVolume(flat).confirmed, false);
  assert.equal(assessGdeltVolume(Array.from({ length: 5 }, (_, i) => ({ date: padDate(i), value: 0.3 }))), null);
});

test("assessEdgarAcceleration: confirms on YoY >=2x with a minimum filing count", () => {
  const counts = [
    { year: 2024, quarter: 3, count: 8 },
    { year: 2025, quarter: 3, count: 22 },
  ];
  const result = assessEdgarAcceleration(counts);
  assert.equal(result.confirmed, true);
  assert.equal(result.basis, "yoy");
});

test("assessEdgarAcceleration: confirms small counts via 3 consecutive rising quarters", () => {
  const counts = [
    { year: 2025, quarter: 1, count: 2 },
    { year: 2025, quarter: 2, count: 4 },
    { year: 2025, quarter: 3, count: 7 },
  ];
  const result = assessEdgarAcceleration(counts);
  assert.equal(result.confirmed, true);
  assert.equal(result.basis, "3-consecutive-rising");
});

test("assessEdgarAcceleration: not confirmed for flat/declining filings", () => {
  const counts = [
    { year: 2025, quarter: 1, count: 5 },
    { year: 2025, quarter: 2, count: 4 },
    { year: 2025, quarter: 3, count: 4 },
  ];
  assert.equal(assessEdgarAcceleration(counts).confirmed, false);
});

test("shortlistCandidates: applies novelty, WoW acceleration, and the min-source-domains guard", () => {
  const history = { weeks: {}, firstSeen: {} };
  const events = [
    { title: "co-packaged optics deals surge across the industry", url: "https://reuters.com/1", source: "GDELT News", ticker: "COHR" },
    { title: "co-packaged optics deals surge across the industry", url: "https://cnbc.com/2", source: "CNBC", ticker: "LITE" },
    { title: "market stock shares today", url: "https://x.com/3", source: "GDELT News", ticker: "AAPL" }, // all-stopword-ish, low signal
  ];
  const { shortlist, nextHistory } = shortlistCandidates(history, events, "2026-01-15");
  const phraseNames = shortlist.map((s) => s.phrase);
  assert.ok(phraseNames.includes("co-packaged optics"));
  assert.ok(nextHistory.firstSeen["co-packaged optics"]);
});

test("shortlistCandidates: an established (non-novel) phrase is excluded even if it appears today", () => {
  const weekKey = "2026-W01";
  const history = { weeks: { [weekKey]: { "ai chip": 100 } }, firstSeen: {} };
  const events = [
    { title: "ai chip demand keeps climbing this quarter", url: "https://reuters.com/1", source: "GDELT News", ticker: "NVDA" },
    { title: "ai chip demand keeps climbing this quarter", url: "https://cnbc.com/2", source: "CNBC", ticker: "AMD" },
  ];
  // Same week as the pre-existing huge count -- isNovel excludes weekKey itself from the prior-mentions
  // sum, so use a later date to simulate an already-established phrase with real prior history.
  const { shortlist } = shortlistCandidates({ weeks: { "2025-W52": { "ai chip": 100 } }, firstSeen: {} }, events, "2026-01-05");
  assert.ok(!shortlist.some((s) => s.phrase === "ai chip"));
});

test("confirmCandidates: a phrase confirmed by both corpora is marked confirmed; only one corpus is not enough", () => {
  const shortlist = [{ phrase: "co-packaged optics", weekCount: 5, tickers: ["COHR"], domains: 2 }];
  const gdeltPoints = [...Array.from({ length: 275 }, (_, i) => ({ date: `d${i}`, value: 0.1 })), ...Array.from({ length: 90 }, (_, i) => ({ date: `e${i}`, value: 0.5 }))];
  const edgarCounts = [{ year: 2024, quarter: 3, count: 8 }, { year: 2025, quarter: 3, count: 22 }];

  return confirmCandidates({
    history: { gdeltCache: {}, lastGdeltRunDate: null, lastEdgarRunWeek: null },
    shortlist,
    weekKey: "2026-W03",
    dateStr: "2026-01-15",
    fetchGdeltTimeline: async () => ({ timeline: [{ data: gdeltPoints.map((p) => ({ date: p.date, value: p.value })) }] }).timeline[0].data,
    fetchEdgarQuarterCounts: async () => edgarCounts,
  }).then(({ results }) => {
    assert.equal(results[0].confirmed, true);
  });
});

test("confirmCandidates: falls back to a cached GDELT result when the live check is skipped/unreachable", () => {
  const shortlist = [{ phrase: "grid capacity", weekCount: 5, tickers: [], domains: 2 }];
  return confirmCandidates({
    history: {
      gdeltCache: { "grid capacity": { ratio: 3, confirmed: true, checkedDate: "2026-01-01" } },
      lastGdeltRunDate: "2026-01-15", // already ran today -> skip live GDELT
      lastEdgarRunWeek: null,
    },
    shortlist,
    weekKey: "2026-W03",
    dateStr: "2026-01-15",
    fetchGdeltTimeline: async () => {
      throw new Error("should not be called");
    },
    fetchEdgarQuarterCounts: async () => [{ year: 2024, quarter: 3, count: 8 }, { year: 2025, quarter: 3, count: 22 }],
  }).then(({ results }) => {
    assert.equal(results[0].gdelt.confirmed, true);
    assert.equal(results[0].confirmed, true);
  });
});

test("phraseScore: higher confirmation strength scores higher, capped at 1", () => {
  const strong = phraseScore({ ratio: 10 }, { confirmed: true, ratio: 10 });
  const weak = phraseScore({ ratio: 2 }, { confirmed: true, ratio: 2 });
  assert.equal(strong, 1);
  assert.ok(weak < strong);
  assert.equal(phraseScore(null, null), 0);
});

test("matchPhrasesToThemes: matches a confirmed phrase to the theme whose curated phrase list contains it", () => {
  const confirmed = [{ phrase: "co-packaged optics", gdelt: { ratio: 3 }, edgar: { confirmed: true, ratio: 3 } }];
  const themes = [{ id: "photonics", phrases: ["co-packaged optics", "optical interconnect"] }, { id: "ai-power", phrases: ["grid capacity"] }];
  const map = matchPhrasesToThemes(confirmed, themes);
  assert.equal(map.get("photonics").phrase, "co-packaged optics");
  assert.ok(!map.has("ai-power"));
});
