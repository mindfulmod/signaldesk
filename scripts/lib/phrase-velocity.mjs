// Phrase velocity radar — THEME_ENGINE.md Layer 0a. Candidate generation:
// bigrams/trigrams from the headline stream that are (i) new or rare in the
// trailing year and (ii) accelerating week-over-week. Novelty is the filter
// -- established words never qualify (the "photonics vs co-packaged optics"
// lesson: specific emergent phrases discriminate, generic words don't).
// Confirmation via two independent corpora: GDELT timelinevol (news) and
// EDGAR full-text search (filings). A phrase passing both spawns/updates a
// theme card at stage Naming or Diffusion -- in this build, that means
// feeding theme-heat.mjs's `language` score, which has been hardcoded to 0
// since Layer 1 shipped pending this module.
import { readFile, writeFile } from "node:fs/promises";
import { isoWeekKey } from "./alerts.mjs";

const ROOT = new URL("../../", import.meta.url);
export const PHRASE_HISTORY_URL = new URL("data/phrase-history.json", ROOT);
export const PHRASE_RADAR_URL = new URL("data/phrase-radar.json", ROOT);
export const PHRASE_RADAR_JS_URL = new URL("data/phrase-radar.js", ROOT);

export const PHRASE_TRAILING_WEEKS = 56; // ~13 months (a full trailing year + buffer)
export const NOVELTY_MAX_PRIOR_MENTIONS = 3; // "new or rare in the trailing year"
export const WOW_ACCELERATION_MULT = 2; // "accelerating week-over-week"
export const MAX_CANDIDATES_PER_RUN = 40; // bound extraction cost
export const MAX_GDELT_CHECKS_PER_DAY = 5; // GDELT needs >=5s spacing and rate-limits hard
export const MAX_EDGAR_CHECKS_PER_WEEK = 8;
export const GDELT_VOLUME_RATIO_THRESHOLD = 2; // "90d avg >= 2x prior-365d avg"
export const EDGAR_MIN_FILINGS = 10;
export const EDGAR_YOY_MULT = 2;
export const GDELT_CACHE_MAX_AGE_DAYS = 30; // fall back to a cached confirmation if GDELT is unreachable
export const MIN_SOURCE_DOMAINS = 2; // "require >=2 distinct source domains" (failure-mode guard)

// A phrase's n-gram must have at least one non-stopword token, or it's
// almost certainly noise ("in the", "for a", ...). Deliberately not
// exhaustive -- this is a coarse pre-filter; novelty + WoW acceleration
// against real headline volume is the real discriminator per the spec.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "but", "by", "can", "day", "did",
  "do", "does", "for", "from", "get", "got", "had", "has", "have", "he", "her", "here",
  "him", "his", "how", "if", "in", "into", "is", "it", "its", "just", "may", "me", "more",
  "most", "much", "must", "my", "new", "no", "not", "now", "of", "off", "on", "one", "only",
  "or", "other", "our", "out", "over", "own", "per", "said", "same", "say", "says", "see",
  "set", "she", "so", "some", "than", "that", "the", "their", "them", "then", "there", "they",
  "this", "to", "too", "up", "us", "very", "was", "way", "we", "were", "what", "when", "where",
  "which", "who", "why", "will", "with", "would", "you", "your", "stock", "stocks", "shares",
  "share", "market", "markets", "today", "week", "year", "percent",
]);

export async function loadPhraseHistory() {
  try {
    const raw = await readFile(PHRASE_HISTORY_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.weeks) return parsed;
  } catch {
    // First run.
  }
  return { weeks: {}, firstSeen: {}, gdeltCache: {}, lastGdeltRunDate: null, lastEdgarRunWeek: null };
}

export async function savePhraseHistory(history) {
  await writeFile(PHRASE_HISTORY_URL, JSON.stringify(history));
}

export async function loadPhraseRadar() {
  try {
    const raw = await readFile(PHRASE_RADAR_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.phrases)) return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, phrases: [] };
}

export async function savePhraseRadar(radar) {
  const json = JSON.stringify(radar);
  await writeFile(PHRASE_RADAR_URL, json);
  await writeFile(PHRASE_RADAR_JS_URL, `window.SIGNALDESK_PHRASE_RADAR = ${json};\n`);
}

