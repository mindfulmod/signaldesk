// Theme registry (data/theme-registry.json) — THEME_ENGINE.md P2. Three
// membership sources, merged, provenance kept per member:
//   1. GICS baseline  — ticker -> {sector, sub}, parsed from Wikipedia's S&P
//      500 constituent table. Static seed, refreshed monthly.
//   2. Dynamic clusters — co-mention/return-correlation clustering. Stubbed
//      out for now (see THEME_ENGINE.md build order items 6/8); the merge
//      function accepts a clusters array so wiring it in later doesn't
//      require touching the shape of theme-registry.json.
//   3. Manual overrides — data/theme-overrides.json, human-curated.
import { readFile, writeFile } from "node:fs/promises";

const ROOT = new URL("../../", import.meta.url);
export const REGISTRY_URL = new URL("data/theme-registry.json", ROOT);
export const REGISTRY_JS_URL = new URL("data/theme-registry.js", ROOT);
export const OVERRIDES_URL = new URL("data/theme-overrides.json", ROOT);

export const GICS_REFRESH_DAYS = 30;
const WIKI_UA = "SignalDeskDaily/1.0 (m.aali9@gmail.com) gics-baseline";
const SP500_URL = "https://en.wikipedia.org/w/index.php?title=List_of_S%26P_500_companies&action=raw";
export const GICS_SECTORS = new Set(["Communication Services", "Consumer Discretionary", "Consumer Staples", "Energy", "Financials", "Health Care", "Industrials", "Information Technology", "Materials", "Real Estate", "Utilities"]);
const validClassification = info => GICS_SECTORS.has(info?.sector) && typeof info.sub === "string" && info.sub.length > 2 && !GICS_SECTORS.has(info.sub);

export async function loadThemeOverrides() {
  const raw = await readFile(OVERRIDES_URL, "utf8");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.themes) ? parsed.themes : [];
}

export async function loadThemeRegistry() {
  try {
    const raw = await readFile(REGISTRY_URL, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // No registry yet.
  }
  return { generatedAt: null, gicsRefreshedAt: null, gics: {}, themes: [] };
}

export async function saveThemeRegistry(registry) {
  const json = JSON.stringify(registry);
  await writeFile(REGISTRY_URL, json);
  await writeFile(REGISTRY_JS_URL, `window.SIGNALDESK_THEME_REGISTRY = ${json};\n`);
}

// Parses the wikitext of "List of S&P 500 companies" (the constituents
// table only) into ticker -> {name, sector, sub, cik}. Wikitext, not the
// rendered HTML, so no DOM parser dependency is needed.
export function parseGicsWikitext(wikitext) {
  const startIdx = wikitext.indexOf('{| class="wikitable');
  if (startIdx === -1) return new Map();
  const endIdx = wikitext.indexOf("\n|}", startIdx);
  const table = wikitext.slice(startIdx, endIdx === -1 ? undefined : endIdx);
  const rows = table.split(/\n\|-[^\n]*\n/).slice(1);
  const header = rows.find(row => /^\s*!/.test(row));
  if (!header) throw new Error("GICS constituent header missing");
  const labels = header.trim().replace(/^!+/, "").split(/!!|\n!+/).map(cleanWikitext);
  const columns = ["Symbol", "Security", "GICS Sector", "GICS Sub-Industry", "CIK"].map(label => labels.indexOf(label));
  if (columns.some(i => i < 0) || new Set(columns).size !== columns.length) throw new Error("GICS constituent columns changed");
  const map = new Map();

  for (const row of rows) {
    if (/^\s*!/.test(row)) continue;
    // A leading || is a cell delimiter, not an empty first column. Newline
    // cells and same-line cells must retain the exact header-defined order.
    const rawCells = row.trim().replace(/^\|{1,2}\s*/, "").split(/\|\||\n\|{1,2}/);
    const symbolMatch = rawCells[columns[0]]?.match(/(?:Symbol|BZX link)\|([A-Z.\-]+)/);
    if (!symbolMatch) { if (row.trim()) throw new Error("Unrecognized GICS constituent symbol"); continue; }
    const ticker = symbolMatch[1].replace(/\./g, "-"); // BRK.B -> BRK-B (Yahoo/most feeds' convention)
    const cells = rawCells.map(cleanWikitext);
    const [, name, sector, sub, cik] = columns.map(i => cells[i]);
    if (!name || !validClassification({ sector, sub }) || !/^\d{1,10}$/.test(cik || "") || map.has(ticker)) throw new Error(`Invalid GICS constituent row: ${ticker}`);
    map.set(ticker, { name, sector, sub, cik: cik.padStart(10, "0") });
  }
  return map;
}

function cleanWikitext(value) {
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''/g, "")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/\s*>/gi, "")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function validateGicsBaseline(baseline) {
  if (!(baseline instanceof Map) || baseline.size < 400 || baseline.size > 600 || [...baseline.values()].some(info => !validClassification(info)) || new Set([...baseline.values()].map(info => info.sector)).size < 10) throw new Error("Incomplete or invalid GICS constituent coverage");
  return baseline;
}

