// Per-ticker daily ledger (data/ledger.json) — the persistence history the coil
// detector needs. history.json only keeps the daily top-75, so a ticker's
// attention/price trail is lost once it falls out of the ranking; this ledger
// keeps a row per tracked ticker per day regardless of rank.
//
// Row shape: [date, mentions, shareOfVoice, close, volume, wikiViews]
// `volume` is raw daily share volume, not a pre-computed relative-volume
// ratio — the coil detector needs a consistent 60d-average baseline for its
// release trigger, and a stored ratio would carry whatever baseline window
// happened to produce it (today's live quote uses a ~4d window, Yahoo's
// backfill would otherwise use a 20d window). Storing raw volume lets the
// detector compute one consistent ratio itself.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
export const LEDGER_URL = new URL("data/ledger.json", ROOT);
export const LEDGER_JS_URL = new URL("data/ledger.js", ROOT);

export const LEDGER_MAX_ROWS = 400;
export const LEDGER_DORMANT_DAYS = 90;

export const ROW_DATE = 0;
export const ROW_MENTIONS = 1;
export const ROW_SOV = 2;
export const ROW_CLOSE = 3;
export const ROW_VOLUME = 4;
export const ROW_WIKI = 5;

const YAHOO_UA = "SignalDeskDaily/1.0 (+https://openai.com/; codex automation)";
const WIKI_UA = "SignalDeskDaily/1.0 (m.aali9@gmail.com) pageviews";

export async function loadLedger() {
  try {
    const raw = await readFile(LEDGER_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.tickers) return parsed;
  } catch {
    // No ledger yet — start fresh.
  }
  return { __meta: { lastPageviewsRunDate: null }, tickers: {} };
}

export async function saveLedger(ledger) {
  const json = JSON.stringify(ledger);
  await writeFile(LEDGER_URL, json);
  await writeFile(LEDGER_JS_URL, `window.SIGNALDESK_LEDGER = ${json};\n`);
}

export function upsertRow(ledger, ticker, meta, row) {
  const entry = ledger.tickers[ticker] || { meta: {}, rows: [] };
  entry.meta = { ...entry.meta, ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== "")) };
  const date = row[ROW_DATE];
  const idx = entry.rows.findIndex((r) => r[ROW_DATE] === date);
  if (idx >= 0) entry.rows[idx] = row;
  else entry.rows.push(row);
  entry.rows.sort((a, b) => a[ROW_DATE].localeCompare(b[ROW_DATE]));
  if (entry.rows.length > LEDGER_MAX_ROWS) entry.rows = entry.rows.slice(-LEDGER_MAX_ROWS);
  ledger.tickers[ticker] = entry;
  return entry;
}

// Merge historical [date, close, volume] rows fetched from Yahoo into a
// ticker's ledger, filling gaps without mention data (backfilled days show 0
// mentions/shareOfVoice — no historical social data exists for them).
export function mergeBackfillRows(ledger, ticker, backfillRows) {
  const entry = ledger.tickers[ticker] || { meta: {}, rows: [] };
  const byDate = new Map(entry.rows.map((r) => [r[ROW_DATE], r]));
  for (const [date, close, volume] of backfillRows) {
    const existing = byDate.get(date);
    if (existing) {
      if (!Number.isFinite(existing[ROW_CLOSE]) && Number.isFinite(close)) existing[ROW_CLOSE] = close;
      if (!Number.isFinite(existing[ROW_VOLUME]) && Number.isFinite(volume)) existing[ROW_VOLUME] = volume;
    } else {
      byDate.set(date, [date, 0, 0, Number.isFinite(close) ? close : null, Number.isFinite(volume) ? volume : null, null]);
    }
  }
  entry.rows = [...byDate.values()].sort((a, b) => a[ROW_DATE].localeCompare(b[ROW_DATE]));
  if (entry.rows.length > LEDGER_MAX_ROWS) entry.rows = entry.rows.slice(-LEDGER_MAX_ROWS);
  ledger.tickers[ticker] = entry;
  return entry;
}

export function mergePageviews(ledger, ticker, viewsByDate) {
  const entry = ledger.tickers[ticker];
  if (!entry) return;
  for (const row of entry.rows) {
    const views = viewsByDate.get(row[ROW_DATE]);
    if (Number.isFinite(views)) row[ROW_WIKI] = views;
  }
}

export function pruneLedger(ledger, { now = new Date(), dormantDays = LEDGER_DORMANT_DAYS, protectedTickers = new Set() } = {}) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - dormantDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  let pruned = 0;
  for (const [ticker, entry] of Object.entries(ledger.tickers)) {
    if (protectedTickers.has(ticker)) continue;
    const lastMentionRow = [...entry.rows].reverse().find((r) => r[ROW_MENTIONS] > 0);
    const lastActiveDate = lastMentionRow?.[ROW_DATE] || entry.rows[0]?.[ROW_DATE];
    if (!lastActiveDate || lastActiveDate < cutoffStr) {
      delete ledger.tickers[ticker];
      pruned += 1;
    }
  }
  return pruned;
}