// ---- Candidate generation (pure) -----------------------------------------

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasNonStopword(words) {
  return words.some((w) => !STOPWORDS.has(w) && w.length > 2 && !/^\d+$/.test(w));
}

// Extracts bigrams and trigrams from a headline, dropping n-grams that are
// entirely stopwords/numbers/very short tokens.
export function extractNgrams(text) {
  const words = tokenize(text);
  const ngrams = new Set();
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= words.length; i += 1) {
      const slice = words.slice(i, i + n);
      if (!hasNonStopword(slice)) continue;
      ngrams.add(slice.join(" "));
    }
  }
  return [...ngrams];
}

// Candidate generation is restricted to real news headlines -- matching the
// spec's own framing ("SignalDesk's own headline stream") and its
// confirmation corpora (GDELT news volume, EDGAR filings: both formal-
// register text). Two things ruled out social/aggregator sources during
// this build, both live-verified: (1) synthetic templated titles
// (Price/Volume's "$X.XX, price +Y%, volume Z.Zx", FINRA's share-count
// string, ApeWisdom's mention-count string) generate meaningless n-grams
// like "volume 1" that look "novel" only because the template itself is new
// to phrase-history; (2) casual Reddit/WSB/HN/4chan prose is dominated by
// generic conversational bigrams ("due to", "trying to", "need a") that
// pass the novelty filter on a cold start (nothing has recurred yet to
// disqualify them) but aren't the kind of specific, emergent terminology
// the spec's "GLP-1" / "co-packaged optics" examples are about. An
// allowlist of edited news sources is far more robust against future noise
// than an ever-growing denylist of generic English phrases.
const NEWS_SOURCES = new Set(["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings"]);

// Groups this run's headline-bearing events by phrase -> {count, sourceDomains, tickers}.
export function extractCandidatesFromEvents(events) {
  const candidates = new Map();
  for (const event of events) {
    if (!event.title || !NEWS_SOURCES.has(event.source)) continue;
    const phrases = extractNgrams(event.title);
    if (!phrases.length) continue;
    let domain = "";
    try {
      domain = new URL(event.url).hostname;
    } catch {
      domain = event.source || "unknown";
    }
    for (const phrase of phrases) {
      const entry = candidates.get(phrase) || { count: 0, domains: new Set(), tickers: new Set() };
      entry.count += 1;
      entry.domains.add(domain);
      if (event.ticker) entry.tickers.add(event.ticker);
      candidates.set(phrase, entry);
    }
  }
  return candidates;
}

// Novel: fewer than NOVELTY_MAX_PRIOR_MENTIONS total mentions across all
// *prior* retained weeks (this week excluded). A brand-new phrase (no prior
// history at all) is maximally novel.
export function isNovel(history, phrase, currentWeekKey, threshold = NOVELTY_MAX_PRIOR_MENTIONS) {
  let priorTotal = 0;
  for (const [weekKey, phrases] of Object.entries(history.weeks || {})) {
    if (weekKey === currentWeekKey) continue;
    priorTotal += phrases[phrase] || 0;
  }
  return priorTotal <= threshold;
}

// WoW acceleration: this week's count >= WOW_ACCELERATION_MULT x the
// trailing-4-week average (excluding this week).
export function wowAcceleration(history, phrase, currentWeekKey, thisWeekCount) {
  const weekKeys = Object.keys(history.weeks || {})
    .filter((k) => k !== currentWeekKey)
    .sort()
    .slice(-4);
  const counts = weekKeys.map((k) => history.weeks[k][phrase] || 0);
  const avg = counts.length ? counts.reduce((s, v) => s + v, 0) / counts.length : 0;
  if (avg === 0) return thisWeekCount > 0;
  return thisWeekCount >= avg * WOW_ACCELERATION_MULT;
}

// ---- Confirmation (pure assessment; network calls are injected) ----------

