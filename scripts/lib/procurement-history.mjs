import { createHash } from "node:crypto";
import { PROCUREMENT_PROTOCOL, procurementSample, refreshProcurement } from "./procurement-pilot.mjs";

// Fail closed at the review-stage retention limit; never silently discard history.
const MAX_OBSERVATIONS = 400, MAX_VERSIONS = 30000;
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = record => createHash("sha256").update(canonical(record)).digest("hex");
const same = (a, b) => canonical(a) === canonical(b);
const empty = () => ({ schemaVersion: 1, protocol: PROCUREMENT_PROTOCOL, versions: [], observations: [] });
const raw = record => ({ generated_internal_id: record.awardKey, Mod: record.modification,
  "Award ID": record.awardId, "Recipient Name": record.recipient, "Awarding Agency": record.agency,
  "Award Type": record.awardType, NAICS: { code: record.naicsCode },
  // Intake truncates after whitespace normalization. A 320-character excerpt can
  // legitimately end in a space; preserve that exact historical representation.
  "Transaction Description": record.description?.length === 320 ? record.description + "…" : record.description,
  "Action Date": record.actionDate, "Transaction Amount": record.obligationChangeUsd });

function reconstruct(records, observedAt, coverage) {
  if (!coverage || !Number.isInteger(coverage.returnedRows) || coverage.returnedRows < records.length || coverage.returnedRows > 100 || (!records.length && coverage.returnedRows)) throw new Error("Invalid procurement history coverage");
  const rows = records.map(raw);
  // Exact duplicates were removed by intake; their raw count remains auditable.
  while (rows.length < coverage.returnedRows) rows.push(rows[0]);
  const snapshot = procurementSample({ limit: 100, results: rows, page_metadata: { page: 1, hasNext: coverage.hasMore } }, observedAt);
  if (!same(snapshot.coverage, coverage)) throw new Error("Inconsistent procurement history coverage");
  return snapshot;
}

export function validateProcurementSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.records) || snapshot.records.length > 100) throw new Error("Invalid retained procurement snapshot");
  const checked = reconstruct(snapshot.records, snapshot.observedAt, snapshot.coverage);
  if (!same(checked, snapshot)) throw new Error("Retained procurement snapshot failed integrity checks");
  return snapshot;
}

export function validateProcurementHistory(history) {
  if (!history || history.schemaVersion !== 1 || history.protocol !== PROCUREMENT_PROTOCOL || !Array.isArray(history.versions) || !Array.isArray(history.observations)
    || history.versions.length > MAX_VERSIONS || history.observations.length > MAX_OBSERVATIONS
    || !same(Object.keys(history).sort(), ["observations", "protocol", "schemaVersion", "versions"])) throw new Error("Unsupported procurement history contract");
  const versions = new Map(), used = new Set();
  for (const item of history.versions) {
    if (!item || !item.record || !same(Object.keys(item).sort(), ["record", "version"]) || item.version !== fingerprint(item.record) || versions.has(item.version)) throw new Error("Invalid procurement history version");
    versions.set(item.version, item.record);
  }
  let lastTime = -Infinity;
  for (const observation of history.observations) {
    if (!observation || !Array.isArray(observation.versions) || observation.versions.length > 100 || !same(Object.keys(observation).sort(), ["coverage", "observedAt", "versions"])) throw new Error("Invalid procurement history observation");
    if (!(Date.parse(observation.observedAt) > lastTime)) throw new Error("Procurement history observations must be chronological");
    const records = observation.versions.map(version => {
      if (!versions.has(version)) throw new Error("Missing procurement history version");
      used.add(version); return versions.get(version);
    });
    const snapshot = reconstruct(records, observation.observedAt, observation.coverage);
    if (!same(snapshot.records, records)) throw new Error("Procurement history record integrity failed");
    lastTime = Date.parse(observation.observedAt);
  }
  if (used.size !== versions.size) throw new Error("Unreferenced procurement history versions");
  return history;
}

export function appendProcurementHistory(previous, snapshot) {
  validateProcurementSnapshot(snapshot);
  const history = previous ? validateProcurementHistory(previous) : empty();
  const observation = { observedAt: snapshot.observedAt, coverage: snapshot.coverage, versions: snapshot.records.map(fingerprint) };
  const last = history.observations.at(-1);
  if (last && Date.parse(observation.observedAt) <= Date.parse(last.observedAt)) {
    if (same(last, observation)) return structuredClone(history);
    throw new Error("Older or conflicting procurement observation; prior history retained");
  }
  const versions = new Map(history.versions.map(item => [item.version, item]));
  for (const record of snapshot.records) {
    const version = fingerprint(record);
    if (!versions.has(version)) versions.set(version, { version, record });
  }
  if (history.observations.length >= MAX_OBSERVATIONS || versions.size > MAX_VERSIONS) throw new Error("Procurement history retention limit reached; archive review required");
  return structuredClone({ ...history, versions: [...versions.values()], observations: [...history.observations, observation] });
}

export function procurementHistorySummary(history) {
  validateProcurementHistory(history);
  const latest = history.observations.at(-1);
  const records = new Map(history.versions.map(item => [item.version, item.record])), prior = new Map();
  for (const observation of history.observations.slice(0, -1)) for (const version of observation.versions) prior.set(records.get(version).id, version);
  const result = { successfulObservations: history.observations.length, observedActions: latest?.versions.length || 0,
    firstObservedActions: 0, changedActions: 0, unchangedActions: 0, notInLatestSample: 0,
    note: "First observed is not newly awarded. Changes are source-record revisions, not growth. Missing from a sample does not mean cancelled. Repeated checks are not independent evidence." };
  const current = new Set();
  for (const version of latest?.versions || []) {
    const id = records.get(version).id; current.add(id);
    if (!prior.has(id)) result.firstObservedActions++;
    else if (prior.get(id) !== version) result.changedActions++;
    else result.unchangedActions++;
  }
  result.notInLatestSample = [...prior.keys()].filter(id => !current.has(id)).length;
  return result;
}

export async function refreshProcurementArchive(previous = {}, options = {}) {
  // Validate before network access or disk writes. Corrupt history requires review,
  // not replacement with a superficially healthy fresh sample.
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) throw new Error("Invalid procurement archive");
  if (Object.keys(previous).length && (previous.schemaVersion !== 1 || !["ok", "error"].includes(previous.status))) throw new Error("Unsupported procurement archive contract");
  let history = previous.history;
  if (history) validateProcurementHistory(history);
  if (previous.snapshot) {
    validateProcurementSnapshot(previous.snapshot);
    if (previous.lastSuccessAt !== previous.snapshot.observedAt) throw new Error("Procurement success time disagrees with retained evidence");
    if (!history) history = appendProcurementHistory(null, previous.snapshot);
    else {
      const tail = history.observations.at(-1);
      const expected = { observedAt: previous.snapshot.observedAt, coverage: previous.snapshot.coverage, versions: previous.snapshot.records.map(fingerprint) };
      if (!same(tail, expected)) throw new Error("Procurement history disagrees with retained snapshot");
    }
  } else if (history || previous.lastSuccessAt || previous.status === "ok") throw new Error("Procurement archive is missing its retained snapshot");
  const state = await refreshProcurement(previous, options);
  if (state.status !== "ok") return state;
  try {
    return { ...state, history: appendProcurementHistory(history, state.snapshot) };
  } catch (error) {
    return { ...previous, schemaVersion: 1, status: "error", lastAttemptAt: state.lastAttemptAt, error: error.message };
  }
}
