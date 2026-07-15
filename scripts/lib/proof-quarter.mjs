// Proof-quarter detector — THEME_ENGINE.md Layer 0b. Trigger per ticker:
// close gaps >=+8% on >=3x 60d avg volume AND same-day headlines contain
// earnings/guidance vocabulary. Effect: mark the ticker a candidate theme
// leader; elevate its co-mention neighbors and GICS siblings to a
// hot-monitor list for 2 quarters (covered by news/pageviews/ledger even
// with zero social chatter).
import { readFile, writeFile } from "node:fs/promises";
import { topNeighbors } from "./co-mention.mjs";

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

// IMPACT_WORDS (update-data.mjs) plus the earnings/guidance-specific terms
// the spec calls out by name.
const EARNINGS_VOCAB =
  /\b(surge|surges|surged|soar|soars|plunge|plunges|plunged|tumble|tumbles|sink|sinks|slump|jump|jumps|jumped|rally|rallies|crash|crashes|spike|spikes|drop|drops|dropped|fall|falls|fell|slide|slides|rise|rises|rose|gain|gains|gained|beat|beats|miss|misses|cut|cuts|raise|raises|raised|hike|hikes|warn|warns|warned|guidance|outlook|earnings|quarterly|quarter|eps|revenue|forecast)\b/i;

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
export function detectProofQuarter({ priceMove, volume, avgVolume60d, headlineTexts = [] }) {
  if (!Number.isFinite(priceMove) || priceMove < PROOF_QUARTER_GAP_THRESHOLD) return null;
  if (!Number.isFinite(volume) || !Number.isFinite(avgVolume60d) || avgVolume60d <= 0) return null;
  const volumeRatio = volume / avgVolume60d;
  if (volumeRatio < PROOF_QUARTER_VOLUME_MULT) return null;
  const matchedHeadline = headlineTexts.find((text) => EARNINGS_VOCAB.test(text));
  if (!matchedHeadline) return null;
  return { priceMove, volumeRatio, matchedHeadline: matchedHeadline.slice(0, 200) };
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
export function computeProofQuarters({ events, ledger, gicsByTicker, coMentionEdges, prevLeaders, dateStr }) {
  const priceByTicker = new Map();
  const headlinesByTicker = new Map();
  for (const event of events) {
    if (!event.ticker) continue;
    if (event.source === "Price/Volume") {
      priceByTicker.set(event.ticker, { priceMove: event.priceMove, volume: event.volume });
    } else if (event.title) {
      if (!headlinesByTicker.has(event.ticker)) headlinesByTicker.set(event.ticker, []);
      headlinesByTicker.get(event.ticker).push(event.title);
    }
  }

  const activeLeaders = (prevLeaders.leaders || []).filter((l) => !isExpired(l, dateStr));
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
      headlineTexts: headlinesByTicker.get(ticker) || [],
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
    hotMonitorPayload: { generatedAt: new Date().toISOString(), tickers: hotMonitorTickers },
    newLeaders,
  };
}