export async function fetchGicsBaseline({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(SP500_URL, { headers: { "User-Agent": WIKI_UA, Accept: "text/plain" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.byteLength; if (bytes > 2000000) throw new Error("GICS response size limit"); chunks.push(chunk); }
  return validateGicsBaseline(parseGicsWikitext(Buffer.concat(chunks).toString("utf8")));
}

function daysSince(dateStr, now = new Date()) {
  if (!dateStr) return Infinity;
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return Infinity;
  return (now.getTime() - then) / 86_400_000;
}

// Merges GICS baseline + manual overrides (+ optional dynamic clusters) into
// the registry shape. `clusters` is `[{ id, name, members: [ticker,...] }]`
// and defaults to [] (P2 stub — see THEME_ENGINE.md build order items 6/8).
export function buildThemeRegistry(gicsBaseline, overrideThemes, clusters = []) {
  gicsBaseline = new Map([...gicsBaseline].filter(([, info]) => validClassification(info)));
  const themes = overrideThemes.map((theme) => {
    const membersMap = new Map();
    const addSrc = (ticker, src) => {
      const existing = membersMap.get(ticker) || { t: ticker, src: [] };
      if (!existing.src.includes(src)) existing.src.push(src);
      membersMap.set(ticker, existing);
    };
    for (const sub of theme.gicsSubs || []) {
      for (const [ticker, info] of gicsBaseline) {
        if (info.sub === sub) addSrc(ticker, "gics");
      }
    }
    for (const ticker of theme.manual || []) addSrc(ticker, "manual");
    const cluster = clusters.find((c) => c.id === theme.id);
    for (const ticker of cluster?.members || []) addSrc(ticker, "cluster");

    return {
      id: theme.id,
      name: theme.name,
      phrases: theme.phrases || [],
      members: [...membersMap.values()].sort((a, b) => a.t.localeCompare(b.t)),
    };
  });

  const gics = {};
  for (const [ticker, info] of gicsBaseline) gics[ticker] = { sector: info.sector, sub: info.sub };

  return { generatedAt: new Date().toISOString(), gicsRefreshedAt: new Date().toISOString(), gics, themes };
}

// Refreshes the registry: re-fetches the GICS baseline only if it is missing
// or older than GICS_REFRESH_DAYS (spec: "Static seed, refreshed monthly"),
// otherwise reuses the cached baseline and just re-merges overrides so a
// same-day edit to theme-overrides.json still takes effect every run.
export async function refreshThemeRegistry({ failures, clusters = [], loadRegistry = loadThemeRegistry, loadOverrides = loadThemeOverrides, fetchBaseline = fetchGicsBaseline, now = new Date().toISOString() } = {}) {
  const existing = await loadRegistry();
  const overrideThemes = await loadOverrides();
  let cached = new Map(Object.entries(existing.gics || {}));
  try { validateGicsBaseline(cached); } catch { cached = new Map(); }
  const stale = existing.gicsParserVersion !== 2 || daysSince(existing.gicsRefreshedAt, new Date(now)) >= GICS_REFRESH_DAYS || !cached.size;

  let gicsBaseline;
  let refreshed = false, errorMessage = null;
  if (stale) {
    try {
      gicsBaseline = validateGicsBaseline(await fetchBaseline()); refreshed = true;
    } catch (error) {
      failures?.push(`GICS baseline: ${error.message}`);
      errorMessage = error.message; gicsBaseline = cached;
    }
  } else {
    gicsBaseline = cached;
  }

  const registry = buildThemeRegistry(gicsBaseline, overrideThemes, clusters);
  registry.generatedAt = now;
  registry.gicsRefreshedAt = refreshed ? now : cached.size ? existing.gicsRefreshedAt : null;
  registry.gicsParserVersion = refreshed || existing.gicsParserVersion === 2 ? 2 : null;
  registry.gicsStatus = refreshed || !stale ? "current" : cached.size ? "retained" : "unavailable";
  registry.gicsError = errorMessage;
  registry.gicsSource = SP500_URL;
  return registry;
}
