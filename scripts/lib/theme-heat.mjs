// Theme heat — THEME_ENGINE.md Layer 1. Scores how hot each registry theme
// is right now, using only trailing data (the wave detector that produced
// the frozen thresholds ran on hindsight forward-returns; live heat can't).
//
// heat = 100 x (0.30*relBreadthXS + 0.25*newHighBreadthXS + 0.25*attnBreadthXS + 0.20*language)
//
// NOTE on `language`: Layer 0a (phrase-velocity radar, THEME_ENGINE.md build
// item 6) is not built yet, so language is always 0 here — heat is
// understated by its 0.20 weight until item 6 lands. This is a deliberate,
// conservative gap, not a bug.
//
// NOTE on stage thresholds: THEME_ENGINE.md describes stages qualitatively
// (Naming: language only; Diffusion: language + attention breadth; Wave: rel
// breadth high; Saturation: attention breadth extreme AND laggard-quality
// collapse; Decay: equal-weight rel index below its 100d average) but does
// not give numeric cutoffs. Saturation's "laggard-quality collapse" needs
// revenue/earnings data (SEC XBRL, THEME_ENGINE.md build item 8/9) that
// doesn't exist yet, so Saturation is not assigned here. The breadth cutoffs
// below (NAMING/DIFFUSION/WAVE_*) are conservative placeholders picked for
// this build, not values from the backtest, and should be revisited once
// Layer 0a exists and there is forward-return data to calibrate against.
import { readFile, writeFile } from "node:fs/promises";
import { selectAttentionSeries, hotFlags } from "./coil-detector.mjs";

const ROOT = new URL("../../", import.meta.url);
export const THEMES_URL = new URL("data/themes.json", ROOT);
export const THEMES_JS_URL = new URL("data/themes.js", ROOT);

export const REL_RETURN_WINDOW = 90;
export const REL_RETURN_THRESHOLD = 0.15; // "90d return >= +15% over SPY"
export const NEW_HIGH_LOOKBACK = 60;
export const NEW_HIGH_YEAR_WINDOW = 252;
export const DECAY_INDEX_WINDOW = 100;
export const MIN_MEMBERS_WITH_DATA = 3;

// Conservative, unvalidated stage-cutoff placeholders (see file header).
export const NAMING_ATTN_THRESHOLD = 0.15;
export const DIFFUSION_ATTN_THRESHOLD = 0.3;
export const WAVE_REL_BREADTH_THRESHOLD = 0.35;