// json.timeline[0].data: [{date, value}] where value is GDELT's % share of
// monitored global news volume matching the query. Not live-verified against
// a real response in this build (GDELT was rate-limited/unreachable from the
// dev sandbox throughout) -- defensive parsing degrades to null rather than
// throwing on an unexpected shape, and the orchestrator treats null as "try
// again next run," never as a negative confirmation.
export function parseGdeltTimeline(json) {
  const points = json?.timeline?.[0]?.data;
  if (!Array.isArray(points)) return null;
  const parsed = points
    .map((p) => ({ date: p.date, value: Number(p.value) }))
    .filter((p) => p.date && Number.isFinite(p.value));
  return parsed.length ? parsed : null;
}

export function assessGdeltVolume(points, { threshold = GDELT_VOLUME_RATIO_THRESHOLD } = {}) {
  if (!points || points.length < 30) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last90 = sorted.slice(-90);
  const priorWindow = sorted.slice(0, -90);
  if (!last90.length || !priorWindow.length) return null;
  const avg = (arr) => arr.reduce((s, p) => s + p.value, 0) / arr.length;
  const recentAvg = avg(last90);
  const priorAvg = avg(priorWindow) || 0.0001;
  const ratio = recentAvg / priorAvg;
  return { ratio, confirmed: ratio >= threshold };
}

// counts: array of {year, quarter, count}, oldest first, up to 8 quarters.
export function assessEdgarAcceleration(counts, { minFilings = EDGAR_MIN_FILINGS, yoyMult = EDGAR_YOY_MULT } = {}) {
  if (!counts || counts.length < 2) return null;
  const latest = counts.at(-1);
  const yearAgo = counts.find((c) => c.year === latest.year - 1 && c.quarter === latest.quarter);
  if (yearAgo && latest.count >= minFilings && latest.count >= yearAgo.count * yoyMult) {
    return { ratio: yearAgo.count ? latest.count / yearAgo.count : Infinity, confirmed: true, basis: "yoy" };
  }
  // Small-count fallback: 3 consecutive rising quarters.
  const lastThree = counts.slice(-3);
  if (lastThree.length === 3 && lastThree[0].count < lastThree[1].count && lastThree[1].count < lastThree[2].count) {
    return { ratio: null, confirmed: true, basis: "3-consecutive-rising" };
  }
  return { ratio: null, confirmed: false, basis: null };
}

// ---- Orchestration ---------------------------------------------------------

// Folds today's headline candidates into the weekly history, applies the
// novelty + WoW acceleration filters, and returns the shortlist worth
// spending GDELT/EDGAR requests on (ranked by mention count, capped, and
// requiring >=MIN_SOURCE_DOMAINS distinct domains -- the spec's junk-phrase
// guard).
export function shortlistCandidates(history, events, dateStr, limit = MAX_CANDIDATES_PER_RUN) {
  const weekKey = isoWeekKey(new Date(dateStr));
  const extracted = extractCandidatesFromEvents(events);

  const week = { ...(history.weeks[weekKey] || {}) };
  for (const [phrase, entry] of extracted) week[phrase] = (week[phrase] || 0) + entry.count;
  const weeks = { ...history.weeks, [weekKey]: week };
  const keys = Object.keys(weeks).sort();
  if (keys.length > PHRASE_TRAILING_WEEKS) for (const k of keys.slice(0, keys.length - PHRASE_TRAILING_WEEKS)) delete weeks[k];

  const firstSeen = { ...history.firstSeen };
  const shortlisted = [];
  for (const [phrase, entry] of extracted) {
    if (entry.domains.size < MIN_SOURCE_DOMAINS) continue;
    if (!isNovel(history, phrase, weekKey)) continue;
    if (!wowAcceleration(history, phrase, weekKey, week[phrase])) continue;
    if (!firstSeen[phrase]) firstSeen[phrase] = dateStr;
    shortlisted.push({ phrase, weekCount: week[phrase], tickers: [...entry.tickers], domains: entry.domains.size });
  }
  shortlisted.sort((a, b) => b.weekCount - a.weekCount);

  return {
    nextHistory: { ...history, weeks, firstSeen },
    shortlist: shortlisted.slice(0, limit),
    weekKey,
  };
}

