// Shared, deterministic evidence rules. Browser global + Node import; no network.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_QUALITY = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const SOURCES = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan", "GDELT News", "Google News", "Bing News", "SEC Filings", "Yahoo Public News", "CNBC", "MarketWatch", "Press Releases", "Financial Media", "Nasdaq", "FINRA Short Volume", "Price/Volume"];
  // No matched coverage in the last ten saved daily snapshots, plus repeated
  // access failures. Retain adapters/history; re-enable only after a CI probe.
  const PAUSED_SOURCES = {
    Wallstreetbets: "Direct Reddit access repeatedly blocked. Reddit attention is still covered indirectly by ApeWisdom.",
    "Reddit Finance": "Direct Reddit access repeatedly blocked. Reddit attention is still covered indirectly by ApeWisdom.",
    Nasdaq: "Repeated API and RSS timeouts. Broad newswires and the capped Google News top-up remain active.",
  };
  const NEWS_MAX_HOURS = 72;
  const QUOTE_MAX_HOURS = 96; // tolerates weekends/long weekends; not a live quote SLA
  const GENERIC_PAGE = /\b(price to earnings|price[- ]to[- ]earnings|price prediction|should i buy|stock price forecast|forecast\s*[—:-]\s*price)\b/i;
  function recent(value, now = Date.now(), hours = NEWS_MAX_HOURS) {
    if (!value) return false;
    const time = new Date(value).getTime();
    const age = new Date(now).getTime() - time;
    return Number.isFinite(age) && age >= -300_000 && age <= hours * 3_600_000;
  }
  function quoteState(item, now = Date.now()) {
    if (item?.lastPrice == null || !Number.isFinite(Number(item.lastPrice)) || Number(item.lastPrice) <= 0) return "missing";
    return recent(item.quoteAsOf, now, QUOTE_MAX_HOURS) ? "current" : "stale";
  }
  function usableNews(entry, now = Date.now()) {
    return Boolean(entry?.title && recent(entry.published, now) && !GENERIC_PAGE.test(entry.title));
  }
  function earningsHeadline(title) {
    const text = String(title || "");
    if (GENERIC_PAGE.test(text)) return false;
    const results = /\b(earnings|eps|quarterly results|financial results|q[1-4]\s+(?:20\d{2}\s+)?results)\b/i;
    const action = /\b(reports?|reported|announces?|announced|beats?|miss(?:es|ed)?|results|raises?|raised|cuts?|cut|reaffirms?|reaffirmed)\b/i;
    const guidance = /\b(raises?|raised|cuts?|cut|reaffirms?|reaffirmed|updates?|updated|issues?|issued)\s+(?:its\s+|full[- ]year\s+|annual\s+|quarterly\s+|revenue\s+|profit\s+)*(?:guidance|outlook)\b/i;
    return (results.test(text) && action.test(text)) || guidance.test(text);
  }
  function sourceHealth(snapshot = {}, history = [], previous = []) {
    const previousByName = new Map(previous.map(row => [row.source, row]));
    // Collection computes health before truncating its human-readable failures.
    // Preserve that fuller diagnosis when the browser reads the saved payload.
    const savedByName = new Map((snapshot.sourceHealth || []).map(row => [row.source, row]));
    return SOURCES.map(source => {
      const tickers = (snapshot.signals || []).filter(item => Number(item.sources?.[source]) > 0).length;
      const warnings = (snapshot.failures || []).filter(failure => String(failure).replace(/^\d+x\s+/, "").startsWith(source + ":") || String(failure).replace(/^\d+x\s+/, "").startsWith(source + " "));
      const saved = savedByName.get(source);
      const warning = warnings[0] || (["partial", "unavailable"].includes(saved?.state) ? saved.reason || "Collection reported incomplete source coverage." : null);
      const prior = [...history].reverse().find(day => (day.signals || []).some(item => Number(item.sources?.[source]) > 0));
      const lastSeen = tickers ? snapshot.generatedAt : prior?.generatedAt || saved?.lastSeen || previousByName.get(source)?.lastSeen || null;
      const state = PAUSED_SOURCES[source] ? "paused" : tickers ? (warning ? "partial" : "covered") : warning ? "unavailable" : "no-matches";
      return { source, state, tickers, lastSeen, reason: PAUSED_SOURCES[source] || warning || (tickers ? "Matched tickers in this snapshot; not a guarantee of complete coverage." : "No matched tickers in this snapshot; this alone does not mean the feed is broken.") };
    });
  }
  const MARKET_SOURCES = ["Price/Volume", "FINRA Short Volume"];
  const number = value => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
  const clamp = value => Math.max(0, Math.min(1, value));
  const attentionTotal = sources => Object.entries(sources || {}).reduce((sum, [source, count]) => sum + (MARKET_SOURCES.includes(source) ? 0 : Math.max(0, number(count) || 0)), 0);
  function relativeVolume(value) { const n = number(value); return n !== null && n >= 0 && n <= 25 ? n : null; }
  function marketComparison({ last, previous, asOf, previousAsOf, volumes = [], split = false, basis = "unadjusted", now = Date.now() }) {
    const price = number(last), prior = number(previous), issues = [];
    const gap = (Date.parse(asOf) - Date.parse(previousAsOf)) / 86400000;
    if (!(price > 0 && prior > 0) || !(gap > 0 && gap <= 7) || !recent(asOf, now, QUOTE_MAX_HOURS)) issues.push("Missing, stale or mismatched comparison dates");
    const rawMove = price > 0 && prior > 0 ? (price / prior - 1) * 100 : null;
    // This is a quarantine, not a split detector: genuine extreme moves require
    // independent same-basis validation too. Never label the move a known split.
    if (split || (rawMove !== null && Math.abs(rawMove) >= 50)) issues.push("Corporate action or extreme move requires same-basis verification");
    const validVolumes = volumes.every(v => number(v) !== null && Number(v) >= 0) && volumes.length >= 2;
    const avg = validVolumes ? volumes.slice(0, -1).reduce((s, v) => s + Number(v), 0) / (volumes.length - 1) : 0;
    const rawRelativeVolume = avg > 0 ? Number(volumes.at(-1)) / avg : null;
    const rv = relativeVolume(rawRelativeVolume);
    if (rv === null) issues.push("Relative volume unavailable or extreme; not reset to normal");
    return { marketMetricsVersion: 2, priceMove: issues.some(x => /comparison|verification/.test(x)) ? null : rawMove,
      relativeVolume: split ? null : rv, marketQuality: issues, rawPriceMove: rawMove, rawRelativeVolume,
      marketWindow: { asOf, previousAsOf, basis, volumeSessions: Math.max(0, volumes.length - 1) } };
  }
  function normalizeSignal(item) {
    const sources = Object.fromEntries(SOURCES.map(s => [s, MARKET_SOURCES.includes(s) ? (Number(item.sources?.[s]) > 0 ? 1 : 0) : Math.max(0, number(item.sources?.[s]) || 0)]));
    const valid = item.marketMetricsVersion === 2;
    return { ...item, sources, mentions: attentionTotal(sources), activityUnit: "weighted attention (not post counts)",
      momentum: number(item.momentum), sentiment: number(item.sentiment),
      priceMove: valid ? number(item.priceMove) : null, relativeVolume: valid ? relativeVolume(item.relativeVolume) : null,
      marketQuality: valid ? item.marketQuality || [] : ["Legacy blended market measurements are unverified; awaiting a new collection"],
      description: item.profileIdentityVersion === 2 ? item.description : null,
      descriptionUrl: item.profileIdentityVersion === 2 ? item.descriptionUrl : null,
      latest: item.latest || [], topHeadline: item.topHeadline || null };
  }
  function aggregateSignals(snapshots, previousSnapshots = []) {
    const map = new Map(), previous = new Map();
    for (const daily of previousSnapshots) for (const raw of daily.signals || []) {
      const item = normalizeSignal(raw), counts = previous.get(item.ticker) || {};
      for (const s of SOURCES) counts[s] = (counts[s] || 0) + item.sources[s];
      previous.set(item.ticker, counts);
    }
    const priorCoverage = previousSnapshots.length && previousSnapshots.length === snapshots.length
      ? SOURCES.filter(s => previousSnapshots.every(d => (d.sourceHealth || []).some(h => h.source === s && ["covered", "no-matches"].includes(h.state)))) : [];
    for (const daily of [...snapshots].sort((a, b) => (a.generatedAt || a.date || "").localeCompare(b.generatedAt || b.date || ""))) {
      for (const raw of daily.signals || []) {
        const signal = normalizeSignal(raw), old = map.get(signal.ticker);
        const sources = Object.fromEntries(SOURCES.map(s => [s, (old?.sources[s] || 0) + signal.sources[s]]));
        const latest = [...(old?.latest || []), ...signal.latest];
        // Market observations are latest-in-range, never averaged by attention.
        map.set(signal.ticker, { ...signal, sources, mentions: attentionTotal(sources), latest,
          momentum: null, previousSources: previous.get(signal.ticker) || (snapshots.length === 1 ? signal.previousSources : null),
          previousCoverage: previousSnapshots.length ? priorCoverage : snapshots.length === 1 ? signal.previousCoverage || [] : [],
          marketPeriodLabel: snapshots.length > 1 ? "latest session in selected range" : "quoted session",
          attentionWindow: { start: snapshots[0]?.date, end: snapshots.at(-1)?.date } });
      }
    }
    return [...map.values()];
  }
  function scopeSignal(item, selectedSources) {
    const selected = new Set(selectedSources), sources = Object.fromEntries(SOURCES.map(s => [s, selected.has(s) ? item.sources?.[s] || 0 : 0]));
    const attentionSources = selectedSources.filter(s => !MARKET_SOURCES.includes(s) && (!PAUSED_SOURCES[s] || item.sources?.[s] > 0 || item.previousSources?.[s] > 0));
    const comparable = attentionSources.length && item.previousSources && attentionSources.every(s => item.previousCoverage?.includes(s));
    const prior = comparable ? attentionSources.reduce((sum, s) => sum + (number(item.previousSources[s]) || 0), 0) : null;
    const mentions = attentionTotal(sources);
    const latest = item.latest.filter(e => selected.has(e.source));
    const scoped = { ...item, sources, mentions, momentum: prior > 0 ? (mentions / prior - 1) * 100 : null,
      sentiment: selectedSources.length === SOURCES.length ? item.sentiment : null, latest,
      topHeadline: item.topHeadline && selected.has(item.topHeadline.source) ? item.topHeadline : latest.find(e => usableNews(e)) || null };
    if (!selected.has("Price/Volume")) Object.assign(scoped, { priceMove: null, relativeVolume: null, lastPrice: null, quoteAsOf: null, marketQuality: ["Market source excluded by filter"] });
    return scoped;
  }
  function scoreSignals(items) {
    const maximum = Math.max(1, ...items.map(i => i.mentions));
    const values = items.map(i => 30 * Math.sqrt(i.mentions / maximum) +
      (i.momentum === null ? 0 : 22 * clamp((i.momentum + 5) / 65)) +
      (i.sentiment === null ? 0 : 18 * clamp((i.sentiment + .25) / .7)) +
      (i.priceMove === null ? 0 : 12 * clamp(i.priceMove / 6)) +
      (i.relativeVolume === null ? 0 : 10 * clamp(i.relativeVolume / 2.5)) +
      8 * SOURCES.filter(s => i.sources[s] > 0).length / SOURCES.length);
    const scale = 85 / Math.max(1, ...values);
    return items.map((item, i) => ({ ...item, signalScore: values[i] * scale }));
  }
  return { SOURCES, PAUSED_SOURCES, NEWS_MAX_HOURS, QUOTE_MAX_HOURS, recent, quoteState, usableNews, earningsHeadline, sourceHealth,
    MARKET_SOURCES, number, attentionTotal, relativeVolume, marketComparison, normalizeSignal, aggregateSignals, scopeSignal, scoreSignals };
});
