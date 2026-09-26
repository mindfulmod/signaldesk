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
  return { SOURCES, PAUSED_SOURCES, NEWS_MAX_HOURS, QUOTE_MAX_HOURS, recent, quoteState, usableNews, earningsHeadline, sourceHealth };
});