// `fetchGdeltTimeline(phrase) -> Promise<points|null>` and
// `fetchEdgarQuarterCounts(phrase) -> Promise<counts|null>` are injected so
// this stays testable without network access. Runs GDELT confirmation up to
// MAX_GDELT_CHECKS_PER_DAY once per calendar day (gentle on GDELT's rate
// limit); EDGAR confirmation up to MAX_EDGAR_CHECKS_PER_WEEK once per ISO
// week (matches the spec's 0a cadence: "daily (GDELT) / weekly (EDGAR)").
export async function confirmCandidates({ history, shortlist, weekKey, dateStr, fetchGdeltTimeline, fetchEdgarQuarterCounts, failures = [] }) {
  const gdeltCache = { ...(history.gdeltCache || {}) };
  const runGdelt = history.lastGdeltRunDate !== dateStr;
  const runEdgar = history.lastEdgarRunWeek !== weekKey;

  const results = [];
  for (const candidate of shortlist) {
    let gdelt = null;
    if (runGdelt && results.filter((r) => r.gdeltChecked).length < MAX_GDELT_CHECKS_PER_DAY) {
      try {
        const points = await fetchGdeltTimeline(candidate.phrase);
        gdelt = assessGdeltVolume(points);
        if (gdelt) gdeltCache[candidate.phrase] = { ...gdelt, checkedDate: dateStr };
      } catch (error) {
        failures.push(`GDELT ${candidate.phrase}: ${error.message}`);
      }
    }
    if (!gdelt) {
      const cached = gdeltCache[candidate.phrase];
      if (cached) {
        const ageDays = (new Date(dateStr) - new Date(cached.checkedDate)) / 86_400_000;
        if (ageDays <= GDELT_CACHE_MAX_AGE_DAYS) gdelt = cached;
      }
    }

    let edgar = null;
    if (runEdgar && results.filter((r) => r.edgarChecked).length < MAX_EDGAR_CHECKS_PER_WEEK) {
      try {
        const counts = await fetchEdgarQuarterCounts(candidate.phrase);
        edgar = assessEdgarAcceleration(counts);
      } catch (error) {
        failures.push(`EDGAR ${candidate.phrase}: ${error.message}`);
      }
    }

    results.push({
      ...candidate,
      gdelt,
      edgar,
      gdeltChecked: gdelt !== null,
      edgarChecked: edgar !== null,
      confirmed: Boolean(gdelt?.confirmed && edgar?.confirmed),
    });
  }

  return {
    results,
    nextHistory: {
      ...history,
      gdeltCache,
      lastGdeltRunDate: runGdelt ? dateStr : history.lastGdeltRunDate,
      lastEdgarRunWeek: runEdgar ? weekKey : history.lastEdgarRunWeek,
    },
  };
}

// Normalizes against 2x the confirmation threshold, not the threshold
// itself -- confirmation always means ratio >= threshold, so normalizing
// against the threshold would saturate every confirmed phrase to a score of
// 1 with no headroom to tell "barely confirmed" from "massively confirmed."
export function phraseScore(gdelt, edgar) {
  const gdeltScore = gdelt ? Math.min(1, gdelt.ratio / (GDELT_VOLUME_RATIO_THRESHOLD * 2)) : 0;
  const edgarScore = edgar?.confirmed ? (edgar.ratio ? Math.min(1, edgar.ratio / (EDGAR_YOY_MULT * 2)) : 0.75) : 0;
  return Math.min(1, (gdeltScore + edgarScore) / 2);
}

// Maps confirmed phrases onto registry themes (matched against each theme's
// curated `phrases` list) for theme-heat.mjs's `phraseVelocity` input.
// Confirmed phrases that don't match any theme aren't dropped -- they stay
// in data/phrase-radar.json as their own surfaced candidates (an emerging
// theme the registry hasn't caught yet), same "human review, not auto-
// promoted" stance as Layer 0c's clusters.
export function matchPhrasesToThemes(confirmedPhrases, themes) {
  const map = new Map();
  for (const theme of themes || []) {
    const themePhrases = (theme.phrases || []).map((p) => p.toLowerCase());
    const match = confirmedPhrases.find((c) => themePhrases.some((tp) => c.phrase.includes(tp) || tp.includes(c.phrase)));
    if (match) map.set(theme.id, { phrase: match.phrase, score: phraseScore(match.gdelt, match.edgar) });
  }
  return map;
}
