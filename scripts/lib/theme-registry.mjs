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
  const rows = table.split(/\n\|-\n/).slice(1);
  const map = new Map();

  for (const row of rows) {
    const lines = row.split("\n").filter(Boolean);
    if (!lines.length) continue;
    const symbolMatch = lines[0].match(/Symbol\|([A-Z.\-]+)/);
    if (!symbolMatch) continue;
    const ticker = symbolMatch[1].replace(/\./g, "-"); // BRK.B -> BRK-B (Yahoo/most feeds' convention)
    const rest = lines.slice(1).join(" ");
    const cells = rest.split("||").map((cell) => cleanWikitext(cell.replace(/^\|/, "")));
    const [name, sector, sub, , , cik] = cells;
    if (!sector || !sub) continue;
    map.set(ticker, { name: name || ticker, sector, sub, cik: cik || null });
  }
  return map;
}

function cleanWikitext(value) {
  return String(value || "")
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''/g, "")
    .trim();
}

export async function fetchGicsBaseline() {
  const response = await fetch(SP500_URL, { headers: { "User-Agent": WIKI_UA, Accept: "text/plain" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const wikitext = await response.text();
  return parseGicsWikitext(wikitext);
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
export async function refreshThemeRegistry({ failures, clusters = [] } = {}) {
  const existing = await loadThemeRegistry();
  const overrideThemes = await loadThemeOverrides();
  const stale = daysSince(existing.gicsRefreshedAt) >= GICS_REFRESH_DAYS || !existing.gics || !Object.keys(existing.gics).length;

  let gicsBaseline;
  if (stale) {
    try {
      gicsBaseline = await fetchGicsBaseline();
    } catch (error) {
      failures?.push(`GICS baseline: ${error.message}`);
      gicsBaseline = new Map(Object.entries(existing.gics || {}).map(([t, info]) => [t, { ...info, name: t, cik: null }]));
    }
  } else {
    gicsBaseline = new Map(Object.entries(existing.gics || {}).map(([t, info]) => [t, { ...info, name: t, cik: null }]));
  }

  const registry = buildThemeRegistry(gicsBaseline, overrideThemes, clusters);
  if (!stale) registry.gicsRefreshedAt = existing.gicsRefreshedAt;
  return registry;
}
