import { createHash } from "node:crypto";
import { boundedJson } from "./research-fetch.mjs";

// Review-stage intake only: not wired into scheduled collection or story momentum.
export const PROCUREMENT_ENDPOINT = "https://api.usaspending.gov/api/v2/search/spending_by_transaction/";
export const PROCUREMENT_PROTOCOL = "usaspending-rd-actions-v1";
const LIMIT = 100, DAYS = 120;
const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const text = (value, max, name) => {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Invalid procurement ${name}`);
  return value.replace(/\s+/g, " ").trim();
};
const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
export function obligationAmount(value) {
  // Preserve exact cents and sign. Zero is an observed non-funding change.
  if (!["number", "string"].includes(typeof value)) throw new Error("Missing procurement obligation amount");
  const raw = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Invalid procurement obligation amount");
  const negative = raw.startsWith("-"), [whole, fraction = ""] = raw.replace(/^-/, "").split(".");
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n);
  if (cents > BigInt(Number.MAX_SAFE_INTEGER) || cents < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Procurement amount exceeds supported precision");
  const abs = cents < 0n ? -cents : cents;
  return { obligationChangeUsd: `${cents < 0n ? "-" : ""}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`, direction: cents > 0n ? "increase" : cents < 0n ? "decrease" : "no-change" };
}
export function procurementRequest(now = new Date().toISOString()) {
  if (typeof now !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(now) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now.replace(/(?<!\.\d{3})Z$/, ".000Z")) throw new Error("Invalid procurement observation time");
  const end = now.slice(0, 10);
  if (!day(end)) throw new Error("Invalid procurement observation date");
  const start = new Date(Date.parse(end) - (DAYS - 1) * 86400000).toISOString().slice(0, 10);
  return { filters: { award_type_codes: ["A", "B", "C", "D"], time_period: [{ start_date: start, end_date: end }], naics_codes: { require: ["5417"] } },
    fields: ["Award ID", "Recipient Name", "Transaction Description", "Action Date", "Transaction Amount", "Awarding Agency", "Award Type", "Mod", "generated_internal_id", "NAICS"],
    page: 1, limit: LIMIT, sort: "Action Date", order: "desc" };
}
export function procurementRecord(row, window) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Invalid procurement record");
  const awardKey = text(row.generated_internal_id, 500, "award identity"), modification = text(row.Mod, 100, "modification identity");
  if (!/^CONT_AWD_[A-Za-z0-9_-]+$/.test(awardKey)) throw new Error("Invalid procurement contract identity");
  const actionDate = row["Action Date"];
  if (!day(actionDate) || actionDate < window.start_date || actionDate > window.end_date) throw new Error("Procurement action date outside the requested window");
  const naicsCode = row.NAICS?.code;
  if (typeof naicsCode !== "string" || !/^5417\d{2}$/.test(naicsCode)) throw new Error("Procurement classification outside R&D scope");
  const description = row["Transaction Description"] == null || row["Transaction Description"] === "" ? null : text(row["Transaction Description"], 10000, "description").slice(0, 320);
  return { id: hash(`${awardKey}|${modification}`), awardKey, awardId: text(row["Award ID"], 200, "award number"), modification,
    recipient: text(row["Recipient Name"], 500, "recipient"), agency: text(row["Awarding Agency"], 300, "agency"),
    awardType: text(row["Award Type"], 150, "award type"), naicsCode, description,
    actionDate, publishedAt: null, ...obligationAmount(row["Transaction Amount"]),
    url: `https://www.usaspending.gov/award/${encodeURIComponent(awardKey)}` };
}
export function procurementSample(payload, now = new Date().toISOString()) {
  const request = procurementRequest(now), window = request.filters.time_period[0];
  if (!payload || !Array.isArray(payload.results) || payload.results.length > LIMIT || payload.limit !== LIMIT || payload.page_metadata?.page !== 1 || typeof payload.page_metadata.hasNext !== "boolean") throw new Error("Procurement response contract changed");
  const records = new Map();
  for (const raw of payload.results) {
    const row = procurementRecord(raw, window), old = records.get(row.id);
    if (old && JSON.stringify(old) !== JSON.stringify(row)) throw new Error("Conflicting procurement records share an award/modification identity");
    records.set(row.id, row);
  }
  const rows = [...records.values()].sort((a, b) => b.actionDate.localeCompare(a.actionDate) || a.id.localeCompare(b.id));
  return { schemaVersion: 1, protocol: PROCUREMENT_PROTOCOL, observedAt: now, sourceUrl: PROCUREMENT_ENDPOINT,
    request, window, records: rows, coverage: { returnedRows: payload.results.length, distinctActions: rows.length,
      distinctAwards: new Set(rows.map(r => r.awardKey)).size, hasMore: payload.page_metadata.hasNext, capped: payload.results.length === LIMIT || payload.page_metadata.hasNext,
      completeCensus: false, newestActionDate: rows[0]?.actionDate || null },
    note: "Bounded sample of federal contract actions classified as scientific R&D (NAICS 5417), not all technology spending. Action dates are not publication dates; delayed and revised records can be missed. Obligation changes are commitments or adjustments, not payments, recipient revenue, delivered products or consumer adoption. Multiple modifications do not establish repeat customers." };
}
export async function fetchProcurement({ fetchImpl = fetch, now = new Date().toISOString(), timeoutMs = 20000 } = {}) {
  const request = procurementRequest(now);
  const payload = await boundedJson(PROCUREMENT_ENDPOINT, { maxBytes: 750000, timeoutMs,
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "SignalDesk/2.0 (+https://mindfulmod.github.io/signaldesk/)" },
    fetchImpl: (url, init) => fetchImpl(url, { ...init, method: "POST", redirect: "error", body: JSON.stringify(request) }) });
  return procurementSample(payload, now);
}
export async function refreshProcurement(previous = {}, options = {}) {
  const now = options.now || new Date().toISOString();
  try {
    const snapshot = await fetchProcurement({ ...options, now });
    return { schemaVersion: 1, status: "ok", lastAttemptAt: now, lastSuccessAt: now, error: null, snapshot };
  } catch (error) {
    return { ...previous, schemaVersion: 1, status: "error", lastAttemptAt: now, error: String(error.message || "Procurement intake failed").slice(0, 300) };
  }
}
