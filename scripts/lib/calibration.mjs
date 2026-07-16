// Calibration panel — THEME_ENGINE.md validation plan: "every theme card
// and coil logs its creation date and each stage transition; the
// calibration panel reports forward returns by stage/state so the engine
// grades itself the way DISCOVERY_MODEL.md already promises for ticker
// scores." This is the only layer that can't be rushed: it needs real
// elapsed calendar time before there's anything honest to report.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
export const CALIBRATION_LOG_URL = new URL("data/calibration-log.json", ROOT);
export const CALIBRATION_URL = new URL("data/calibration.json", ROOT);
export const CALIBRATION_JS_URL = new URL("data/calibration.js", ROOT);

// Calendar days, not trading sessions -- "3-month forward return" reads
// naturally this way, and it's robust to the ledger's per-ticker gaps
// (only tracked while active) that a session-index offset wouldn't be.
export const GRADING_HORIZONS = { "30d": 30, "90d": 90, "180d": 180, "365d": 365 };
export const GRADE_TOLERANCE_DAYS = 5;
export const CALIBRATION_LOG_MAX = 2000;

export async function loadCalibrationLog() {
  try {
    const raw = await readFile(CALIBRATION_LOG_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed;
  } catch {
    // First run.
  }
  return { entries: [] };
}

export async function saveCalibrationLog(log) {
  await writeFile(CALIBRATION_LOG_URL, JSON.stringify(log));
}

export async function loadCalibration() {
  try {
    const raw = await readFile(CALIBRATION_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // First run.
  }
  return { generatedAt: null, totalEvents: 0, pending: 0, summary: {} };
}

export async function saveCalibration(calibration) {
  const json = JSON.stringify(calibration);
  await writeFile(CALIBRATION_URL, json);
  await writeFile(CALIBRATION_JS_URL, `window.SIGNALDESK_CALIBRATION = ${json};\n`);
}

// ---- Pure helpers ----------------------------------------------------------

function toTime(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getTime();
}

export function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Closest ledger close to targetDateStr within toleranceDays (ledger rows
// are [date, mentions, shareOfVoice, close, volume, wikiViews]).
export function findCloseNear(rows, targetDateStr, toleranceDays = GRADE_TOLERANCE_DAYS) {
  if (!rows?.length) return null;
  const target = toTime(targetDateStr);
  const toleranceMs = toleranceDays * 86_400_000;
  let best = null;
  let bestDiff = Infinity;
  for (const row of rows) {
    if (!Number.isFinite(row[3])) continue;
    const diff = Math.abs(toTime(row[0]) - target);
    if (diff <= toleranceMs && diff < bestDiff) {
      best = row[3];
      bestDiff = diff;
    }
  }
  return best;
}

export function isHorizonReachable(eventDateStr, horizonDays, todayStr) {
  return toTime(todayStr) - toTime(eventDateStr) >= horizonDays * 86_400_000;
}

// Equal-weight member basket return vs SPY over [fromDateStr, toDateStr] --
// the theme-level analog of a single ticker's forward return.
export function themeRelativeReturn(memberTickers, ledger, fromDateStr, toDateStr) {
  const spyRows = ledger.tickers?.SPY?.rows;
  const spyFrom = findCloseNear(spyRows, fromDateStr);
  const spyTo = findCloseNear(spyRows, toDateStr);
  if (!Number.isFinite(spyFrom) || !Number.isFinite(spyTo) || spyFrom <= 0) return null;
  const spyReturn = spyTo / spyFrom - 1;

  const memberReturns = [];
  for (const ticker of memberTickers) {
    const rows = ledger.tickers?.[ticker]?.rows;
    const from = findCloseNear(rows, fromDateStr);
    const to = findCloseNear(rows, toDateStr);
    if (Number.isFinite(from) && Number.isFinite(to) && from > 0) memberReturns.push(to / from - 1);
  }
  if (!memberReturns.length) return null;
  const avgReturn = memberReturns.reduce((sum, v) => sum + v, 0) / memberReturns.length;
  return avgReturn - spyReturn;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---- Log construction -------------------------------------------------------

// Turns this run's already-detected spring/theme transitions (the same
// events alerts.mjs fires) into gradable log entries. Only "release" and
// "dead-coil" are gradable per-ticker springs events -- "new-coil-hot-theme"
// isn't a terminal state worth forward-grading on its own (the coil's
// eventual release/death is what release/dead-coil already capture).
export function buildLogEntries({ springEvents, themeEvents, ledger, dateStr }) {
  const entries = [];
  for (const event of springEvents) {
    if (event.type !== "release" && event.type !== "dead-coil") continue;
    const rows = ledger.tickers?.[event.ticker]?.rows;
    const basePrice = rows?.length ? rows.at(-1)[3] : null;
    if (!Number.isFinite(basePrice)) continue;
    entries.push({
      id: `${event.type}-${event.ticker}-${dateStr}`,
      type: event.type,
      ticker: event.ticker,
      theme: null,
      stage: null,
      date: dateStr,
      basePrice,
      graded: {},
    });
  }
  for (const event of themeEvents) {
    if (event.type !== "theme-stage-transition" || !event.toStage) continue;
    entries.push({
      id: `theme-stage-${event.theme}-${event.toStage}-${dateStr}`,
      type: "theme-stage",
      ticker: null,
      theme: event.theme,
      stage: event.toStage,
      date: dateStr,
      basePrice: null,
      graded: {},
    });
  }
  return entries;
}

// Appends new entries (deduped by id) and grades every entry with a
// reachable, ungraded horizon. Returns the updated log.
export function updateCalibrationLog(log, newEntries, ledger, registry, todayStr) {
  const existingIds = new Set(log.entries.map((e) => e.id));
  const entries = [...log.entries, ...newEntries.filter((e) => !existingIds.has(e.id))];

  const graded = entries.map((entry) => {
    let nextGraded = entry.graded;
    let changed = false;
    for (const [label, days] of Object.entries(GRADING_HORIZONS)) {
      if (label in nextGraded) continue;
      if (!isHorizonReachable(entry.date, days, todayStr)) continue;
      const targetDate = addDaysStr(entry.date, days);

      let ret;
      if (entry.type === "theme-stage") {
        const members = (registry.themes?.find((t) => t.id === entry.theme)?.members || []).map((m) => m.t);
        ret = themeRelativeReturn(members, ledger, entry.date, targetDate);
      } else {
        const closeAtHorizon = findCloseNear(ledger.tickers?.[entry.ticker]?.rows, targetDate);
        ret = Number.isFinite(closeAtHorizon) && entry.basePrice > 0 ? closeAtHorizon / entry.basePrice - 1 : null;
      }
      if (!changed) nextGraded = { ...entry.graded };
      nextGraded[label] = ret; // null = attempted but ungradeable (e.g. delisted/pruned); still marked so it isn't retried forever
      changed = true;
    }
    return changed ? { ...entry, graded: nextGraded } : entry;
  });

  // Prune fully-graded entries first once over the cap, oldest first.
  let pruned = graded;
  if (pruned.length > CALIBRATION_LOG_MAX) {
    const horizonLabels = Object.keys(GRADING_HORIZONS);
    const isFullyGraded = (e) => horizonLabels.every((label) => label in e.graded);
    const sortedByAge = [...pruned].sort((a, b) => a.date.localeCompare(b.date));
    const excess = pruned.length - CALIBRATION_LOG_MAX;
    const toDrop = new Set(
      sortedByAge
        .filter(isFullyGraded)
        .slice(0, excess)
        .map((e) => e.id)
    );
    pruned = pruned.filter((e) => !toDrop.has(e.id));
  }

  return { entries: pruned };
}

// Currently-pending tickers/themes -- fed back into ledger pruning so a
// price series doesn't disappear before its calibration horizons are met.
export function pendingSubjects(log) {
  const tickers = new Set();
  const themes = new Set();
  const horizonLabels = Object.keys(GRADING_HORIZONS);
  for (const entry of log.entries) {
    if (horizonLabels.every((label) => label in entry.graded)) continue; // fully graded
    if (entry.ticker) tickers.add(entry.ticker);
    if (entry.theme) themes.add(entry.theme);
  }
  return { tickers, themes };
}

// ---- Aggregation -------------------------------------------------------------

export function aggregateCalibration(log) {
  const byKey = {};
  for (const entry of log.entries) {
    const key = entry.type === "theme-stage" ? `theme-${entry.stage}` : entry.type;
    if (!byKey[key]) byKey[key] = { n: 0, horizons: {} };
    byKey[key].n += 1;
    for (const [label, value] of Object.entries(entry.graded)) {
      if (!Number.isFinite(value)) continue;
      if (!byKey[key].horizons[label]) byKey[key].horizons[label] = [];
      byKey[key].horizons[label].push(value);
    }
  }

  const summary = {};
  for (const [key, data] of Object.entries(byKey)) {
    summary[key] = {
      n: data.n,
      horizons: Object.fromEntries(
        Object.entries(data.horizons).map(([label, returns]) => [
          label,
          {
            graded: returns.length,
            winRate: returns.length ? returns.filter((r) => r > 0).length / returns.length : null,
            medianReturn: returns.length ? median(returns) : null,
          },
        ])
      ),
    };
  }

  const horizonLabels = Object.keys(GRADING_HORIZONS);
  const pending = log.entries.filter((e) => !horizonLabels.every((label) => label in e.graded)).length;

  return { generatedAt: new Date().toISOString(), totalEvents: log.entries.length, pending, summary };
}
