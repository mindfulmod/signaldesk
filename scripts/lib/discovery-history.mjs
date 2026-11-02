import { createHash } from "node:crypto";
import { calendarDay } from "./technology-monitor.mjs";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const dayMs = 86400000;
const validTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const dateAge = (date, today) => /^\d{4}-\d{2}-\d{2}$/.test(date || "") && validTime(date) && new Date(date).toISOString().slice(0, 10) === date ? (Date.parse(today) - Date.parse(date)) / dayMs : NaN;

// Daily cadence belongs to the collector's Toronto calendar, not the UTC date
// when a cached dataset happens to be rebuilt. Keep per-source check receipts.
export function discoveryHistory(sources, states, previous, now) {
  if (!validTime(now)) throw new Error("Discovery requires a valid collection time");
  const today = calendarDay(now);
  const coverageKey = hash([5, "America/Toronto", sources.map(s => [s.id, s.url, s.format, s.terms, s.linkPattern, s.owner, s.tier, s.mode, s.quietAfterDays, s.freshnessHours, s.accessStatus, states[s.id]?.extractorVersion]).sort((a, b) => a[0].localeCompare(b[0]))]);
  const coverage = sources.map(s => {
    const state = states[s.id] || {}, age = validTime(state.lastSuccessAt) ? (Date.parse(now) - Date.parse(state.lastSuccessAt)) / dayMs : NaN;
    const publicationAge = validTime(state.newestPublicationAt) ? (Date.parse(now) - Date.parse(state.newestPublicationAt)) / dayMs : NaN;
    const fresh = s.accessStatus !== "permission-required" && state.status === "ok" && state.sourceUrl === s.url && age >= 0 && age <= (s.freshnessHours || 36) / 24;
    const quiet = !Number.isFinite(publicationAge) || publicationAge < 0 || Boolean(s.quietAfterDays && publicationAge > s.quietAfterDays);
    const sampleUsable = Number.isInteger(state.matchedItems) && state.matchedItems > 0 && Number.isInteger(state.datedItems) && state.datedItems > 0 && state.datedItems <= state.matchedItems;
    return { id: s.id, owner: s.owner, lane: s.tier === "community" ? "community" : "research", fresh, quiet, sampleUsable,
      collectedToday: fresh && calendarDay(state.lastSuccessAt) === today, lastSuccessAt: state.lastSuccessAt || null,
      newestPublicationAt: state.newestPublicationAt || null, matchedItems: state.matchedItems ?? null, datedItems: state.datedItems ?? null };
  });
  const healthy = coverage.length > 0 && coverage.every(s => s.fresh && !s.quiet && s.sampleUsable);
  const collectedToday = healthy && coverage.every(s => s.collectedToday);
  const validReceipt = row => {
    if (!Array.isArray(row.sourceChecks) || row.sourceChecks.length !== sources.length || !Array.isArray(row.topics)) return false;
    const ids = new Set(row.sourceChecks.map(s => s.id));
    return ids.size === sources.length && sources.every(s => ids.has(s.id)) && row.sourceChecks.every(s => validTime(s.checkedAt) && Date.parse(s.checkedAt) <= Date.parse(now) && calendarDay(s.checkedAt) === row.date);
  };
  const history = new Map(), legacy = new Map();
  const retainLegacy = row => { if (dateAge(row.date, today) >= 0 && dateAge(row.date, today) <= 90) legacy.set(hash(row), row); };
  for (const row of previous.legacyHistory || []) retainLegacy(row);
  for (const row of previous.history || []) {
    const age = dateAge(row.date, today);
    if (!(age >= 0 && age <= 90)) continue;
    if (previous.coverageKey !== coverageKey || !validReceipt(row)) { retainLegacy({ ...row, coverageKey: previous.coverageKey || null }); continue; }
    if (history.has(row.date)) {
      // Conflicting duplicate dates are ambiguous, not extra collection days.
      const old = history.get(row.date);
      if (JSON.stringify(old) !== JSON.stringify(row)) { retainLegacy({ ...old, coverageKey }); retainLegacy({ ...row, coverageKey }); history.set(row.date, null); }
    } else history.set(row.date, row);
  }
  const comparableHistory = [...history.values()].filter(Boolean).sort((a, b) => a.date.localeCompare(b.date));
  const historyDays = new Set(comparableHistory.filter(s => dateAge(s.date, today) <= 29).map(s => s.date));
  // Calendar arithmetic on date-only labels avoids DST 23/25-hour day shifts.
  const completeHistory = Array.from({ length: 28 }, (_, i) => new Date(Date.parse(today) - (i + 1) * dayMs).toISOString().slice(0, 10)).every(date => historyDays.has(date));
  return { today, coverageKey, coverage, healthy, collectedToday, completeHistory, historyDays, comparableHistory,
    legacyHistory: [...legacy.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-500) };
}

export function recordDiscoveryDay(audit, topics, documentCount) {
  // A failed later retry must not erase an earlier, fully checked day. It still
  // blocks a current momentum calculation through audit.collectedToday.
  if (!audit.collectedToday) return audit.comparableHistory;
  return [...audit.comparableHistory.filter(row => row.date !== audit.today), { date: audit.today, topics, documentCount,
    sourceChecks: audit.coverage.map(s => ({ id: s.id, checkedAt: s.lastSuccessAt })) }].sort((a, b) => a.date.localeCompare(b.date));
}
