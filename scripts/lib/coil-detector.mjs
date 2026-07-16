// Coil detector — THEME_ENGINE.md Layer 3. Pure, frozen-threshold functions
// (validated by the three-phase coiled-spring backtest) plus an orchestrator
// that runs them over data/ledger.json. Thresholds are FROZEN — do not tune.
//
// Coil: attention persistence >= 0.60 (ratio >= 1.25x own trailing-1yr
// median on >= 60% of the last 60 sessions) AND 60d close-range in the <=35th
// percentile of its trailing year. Regime = >= 15 such sessions, gaps <= 10
// merged. Release: close > prior 60d max close on >= 1.5x 60d avg volume.
// Dead coil: 126 sessions after regime end with no release.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
export const SPRINGS_URL = new URL("data/springs.json", ROOT);
export const SPRINGS_JS_URL = new URL("data/springs.js", ROOT);

export const PERSISTENCE_WINDOW = 60;
export const PERSISTENCE_THRESHOLD = 0.6;
export const ATTENTION_RATIO_THRESHOLD = 1.25;
export const TRAILING_MEDIAN_WINDOW = 252;
export const COMPRESSION_WINDOW = 60;
export const COMPRESSION_PERCENTILE_WINDOW = 252;
export const COMPRESSION_PERCENTILE_THRESHOLD = 35;
export const REGIME_MIN_SESSIONS = 15;
export const REGIME_GAP_TOLERANCE = 10;
export const RELEASE_LOOKBACK = 60;
export const RELEASE_VOLUME_MULT = 1.5;
export const DEAD_COIL_SESSIONS = 126;
export const MIN_ATTENTION_HISTORY = 200; // sessions of real (non-placeholder) attention data required

// Honest base rates from the blind S&P-500 backtest (frozen — see THEME_ENGINE.md).
export const BASE_RATES = {
  released: { winRate: 0.65, medianReturn: 0.126, doubleRate: 0.16, horizon: "12mo" },
  unreleased: { relMedianReturn: -0.186, winRate: 0.16, doubleRate: 0, horizon: "12mo vs SPY" },
};

export const DEFENSIVE_SECTORS = new Set(["Utilities", "Consumer Staples", "Real Estate"]);

// ---- Pure math ----------------------------------------------------------

