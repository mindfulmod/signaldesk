// Diffusion map — THEME_ENGINE.md Layer 2: within each theme, who's already
// run, who's running now, who's coiled, and who's lagging (a coil-formation
// watchlist). Mutually-exclusive per-member states, computed from the ledger
// + this run's springs.json.
//
// Precedence when a member could technically satisfy more than one bucket
// (not spec'd numerically -- a build-time judgment call, documented here):
// the Layer 3 coil detector's own state is authoritative for "coiled"/"dead"
// (it already resolves its own regime/release/dead-coil precedence), checked
// before the price-only Ran/Running/Lagging buckets. Ran is checked before
// Running because "already ran and now extended" is the more specific,
// higher-crowding-risk read of the same price action.
import { readFile, writeFile } from "node:fs/promises";
import { madeNewHighRecently, relativeReturn } from "./theme-heat.mjs";

const ROOT = new URL("../../", import.meta.url);
export const DIFFUSION_MAP_URL = new URL("data/diffusion-map.json", ROOT);
export const DIFFUSION_MAP_JS_URL = new URL("data/diffusion-map.js", ROOT);
export const DIFFUSION_STATE_URL = new URL("data/diffusion-state.json", ROOT);

export const RAN_RETURN_THRESHOLD = 0.5; // "12mo return >= +50%"
export const RAN_EXTENSION_THRESHOLD = 0.3; // "now >30% extended above 200d MA"
export const RAN_WINDOW = 252;
export const MA_WINDOW = 200;
export const LAGGING_REL_RETURN_THRESHOLD = 0.1; // "rel 90d return < +10%"
export const LAGGING_WINDOW = 90;

export async function loadDiffusionState() {
  try {
    const raw = await readFile(DIFFUSION_STATE_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // First run.
  }
  return {};
}

export async function saveDiffusionState(state) {
  await writeFile(DIFFUSION_STATE_URL, JSON.stringify(state));
}

export async function saveDiffusionMap(map) {
  const json = JSON.stringify(map);
  await writeFile(DIFFUSION_MAP_URL, json);
  await writeFile(DIFFUSION_MAP_JS_URL, `window.SIGNALDESK_DIFFUSION_MAP = ${json};\n`);
}

function closesOf(entry) {
  return (entry?.rows || []).map((r) => r[3]);
}

function attentionRatioLatest(entry) {
  // Lightweight version of coil-detector's hotFlags: today's attention over
  // its own trailing-1yr median, as a number rather than a boolean.
  const wiki = (entry?.rows || []).map((r) => r[5]);
  const wikiCount = wiki.filter(Number.isFinite).length;
  const values = wikiCount >= 60 ? wiki : (entry?.rows || []).map((r) => r[2]);
  const finite = values.filter(Number.isFinite);
  if (finite.length < 20) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const latest = values.at(-1);
  if (!Number.isFinite(latest) || !Number.isFinite(median) || median <= 0) return null;
  return latest / median;
}

export function twelveMonthReturn(closes, window = RAN_WINDOW) {
  const n = closes.length;
  if (n <= window) return null;
  const now = closes[n - 1];
  const then = closes[n - 1 - window];
  if (!Number.isFinite(now) || !Number.isFinite(then) || then <= 0) return null;
  return now / then - 1;
}

export function extensionAboveMA(closes, window = MA_WINDOW) {
  const n = closes.length;
  if (n < window) return null;
  const recent = closes.slice(n - window).filter(Number.isFinite);
  if (recent.length < window) return null;
  const now = closes[n - 1];
  const ma = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  if (!Number.isFinite(now) || ma <= 0) return null;
  return now / ma - 1;
}

// Classifies one member. springState is this run's springs.json state for
// the ticker ("coiled" | "released" | "dead" | undefined if never classified).
export function classifyMember(closes, springState) {
  if (springState === "coiled") return "coiled";
  if (springState === "dead") return "dead";

  const ran12mo = twelveMonthReturn(closes);
  const extension = extensionAboveMA(closes);
  if (ran12mo !== null && extension !== null && ran12mo >= RAN_RETURN_THRESHOLD && extension > RAN_EXTENSION_THRESHOLD) {
    return "ran";
  }

  if (springState === "released" || madeNewHighRecently(closes)) return "running";

  return "lagging-pending"; // resolved to "lagging" or null by the caller once SPY-relative return is known
}

export function updateDiffusionStateHistory(prevHistory, ticker, state, dateStr) {
  const prev = prevHistory[ticker];
  if (prev?.state === state) {
    const days = Math.max(0, Math.round((new Date(dateStr) - new Date(prev.since)) / 86400000));
    return { state, since: prev.since, days };
  }
  return { state, since: dateStr, days: 0 };
}

// Builds data/diffusion-map.json: one supply-chain table per theme that has
// at least one classifiable member, ordered ran -> running -> coiled ->
// lagging within each theme.
export function computeDiffusionMap(ledger, registry, springsByTicker, prevStateHistory, dateStr) {
  const spyCloses = closesOf(ledger.tickers?.SPY);
  const hasSpy = spyCloses.filter(Number.isFinite).length > LAGGING_WINDOW;
  const nextStateHistory = {};

  const themes = (registry.themes || [])
    .map((theme) => {
      const rows = [];
      for (const member of theme.members || []) {
        const entry = ledger.tickers?.[member.t];
        if (!entry) continue;
        const closes = closesOf(entry);
        if (closes.filter(Number.isFinite).length < LAGGING_WINDOW) continue;

        const springState = springsByTicker.get(member.t);
        let state = classifyMember(closes, springState);
        if (state === "lagging-pending") {
          const rel = hasSpy ? relativeReturn(closes, spyCloses, LAGGING_WINDOW) : null;
          state = rel !== null && rel < LAGGING_REL_RETURN_THRESHOLD ? "lagging" : null;
        }
        if (!state) continue;

        const history = updateDiffusionStateHistory(prevStateHistory, member.t, state, dateStr);
        nextStateHistory[member.t] = history;

        rows.push({
          ticker: member.t,
          state,
          attentionRatio: attentionRatioLatest(entry),
          daysInState: history.days,
          spark: closes.slice(-60),
        });
      }

      rows.sort((a, b) => stateRank(a.state) - stateRank(b.state));
      return { id: theme.id, name: theme.name, members: rows };
    })
    .filter((theme) => theme.members.length > 0);

  return {
    payload: { generatedAt: new Date().toISOString(), themes },
    nextStateHistory,
  };
}

function stateRank(state) {
  return { ran: 0, running: 1, coiled: 2, lagging: 3, dead: 4 }[state] ?? 5;
}
