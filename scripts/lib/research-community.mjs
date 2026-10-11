import { createHash } from "node:crypto";
import { boundedJson } from "./research-fetch.mjs";

// Official public API only. Never request linked article hosts or user profiles.
// A daily bounded sample is discovery coverage, not a census of developer use.
const API = "https://hacker-news.firebaseio.com/v0/";
const LISTS = [["topstories", 30], ["newstories", 20], ["showstories", 10]];
const clean = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/&#x([\da-f]+);|&#(\d+);/gi, (_, hex, dec) => {
  const n = parseInt(hex || dec, hex ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : " ";
}).replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
export function communityLink(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !u.hostname.includes(".") || /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname) || /^[\d.]+$/.test(u.hostname) || u.hostname.includes(":")) return null;
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|msockid)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
export function communityItem(item, expectedId, observedAt) {
  if (!item || item.deleted || item.dead || item.type !== "story") return null;
  if (item.id !== expectedId || !Number.isSafeInteger(item.time) || item.time <= 0 || item.time * 1000 > Date.parse(observedAt)) throw new Error("Community item identity/date mismatch");
  const title = clean(item.title).slice(0, 220);
  if (!title) return null;
  return { url: `https://news.ycombinator.com/item?id=${item.id}`, title, excerpt: "", publishedAt: new Date(item.time * 1000).toISOString(),
    dateKind: "community-submission", linkedUrl: communityLink(item.url),
    engagement: { points: count(item.score), comments: count(item.descendants), observedAt } };
}
export async function fetchCommunity(source, { fetchImpl = fetch, timeoutMs = 15000, now = new Date().toISOString() } = {}) {
  if (source.url !== `${API}topstories.json`) throw new Error("Unrecognized community API contract");
  const options = { fetchImpl: (url, init) => fetchImpl(url, { ...init, redirect: "error" }), timeoutMs, maxBytes: 150000, headers: { Accept: "application/json", "User-Agent": "SignalDesk/2.0 (+https://mindfulmod.github.io/signaldesk/)" } };
  const ids = new Set();
  for (const [list, limit] of LISTS) {
    const rows = await boundedJson(`${API}${list}.json`, options);
    if (!Array.isArray(rows) || !rows.length || rows.some(id => !Number.isSafeInteger(id) || id < 1)) throw new Error("Community story-list schema changed");
    rows.slice(0, limit).forEach(id => ids.add(id));
  }
  const queue = [...ids], items = [], errors = [];
  // Three workers, at most 60 items + three lists. Any request failure marks
  // the sample incomplete; do not turn a partial collection into momentum.
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (queue.length && !errors.length) {
      const id = queue.shift();
      try { const item = communityItem(await boundedJson(`${API}item/${id}.json`, options), id, now); if (item) items.push(item); }
      catch (error) { errors.push(error); }
    }
  }));
  if (errors.length) throw new Error(`Incomplete community sample: ${errors[0].message}`);
  if (!items.length) throw new Error("Community sample contains no usable stories");
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.url.localeCompare(b.url));
  // Engagement is an observation, never a new article version or content event.
  const fingerprint = createHash("sha256").update(JSON.stringify(items.map(({ engagement, ...item }) => item))).digest("hex");
  return { items, title: source.name, fingerprint, extractedEntries: ids.size };
}
