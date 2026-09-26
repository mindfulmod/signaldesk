// Proof-quarter detector — THEME_ENGINE.md Layer 0b. Trigger per ticker:
// close gaps >=+8% on >=3x 60d avg volume AND published news within 48 hours
// reports earnings/results or a guidance update. Effect: mark a candidate theme
// leader; elevate its co-mention neighbors and GICS siblings to a
// hot-monitor list for 2 quarters (covered by news/pageviews/ledger even
// with zero social chatter).
import { readFile, writeFile } from "node:fs/promises";
import { topNeighbors } from "./co-mention.mjs";
import quality from "../../data-quality.js";

const ROOT = new URL("../../", import.meta.url);
export const LEADERS_URL = new URL("data/leaders.json", ROOT);
export const LEADERS_JS_URL = new URL("data/leaders.js", ROOT);
export const HOT_MONITOR_URL = new URL("data/hot-monitor.json", ROOT);
export const HOT_MONITOR_JS_URL = new URL("data/hot-monitor.js", ROOT);

export const PROOF_QUARTER_GAP_THRESHOLD = 8; // percent
export const PROOF_QUARTER_VOLUME_MULT = 3;
export const PROOF_QUARTER_VOLUME_WINDOW = 60;
export const LEADER_ELEVATION_DAYS = 182; // "2 quarters"
export const MAX_SIBLINGS = 15;
export const MAX_CO_MENTION_NEIGHBORS = 8;

// Price-action vocabulary is not evidence of an earnings event. See the
// shared earningsHeadline rule and the Sep 2026 stale-headline regressions.

export async function loadLeaders() {
  try {
    const raw = await readFile(LEADERS_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.leaders)) return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, leaders: [] };
}

export async function saveLeaders(leaders) {
  const json = JSON.stringify(leaders);
  await writeFile(LEADERS_URL, json);
  await writeFile(LEADERS_JS_URL, `window.SIGNALDESK_LEADERS = ${json};\n`);
}

export async function saveHotMonitor(hotMonitor) {
  const json = JSON.stringify(hotMonitor);
  await writeFile(HOT_MONITOR_URL, json);
  await writeFile(HOT_MONITOR_JS_URL, `window.SIGNALDESK_HOT_MONITOR = ${json};\n`);
}

export async function loadHotMonitor() {
  try {
    const raw = await readFile(HOT_MONITOR_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.tickers) return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, tickers: {} };
}

// Pure trigger check for one ticker on one day.
export function detectProofQuarter({ priceMove, volume, avgVolume60d, headlineTexts = [], now = Date.now() }) {
  if (!Number.isFinite(priceMove) || priceMove < PROOF_QUARTER_GAP_THRESHOLD) return null;
  if (!Number.isFinite(volume) || !Number.isFinite(avgVolume60d) || avgVolume60d <= 0) return null;
  const volumeRatio = volume / avgVolume60d;
  if (volumeRatio < PROOF_QUARTER_VOLUME_MULT) return null;
  // Unattributed legacy strings are accepted as input but cannot qualify.
  const candidates = headlineTexts.map((entry) => (typeof entry === "string" ? { text: entry, isNews: false } : entry));
  const matched = candidates.find(entry => entry.isNews && quality.recent(entry.published, now, 48) && quality.earningsHeadline(entry.text));
  const matchedHeadline = matched?.text;
  const matchedHeadlineIsNews = Boolean(matched?.isNews);
  if (!matchedHeadline) return null;
  return { priceMove, volumeRatio, matchedHeadline: matchedHeadline.slice(0, 200), matchedHeadlineIsNews, headlineUrl: matched.url, headlinePublished: matched.published };
}

// Trailing 60d average volume from the ledger, excluding today's own row.
export function trailingAvgVolume(rows, window = PROOF_QUARTER_VOLUME_WINDOW) {
  const priorRows = rows.slice(0, -1).slice(-window);
  const volumes = priorRows.map((r) => r[4]).filter(Number.isFinite);
  if (volumes.length < window * 0.5) return null; // require a reasonable amount of history
  return volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
}