export function trailingMedian(values, index, window = TRAILING_MEDIAN_WINDOW) {
  const start = Math.max(0, index - window + 1);
  const slice = values.slice(start, index + 1).filter(Number.isFinite);
  if (!slice.length) return null;
  const sorted = [...slice].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function percentileRank(value, series) {
  const finite = series.filter(Number.isFinite);
  if (!finite.length || !Number.isFinite(value)) return null;
  const belowOrEqual = finite.filter((v) => v <= value).length;
  return (belowOrEqual / finite.length) * 100;
}

// One boolean per day: is attention >= 1.25x its own trailing-1yr median?
export function hotFlags(attention, { ratioThreshold = ATTENTION_RATIO_THRESHOLD, medianWindow = TRAILING_MEDIAN_WINDOW } = {}) {
  return attention.map((value, i) => {
    if (!Number.isFinite(value)) return false;
    const median = trailingMedian(attention, i, medianWindow);
    if (!Number.isFinite(median) || median <= 0) return false;
    return value >= ratioThreshold * median;
  });
}

// Persistence at day i: fraction of the trailing `window` sessions (ending
// at i, inclusive) that were "hot". O(n) via a running count.
export function persistenceSeries(hot, window = PERSISTENCE_WINDOW) {
  const out = new Array(hot.length).fill(0);
  let count = 0;
  for (let i = 0; i < hot.length; i += 1) {
    if (hot[i]) count += 1;
    const dropIdx = i - window;
    if (dropIdx >= 0 && hot[dropIdx]) count -= 1;
    const span = Math.min(window, i + 1);
    out[i] = span ? count / span : 0;
  }
  return out;
}

// Rolling 60d close range (as a fraction of the window high) and its
// percentile within the trailing year of the same rolling metric. Requires a
// full rangeWindow of closes to produce a value (partial windows -> null).
export function compressionSeries(closes, { rangeWindow = COMPRESSION_WINDOW, percentileWindow = COMPRESSION_PERCENTILE_WINDOW } = {}) {
  const ranges = closes.map((_, i) => {
    if (i + 1 < rangeWindow) return null;
    const slice = closes.slice(i - rangeWindow + 1, i + 1).filter(Number.isFinite);
    if (slice.length < rangeWindow) return null;
    const max = Math.max(...slice);
    const min = Math.min(...slice);
    return max > 0 ? (max - min) / max : null;
  });
  return ranges.map((range, i) => {
    if (!Number.isFinite(range)) return { range: null, percentile: null };
    const start = Math.max(0, i - percentileWindow + 1);
    const percentile = percentileRank(range, ranges.slice(start, i + 1));
    return { range, percentile };
  });
}

// Merge qualifying (persistence>=threshold AND compression<=percentile
// threshold) days into regimes, bridging gaps of <= gapTolerance
// non-qualifying days, keeping only regimes with >= minSessions qualifying days.
export function mergeRegimes(qualifies, { gapTolerance = REGIME_GAP_TOLERANCE, minSessions = REGIME_MIN_SESSIONS } = {}) {
  const spans = [];
  let start = null;
  let lastTrue = null;
  for (let i = 0; i < qualifies.length; i += 1) {
    if (qualifies[i]) {
      if (start === null) start = i;
      lastTrue = i;
    } else if (start !== null && i - lastTrue > gapTolerance) {
      spans.push([start, lastTrue]);
      start = null;
      lastTrue = null;
    }
  }
  if (start !== null) spans.push([start, lastTrue]);

  return spans
    .map(([spanStart, spanEnd]) => ({
      start: spanStart,
      end: spanEnd,
      sessions: qualifies.slice(spanStart, spanEnd + 1).filter(Boolean).length,
    }))
    .filter((regime) => regime.sessions >= minSessions);
}

// Release trigger at day i: close breaks the prior `lookback`-day high on
// >= volumeMult x the prior `lookback`-day average volume.
export function releaseTriggerAt(closes, volumes, i, { lookback = RELEASE_LOOKBACK, volumeMult = RELEASE_VOLUME_MULT } = {}) {
  if (i < lookback || !Number.isFinite(closes[i])) return false;
  const priorCloses = closes.slice(i - lookback, i).filter(Number.isFinite);
  if (!priorCloses.length) return false;
  const priorHigh = Math.max(...priorCloses);
  if (closes[i] <= priorHigh) return false;
  const priorVolumes = volumes.slice(i - lookback, i).filter(Number.isFinite);
  if (!priorVolumes.length || !Number.isFinite(volumes[i])) return false;
  const avgVolume = priorVolumes.reduce((sum, v) => sum + v, 0) / priorVolumes.length;
  return avgVolume > 0 && volumes[i] >= volumeMult * avgVolume;
}

export function findFirstRelease(closes, volumes, fromIndex, options) {
  for (let i = Math.max(0, fromIndex); i < closes.length; i += 1) {
    if (releaseTriggerAt(closes, volumes, i, options)) return i;
  }
  return -1;
}

// 60-session On-Balance-Volume slope sign — display-only context badge, never a gate.
export function obvSlope(closes, volumes, window = 60) {
  const n = closes.length;
  if (n < 2) return null;
  const start = Math.max(1, n - window);
  let obv = 0;
  const series = [];
  for (let i = start; i < n; i += 1) {
    if (!Number.isFinite(closes[i]) || !Number.isFinite(closes[i - 1]) || !Number.isFinite(volumes[i])) continue;
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    series.push(obv);
  }
  if (series.length < 5) return null;
  const half = Math.floor(series.length / 2);
  const firstAvg = series.slice(0, half).reduce((s, v) => s + v, 0) / half;
  const secondAvg = series.slice(half).reduce((s, v) => s + v, 0) / (series.length - half);
  if (secondAvg > firstAvg * 1.05) return "up";
  if (secondAvg < firstAvg * 0.95) return "down";
  return "flat";
}

// ---- Per-ticker classification ------------------------------------------

// Choose the attention series to gate on: Wikipedia pageviews if there is
// enough real history, else share-of-voice restricted to dates on/after the
// ticker's ledger firstSeen date (backfilled pre-ledger days have a
// placeholder shareOfVoice of 0, not a confirmed zero, and must not count).
export function selectAttentionSeries(rows, meta, { minHistory = MIN_ATTENTION_HISTORY } = {}) {
  const wiki = rows.map((r) => r[5]);
  const wikiCount = wiki.filter(Number.isFinite).length;
  if (wikiCount >= minHistory) return { source: "wikiViews", values: wiki };

  const firstSeen = meta?.firstSeen || null;
  const sov = rows.map((r) => (firstSeen && r[0] >= firstSeen ? r[2] : null));
  const sovCount = sov.filter(Number.isFinite).length;
  if (sovCount >= minHistory) return { source: "shareOfVoice", values: sov };

  return { source: null, values: null };
}

// Classifies one ticker's ledger entry into a spring state. Returns null if
// there isn't enough attention or price history to say anything.
export function classifyTicker(entry, { now = new Date() } = {}) {
  const rows = entry?.rows || [];
  if (rows.length < COMPRESSION_WINDOW) return null;

  const attention = selectAttentionSeries(rows, entry.meta);
  if (!attention.values) return null;

  const closes = rows.map((r) => r[3]);
  const volumes = rows.map((r) => r[4]);
  if (closes.filter(Number.isFinite).length < COMPRESSION_WINDOW) return null;

  const hot = hotFlags(attention.values);
  const persistence = persistenceSeries(hot);
  const compression = compressionSeries(closes);
  const qualifies = rows.map(
    (_, i) => persistence[i] >= PERSISTENCE_THRESHOLD && Number.isFinite(compression[i].percentile) && compression[i].percentile <= COMPRESSION_PERCENTILE_THRESHOLD
  );
  const regimes = mergeRegimes(qualifies);
  if (!regimes.length) return null;

  const latestRegime = regimes.at(-1);
  const releaseIndex = findFirstRelease(closes, volumes, latestRegime.end + 1);
  const lastIndex = rows.length - 1;
  const sessionsSinceRegimeEnd = lastIndex - latestRegime.end;

  let state = "coiled";
  if (releaseIndex !== -1) state = "released";
  else if (sessionsSinceRegimeEnd > DEAD_COIL_SESSIONS) state = "dead";

  const stateStartIndex = state === "released" ? releaseIndex : state === "dead" ? latestRegime.end + DEAD_COIL_SESSIONS : latestRegime.start;
  const daysInState = Math.max(0, lastIndex - stateStartIndex);

  return {
    state,
    attentionSource: attention.source,
    persistence: persistence[latestRegime.end],
    compressionPercentile: compression[latestRegime.end]?.percentile ?? null,
    regimeStart: rows[latestRegime.start][0],
    regimeEnd: rows[latestRegime.end][0],
    regimeSessions: latestRegime.sessions,
    releaseDate: releaseIndex !== -1 ? rows[releaseIndex][0] : null,
    daysInState,
    obvSlope: obvSlope(closes, volumes),
    asOf: rows[lastIndex][0],
  };
}

// ---- Orchestrator --------------------------------------------------------

// Runs classifyTicker over every ledger entry, ranks the results, and shapes
// data/springs.json. `hotThemeTickers` (a Set) is optional — Layer 1 (theme
// heat, THEME_ENGINE.md build item 4) supplies it so hot-theme coils rank
// first and defensive-sector coils inside a hot theme skip the discount; an
// empty set (the default, used until Layer 1 lands) just falls back to
// persistence/compression ranking with the sector discount always applied.
export function computeSprings(ledger, gicsByTicker = {}, { hotThemeTickers = new Set() } = {}) {
  const springs = [];
  for (const [ticker, entry] of Object.entries(ledger.tickers || {})) {
    const classification = classifyTicker(entry);
    if (!classification) continue;
    const sector = gicsByTicker[ticker]?.sector || entry.meta?.sector || null;
    const sub = gicsByTicker[ticker]?.sub || entry.meta?.sub || null;
    const inHotTheme = hotThemeTickers.has(ticker);
    const defensiveDiscount = DEFENSIVE_SECTORS.has(sector) && !inHotTheme;
    springs.push({
      ticker,
      name: entry.meta?.name || ticker,
      sector,
      sub,
      inHotTheme,
      defensiveDiscount,
      ...classification,
    });
  }

  springs.sort((a, b) => {
    if (a.inHotTheme !== b.inHotTheme) return a.inHotTheme ? -1 : 1;
    if (a.defensiveDiscount !== b.defensiveDiscount) return a.defensiveDiscount ? 1 : -1;
    if (a.state !== b.state) return stateRank(a.state) - stateRank(b.state);
    if (b.persistence !== a.persistence) return b.persistence - a.persistence;
    return (a.compressionPercentile ?? 100) - (b.compressionPercentile ?? 100);
  });

  return {
    generatedAt: new Date().toISOString(),
    baseRates: BASE_RATES,
    thresholds: {
      persistenceThreshold: PERSISTENCE_THRESHOLD,
      attentionRatioThreshold: ATTENTION_RATIO_THRESHOLD,
      compressionPercentileThreshold: COMPRESSION_PERCENTILE_THRESHOLD,
      regimeMinSessions: REGIME_MIN_SESSIONS,
      releaseVolumeMult: RELEASE_VOLUME_MULT,
      deadCoilSessions: DEAD_COIL_SESSIONS,
    },
    springs,
  };
}

function stateRank(state) {
  return { released: 0, coiled: 1, dead: 2 }[state] ?? 3;
}

export async function loadSprings() {
  try {
    const raw = await readFile(SPRINGS_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // No springs board yet.
  }
  return { generatedAt: null, baseRates: BASE_RATES, thresholds: {}, springs: [] };
}

export async function saveSprings(springs) {
  const json = JSON.stringify(springs);
  await writeFile(SPRINGS_URL, json);
  await writeFile(SPRINGS_JS_URL, `window.SIGNALDESK_SPRINGS = ${json};\n`);
}
