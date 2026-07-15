// Alerts & lifecycle notifications — THEME_ENGINE.md Layer 4. Diffs this
// run's springs/themes output against the previous run's, turns each
// state-change into an event (at most once per ticker/theme per change),
// posts the high-priority ones to ntfy.sh (free, keyless; off by default
// unless a topic is configured), and keeps a bounded on-site "What changed"
// log independent of whether ntfy is configured at all.
//
// "Proof quarter detected" events are passed in from scripts/lib/proof-quarter.mjs
// (update-data.mjs wires the two together) rather than detected in here.
// One spec'd condition still isn't wired up: "dead-coil demotion of a
// *watchlist* name" can't be scoped to a specific user's watchlist -- the
// existing watchlist is client-side localStorage (script.js), invisible to
// this Node pipeline with no server/accounts. Dead-coil demotions are
// alerted for every ticker instead, the closest honest approximation.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
export const ALERTS_STATE_URL = new URL("data/alerts-state.json", ROOT);
export const ALERTS_LOG_URL = new URL("data/alerts-log.json", ROOT);
export const ALERTS_LOG_JS_URL = new URL("data/alerts-log.js", ROOT);

export const ALERTS_LOG_MAX = 200;
const NTFY_BASE = "https://ntfy.sh";

export async function loadAlertState() {
  try {
    const raw = await readFile(ALERTS_STATE_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // First run.
  }
  return { springs: {}, themes: {}, lastDigestDate: null };
}

export async function saveAlertState(state) {
  await writeFile(ALERTS_STATE_URL, JSON.stringify(state));
}

export async function loadAlertLog() {
  try {
    const raw = await readFile(ALERTS_LOG_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.entries)) return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, entries: [] };
}

export async function saveAlertLog(log) {
  const json = JSON.stringify(log);
  await writeFile(ALERTS_LOG_URL, json);
  await writeFile(ALERTS_LOG_JS_URL, `window.SIGNALDESK_ALERTS_LOG = ${json};\n`);
}

// ---- Pure event detection -------------------------------------------------

// Compares this run's springs against the last recorded state per ticker.
// hotThemeTickers gates condition 2 ("new coil inside a hot theme").
export function detectSpringEvents(prevSpringStates, currentSprings, hotThemeTickers = new Set()) {
  const events = [];
  for (const spring of currentSprings) {
    const prevState = prevSpringStates[spring.ticker];
    if (prevState === spring.state) continue; // no change -> no alert (dedupe)

    if (spring.state === "released") {
      events.push({
        type: "release",
        priority: "high",
        ticker: spring.ticker,
        message: `${spring.ticker} released: closed above its 60-day high on a volume surge (coiled ${spring.regimeStart} to ${spring.regimeEnd}). Released coils have historically won 65% of the time, +12.6% median at 12mo -- a base rate, not a guarantee.`,
      });
    } else if (spring.state === "coiled" && hotThemeTickers.has(spring.ticker)) {
      events.push({
        type: "new-coil-hot-theme",
        priority: "high",
        ticker: spring.ticker,
        message: `${spring.ticker} started coiling inside a hot theme (${spring.sector || "sector n/a"}). Watching for a release.`,
      });
    } else if (spring.state === "dead") {
      events.push({
        type: "dead-coil",
        priority: "normal",
        ticker: spring.ticker,
        message: `${spring.ticker}'s coil aged out with no release (coiled ${spring.regimeStart} to ${spring.regimeEnd}, ${spring.regimeSessions} sessions). Demoted -- unreleased coils have historically returned -18.6% vs SPY with zero doubles.`,
      });
    }
  }
  return events;
}

// Compares this run's theme stages against the last recorded state per theme.
export function detectThemeEvents(prevThemeStages, currentThemes) {
  const events = [];
  for (const theme of currentThemes) {
    const prevStage = prevThemeStages[theme.id];
    if (!prevStage || prevStage === theme.stage) continue; // no change, or first time seen -> no alert
    if (theme.stage === "insufficient-data" || theme.stage === "quiet") continue; // not alert-worthy transitions

    const highPriority = theme.stage === "diffusion" || theme.stage === "decay";
    events.push({
      type: "theme-stage-transition",
      priority: highPriority ? "high" : "normal",
      theme: theme.id,
      message: `${theme.name}: ${prevStage} -> ${theme.stage}${theme.stage === "diffusion" ? " -- historically the early-entry window" : ""}${theme.stage === "decay" ? " -- rotation out may be starting" : ""}.`,
    });
  }
  return events;
}

export function nextSpringStateMap(currentSprings) {
  return Object.fromEntries(currentSprings.map((s) => [s.ticker, s.state]));
}

export function nextThemeStageMap(currentThemes) {
  return Object.fromEntries(currentThemes.map((t) => [t.id, t.stage]));
}

// Weekly digest: theme leaderboard + springs board counts. Fires at most
// once per calendar week (gated on ISO week number so it survives the
// 4x/day cadence without a fixed weekday assumption about which runs
// actually succeed).
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export function buildWeeklyDigest(themes, springs) {
  const leaderboard = [...themes]
    .filter((t) => Number.isFinite(t.heat))
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 5)
    .map((t) => `${t.name} (${t.stage}, heat ${t.heat})`);
  const counts = springs.reduce((acc, s) => ({ ...acc, [s.state]: (acc[s.state] || 0) + 1 }), {});
  const lines = [
    leaderboard.length ? `Theme leaderboard: ${leaderboard.join(" | ")}` : "Theme leaderboard: no themes have enough data to score yet.",
    `Springs board: ${counts.coiled || 0} coiled, ${counts.released || 0} released, ${counts.dead || 0} dead this week.`,
    "Phrase-radar newcomers: not available yet (Layer 0a is a later build item).",
  ];
  return { type: "weekly-digest", priority: "normal", message: lines.join(" ") };
}

// ---- ntfy.sh transport -----------------------------------------------------

// Keyless POST to a user-chosen private topic (https://ntfy.sh/<topic>).
// Silently a no-op if no topic is configured -- alerts still get logged
// on-site either way, so this is purely the optional push-notification leg.
export async function postNtfy(topic, event) {
  if (!topic) return { sent: false, reason: "no topic configured" };
  const title = titleFor(event);
  try {
    const response = await fetch(`${NTFY_BASE}/${encodeURIComponent(topic)}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: event.priority === "high" ? "high" : "default",
        Tags: tagsFor(event),
      },
      body: event.message,
    });
    if (!response.ok) return { sent: false, reason: `${response.status} ${response.statusText}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

function titleFor(event) {
  switch (event.type) {
    case "release":
      return `SignalDesk: ${event.ticker} released`;
    case "new-coil-hot-theme":
      return `SignalDesk: ${event.ticker} coiling in a hot theme`;
    case "dead-coil":
      return `SignalDesk: ${event.ticker} coil demoted`;
    case "theme-stage-transition":
      return `SignalDesk: theme ${event.theme} -> ${event.message.split(" -> ")[1]?.split(" ")[0] || "changed"}`;
    case "proof-quarter":
      return `SignalDesk: ${event.ticker} proof quarter`;
    case "weekly-digest":
      return "SignalDesk: weekly digest";
    default:
      return "SignalDesk alert";
  }
}

function tagsFor(event) {
  switch (event.type) {
    case "release":
      return "rocket";
    case "new-coil-hot-theme":
      return "coil,fire";
    case "dead-coil":
      return "skull";
    case "theme-stage-transition":
      return "chart_with_upwards_trend";
    case "proof-quarter":
      return "loudspeaker";
    case "weekly-digest":
      return "calendar";
    default:
      return "bell";
  }
}