function isExpired(entry, dateStr) {
  return !entry.expiresDate || entry.expiresDate < dateStr;
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Orchestrator: checks every ticker with a Price/Volume event today against
// the trigger, elevates new leaders (deduped -- an already-active leader
// isn't re-triggered), prunes expired leaders, and rebuilds the hot-monitor
// list (union of active leaders' GICS siblings + co-mention neighbors).
// A proof quarter's headline is the "why" shown to the reader in the What
// changed feed, so it has to be the best available evidence, not merely the
// first string that happened to contain an earnings word. Every event title was
// treated equally, which is how the feed ended up attributing a +602% proof
// quarter to "$SXTC The offering closure disclosure dropped in after-hours
// trading..." — a StockTwits post. Published articles and filings sort first;
// the detector also requires dated news and rejects social-only matches.
export function orderByEvidence(entries, newsSources = new Set()) {
  const rank = (entry) => (newsSources.has(entry.source) ? 0 : 1);
  return [...entries]
    .sort((a, b) => rank(a) - rank(b))
    .map((entry) => ({ text: entry.title, isNews: newsSources.has(entry.source), published: entry.published, url: entry.url }));
}

export function computeProofQuarters({ events, ledger, gicsByTicker, coMentionEdges, prevLeaders, dateStr, newsSources = new Set(), now = Date.now() }) {
  const priceByTicker = new Map();
  const headlinesByTicker = new Map();
  for (const event of events) {
    if (!event.ticker) continue;
    if (event.source === "Price/Volume" && quality.quoteState(event, now) === "current") {
      priceByTicker.set(event.ticker, { priceMove: event.priceMove, volume: event.volume });
    } else if (event.title) {
      if (!headlinesByTicker.has(event.ticker)) headlinesByTicker.set(event.ticker, []);
      // Keep the source so a published article can outrank a forum post below.
      headlinesByTicker.get(event.ticker).push({ title: event.title, source: event.source, published: event.published, url: event.url });
    }
  }

  // Legacy matches lacked a publication-date check and used generic move
  // words. Keep the historical alerts, but do not use them to expand coverage.
  const activeLeaders = (prevLeaders.leaders || []).filter((l) => l.evidenceVersion === 2 && !isExpired(l, dateStr));
  const activeTickers = new Set(activeLeaders.map((l) => l.ticker));
  const newLeaders = [];

  for (const [ticker, price] of priceByTicker) {
    if (activeTickers.has(ticker)) continue;
    const entry = ledger.tickers?.[ticker];
    if (!entry) continue;
    const avgVolume60d = trailingAvgVolume(entry.rows);
    const trigger = detectProofQuarter({
      priceMove: price.priceMove,
      volume: price.volume,
      avgVolume60d,
      headlineTexts: orderByEvidence(headlinesByTicker.get(ticker) || [], newsSources),
      now,
    });
    if (!trigger) continue;

    const sub = gicsByTicker[ticker]?.sub;
    const siblings = sub
      ? Object.entries(gicsByTicker)
          .filter(([t, info]) => t !== ticker && info.sub === sub)
          .map(([t]) => t)
          .slice(0, MAX_SIBLINGS)
      : [];
    const coMentionNeighbors = topNeighbors(coMentionEdges, ticker, MAX_CO_MENTION_NEIGHBORS);

    newLeaders.push({
      ticker,
      detectedDate: dateStr,
      expiresDate: addDays(dateStr, LEADER_ELEVATION_DAYS),
      priceMove: trigger.priceMove,
      volumeRatio: trigger.volumeRatio,
      headline: trigger.matchedHeadline,
      headlineIsNews: trigger.matchedHeadlineIsNews,
      headlineUrl: trigger.headlineUrl,
      headlinePublished: trigger.headlinePublished,
      evidenceVersion: 2,
      siblings,
      coMentionNeighbors,
    });
  }

  const leaders = [...activeLeaders, ...newLeaders];

  const hotMonitorTickers = {};
  for (const leader of leaders) {
    for (const ticker of [...leader.siblings, ...leader.coMentionNeighbors]) {
      const existing = hotMonitorTickers[ticker];
      if (!existing || existing.expiresDate < leader.expiresDate) {
        hotMonitorTickers[ticker] = { reason: `sibling/neighbor of proof-quarter leader ${leader.ticker}`, expiresDate: leader.expiresDate };
      }
    }
  }

  return {
    leadersPayload: { generatedAt: new Date().toISOString(), leaders },
    hotMonitorPayload: { generatedAt: new Date().toISOString(), evidenceVersion: 2, tickers: hotMonitorTickers },
    newLeaders,
  };
}