export async function loadThemes() {
  try {
    const raw = await readFile(THEMES_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // No themes.json yet.
  }
  return { generatedAt: null, themes: [] };
}

export async function saveThemes(themes) {
  const json = JSON.stringify(themes);
  await writeFile(THEMES_URL, json);
  await writeFile(THEMES_JS_URL, `window.SIGNALDESK_THEMES = ${json};\n`);
}

function closesOf(entry) {
  return (entry?.rows || []).map((r) => r[3]);
}

// Aligns a member's close series with SPY's by trailing index position
// (both ledgers are appended daily in the same run, so the last N rows line
// up on trading days in practice; this is a pragmatic join, not a strict
// date match).
export function relativeReturn(memberCloses, spyCloses, window = REL_RETURN_WINDOW) {
  const n = Math.min(memberCloses.length, spyCloses.length);
  if (n <= window) return null;
  const memberNow = memberCloses[memberCloses.length - 1];
  const memberThen = memberCloses[memberCloses.length - 1 - window];
  const spyNow = spyCloses[spyCloses.length - 1];
  const spyThen = spyCloses[spyCloses.length - 1 - window];
  if (![memberNow, memberThen, spyNow, spyThen].every(Number.isFinite) || memberThen <= 0 || spyThen <= 0) return null;
  const memberReturn = memberNow / memberThen - 1;
  const spyReturn = spyNow / spyThen - 1;
  return memberReturn - spyReturn;
}

// Did this series make a new `yearWindow`-session high at any point within
// the last `lookback` sessions? (Causal: only counts a day as a "new high"
// using the *prior* trailing window as of that day -- today's own close must
// not be included in the comparison set, and the comparison must be strict,
// or a flat/tied series tautologically "makes a new high" every day. Requires
// a genuinely full yearWindow of prior data -- a partial-window allowance
// let `Math.max(...[])` degenerate to -Infinity for short series, which made
// *any* finite close look like a "new high" once the ledger had only a
// couple of rows.)
export function madeNewHighRecently(closes, { lookback = NEW_HIGH_LOOKBACK, yearWindow = NEW_HIGH_YEAR_WINDOW } = {}) {
  const n = closes.length;
  for (let i = Math.max(0, n - lookback); i < n; i += 1) {
    if (!Number.isFinite(closes[i])) continue;
    const start = Math.max(0, i - yearWindow);
    const priorTrailing = closes.slice(start, i).filter(Number.isFinite);
    if (priorTrailing.length < yearWindow) continue;
    if (closes[i] > Math.max(...priorTrailing)) return true;
  }
  return false;
}

// Is *today's* attention >= ATTENTION_RATIO_THRESHOLD x its own trailing
// median? (Point-in-time, unlike the coil detector's persistence window —
// theme heat is a breadth measure, not a per-ticker regime.)
export function isAttentionHot(entry) {
  const attention = selectAttentionSeries(entry.rows, entry.meta);
  if (!attention.values) return null;
  const hot = hotFlags(attention.values);
  return hot.at(-1) ?? null;
}

function breadth(flags) {
  const known = flags.filter((f) => f !== null);
  if (!known.length) return null;
  return known.filter(Boolean).length / known.length;
}

// Equal-weight theme index (average relative-return series, member-aligned
// to the shortest common length) vs its trailing 100d average -- a simple
// decay check: is the theme's own basket now below its recent baseline?
export function computeDecaySignal(memberCloseSeries, spyCloses, window = DECAY_INDEX_WINDOW) {
  if (memberCloseSeries.length < MIN_MEMBERS_WITH_DATA) return null;
  const minLen = Math.min(spyCloses.length, ...memberCloseSeries.map((c) => c.length));
  if (minLen <= window + 1) return null;
  const index = [];
  for (let i = minLen - window - 1; i < minLen; i += 1) {
    const spyBase = spyCloses[spyCloses.length - minLen];
    const spyNow = spyCloses[spyCloses.length - minLen + i];
    if (!Number.isFinite(spyNow) || !Number.isFinite(spyBase) || spyBase <= 0) continue;
    const relValues = memberCloseSeries
      .map((closes) => {
        const base = closes[closes.length - minLen];
        const now = closes[closes.length - minLen + i];
        if (!Number.isFinite(base) || !Number.isFinite(now) || base <= 0) return null;
        return now / base - spyNow / spyBase;
      })
      .filter(Number.isFinite);
    if (relValues.length) index.push(relValues.reduce((s, v) => s + v, 0) / relValues.length);
  }
  if (index.length < window) return null;
  const current = index.at(-1);
  const trailingAvg = index.slice(0, -1).reduce((s, v) => s + v, 0) / (index.length - 1);
  return current < trailingAvg;
}

function assignStage({ relBreadthXS, attnBreadthXS, language, decay, membersWithData }) {
  if (membersWithData < MIN_MEMBERS_WITH_DATA) return "insufficient-data";
  if (decay) return "decay";
  if (relBreadthXS >= WAVE_REL_BREADTH_THRESHOLD) return "wave";
  if (attnBreadthXS >= DIFFUSION_ATTN_THRESHOLD) return "diffusion";
  if (attnBreadthXS >= NAMING_ATTN_THRESHOLD || language > 0) return "naming";
  return "quiet";
}

// Computes universe-wide breadth stats (the beta guard) once, over every
// ledger ticker with enough history -- not just theme members.
function universeBreadthStats(ledger, spyCloses) {
  let relHits = 0;
  let relKnown = 0;
  let newHighHits = 0;
  let newHighKnown = 0;
  let attnHits = 0;
  let attnKnown = 0;

  for (const entry of Object.values(ledger.tickers || {})) {
    const closes = closesOf(entry);
    const rel = relativeReturn(closes, spyCloses);
    if (rel !== null) {
      relKnown += 1;
      if (rel >= REL_RETURN_THRESHOLD) relHits += 1;
    }
    if (closes.filter(Number.isFinite).length >= NEW_HIGH_YEAR_WINDOW) {
      newHighKnown += 1;
      if (madeNewHighRecently(closes)) newHighHits += 1;
    }
    const hot = isAttentionHot(entry);
    if (hot !== null) {
      attnKnown += 1;
      if (hot) attnHits += 1;
    }
  }

  return {
    relBreadth: relKnown ? relHits / relKnown : 0,
    newHighBreadth: newHighKnown ? newHighHits / newHighKnown : 0,
    attnBreadth: attnKnown ? attnHits / attnKnown : 0,
  };
}

// `phraseVelocity` is an optional Map<themeId, {phrase, score}> supplied by
// Layer 0a (build item 6) -- absent for now, so language stays 0 everywhere.
export function computeThemeHeat(ledger, registry, { phraseVelocity = new Map() } = {}) {
  const spyCloses = closesOf(ledger.tickers?.SPY);
  const hasSpy = spyCloses.filter(Number.isFinite).length > REL_RETURN_WINDOW;
  const universe = hasSpy ? universeBreadthStats(ledger, spyCloses) : { relBreadth: 0, newHighBreadth: 0, attnBreadth: 0 };

  const themes = (registry.themes || []).map((theme) => {
    const memberEntries = theme.members.map((m) => ({ ticker: m.t, entry: ledger.tickers?.[m.t] })).filter((m) => m.entry);

    let relHits = 0;
    let relKnown = 0;
    let newHighHits = 0;
    let newHighKnown = 0;
    let attnHits = 0;
    let attnKnown = 0;
    const memberCloseSeries = [];

    for (const { entry } of memberEntries) {
      const closes = closesOf(entry);
      if (hasSpy) {
        const rel = relativeReturn(closes, spyCloses);
        if (rel !== null) {
          relKnown += 1;
          if (rel >= REL_RETURN_THRESHOLD) relHits += 1;
          memberCloseSeries.push(closes);
        }
      }
      if (closes.filter(Number.isFinite).length >= NEW_HIGH_YEAR_WINDOW) {
        newHighKnown += 1;
        if (madeNewHighRecently(closes)) newHighHits += 1;
      }
      const hot = isAttentionHot(entry);
      if (hot !== null) {
        attnKnown += 1;
        if (hot) attnHits += 1;
      }
    }

    const membersWithData = new Set([...memberEntries.map((m) => m.ticker)]).size;
    const relBreadth = relKnown ? relHits / relKnown : null;
    const newHighBreadth = newHighKnown ? newHighHits / newHighKnown : null;
    const attnBreadth = attnKnown ? attnHits / attnKnown : null;

    const relBreadthXS = relBreadth !== null ? Math.max(0, relBreadth - universe.relBreadth) : 0;
    const newHighBreadthXS = newHighBreadth !== null ? Math.max(0, newHighBreadth - universe.newHighBreadth) : 0;
    const attnBreadthXS = attnBreadth !== null ? Math.max(0, attnBreadth - universe.attnBreadth) : 0;

    const language = phraseVelocity.get(theme.id)?.score || 0;
    const heat = Math.round(100 * (0.3 * relBreadthXS + 0.25 * newHighBreadthXS + 0.25 * attnBreadthXS + 0.2 * language));

    const decay = hasSpy ? computeDecaySignal(memberCloseSeries, spyCloses) : null;
    const stage = assignStage({ relBreadthXS, attnBreadthXS, language, decay, membersWithData });

    return {
      id: theme.id,
      name: theme.name,
      stage,
      heat: membersWithData >= MIN_MEMBERS_WITH_DATA ? heat : null,
      evidence: {
        relBreadth,
        newHighBreadth,
        attnBreadth,
        relBreadthXS,
        newHighBreadthXS,
        attnBreadthXS,
        phrase: phraseVelocity.get(theme.id)?.phrase || null,
        language,
      },
      membersWithData,
      members: theme.members.map((m) => m.t),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    languageAvailable: phraseVelocity.size > 0,
    universe,
    themes: themes.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1)),
  };
}

export function hotThemeTickers(themesPayload) {
  const hot = new Set();
  for (const theme of themesPayload.themes || []) {
    if (theme.stage === "diffusion" || theme.stage === "wave") {
      for (const ticker of theme.members) hot.add(ticker);
    }
  }
  return hot;
}