// Yahoo v8 chart with explicit period1/period2 epochs — range=max silently
// degrades to monthly candles, so we always pass an explicit window.
export async function fetchYahooDailyHistory(ticker, days = 400) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - Math.ceil(days * 1.6) * 86400; // pad for weekends/holidays
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d`;
  const response = await fetch(url, { headers: { "User-Agent": YAHOO_UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const volumes = quote.volume || [];
  const rows = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = closes[i];
    if (!Number.isFinite(close)) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    rows.push([date, close, Number.isFinite(volumes[i]) ? volumes[i] : null]);
  }
  return rows.slice(-days);
}

// Wikipedia pageviews daily endpoint. `article` is the human-readable title
// (spaces, not underscores) resolved once via opensearch and cached on the
// ledger entry's meta.article so we don't re-resolve it every run.
export async function fetchWikipediaPageviews(article, startDate, endDate) {
  const title = encodeURIComponent(String(article).replace(/ /g, "_"));
  const start = startDate.replaceAll("-", "");
  const end = endDate.replaceAll("-", "");
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/daily/${start}/${end}`;
  const response = await fetch(url, { headers: { "User-Agent": WIKI_UA, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const json = await response.json();
  const map = new Map();
  for (const item of json?.items || []) {
    const raw = String(item.timestamp).slice(0, 8);
    const iso = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
    if (Number.isFinite(item.views)) map.set(iso, item.views);
  }
  return map;
}

// Derive the pageviews-API article title from a Wikipedia page URL captured
// during profile enrichment (e.g. ".../wiki/SoFi_Technologies%2C_Inc.").
export function articleFromWikipediaUrl(url) {
  if (!url) return null;
  const marker = "/wiki/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  try {
    return decodeURIComponent(url.slice(idx + marker.length)).replace(/_/g, " ").trim() || null;
  } catch {
    return null;
  }
}

function isoDaysAgo(days, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Orchestrates one refresh's worth of ledger work: upsert today's rows, backfill
// price history for newly-seen tickers (capped per run so runtime stays bounded;
// the 4x/day cadence catches up on the full universe within a few days), and
// backfill Wikipedia pageviews for the whole known universe once per calendar
// day (not on every 4x/day run).
export async function updateLedger({
  ledger,
  dateStr,
  mentionsByTicker,
  totalMentions,
  priceByTicker,
  registryMeta,
  failures,
  maxBackfills = 20,
  maxPageviewBatch = 150,
  protectedTickers = new Set(),
}) {
  const stats = { upserted: 0, backfilled: 0, pageviewsFetched: 0, pruned: 0 };
  const activeTickers = new Set(mentionsByTicker.keys());
  const allTickers = new Set([...activeTickers, ...Object.keys(ledger.tickers)]);
  const newlySeen = [];

  for (const ticker of allTickers) {
    const mentions = mentionsByTicker.get(ticker) || 0;
    const shareOfVoice = totalMentions > 0 ? mentions / totalMentions : 0;
    const price = priceByTicker.get(ticker);
    const prevEntry = ledger.tickers[ticker];
    const wasNew = !prevEntry;
    const prevRow = prevEntry?.rows?.at(-1);
    const close = Number.isFinite(price?.close) ? price.close : prevRow ? prevRow[ROW_CLOSE] : null;
    const volume = Number.isFinite(price?.volume) ? price.volume : null;
    // firstSeen marks where *real* observed shareOfVoice begins — backfilled
    // pre-ledger days get shareOfVoice=0 as a placeholder (unknown, not
    // confirmed zero), so the coil detector must not treat them as real
    // attention history when it falls back to shareOfVoice.
    const meta = { ...(registryMeta.get(ticker) || {}), ...(wasNew ? { firstSeen: dateStr } : {}) };
    upsertRow(ledger, ticker, meta, [dateStr, mentions, Number(shareOfVoice.toFixed(6)), close, volume, null]);
    stats.upserted += 1;
    if (wasNew) newlySeen.push({ ticker, mentions });
  }

  // Backfill price history for the most significant newly-seen tickers this run.
  newlySeen.sort((a, b) => b.mentions - a.mentions);
  for (const { ticker } of newlySeen.slice(0, maxBackfills)) {
    try {
      const history = await fetchYahooDailyHistory(ticker);
      if (history.length) mergeBackfillRows(ledger, ticker, history);
      stats.backfilled += 1;
    } catch (error) {
      failures.push(`Ledger backfill ${ticker}: ${error.message}`);
    }
    await sleep(150);
  }

  // Pageviews: once per calendar day across the known universe.
  if (ledger.__meta?.lastPageviewsRunDate !== dateStr) {
    const candidates = Object.entries(ledger.tickers)
      .filter(([, entry]) => entry.meta?.article)
      .slice(0, maxPageviewBatch);
    const start = isoDaysAgo(LEDGER_MAX_ROWS);
    for (const [ticker, entry] of candidates) {
      try {
        const views = await fetchWikipediaPageviews(entry.meta.article, start, dateStr);
        if (views.size) mergePageviews(ledger, ticker, views);
        stats.pageviewsFetched += 1;
      } catch (error) {
        failures.push(`Ledger pageviews ${ticker}: ${error.message}`);
      }
      await sleep(150);
    }
    ledger.__meta = { ...ledger.__meta, lastPageviewsRunDate: dateStr };
  }

  stats.pruned = pruneLedger(ledger, { protectedTickers });
  return stats;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
