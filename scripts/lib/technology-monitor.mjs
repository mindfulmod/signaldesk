import { createHash } from "node:crypto";

const hash = value => createHash("sha256").update(value).digest("hex");
const EXTRACTOR_VERSION = 2;
const decode = text => text.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : " "; })
  .replace(/&(?:amp|quot|apos|lt|gt|nbsp|ndash|mdash|rsquo);/g, v => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&rsquo;": "’" }[v]));
export function textOnly(html) {
  return decode(String(html).replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[^]*?-->/g, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
export function canonicalUrl(value, base, allowedHosts) {
  try {
    const u = new URL(decode(value), base);
    if (u.protocol !== "https:" || u.username || u.password || !allowedHosts.includes(u.hostname) || (u.port && u.port !== "443")) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|msockid)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
export function extractSource(html, source) {
  const title = textOnly(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (/just a moment|access denied|attention required|verify.*human|robot check/i.test(title)) throw new Error("Source returned an access challenge, not usable evidence");
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  // Some publishers put an empty article before the real page content.
  const region = main && textOnly(main).length >= 120 ? main : article && textOnly(article).length >= 120 ? article : html;
  const text = textOnly(region);
  if (text.length < 120) throw new Error("Source has too little readable content (possibly a client-rendered page)");
  const relevant = value => source.terms.some(term => value.toLowerCase().includes(term.toLowerCase()));
  if (source.mode === "page" && !relevant(text)) throw new Error("Expected technology terms are absent; source needs review");
  const links = new Map();
  const clean = region.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  for (const match of clean.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    // Ignore template bindings (:href, data-href) and unresolved JS expressions.
    if (!/^(?:https:\/\/|\/|\.{1,2}\/)/i.test(decode(match[1]).trim())) continue;
    const url = canonicalUrl(match[1], source.url, source.allowedHosts);
    const label = textOnly(match[2]).slice(0, 180);
    if (url && url !== source.url && label.length >= 12 && relevant(label)) links.set(url, { url, title: label });
  }
  const items = [...links.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(0, 250);
  // Hash only the matching link inventory in discovery mode, not rotating
  // banners/cookies. Page mode changes remain unverified review candidates.
  return { fingerprint: hash(source.mode === "links" ? JSON.stringify(items) : text), items, title: title.slice(0, 180), textLength: text.length };
}
export function updateSource(source, previous, result, now) {
  const base = previous?.extractorVersion === EXTRACTOR_VERSION && previous.sourceUrl === source.url ? previous : {};
  if (result.error) return { state: { ...base, id: source.id, sourceUrl: source.url, extractorVersion: EXTRACTOR_VERSION, lastAttemptAt: now, status: "error", error: result.error.slice(0, 180), failureStreak: (base.failureStreak || 0) + 1 }, events: [] };
  if (result.notModified) {
    if (!base.fingerprint) return updateSource(source, previous, { error: "304 without a saved baseline" }, now);
    return { state: { ...base, lastAttemptAt: now, lastSuccessAt: now, status: "ok", error: null, failureStreak: 0 }, events: [] };
  }
  const { fingerprint, items, title } = result;
  const changed = Boolean(base.fingerprint && base.fingerprint !== fingerprint);
  const seen = new Set(base.seenLinks || base.items?.map(item => item.url) || []);
  const candidates = base.fingerprint && source.mode === "links" ? items.filter(item => !seen.has(item.url)) : [];
  const event = (kind, url, label) => ({ id: hash(`${source.id}|${kind}|${url}|${kind === "page-change" ? fingerprint : ""}`).slice(0, 24), sourceId: source.id, themes: source.themes, owner: source.owner, kind, title: label, url, detectedAt: now, publishedAt: null, verification: "unreviewed" });
  const events = candidates.map(item => event("new-link", item.url, item.title));
  if (changed && source.mode === "page") events.push(event("page-change", source.url, `${source.name}: page content changed`));
  items.forEach(item => seen.add(item.url));
  return { state: { id: source.id, sourceUrl: source.url, extractorVersion: EXTRACTOR_VERSION, status: "ok", lastAttemptAt: now, lastSuccessAt: now, baselineAt: base.baselineAt || now,
    lastChangedAt: changed ? now : base.lastChangedAt || null, failureStreak: 0, error: null, fingerprint, items,
    seenLinks: [...seen], matchedItems: items.length, title, etag: result.etag || null, lastModified: result.lastModified || null }, events };
}
export async function fetchSource(source, previous, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 1500000 } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "User-Agent": "SignalDesk technology research monitor (public source-change checks)", Accept: "text/html,application/xhtml+xml" };
  if (previous?.fingerprint && previous.etag) headers["If-None-Match"] = previous.etag;
  if (previous?.fingerprint && previous.lastModified) headers["If-Modified-Since"] = previous.lastModified;
  let url = source.url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!canonicalUrl(url, source.url, source.allowedHosts)) throw new Error("Source or redirect host is not allowlisted");
    const response = await fetchImpl(url, { headers, signal, redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Redirect has no destination");
      url = new URL(location, url).href;
      continue;
    }
    if (response.status === 304) return { notModified: true };
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") || "")) { await response.body?.cancel(); throw new Error("Expected an HTML source page"); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Source exceeds size limit"); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.byteLength; if (length > maxBytes) throw new Error("Source exceeds size limit"); chunks.push(chunk); }
    return { ...extractSource(Buffer.concat(chunks).toString("utf8"), source), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
  }
  throw new Error("Too many redirects");
}
export async function collectTechnology(registry, previous = {}, { now = new Date().toISOString(), force = false, fetchImpl = fetch, timeoutMs } = {}) {
  const sources = { ...(previous.sources || {}) };
  const events = new Map((previous.events || []).map(e => [e.id, e]));
  let checked = 0;
  // Sequential and cadence-limited: one page per source, never per ticker.
  for (const source of registry.sources) {
    const prior = sources[source.id];
    const compatible = prior?.extractorVersion === EXTRACTOR_VERSION && prior.sourceUrl === source.url;
    if (!force && compatible && prior?.lastAttemptAt && Date.parse(now) - Date.parse(prior.lastAttemptAt) < source.intervalHours * 3600000) continue;
    let result;
    try { result = await fetchSource(source, compatible ? prior : {}, { fetchImpl, timeoutMs }); }
    catch (error) { result = { error: error.message || "Source request failed" }; }
    const update = updateSource(source, prior, result, now);
    sources[source.id] = update.state;
    for (const event of update.events) if (!events.has(event.id)) events.set(event.id, event);
    checked++;
  }
  return { schemaVersion: 1, generatedAt: checked ? now : previous.generatedAt || null, sources, events: [...events.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)) };
}
export function publicMonitor(state) {
  return { ...state, sources: Object.fromEntries(Object.entries(state.sources || {}).map(([id, { fingerprint, items, seenLinks, etag, lastModified, ...publicState }]) => [id, publicState])) };
}
