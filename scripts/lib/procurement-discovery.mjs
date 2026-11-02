import { refreshProcurementArchive, validateProcurementArchive, procurementHistorySummary } from "./procurement-history.mjs";
import { validateProcurementSnapshot } from "./procurement-history.mjs";
import { PROCUREMENT_PROTOCOL, DELAYED_PROCUREMENT_PROTOCOL } from "./procurement-pilot.mjs";

export const PROCUREMENT_LANES = ["recent", "delayed"];
const calendarDay = time => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time));
const hour = 3600000;
export function validateProcurementState(state) {
  if (!state || state.schemaVersion !== 1 || !state.lanes || Object.keys(state.lanes).sort().join() !== "delayed,recent") throw new Error("Invalid public R&D state");
  for (const lane of PROCUREMENT_LANES) {
    if (!state.lanes[lane] || typeof state.lanes[lane] !== "object" || Array.isArray(state.lanes[lane])) throw new Error("Invalid public R&D lane");
    validateProcurementArchive(state.lanes[lane], { delayed: lane === "delayed" });
  }
  return state;
}
export function procurementDue(archive, now) {
  if (archive.lastAttemptAt && Date.parse(now) - Date.parse(archive.lastAttemptAt) < 6 * hour) return false;
  return !archive.lastSuccessAt || calendarDay(archive.lastSuccessAt) !== calendarDay(now);
}
export async function collectProcurement(previous, { now = new Date().toISOString(), fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const state = previous ? validateProcurementState(previous) : { schemaVersion: 1, lanes: { recent: {}, delayed: {} } };
  const lanes = {};
  let requested = false;
  for (const lane of PROCUREMENT_LANES) {
    const prior = state.lanes[lane];
    if (!procurementDue(prior, now)) { lanes[lane] = prior; continue; }
    if (requested) await sleep(1000);
    requested = true;
    const next = await refreshProcurementArchive(prior, { now, fetchImpl, delayed: lane === "delayed" });
    lanes[lane] = Buffer.byteLength(JSON.stringify(next)) > 40000000
      ? { ...prior, schemaVersion: 1, status: "error", lastAttemptAt: now, error: "Procurement archive size limit reached; archive review required" }
      : next;
  }
  return { schemaVersion: 1, lanes };
}
export function publicProcurement(state) {
  validateProcurementState(state);
  return { schemaVersion: 1, source: "USAspending", sourceUrl: "https://www.usaspending.gov/", lanes: Object.fromEntries(PROCUREMENT_LANES.map(lane => {
    const archive = state.lanes[lane];
    return [lane, { status: archive.status || "uncollected", lastAttemptAt: archive.lastAttemptAt || null, lastSuccessAt: archive.lastSuccessAt || null,
      error: archive.error || null, snapshot: archive.snapshot || null, historySummary: archive.history ? procurementHistorySummary(archive.history) : null }];
  })) };
}
export function procurementHealth(data, now = Date.now()) {
  const errors = [], warnings = [];
  if (!data || data.schemaVersion !== 1 || !data.lanes || Object.keys(data.lanes).sort().join() !== "delayed,recent") return { errors: ["Public R&D sample is missing or invalid"], warnings };
  for (const lane of PROCUREMENT_LANES) {
    const row = data.lanes[lane], label = `Public R&D ${lane} sample`;
    if (!row || !["ok", "error", "uncollected"].includes(row.status)) { errors.push(`${label}: invalid state`); continue; }
    for (const key of ["lastAttemptAt", "lastSuccessAt"]) if (row[key] && (!Number.isFinite(Date.parse(row[key])) || Date.parse(row[key]) > now + 300000)) errors.push(`${label}: invalid ${key}`);
    if (row.snapshot) {
      try {
        validateProcurementSnapshot(row.snapshot);
        if (row.snapshot.protocol !== (lane === "delayed" ? DELAYED_PROCUREMENT_PROTOCOL : PROCUREMENT_PROTOCOL) || row.snapshot.observedAt !== row.lastSuccessAt) throw Error("sampling identity or success time disagrees");
      } catch (e) { errors.push(`${label}: ${e.message}`); }
    } else if (row.status === "ok" || row.lastSuccessAt) errors.push(`${label}: successful check has no snapshot`);
    if (row.status !== "ok" || !row.lastSuccessAt || now - Date.parse(row.lastSuccessAt) > 36 * hour) warnings.push(`${label}: ${row.error || "check overdue or not yet collected"}; retained records keep their original dates`);
    if (row.snapshot?.coverage.capped) warnings.push(`${label}: capped at 100 actions; not a census or a growth series`);
  }
  return { errors, warnings };
}
// Operational deadline is separate from publication integrity: keep publishing
// explicit retained/error states, but fail the watchdog when checks are overdue.
export function procurementFreshnessErrors(data, now = Date.now()) {
  if (!data?.lanes) return ["Public R&D collection has not been published"];
  return PROCUREMENT_LANES.filter(lane => {
    const time = Date.parse(data.lanes[lane]?.lastSuccessAt);
    return !Number.isFinite(time) || time > now + 300000 || now - time > 36 * hour;
  }).map(lane => `Public R&D ${lane} sample has no successful check within 36 hours`);
}
