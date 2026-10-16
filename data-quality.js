// Shared, deterministic evidence rules. Browser global + Node import; no network.
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./company-identity.js") : root.SIGNALDESK_IDENTITY);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_QUALITY = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (identity) {
  const SOURCES = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan", "GDELT News", "Google News", "Bing News", "SEC Filings", "Yahoo Public News", "CNBC", "MarketWatch", "Press Releases", "Financial Media", "Nasdaq", "FINRA Short Volume", "Price/Volume"];
  // Source-specific pauses based on repeated saved collection failures.
  // Retain adapters/history; re-enable only after a permitted, successful probe.
  const PAUSED_SOURCES = {
    Wallstreetbets: "Direct Reddit access repeatedly blocked. Reddit attention is still covered indirectly by ApeWisdom.",
    "Reddit Finance": "Direct Reddit access repeatedly blocked. Reddit attention is still covered indirectly by ApeWisdom.",
    Nasdaq: "Repeated API and RSS timeouts. Broad newswires and the capped Google News top-up remain active.",
    "Yahoo Public News": "The broad RSS endpoint returned 404 on October 9, 12 and 13. Paused pending a working, permitted replacement; Yahoo price quotes are separate and remain active.",
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
  function marketCoverage(snapshot = {}, now = Date.now()) {
    const rows = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
    const recentQuotes = rows.filter(s => quoteState(s, now) === "current");
    // A carried-forward quote can remain useful with its original date, but
    // cannot stand in for a successful collection in this snapshot.
    const collected = recentQuotes.filter(s => s.marketMetricsVersion === 2 && Number(s.sources?.["Price/Volume"]) > 0);
    const price = s => Number.isFinite(s.priceMove), volume = s => relativeVolume(s.relativeVolume) !== null;
    return { total: rows.length, recentQuotes: recentQuotes.length, collectedQuotes: collected.length,
      retainedQuotes: recentQuotes.length - collected.length,
      staleQuotes: rows.filter(s => quoteState(s, now) === "stale").length,
      missingQuotes: rows.filter(s => quoteState(s, now) === "missing").length,
      priceComparisons: collected.filter(price).length, volumeComparisons: collected.filter(volume).length,
      completeComparisons: collected.filter(s => price(s) && volume(s)).length };
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
  // A share count × quote is not a verified issuer capitalization: share class,
  // ADR ratio, currency and corporate-action dates may differ. Only an explicit
  // provider-reported observation can enter size filters or risk calculations.
  // asOf belongs to the capitalization itself, never borrowed from a quote.
  function capitalization(item, now = Date.now()) {
    const e = item?.marketCapEvidence;
    const empty = (state, reason) => ({ marketCap: null, capTier: null, marketCapState: state, marketCapQuality: reason });
    if (item?.instrumentType && item.instrumentType !== "EQUITY") return empty("not-applicable", "Company market capitalization is not used for this instrument type; fund assets are a different measure.");
    if (!e) return empty(item?.marketCap != null || item?.unverifiedMarketCap != null ? "unverified" : "unavailable", "No attributable capitalization observation. SEC shares × price estimates are excluded; share class, ADR basis and dates may differ.");
    let url;
    try { url = new URL(e.url); } catch { /* Invalid provenance stays unknown. */ }
    if (e.version !== 1 || e.method !== "provider-reported" || e.ticker !== item?.ticker || e.instrumentType !== "EQUITY" ||
        typeof e.value !== "number" || !Number.isFinite(e.value) || e.value <= 0 ||
        typeof e.provider !== "string" || !e.provider.trim() || url?.protocol !== "https:" || url.username || url.password ||
        !Number.isFinite(Date.parse(e.asOf)) || !Number.isFinite(Date.parse(e.collectedAt)) ||
        Date.parse(e.asOf) > Date.parse(e.collectedAt) + 300_000 || Date.parse(e.collectedAt) > new Date(now).getTime() + 300_000) {
      return empty("unverified", "Capitalization provenance is incomplete or mismatched; excluded from size filters and risk calculations.");
    }
    if (e.currency !== "USD") return empty("unsupported-currency", "Capitalization is not reported in USD; no verified currency conversion is configured.");
    if (!recent(e.asOf, now, QUOTE_MAX_HOURS)) return empty("stale", "Capitalization is older than the 96-hour freshness limit or future-dated; excluded from size filters and risk calculations.");
    return { marketCap: e.value, capTier: e.value >= 500_000_000 ? "large" : "small", marketCapState: "current",
      marketCapQuality: "Provider-reported USD capitalization; not independently audited or a measure of valuation attractiveness." };
  }
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
    const rejected = [...(item.quarantinedNews || []), ...(item.latest || []), ...(item.topHeadline ? [item.topHeadline] : [])]
      .filter(entry => !identity.articleMatches(entry, item));
    const quarantinedNews = [...new Map(rejected.map(entry => [`${entry.source}|${entry.url}|${entry.title}`, entry])).values()];
    // A saved top-six list cannot reconstruct full source totals. Exclude the
    // affected source rather than subtracting an invented per-article weight.
    const excludedNewsSources = [...new Set([...(item.excludedNewsSources || []), ...quarantinedNews.map(entry => entry.source)])];
    for (const source of excludedNewsSources) sources[source] = 0;
    const valid = item.marketMetricsVersion === 2;
    return { ...item, ...capitalization(item),
      unverifiedMarketCap: item.unverifiedMarketCap ?? (!item.marketCapEvidence ? number(item.marketCap) : null),
      sources, mentions: attentionTotal(sources), activityUnit: "weighted attention (not post counts)",
      quarantinedNews, excludedNewsSources,
      currentCoverage: (item.currentCoverage || []).filter(source => !excludedNewsSources.includes(source) &&
        item.attentionObservedSources?.includes(source) && number(item.sources?.[source]) !== null && Number(item.sources[source]) >= 0),
      previousCoverage: (item.previousCoverage || []).filter(source => !excludedNewsSources.includes(source) && !(item.previousExcludedNewsSources || []).includes(source)),
      momentum: excludedNewsSources.length ? null : number(item.momentum), sentiment: excludedNewsSources.length ? null : number(item.sentiment),
      priceMove: valid ? number(item.priceMove) : null, relativeVolume: valid ? relativeVolume(item.relativeVolume) : null,
      marketQuality: valid ? item.marketQuality || [] : ["Legacy blended market measurements are unverified; awaiting a new collection"],
      description: item.profileIdentityVersion === 3 && identity.profileMatches(item.name, item.profileTitle) ? item.description : null,
      descriptionUrl: item.profileIdentityVersion === 3 && identity.profileMatches(item.name, item.profileTitle) ? item.descriptionUrl : null,
      latest: (item.latest || []).filter(entry => identity.articleMatches(entry, item)),
      topHeadline: item.topHeadline && identity.articleMatches(item.topHeadline, item) ? item.topHeadline : null };
  }
  function attentionCoverageFor(snapshot, raw) {
    if (!raw || raw.attentionMetricsVersion !== 1) return [];
    const clean = normalizeSignal(raw);
    return SOURCES.filter(source => !MARKET_SOURCES.includes(source) &&
      raw.attentionObservedSources?.includes(source) && number(raw.sources?.[source]) !== null && Number(raw.sources[source]) >= 0 &&
      !clean.excludedNewsSources.includes(source) &&
      (snapshot.sourceHealth || []).some(h => h.source === source && ["covered", "no-matches"].includes(h.state)));
  }
  function attentionWindowCoverage(snapshots, ticker) {
    if (!snapshots.length) return [];
    const coverage = snapshots.map(day => attentionCoverageFor(day, (day.signals || []).find(s => s.ticker === ticker)));
    return SOURCES.filter(source => coverage.every(list => list.includes(source)));
  }
  function attentionWindowTimes(snapshots) {
    const times = snapshots.map(s => Date.parse(s.generatedAt)).sort((a,b) => a-b);
    const days = snapshots.map(s => String(s.generatedAt || "").slice(0, 10));
    return times.length && times.every(Number.isFinite) && new Set(days).size === days.length ? times : [];
  }
  function attentionComparisonValid(comparison) {
    if (comparison?.version !== 1 || !Number.isInteger(comparison.samples) || comparison.samples < 1) return false;
    const values = [comparison.previousStart, comparison.previousEnd, comparison.currentStart, comparison.currentEnd];
    if (!values.every(value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value))) return false;
    const dates = values.map(Date.parse);
    return dates.every(Number.isFinite) && dates[0] <= dates[1] && dates[1] < dates[2] && dates[2] <= dates[3];
  }
  function attachAttentionComparison(item, snapshots, previousSnapshots) {
    const currentCoverage = attentionWindowCoverage(snapshots, item.ticker);
    const currentTimes = attentionWindowTimes(snapshots), priorTimes = attentionWindowTimes(previousSnapshots);
    const sameSpacing = currentTimes.every((t, i) => !i || Math.round((t-currentTimes[0])/86400000) === Math.round((priorTimes[i]-priorTimes[0])/86400000));
    const valid = [...snapshots, ...previousSnapshots].every(day => identity.sameIssuer(item, (day.signals || []).find(s => s.ticker === item.ticker))) && currentTimes.length === snapshots.length && priorTimes.length === previousSnapshots.length &&
      currentTimes.length > 0 && currentTimes.length === priorTimes.length && priorTimes.at(-1) < currentTimes[0] && sameSpacing;
    const priorRows = previousSnapshots.map(day => (day.signals || []).find(s => s.ticker === item.ticker));
    const prior = priorRows.filter(Boolean).map(normalizeSignal);
    return { ...item, currentCoverage,
      previousSources: prior.length ? Object.fromEntries(SOURCES.map(s => [s, prior.reduce((n,row) => n + row.sources[s], 0)])) : null,
      previousExcludedNewsSources: [...new Set(prior.flatMap(row => row.excludedNewsSources))],
      previousCoverage: valid ? attentionWindowCoverage(previousSnapshots, item.ticker) : [],
      attentionComparison: valid ? { version: 1, samples: snapshots.length,
        currentStart: new Date(currentTimes[0]).toISOString(), currentEnd: new Date(currentTimes.at(-1)).toISOString(),
        previousStart: new Date(priorTimes[0]).toISOString(), previousEnd: new Date(priorTimes.at(-1)).toISOString() } : null };
  }
  function attentionHistory(snapshots, ticker, limit = 14) {
    const ordered = [...snapshots].sort((a,b) => Date.parse(a.generatedAt)-Date.parse(b.generatedAt)).slice(-limit);
    const observations = ordered.map(day => {
      const raw = (day.signals || []).find(s => s.ticker === ticker), clean = raw ? normalizeSignal(raw) : null;
      return { date: day.date, asOf: day.generatedAt, mentions: clean ? attentionTotal(clean.sources) : null,
        sources: clean?.sources || {}, issuer: raw, coverage: attentionCoverageFor(day, raw) };
    });
    let sources = observations.at(-1)?.coverage || [], start = observations.length - 1;
    if (sources.length) for (let i = observations.length - 2; i >= 0; i--) {
      const gap = Date.parse(observations[i+1].asOf) - Date.parse(observations[i].asOf);
      const common = sources.filter(s => observations[i].coverage.includes(s));
      if (!common.length || !identity.sameIssuer(observations[i].issuer, observations[i+1].issuer) || !(gap > 0 && gap <= 96 * 3600000)) break;
      sources = common; start = i;
    }
    const series = sources.length ? observations.slice(start).map(row => ({ date: row.date,
      mentions: sources.reduce((total,source) => total + row.sources[source], 0) })) : [];
    return { observations, series, sources };
  }
  function aggregateSignals(snapshots, previousSnapshots = []) {
    const map = new Map();
    for (const daily of [...snapshots].sort((a, b) => (a.generatedAt || a.date || "").localeCompare(b.generatedAt || b.date || ""))) {
      for (const raw of daily.signals || []) {
        const signal = normalizeSignal(raw), previous = map.get(signal.ticker);
        const old = identity.sameIssuer(signal, previous) ? previous : null;
        const sources = Object.fromEntries(SOURCES.map(s => [s, (old?.sources[s] || 0) + signal.sources[s]]));
        const latest = [...(old?.latest || []), ...signal.latest];
        // Market observations are latest-in-range, never averaged by attention.
        map.set(signal.ticker, { ...signal, sources, mentions: attentionTotal(sources), latest,
          quarantinedNews: [...(old?.quarantinedNews || []), ...signal.quarantinedNews],
          excludedNewsSources: [...new Set([...(old?.excludedNewsSources || []), ...signal.excludedNewsSources])],
          momentum: null,
          marketPeriodLabel: snapshots.length > 1 ? "latest session in selected range" : "quoted session",
          attentionWindow: { start: snapshots[0]?.date, end: snapshots.at(-1)?.date } });
      }
    }
    return [...map.values()].map(item => normalizeSignal(previousSnapshots.length || snapshots.length !== 1
      ? attachAttentionComparison(item, snapshots, previousSnapshots)
      : { ...item, currentCoverage: attentionWindowCoverage(snapshots, item.ticker),
        attentionComparison: item.attentionComparison?.samples === 1 &&
          Date.parse(item.attentionComparison.currentEnd) === Date.parse(snapshots[0].generatedAt) ? item.attentionComparison : null }));
  }
  function scopeSignal(item, selectedSources) {
    const selected = new Set(selectedSources), sources = Object.fromEntries(SOURCES.map(s => [s, selected.has(s) ? item.sources?.[s] || 0 : 0]));
    const attentionSources = selectedSources.filter(s => !MARKET_SOURCES.includes(s) && (!PAUSED_SOURCES[s] || item.sources?.[s] > 0 || item.previousSources?.[s] > 0));
    const comparable = item.attentionMetricsVersion === 1 && attentionComparisonValid(item.attentionComparison) && attentionSources.length && item.previousSources &&
      attentionSources.every(s => item.currentCoverage?.includes(s) && item.previousCoverage?.includes(s) &&
        number(item.previousSources[s]) !== null && Number(item.previousSources[s]) >= 0 &&
        !item.excludedNewsSources?.includes(s) && !item.previousExcludedNewsSources?.includes(s));
    const prior = comparable ? attentionSources.reduce((sum, s) => sum + (number(item.previousSources[s]) || 0), 0) : null;
    const mentions = attentionTotal(sources);
    const latest = item.latest.filter(e => selected.has(e.source));
    const scoped = { ...item, sources, mentions, momentum: prior > 0 ? (mentions / prior - 1) * 100 : null,
      attentionComparisonNote: !comparable ? "No like-for-like source observations in both saved windows; missing or excluded coverage is not zero."
        : prior === 0 ? "Prior observed activity was zero; a percentage change is undefined."
        : "Change in sampled weighted activity, not unique posts, total public attention or adoption. Collection windows may overlap.",
      sentiment: selectedSources.length === SOURCES.length ? item.sentiment : null, latest,
      topHeadline: item.topHeadline && selected.has(item.topHeadline.source) ? item.topHeadline : latest.find(e => identity.NEWS_SOURCES.has(e.source) && usableNews(e)) || null };
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
  return { articleMatches: identity.articleMatches, SOURCES, PAUSED_SOURCES, NEWS_MAX_HOURS, QUOTE_MAX_HOURS, recent, quoteState, marketCoverage, usableNews, earningsHeadline, sourceHealth,
    MARKET_SOURCES, number, attentionTotal, relativeVolume, capitalization, marketComparison, normalizeSignal,
    attentionCoverageFor, attentionWindowCoverage, attentionComparisonValid, attachAttentionComparison, attentionHistory, aggregateSignals, scopeSignal, scoreSignals };
});
