// Reconcile independently collected publications without summing overlapping
// measurements. Git merge parents retain exact competing values for audit.
import { createHash } from "node:crypto";
const clone = value => value === undefined ? undefined : structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const latest = (a, b, field = "generatedAt") => String(a?.[field] || "") > String(b?.[field] || "") ? a : b;
export const union = (a = [], b = [], key = hash, resolve = (x, y) => y) => {
  const rows = new Map(a.map(row => [key(row), clone(row)]));
  for (const row of b) { const id = key(row); rows.set(id, rows.has(id) ? resolve(rows.get(id), clone(row)) : clone(row)); }
  return [...rows.values()];
};
export function threeWay(base, ours, theirs, audit = [], path = "", prefer = "ours") {
  if (equal(ours, theirs) || equal(theirs, base)) return clone(ours);
  if (equal(ours, base)) return clone(theirs);
  if (object(ours) && object(theirs)) return Object.fromEntries([...new Set([...Object.keys(ours), ...Object.keys(theirs)])]
    .map(k => [k, threeWay(base?.[k], ours[k], theirs[k], audit, `${path}/${k}`, prefer)]).filter(([,v])=>v!==undefined));
  if (Array.isArray(ours) && Array.isArray(theirs)) return union(ours, theirs);
  audit.push({ path, resolution: prefer, oursHash: hash(ours ?? null), theirsHash: hash(theirs ?? null) });
  return clone(prefer === "ours" ? ours : theirs);
}
export function reconcileHistory(ours, theirs) {
  const snapshots = union(ours.snapshots, theirs.snapshots, row => row.date, (a,b) => latest(a,b)).sort((a,b)=>a.date.localeCompare(b.date));
  if (snapshots.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.date))) throw new Error("Invalid daily snapshot identity");
  return { ...latest(ours,theirs,"updatedAt"), snapshots };
}
export function reconcileLedger(base, ours, theirs, audit = []) {
  const tickers = {};
  for (const ticker of new Set([...Object.keys(ours.tickers), ...Object.keys(theirs.tickers)])) {
    const a = ours.tickers[ticker], b = theirs.tickers[ticker], original = base.tickers?.[ticker];
    if (!a || !b) { tickers[ticker] = clone(a || b); continue; }
    if(a.meta?.issuerIdentity?.cik && b.meta?.issuerIdentity?.cik && a.meta.issuerIdentity.cik!==b.meta.issuerIdentity.cik) throw Error(`Ledger issuer boundary requires explicit reconciliation: ${ticker}`);
    const before = new Map((original?.rows || []).map(row => [row[0], row]));
    const rows = union(a.rows, b.rows, row => row[0], (x,y) => {
      if (equal(x,y) || equal(y,before.get(x[0]))) return x;
      if (equal(x,before.get(x[0]))) return y;
      audit.push({path:`ledger/${ticker}/${x[0]}`,resolution:"ours — repaired observation contract"});
      return x; // Never add/average same-session measurements or null-fill them.
    }).sort((x,y)=>x[0].localeCompare(y[0]));
    tickers[ticker] = { ...threeWay(original,a,b,audit,`ledger/${ticker}`), rows };
  }
  return { ...threeWay(base, { ...ours, tickers: {} }, { ...theirs, tickers: {} },audit,"ledger"), tickers };
}
export function reconcileMonitor(ours, theirs) {
  const sources = {};
  for (const id of new Set([...Object.keys(ours.sources), ...Object.keys(theirs.sources)])) {
    const a=ours.sources[id], b=theirs.sources[id];
    sources[id]=clone(!a||!b?a||b:latest(a,b,"lastAttemptAt"));
  }
  return { ...latest(ours,theirs), sources, events: union(ours.events,theirs.events,row=>row.id || hash(row)).sort((a,b)=>String(a.detectedAt||a.at||"").localeCompare(String(b.detectedAt||b.at||""))) };
}
export function reconcileCalibration(base,ours,theirs,audit=[]) {
  return {entries:union(ours.entries,theirs.entries,row=>row.id,(a,b)=>{
    for(const field of ["type","ticker","theme","stage","date","memberTickers","basePrice"]) {
      if(a[field]!=null&&b[field]!=null&&!equal(a[field],b[field]))throw Error(`Conflicting frozen calibration ${a.id}/${field}`);
    }
    return threeWay(base.entries.find(r=>r.id===a.id),a,b,audit,`calibration/${a.id}`);
  })};
}
export function reconcilePhrases(base,ours,theirs,audit=[]) {
  const result=threeWay(base,ours,theirs,audit,"phrase-history","theirs");
  result.firstSeen={...ours.firstSeen,...theirs.firstSeen};
  for(const key of Object.keys(result.firstSeen))result.firstSeen[key]=[ours.firstSeen?.[key],theirs.firstSeen?.[key]].filter(Boolean).sort()[0];
  return result;
}
export function reconcileResearch(ours, theirs) {
  const newest = latest(ours,theirs), older = newest === ours ? theirs : ours;
  const documents = union(older.documents,newest.documents,row=>row.id,(a,b)=>({ ...b,
    detectedAt:[a.detectedAt,b.detectedAt].filter(Boolean).sort()[0],
    firstSeenAt:[a.firstSeenAt,b.firstSeenAt].filter(Boolean).sort()[0] }));
  const documentIndex={};
  for(const id of new Set([...Object.keys(ours.documentIndex||{}),...Object.keys(theirs.documentIndex||{})])) {
    const a=ours.documentIndex?.[id],b=theirs.documentIndex?.[id];
    if(!a||!b){documentIndex[id]=clone(a||b);continue;}
    const versions={...a.versions};for(const [key,date]of Object.entries(b.versions||{})) versions[key]=[versions[key],date].filter(Boolean).sort()[0];
    documentIndex[id]={...b,versions,firstSeenAt:[a.firstSeenAt,b.firstSeenAt].filter(Boolean).sort()[0],
      originalPublishedAt:[a.originalPublishedAt,b.originalPublishedAt].filter(Boolean).sort()[0]||null,
      latestId:Object.entries(versions).sort((x,y)=>y[1].localeCompare(x[1])||x[0].localeCompare(y[0]))[0]?.[0]};
  }
  const reviews=union(ours.reviews,theirs.reviews,row=>row.id,(a,b)=>{if(!equal(a,b))throw Error(`Conflicting immutable review ${a.id}`);return a;});
  // Never turn old or incompatible coverage into verified daily receipts.
  const compatible=ours.discovery?.coverageKey===theirs.discovery?.coverageKey;
  const discovery={...ours.discovery,
    history:compatible?union(ours.discovery?.history,theirs.discovery?.history):clone(ours.discovery?.history||[]),
    legacyHistory:union(ours.discovery?.legacyHistory,[...(theirs.discovery?.legacyHistory||[]),...(!compatible?(theirs.discovery?.history||[]).map(r=>({...r,coverageKey:theirs.discovery?.coverageKey||null})):[])]),
    archive:union(ours.discovery?.archive,theirs.discovery?.archive,row=>row.id||row.phrase),
  };
  return {...newest,documents,documentIndex,reviews,discovery};
}
export function reconcileCoMentions(ours,theirs) {
  const documents={},legacyDocuments={};
  const retain=(target,id,value)=>{
    if(!target[id]||equal(target[id],value)) target[id]=clone(value);
    else target[`${id}:revision:${hash(value)}`]=clone(value);
  };
  for(const side of [ours,theirs]) {
    for(const[id,value]of Object.entries(side.legacyDocuments||{}))retain(legacyDocuments,id,value);
    for(const[id,value]of Object.entries(side.documents||{})) {
      if(side.version!==3){retain(legacyDocuments,id,value);continue;}
      if(documents[id]&&!equal(documents[id],value))throw Error(`Conflicting attributable graph ${id}; reconcile its revisions explicitly`);
      documents[id]=clone(value);
    }
  }
  return {version:3,documents,legacyDocuments,weeks:ours.version===3?clone(ours.weeks):{},legacyWeeks:{...ours.legacyWeeks,...theirs.legacyWeeks}};
}
