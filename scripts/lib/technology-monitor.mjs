import { createHash } from "node:crypto";
import { fetchCommunity } from "./research-community.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const EXTRACTOR_VERSION = 4;
const decode = text => text.replace(/&#(x[\da-f]+|\d+);/gi, (_, n) => { const v = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return v > 0 && v <= 0x10ffff ? String.fromCodePoint(v) : " "; })
  .replace(/&(?:amp|quot|apos|lt|gt|nbsp|ndash|mdash|rsquo);/g, v => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—", "&rsquo;": "’" }[v]));
export function textOnly(html) {
  return decode(String(html).replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ").replace(/<!--[^]*?-->/g, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
const timestamp = value => value && Number.isFinite(Date.parse(value)) ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value).toISOString().slice(0, 10) === value ? value : null : new Date(value).toISOString()) : null;
const relevant = (value, source) => !source.terms?.length || source.terms.some(term => value.toLowerCase().includes(term.toLowerCase()));
const xmlText = (block, tag) => block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
const inventory = (items, title, extra = {}) => ({ items, title, fingerprint: hash(JSON.stringify(items)), ...extra });
export function extractFeed(xml, source) {
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(xml)) throw new Error("Expected RSS/Atom, not an HTML error page");
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
  if (!blocks.length) throw new Error("Feed has no entries; collection contract needs review");
  const items = new Map();
  let usableEntries = 0;
  for (const [, , block] of blocks) {
    const title = textOnly(xmlText(block, "title")).slice(0, 220);
    const atomLinks = [...block.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
    const alternate = atomLinks.find(tag => !/rel=["'](?:self|enclosure)["']/i.test(tag));
    const raw = xmlText(block, "link") || alternate?.match(/href=["']([^"']+)["']/i)?.[1];
    const url = canonicalUrl(textOnly(raw || ""), source.url, source.allowedHosts);
    const excerpt = textOnly(xmlText(block, "description") || xmlText(block, "summary")).slice(0, 240);
    if (!url || !title) continue;
    usableEntries++;
    if (!relevant(`${title} ${excerpt}`, source)) continue;
    const publishedAt = timestamp(textOnly(xmlText(block, "pubDate") || xmlText(block, "published") || xmlText(block, "dc:date") || xmlText(block, "updated")));
    items.set(url, { url, title, excerpt: source.metadataOnly ? "" : excerpt, publishedAt });
  }
  if (!usableEntries) throw new Error("Feed has no safe article URLs; collection contract needs review");
  return inventory([...items.values()].slice(0, 100), source.name, { extractedEntries: usableEntries });
}
export function extractFilings(json, source) {
  const data = JSON.parse(json), recent = data.filings?.recent;
  if (!recent || !Array.isArray(recent.accessionNumber) || ![recent.form, recent.primaryDocument, recent.filingDate].every(Array.isArray) || Number(data.cik) !== Number(source.cik)) throw new Error("SEC submissions identity/schema has changed");
  const items = [];
  for (let i = 0; i < recent.accessionNumber.length && items.length < 40; i++) {
    const form = recent.form[i], document = recent.primaryDocument[i], accession = recent.accessionNumber[i];
    if (!/^(10-K|10-Q|8-K|20-F|6-K|S-3|S-1)(\/A)?$/.test(form) || !document || !/^[\w.-]+$/.test(document) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${accession.replaceAll("-", "")}/${document}`;
    if (!canonicalUrl(url, source.url, source.allowedHosts)) continue;
    const filingItems = String(recent.items?.[i] || "").split(",").map(v => v.trim()).filter(Boolean);
    items.push({ url, title: `${source.owner} · ${form} · ${recent.primaryDocDescription?.[i] || "Company filing"}`, publishedAt: timestamp(recent.filingDate[i]),
      reportDate: timestamp(recent.reportDate?.[i]), acceptedAt: timestamp(recent.acceptanceDateTime?.[i]), filingItems,
      exhibitsIndexUrl: `https://www.sec.gov/Archives/edgar/data/${Number(source.cik)}/${accession.replaceAll("-", "")}/${accession}-index.html`,
      excerpt: `Company-filed disclosure${filingItems.length ? `; reported items ${filingItems.join(", ")}` : ""}. Review the filing and exhibit index; filing type alone does not establish an adoption milestone.`, form, accession });
  }
  return inventory(items, `${source.owner} SEC filings`, { extractedEntries: recent.accessionNumber.length });
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
export function articleMetadata(html, source) {
  const fields = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = tag.match(/(?:name|property)=["']([^"']+)["']/i)?.[1];
    const value = tag.match(/content=["']([^"']*)["']/i)?.[1];
    if (key && value) fields[key.toLowerCase()] = decode(value);
  }
  let publishedAt = timestamp(fields["article:published_time"] || fields.datepublished || fields.citation_publication_date || fields.citation_date);
  for (const [, body] of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(body), rows = Array.isArray(parsed) ? parsed : parsed["@graph"] || [parsed];
      for (const row of rows) if (/Article|BlogPosting|NewsArticle/.test(String(row["@type"]))) publishedAt ||= timestamp(row.datePublished);
    } catch { /* Broken structured metadata stays unknown. */ }
  }
  const paper = [...html.matchAll(/href=["'](https:\/\/arxiv\.org\/abs\/\d{4}\.\d+(?:v\d+)?)["']/gi)][0]?.[1] || null;
  return { publishedAt, announcementAt: publishedAt, excerpt: textOnly(fields.description || fields["og:description"] || "").slice(0, 400) || null,
    researchUrl: paper, researchPublishedAt: source.id === "linked-research" ? publishedAt : null };
}
export function extractSource(html, source) {
  if (source.format === "rss") return extractFeed(html, source);
  if (source.format === "sec") return extractFilings(html, source);
  const title = textOnly(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "");
  if (/just a moment|access denied|attention required|verify.*human|robot check/i.test(title)) throw new Error("Source returned an access challenge, not usable evidence");
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1];
  // Some publishers put an empty article before the real page content.
  const region = main && textOnly(main).length >= 120 ? main : source.mode === "page" && article && textOnly(article).length >= 120 ? article : html;
  const text = textOnly(region);
  if (text.length < 120) throw new Error("Source has too little readable content (possibly a client-rendered page)");
  if (source.mode === "page" && !relevant(text, source)) throw new Error("Expected technology terms are absent; source needs review");
  const links = new Map();
  let extractedEntries = 0;
  const clean = region.replace(/<(script|style|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  for (const match of clean.matchAll(/<a\b[^>]*\shref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    // Ignore template bindings (:href, data-href) and unresolved JS expressions.
    if (!/^(?:https:\/\/|\/|\.{1,2}\/)/i.test(decode(match[1]).trim())) continue;
    const url = canonicalUrl(match[1], source.url, source.allowedHosts);
    const label = textOnly(match[2]).slice(0, 180);
    if (!url || url === source.url || label.length < 12 || (source.linkPattern && !new RegExp(source.linkPattern).test(url))) continue;
    extractedEntries++;
    if (relevant(label, source)) links.set(url, { url, title: label });
  }
  const items = [...links.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(0, 250);
  // Hash only the matching link inventory in discovery mode, not rotating
  // banners/cookies. Page mode changes remain unverified review candidates.
  if (source.linkPattern && !extractedEntries) throw new Error("No article links match the source contract; layout or endpoint needs review");
  const metadata = source.mode === "page" ? articleMetadata(html, source) : {};
  return { fingerprint: hash(source.mode === "links" ? JSON.stringify(items) : text), items, title: title.slice(0, 180), textLength: text.length, extractedEntries, ...metadata, excerpt: metadata.excerpt || text.slice(0, 240) };
}
export function updateSource(source, previous, result, now) {
  const base = previous?.extractorVersion === EXTRACTOR_VERSION && previous.sourceUrl === source.url ? previous : {};
  if (result.error) return { state: { ...base, id: source.id, sourceUrl: source.url, extractorVersion: EXTRACTOR_VERSION, lastAttemptAt: now, nextAttemptAt: new Date(Date.parse(now) + Math.min(6, 2 ** (base.failureStreak || 0)) * 3600000).toISOString(), status: "error", error: result.error.slice(0, 180), failureStreak: (base.failureStreak || 0) + 1 }, events: [] };
  if (result.notModified) {
    if (!base.fingerprint) return updateSource(source, previous, { error: "304 without a saved baseline" }, now);
    return { state: { ...base, lastAttemptAt: now, lastSuccessAt: now, nextAttemptAt: null, status: "ok", error: null, failureStreak: 0 }, events: [] };
  }
  const { fingerprint, items, title } = result;
  const changed = Boolean(base.fingerprint && base.fingerprint !== fingerprint);
  const seen = new Set(base.seenLinks || base.items?.map(item => item.url) || []);
  const candidates = base.fingerprint && source.mode === "links" ? items.filter(item => !seen.has(item.url)) : [];
  const event = (kind, url, label, publishedAt = null) => ({ id: hash(`${source.id}|${kind}|${url}|${kind === "page-change" ? fingerprint : ""}`).slice(0, 24), sourceId: source.id, themes: source.themes, owner: source.owner, kind, title: label, url, detectedAt: now, publishedAt, verification: "unreviewed" });
  const events = candidates.map(item => event("new-link", item.url, item.title, item.publishedAt));
  if (changed && source.mode === "page") events.push(event("page-change", source.url, `${source.name}: page content changed`));
  items.forEach(item => seen.add(item.url));
  return { state: { id: source.id, sourceUrl: source.url, extractorVersion: EXTRACTOR_VERSION, status: "ok", lastAttemptAt: now, lastSuccessAt: now, baselineAt: base.baselineAt || now,
    lastChangedAt: changed ? now : base.lastChangedAt || null, nextAttemptAt: null, failureStreak: 0, error: null, fingerprint, items,
    seenLinks: [...seen].slice(-3000), matchedItems: items.length, datedItems: items.filter(i => i.publishedAt).length, extractedEntries: result.extractedEntries ?? items.length, newestPublicationAt: items.map(i => i.publishedAt).filter(Boolean).sort().at(-1) || null, excerpt: result.excerpt || null,
    publishedAt: result.publishedAt || null, announcementAt: result.announcementAt || null, researchUrl: result.researchUrl || null, researchPublishedAt: result.researchPublishedAt || null,
    title, etag: result.etag || null, lastModified: result.lastModified || null }, events };
}
export async function fetchSource(source, previous, { fetchImpl = fetch, timeoutMs = 15000, maxBytes = 1500000 } = {}) {
  if (source.format === "hn") return fetchCommunity(source, { fetchImpl, timeoutMs });
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "User-Agent": source.format === "sec" ? "SignalDesk/2.0 (m.aali9@gmail.com)" : "SignalDesk/2.0 (+https://mindfulmod.github.io/signaldesk/; m.aali9@gmail.com)", Accept: source.format === "sec" ? "application/json" : source.format === "rss" ? "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1" : "text/html,application/xhtml+xml" };
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
    const type = response.headers.get("content-type") || "";
    const validType = source.format === "sec" ? /json/i.test(type) : source.format === "rss" ? /xml|rss|text\/plain/i.test(type) : /text\/html|application\/xhtml\+xml/i.test(type);
    if (!validType) { await response.body?.cancel(); throw new Error(source.format ? `Unexpected ${source.format} response content type` : "Expected an HTML source page"); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new Error("Source exceeds size limit"); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.byteLength; if (length > maxBytes) throw new Error("Source exceeds size limit"); chunks.push(chunk); }
    return { ...extractSource(Buffer.concat(chunks).toString("utf8"), source), etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified") };
  }
  throw new Error("Too many redirects");
}
export const calendarDay = value => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
export function sourceDue(source, prior, now, force = false) {
  if (force || prior?.extractorVersion !== EXTRACTOR_VERSION || prior.sourceUrl !== source.url) return true;
  if (prior.status === "error") return !prior.nextAttemptAt || Date.parse(now) >= Date.parse(prior.nextAttemptAt);
  if (source.cadence === "daily" && prior.lastSuccessAt) return calendarDay(now) !== calendarDay(prior.lastSuccessAt);
  return !prior.lastAttemptAt || Date.parse(now) - Date.parse(prior.lastAttemptAt) >= source.intervalHours * 3600000;
}
export async function collectTechnology(registry, previous = {}, { now = new Date().toISOString(), force = false, retryErrors = false, fetchImpl = fetch, timeoutMs, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const ids = new Set(registry.sources.map(s => s.id));
  const sources = Object.fromEntries(Object.entries(previous.sources || {}).filter(([id]) => ids.has(id)));
  const events = new Map((previous.events || []).map(e => [e.id, e]));
  let checked = 0;
  // Sequential and cadence-limited: one page per source, never per ticker.
  for (const source of registry.sources) {
    const prior = sources[source.id];
    if (source.accessStatus === "permission-required") {
      sources[source.id] = { ...prior, id: source.id, status: "paused", accessNote: source.accessNote, error: null, nextAttemptAt: null };
      if (prior?.status !== "paused") checked++;
      continue;
    }
    const compatible = prior?.extractorVersion === EXTRACTOR_VERSION && prior.sourceUrl === source.url;
    if (!sourceDue(source, prior, now, force || (retryErrors && prior?.status === "error"))) continue;
    let result;
    try { result = await fetchSource(source, compatible ? prior : {}, { fetchImpl, timeoutMs }); }
    catch (error) {
      // Retry transport/5xx errors once. Do not hammer rate limits or access challenges.
      if (/timeout|timed out|fetch failed|HTTP 5\d\d/i.test(error.message)) {
        await sleep(1200);
        try { result = await fetchSource(source, compatible ? prior : {}, { fetchImpl, timeoutMs }); }
        catch (retry) { result = { error: retry.message || "Source retry failed" }; }
      } else result = { error: error.message || "Source request failed" };
    }
    if (source.enrichArticles && result.items) {
      let enriched = 0;
      result.items = await Promise.all([...result.items].sort((a, b) => b.url.localeCompare(a.url)).map(async item => {
        const old = prior?.items?.find(p => p.url === item.url && p.title === item.title);
        if (old?.metadataCheckedAt) return { ...old, ...item };
        if (enriched >= 3) return item;
        enriched++;
        try {
          const article = await fetchSource({ ...source, mode: "page", url: item.url, terms: [], linkPattern: null }, {}, { fetchImpl, timeoutMs });
          const enrichedItem = { ...item, publishedAt: article.publishedAt, announcementAt: article.announcementAt, excerpt: article.excerpt, researchUrl: article.researchUrl, metadataCheckedAt: now };
          if (article.researchUrl) {
            try {
              const paper = await fetchSource({ id: "linked-research", url: article.researchUrl, allowedHosts: ["arxiv.org"], mode: "page", format: "html", terms: [] }, {}, { fetchImpl, timeoutMs });
              enrichedItem.researchPublishedAt = paper.researchPublishedAt;
            } catch { enrichedItem.metadataError = "Original research date not retrieved; announcement date is not substituted"; }
          }
          return enrichedItem;
        } catch { return { ...item, metadataError: "Article metadata unavailable; source date remains unknown" }; }
      }));
      result.fingerprint = hash(JSON.stringify(result.items));
    }
    const update = updateSource(source, prior, result, now);
    sources[source.id] = update.state;
    for (const event of update.events) if (!events.has(event.id)) events.set(event.id, event);
    checked++;
  }
  return { schemaVersion: 1, generatedAt: checked ? now : previous.generatedAt || null, sources, events: [...events.values()].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)).slice(0, 400) };
}
export function publicMonitor(state) {
  return { ...state, sources: Object.fromEntries(Object.entries(state.sources || {}).map(([id, { fingerprint, items, seenLinks, etag, lastModified, ...publicState }]) => [id, publicState])) };
}
