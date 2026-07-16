const SOURCES = [
  "Wallstreetbets",
  "Reddit Finance",
  "StockTwits",
  "ApeWisdom",
  "Hacker News",
  "4chan",
  "GDELT News",
  "Google News",
  "Bing News",
  "SEC Filings",
  "Yahoo Public News",
  "CNBC",
  "MarketWatch",
  "FINRA Short Volume",
  "Price/Volume",
];

// Source hues tuned for legibility on the dark terminal theme.
const SOURCE_COLORS = {
  Wallstreetbets: "#ff6b74",
  "Reddit Finance": "#d98a5b",
  StockTwits: "#3cc6e8",
  ApeWisdom: "#e0a84a",
  "Hacker News": "#ff8a3d",
  "4chan": "#86b06a",
  "GDELT News": "#2bd4d6",
  "Google News": "#6ba8ff",
  "Bing News": "#a98be0",
  "SEC Filings": "#9bb6a8",
  "Yahoo Public News": "#e0b94a",
  CNBC: "#5fb0d6",
  MarketWatch: "#6fcf97",
  "FINRA Short Volume": "#d98a5b",
  "Price/Volume": "#7c9aff",
};

const DISCOVERY_SOCIAL_SOURCES = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan"];
const DISCOVERY_NEWS_SOURCES = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch"];
const DISCOVERY_CATALYST_SOURCES = [...DISCOVERY_NEWS_SOURCES, "SEC Filings"];
const DISCOVERY_MARKET_SOURCES = ["FINRA Short Volume", "Price/Volume"];

// Mirrors scripts/update-data.mjs's headlineQualityScore/rankHeadlines. Range
// aggregation here concatenates each day's already-ranked `latest` list, so
// re-ranking after the merge keeps a real headline from an older day from
// getting pushed out of the top 6 by a newer day's synthetic activity string.
const IMPACT_WORDS_RE = /\b(surge|surges|surged|soar|soars|plunge|plunges|plunged|tumble|tumbles|sink|sinks|slump|jump|jumps|jumped|rally|rallies|crash|crashes|spike|spikes|drop|drops|dropped|fall|falls|fell|slide|slides|rise|rises|rose|gain|gains|gained|beat|beats|miss|misses|cut|cuts|raise|raises|raised|hike|hikes|warn|warns|warned|guidance|earnings|upgrade|downgrade|spook|spooks|spooked|%)\b/i;
const CATALYST_WORDS_RE =
  /\b(acquire|acquires|acquired|acquiring|acquisition|merger|merges|merged|buyout|takeover|divest|divestiture|spinoff|spin-off|bankruptcy|delisting|activist|antitrust|lawsuit|settlement|investigation|recall|breach)\b/i;
const SYNTHETIC_TITLE_PATTERNS = [/social mentions on ApeWisdom/i, /^Trending on StockTwits/i, /FINRA short volume/i, /,\s*price\s+[+-]?\d/i];
const NEWS_ARTICLE_SOURCES = new Set(["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings"]);
function headlineQualityScore(entry) {
  const title = entry?.title || "";
  if (!title) return -1;
  if (SYNTHETIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return 0;
  let score = 1;
  if (CATALYST_WORDS_RE.test(title)) score += 3;
  else if (IMPACT_WORDS_RE.test(title)) score += 2;
  return score;
}
function rankHeadlines(entries) {
  return [...entries].sort((a, b) => {
    const scoreDiff = headlineQualityScore(b) - headlineQualityScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.published || 0) - new Date(a.published || 0);
  });
}
// Prefer a real published article/filing; fall back to social commentary
// only when it clearly matches catalyst/impact vocabulary, tagged
// isNewsArticle: false so the UI can label it as chatter, not reporting.
function pickTopHeadline(rankedItems) {
  const newsItem = rankedItems.find((entry) => NEWS_ARTICLE_SOURCES.has(entry.source) && headlineQualityScore(entry) >= 1);
  if (newsItem) return { ...newsItem, isNewsArticle: true };
  const socialItem = rankedItems.find((entry) => headlineQualityScore(entry) >= 2);
  return socialItem ? { ...socialItem, isNewsArticle: false } : null;
}


let snapshot = null;
let history = null;
let selectedTicker = "";
let rankMode = "signal";
let capFilter = "all"; // "all" | "large" | "small"
let attentionFilter = "all"; // "all" | "quiet" | "attention"
let attentionHighThreshold = Infinity; // peer-relative cutoff, recomputed each render
let rangeStart = ""; // ISO date; empty = all available snapshots
let rangeEnd = "";
let watchlist = new Set(); // starred tickers, persisted to localStorage
let watchlistFilter = false; // when true, show only starred tickers

const WATCHLIST_KEY = "signaldesk:watchlist";

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map((t) => String(t).toUpperCase()) : []);
  } catch {
    return new Set();
  }
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist]));
  } catch {
    /* private mode / storage disabled — watchlist stays in-memory for the session */
  }
}

function toggleWatch(ticker) {
  if (!ticker) return;
  if (watchlist.has(ticker)) watchlist.delete(ticker);
  else watchlist.add(ticker);
  saveWatchlist();
  render();
}

function bindStars(root) {
  root.querySelectorAll("[data-star]").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleWatch(btn.dataset.star);
    });
  });
}

function starButton(ticker) {
  const on = watchlist.has(ticker);
  return `<button type="button" class="star-btn${on ? " on" : ""}" data-star="${ticker}" aria-pressed="${on}" aria-label="${on ? "Remove" : "Add"} ${escapeHtml(ticker)} ${on ? "from" : "to"} watchlist" title="${on ? "Remove from" : "Add to"} watchlist">${on ? "★" : "☆"}</button>`;
}

const LARGE_CAP_MIN = 500_000_000; // large cap: >= $500M
const SMALL_CAP_MAX = 500_000_000; // small cap:  < $500M
// Relative-volume values above this are almost always a data artifact (thin name
// divided by a near-zero average), so we treat them as unknown rather than a signal.
// Genuine single-day surges top out around 10-20x; anything past ~25x is noise.
const MAX_PLAUSIBLE_REL_VOL = 25;

function sanitizeRelVol(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || num > MAX_PLAUSIBLE_REL_VOL) return 1;
  return num;
}

const byId = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat("en-US");
const shortFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

function getState() {
  return {
    start: rangeStart,
    end: rangeEnd,
    sources: [...document.querySelectorAll('input[name="source"]:checked')].map((input) => input.value),
    query: byId("tickerSearch").value.trim().toUpperCase(),
  };
}

async function loadSnapshot(force = false) {
  const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
  if (canFetchJson || force) {
    try {
      const response = await fetch(`data/signals.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("No real data snapshot found.");
      snapshot = await response.json();
      await loadHistory(force);
      return snapshot?.dataMode === "real-public-no-key";
    } catch {
      snapshot = null;
      history = null;
    }
  }

  if (window.SIGNALDESK_DATA?.dataMode === "real-public-no-key") {
    snapshot = window.SIGNALDESK_DATA;
    await loadHistory(force);
    return true;
  }

  return false;
}

async function loadHistory(force = false) {
  const canFetchJson = location.protocol === "http:" || location.protocol === "https:";
  if (canFetchJson || force) {
    try {
      const response = await fetch(`data/history.json?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("No history found.");
      const data = await response.json();
      history = data?.dataMode === "real-public-no-key-history" ? data : null;
      return Boolean(history);
    } catch {
      history = null;
    }
  }

  if (window.SIGNALDESK_HISTORY?.dataMode === "real-public-no-key-history") {
    history = window.SIGNALDESK_HISTORY;
    return true;
  }

  return false;
}

function currentSnapshotEntry() {
  if (!snapshot?.signals?.length) return null;
  return {
    date: (snapshot.generatedAt || new Date().toISOString()).slice(0, 10),
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    signals: snapshot.signals,
    events: snapshot.events || [],
    failures: snapshot.failures || [],
  };
}

function historySnapshots() {
  const snapshots = Array.isArray(history?.snapshots) ? history.snapshots.filter((item) => item?.signals?.length) : [];
  if (snapshots.length) return snapshots;
  const current = currentSnapshotEntry();
  return current ? [current] : [];
}

// ---- Tier 1: per-ticker history, rank deltas, sparklines ----
// All of these read the full daily snapshot history (independent of the active
// date-range filter) so the trend story is consistent regardless of what slice
// the user is viewing. The tracked universe churns day to day, so most tickers
// have a single data point until they recur — these helpers degrade to "no
// trend yet" / "NEW" rather than inventing continuity.
function tickerHistory(ticker) {
  return historySnapshots()
    .map((snap) => {
      const s = (snap.signals || []).find((x) => x.ticker === ticker);
      return s ? { date: snap.date, mentions: Number(s.mentions) || 0, signalScore: Number(s.signalScore) || 0 } : null;
    })
    .filter(Boolean);
}

// Rank of every ticker in the snapshot immediately before the latest one,
// ranked by the same metric the user is currently sorting by, so the delta the
// row shows always matches the visible ordering. Returns null when there is no
// prior snapshot to compare against.
function previousRankMap() {
  const snaps = historySnapshots();
  if (snaps.length < 2) return null;
  const prev = snaps[snaps.length - 2];
  const sorted = [...(prev.signals || [])].sort((a, b) => {
    if (rankMode === "mentions") return (Number(b.mentions) || 0) - (Number(a.mentions) || 0);
    if (rankMode === "momentum") return (Number(b.momentum) || 0) - (Number(a.momentum) || 0);
    return discoveryProfile(b).score - discoveryProfile(a).score;
  });
  const map = new Map();
  sorted.forEach((s, i) => map.set(s.ticker, i + 1));
  return map;
}

// Tiny inline SVG trend line. Fixed-size (1:1 viewBox) for table rows so the
// end-dot stays circular; `fluid` stretches to its container for the detail
// panel. Returns "" for fewer than two points so callers can fall back.
function sparkline(values, { w = 66, h = 22, pad = 2, fluid = false } = {}) {
  if (!Array.isArray(values) || values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  const pts = values.map((v, i) => [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${last[0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  const up = values[values.length - 1] >= values[0];
  const par = fluid ? ' preserveAspectRatio="none"' : "";
  const dot = fluid ? "" : `<circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="1.8"/>`;
  return `<svg class="spark ${up ? "up" : "down"}${fluid ? " spark-fluid" : ""}" viewBox="0 0 ${w} ${h}"${par} aria-hidden="true"><path class="spark-area" d="${area}"/><path class="spark-line" d="${line}"/>${dot}</svg>`;
}

// Rank movement vs the prior snapshot: ▲/▼ with magnitude, a flat dot for no
// change, or "NEW" for a first appearance. Empty until there's history to diff.
function rankBadge(ticker, currentRank, prevRanks) {
  if (!prevRanks) return "";
  const prev = prevRanks.get(ticker);
  if (prev == null) return `<span class="rank-delta new">NEW</span>`;
  const diff = prev - currentRank; // positive = moved up the board
  if (diff === 0) return `<span class="rank-delta flat" title="Unchanged vs prior snapshot">●</span>`;
  const up = diff > 0;
  return `<span class="rank-delta ${up ? "up" : "down"}" title="${up ? "Up" : "Down"} ${Math.abs(diff)} vs prior snapshot">${up ? "▲" : "▼"}${Math.abs(diff)}</span>`;
}

function detailTrendMarkup(item) {
  const hist = tickerHistory(item.ticker);
  if (hist.length < 2) {
    return `
    <div class="detail-section trend-section">
      <h3>Attention trend</h3>
      <p class="muted-note">First appearance in the tracked window — a trend line builds as ${escapeHtml(item.ticker)} recurs across daily snapshots.</p>
    </div>`;
  }
  const mentions = hist.map((h) => h.mentions);
  const first = mentions[0];
  const last = mentions[mentions.length - 1];
  const pct = first ? ((last - first) / first) * 100 : 0;
  const dir = last >= first ? "up" : "down";
  return `
    <div class="detail-section trend-section">
      <h3>Attention trend <span class="trend-span">${hist.length}-day</span></h3>
      <div class="trend-spark">${sparkline(mentions, { w: 300, h: 56, pad: 3, fluid: true })}</div>
      <p class="trend-foot"><span class="momentum ${dir}">${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%</span> mentions, ${shortFmt.format(first)} → ${shortFmt.format(last)} over ${hist.length} snapshots.</p>
    </div>`;
}

function selectedRangeSnapshots() {
  const state = getState();
  const start = state.start || "0000-01-01";
  const end = state.end || "9999-12-31";
  const snapshots = historySnapshots().filter((item) => item.date >= start && item.date <= end);
  if (snapshots.length) return snapshots;
  const current = currentSnapshotEntry();
  return current ? [current] : [];
}

function previousRangeSnapshots() {
  const state = getState();
  if (!state.start || !state.end) return [];
  const start = new Date(`${state.start}T00:00:00`);
  const end = new Date(`${state.end}T00:00:00`);
  const spanDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(start.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousEnd.getDate() - spanDays + 1);
  const startKey = isoDate(previousStart);
  const endKey = isoDate(previousEnd);
  return historySnapshots().filter((item) => item.date >= startKey && item.date <= endKey);
}

function realSignals(snapshots = selectedRangeSnapshots(), previousSnapshots = previousRangeSnapshots()) {
  if (snapshots.length > 1 || previousSnapshots.length) {
    return aggregateSnapshotSignals(snapshots, previousSnapshots);
  }
  if (!snapshot?.signals?.length) return [];

  const items = snapshot.signals.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    mentions: Number(item.mentions) || 0,
    momentum: Number(item.momentum) || 0,
    sentiment: Number(item.sentiment) || 0,
    lastPrice: Number.isFinite(Number(item.lastPrice)) ? Number(item.lastPrice) : null,
    quoteAsOf: item.quoteAsOf || null,
    quoteSource: item.quoteSource || null,
    priceMove: Number(item.priceMove) || 0,
    relativeVolume: sanitizeRelVol(item.relativeVolume),
    marketCap: Number.isFinite(Number(item.marketCap)) ? Number(item.marketCap) : null,
    capTier: item.capTier || capTierFor(Number(item.marketCap)),
    description: item.description || null,
    descriptionUrl: item.descriptionUrl || null,
    sector: item.sector || null,
    industry: item.industry || null,
    optionsActivity: Number(item.optionsActivity) || 0,
    sources: Object.fromEntries(SOURCES.map((source) => [source, Number(item.sources?.[source]) || 0])),
    topHeadline: item.topHeadline || null,
    latest: item.latest || [],
  }));

  // Re-compute signalScore peer-relatively so rankings spread across a useful range
  // even when some sources (WSB, Reddit) are blocked and momentum has no prior snapshot.
  const maxMentions = Math.max(1, ...items.map((item) => item.mentions));
  const rawScores = items.map((item) =>
    30 * Math.sqrt(item.mentions / maxMentions) +
    22 * clamp(0, 1, item.momentum / 80 + 0.25) +
    18 * clamp(0, 1, (item.sentiment + 0.25) / 0.7) +
    12 * clamp(0, 1, item.priceMove / 6) +
    10 * clamp(0, 1, item.relativeVolume / 2.5) +
    8 * (SOURCES.filter((source) => item.sources[source] > 0).length / SOURCES.length)
  );
  // Scale so the top scorer reaches 85, preserving relative differences.
  const maxRaw = Math.max(1, ...rawScores);
  const scale = 85 / maxRaw;
  return items.map((item, i) => ({ ...item, signalScore: clamp(0, 100, rawScores[i] * scale) }));
}

function aggregateSnapshotSignals(snapshots, previousSnapshots = []) {
  const previousMentions = aggregateMentionTotals(previousSnapshots);
  const map = new Map();

  snapshots.forEach((daily) => {
    (daily.signals || []).forEach((signal) => {
      const mentions = Number(signal.mentions) || 0;
      const item =
        map.get(signal.ticker) ||
        {
          ticker: signal.ticker,
          name: signal.name,
          mentions: 0,
          weightedSentiment: 0,
          weightedPrice: 0,
          weightedVolume: 0,
          lastPrice: null,
          quoteAsOf: null,
          quoteSource: null,
          marketCap: null,
          capTier: null,
          description: null,
          descriptionUrl: null,
          sector: null,
          industry: null,
          latestGeneratedAt: "",
          sources: Object.fromEntries(SOURCES.map((source) => [source, 0])),
          latest: [],
        };

      item.mentions += mentions;
      item.weightedSentiment += (Number(signal.sentiment) || 0) * mentions;
      item.weightedPrice += (Number(signal.priceMove) || 0) * mentions;
      item.weightedVolume += sanitizeRelVol(signal.relativeVolume) * mentions;
      SOURCES.forEach((source) => {
        item.sources[source] += Number(signal.sources?.[source]) || 0;
      });
      if ((daily.generatedAt || "") >= item.latestGeneratedAt && Number.isFinite(Number(signal.lastPrice))) {
        item.lastPrice = Number(signal.lastPrice);
        item.quoteAsOf = signal.quoteAsOf || null;
        item.quoteSource = signal.quoteSource || null;
        item.marketCap = Number.isFinite(Number(signal.marketCap)) ? Number(signal.marketCap) : item.marketCap;
        item.capTier = signal.capTier || capTierFor(Number(signal.marketCap)) || item.capTier;
        item.latestGeneratedAt = daily.generatedAt || "";
      }
      // Profile fields are static per ticker; keep the first non-empty value seen.
      if (!item.description && signal.description) {
        item.description = signal.description;
        item.descriptionUrl = signal.descriptionUrl || null;
      }
      if (!item.sector && signal.sector) item.sector = signal.sector;
      if (!item.industry && signal.industry) item.industry = signal.industry;
      item.latest.push(...(signal.latest || []).map((entry) => ({ ...entry, date: daily.date })));
      map.set(signal.ticker, item);
    });
  });

  const maxMentions = Math.max(1, ...[...map.values()].map((item) => item.mentions));
  return [...map.values()]
    .map((item) => {
      const prev = previousMentions.get(item.ticker) || 0;
      const momentum = prev ? ((item.mentions - prev) / prev) * 100 : snapshots.length > 1 ? 0 : item.mentions > 2 ? 35 : 0;
      const sentiment = item.mentions ? item.weightedSentiment / item.mentions : 0;
      const priceMove = item.mentions ? item.weightedPrice / item.mentions : 0;
      const relativeVolume = item.mentions ? item.weightedVolume / item.mentions : 1;
      const sourceBreadth = SOURCES.filter((source) => item.sources[source] > 0).length / SOURCES.length;
      const signalScore = clamp(
        0,
        100,
        30 * Math.sqrt(item.mentions / maxMentions) +
          22 * clamp(0, 1, momentum / 80 + 0.25) +
          18 * clamp(0, 1, (sentiment + 0.25) / 0.7) +
          12 * clamp(0, 1, priceMove / 6) +
          10 * clamp(0, 1, relativeVolume / 2.5) +
          8 * sourceBreadth
      );
      return {
        ticker: item.ticker,
        name: item.name,
        mentions: item.mentions,
        momentum,
        sentiment,
        priceMove,
        lastPrice: item.lastPrice,
        quoteAsOf: item.quoteAsOf,
        quoteSource: item.quoteSource,
        marketCap: item.marketCap,
        capTier: item.capTier,
        description: item.description,
        descriptionUrl: item.descriptionUrl,
        sector: item.sector,
        industry: item.industry,
        relativeVolume,
        optionsActivity: 0,
        signalScore,
        sources: item.sources,
        topHeadline: pickTopHeadline(rankHeadlines(item.latest)),
        latest: rankHeadlines(item.latest).slice(0, 6),
      };
    })
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 55);
}

function aggregateMentionTotals(snapshots) {
  const totals = new Map();
  snapshots.forEach((daily) => {
    (daily.signals || []).forEach((signal) => {
      totals.set(signal.ticker, (totals.get(signal.ticker) || 0) + (Number(signal.mentions) || 0));
    });
  });
  return totals;
}

function filteredSignals() {
  const state = getState();
  const base = realSignals()
    .map((item) => ({
      ...item,
      mentions: state.sources.reduce((sum, source) => sum + (item.sources[source] || 0), 0),
    }))
    .filter((item) => item.mentions > 0)
    .filter((item) => (!state.query ? true : `${item.ticker} ${item.name}`.toUpperCase().includes(state.query)));

  // Recompute signalScore peer-relatively based on the active source selection,
  // so rankings reflect only what the user has checked.
  const maxMentions = Math.max(1, ...base.map((item) => item.mentions));
  const rawScores = base.map((item) => {
    const activeBreadth = state.sources.filter((source) => (item.sources[source] || 0) > 0).length / SOURCES.length;
    return (
      30 * Math.sqrt(item.mentions / maxMentions) +
      22 * clamp(0, 1, item.momentum / 80 + 0.25) +
      18 * clamp(0, 1, (item.sentiment + 0.25) / 0.7) +
      12 * clamp(0, 1, item.priceMove / 6) +
      10 * clamp(0, 1, item.relativeVolume / 2.5) +
      8 * activeBreadth
    );
  });
  const maxRaw = Math.max(1, ...rawScores);
  const scale = 85 / maxRaw;
  const signals = base.map((item, i) => ({ ...item, signalScore: clamp(0, 100, rawScores[i] * scale) }));

  return signals.map((item) => ({ ...item, discovery: discoveryProfile(item) })).sort(sortForMode);
}

function capTierFor(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;
  return marketCap >= LARGE_CAP_MIN ? "large" : "small";
}

function applyCapFilter(items) {
  if (capFilter === "all") return items;
  return items.filter((item) => {
    const tier = item.capTier || capTierFor(item.marketCap);
    return tier === capFilter;
  });
}

function applyAttentionFilter(items) {
  if (attentionFilter === "all") return items;
  return items.filter((item) => attentionGroupFor(item) === attentionFilter);
}

function applyWatchlistFilter(items) {
  if (!watchlistFilter) return items;
  return items.filter((item) => watchlist.has(item.ticker));
}

function sortForMode(a, b) {
  if (rankMode === "mentions") return b.mentions - a.mentions;
  if (rankMode === "momentum") return b.momentum - a.momentum;
  return (b.discovery || discoveryProfile(b)).score - (a.discovery || discoveryProfile(a)).score;
}

function render() {
  if (!snapshot?.signals?.length) {
    renderEmptyState();
    return;
  }

  const state = getState();
  if (!state.sources.length) {
    document.querySelector('input[name="source"]').checked = true;
    state.sources = [SOURCES[0]];
  }

  const items = filteredSignals();
  attentionHighThreshold = computeAttentionThreshold(items);
  const ranked = applyWatchlistFilter(applyAttentionFilter(applyCapFilter(items)));
  const top50 = ranked.slice(0, 50);
  // Keep the current selection if it exists anywhere in the filtered set (so a
  // deep-linked or starred ticker ranked beyond #50 still drives the detail
  // panel); otherwise fall back to the top visible row.
  if (!selectedTicker || !items.some((item) => item.ticker === selectedTicker)) {
    selectedTicker = top50[0]?.ticker || "";
  }

  updateStatus();
  updateRangeNote();
  renderBuyCandidates(items);
  renderTable(top50);
  renderMovers(ranked);
  renderDetail(items, top50);
  updateUrl();
}

function renderEmptyState() {
  if (snapshot?.dataMode === "real-public-no-key") {
    setDataStatus(`No signals in snapshot · ${formatDateTime(snapshot.generatedAt)}`);
  } else {
    setDataStatus("No public snapshot available");
  }
  byId("rankingBody").innerHTML = "";
  byId("buyCandidates").innerHTML = "";
  byId("moversBoard").innerHTML = `<p class="muted-note">No signals in this snapshot yet.</p>`;
  const warnings = snapshot?.failures?.length
    ? `<p class="muted-note">Most recent refresh warnings: ${snapshot.failures.slice(0, 4).join(" | ")}${snapshot.failures.length > 4 ? " | …" : ""}</p>`
    : "";
  byId("detailPanel").innerHTML = `
    <div class="selected-stock">
      <span id="selectedRank">No data</span>
      <h2 id="selectedTicker">-</h2>
      <p id="selectedName">No generated or dummy fallback data is shown — the dashboard stays empty until the next successful refresh.</p>
    </div>${warnings}`;
}

function sourceTotal(item, sources) {
  return sources.reduce((sum, source) => sum + (Number(item.sources?.[source]) || 0), 0);
}

// The discovery score is deliberately not a return forecast. It rewards attention
// that is early, independently corroborated, and confirmed by the market, then
// subtracts visible crowding and data-quality risks. This keeps a parabolic one-
// source move from automatically becoming the site's top "opportunity."
function discoveryProfile(item) {
  const social = sourceTotal(item, DISCOVERY_SOCIAL_SOURCES);
  const catalyst = sourceTotal(item, DISCOVERY_CATALYST_SOURCES);
  const market = sourceTotal(item, DISCOVERY_MARKET_SOURCES);
  const allSources = [...new Set([...DISCOVERY_SOCIAL_SOURCES, ...DISCOVERY_CATALYST_SOURCES, ...DISCOVERY_MARKET_SOURCES])];
  const activeSources = allSources.filter((source) => (item.sources?.[source] || 0) > 0);
  const catalystSources = DISCOVERY_CATALYST_SOURCES.filter((source) => (item.sources?.[source] || 0) > 0);
  const activeGroups = [social > 0, catalyst > 0, market > 0].filter(Boolean).length;
  const total = Math.max(1, activeSources.reduce((sum, source) => sum + (Number(item.sources?.[source]) || 0), 0));
  const concentration = activeSources.length
    ? Math.max(...activeSources.map((source) => Number(item.sources?.[source]) || 0)) / total
    : 1;

  const attention = clamp(0, 1, (Number(item.signalScore) || 0) / 85);
  const acceleration = item.momentum === 0 ? 0.35 : clamp(0, 1, (Number(item.momentum) + 5) / 65);
  const breadth = 0.65 * (activeGroups / 3) + 0.35 * clamp(0, 1, activeSources.length / 6);
  const priceConfirmation = clamp(0, 1, (Number(item.priceMove) + 0.5) / 6.5);
  const volumeConfirmation = clamp(0, 1, (Number(item.relativeVolume) - 1) / 2.5);
  const confirmation = 0.55 * priceConfirmation + 0.45 * volumeConfirmation;
  const catalystEvidence = clamp(0, 1, catalystSources.length / 3 + ((item.sources?.["SEC Filings"] || 0) > 0 ? 0.2 : 0));

  let penalty = 0;
  const risks = [];
  if (item.priceMove >= 12) {
    penalty += Math.min(25, (item.priceMove - 12) * 1.1 + 5);
    risks.push("Extended move");
  }
  if (item.relativeVolume >= 8) {
    penalty += Math.min(8, (item.relativeVolume - 8) * 0.8 + 2);
    risks.push("Extreme volume");
  }
  if (concentration >= 0.75) {
    penalty += Math.min(8, (concentration - 0.75) * 28 + 2);
    risks.push("One-source heavy");
  }
  if (Number.isFinite(item.marketCap) && item.marketCap > 0 && item.marketCap < 100_000_000) {
    penalty += item.marketCap < 25_000_000 ? 8 : 5;
    risks.push("Micro-cap volatility");
  }
  if (social > 0 && catalyst === 0) {
    if (item.priceMove >= 5) penalty += 6;
    risks.push("No verified catalyst");
  }
  if (activeGroups <= 1) {
    penalty += 10;
    risks.push("Thin evidence");
  }
  if (item.priceMove <= -3) {
    penalty += 6;
    risks.push("Price not confirming");
  }

  const raw = 100 * (0.14 * attention + 0.22 * acceleration + 0.2 * breadth + 0.22 * confirmation + 0.22 * catalystEvidence);
  const score = Math.round(clamp(0, 100, raw - penalty));
  const crowdAttention = social + catalyst;

  let stage = "Watching";
  let tone = "watch";
  if (item.priceMove >= 12 || (item.relativeVolume >= 8 && crowdAttention >= 3)) {
    stage = "Crowded";
    tone = "crowded";
  } else if (item.momentum <= -15 || item.priceMove <= -3) {
    stage = "Cooling";
    tone = "cooling";
  } else if (catalyst > 0 && item.priceMove > 0 && item.relativeVolume >= 1.2) {
    stage = "Confirmed";
    tone = "confirmed";
  } else if (item.relativeVolume >= 1.2 && crowdAttention < 5 && item.priceMove < 6) {
    stage = "Early ignition";
    tone = "early";
  } else if (item.momentum >= 15 || crowdAttention >= 5) {
    stage = "Building";
    tone = "building";
  }

  let evidence = "Thin evidence";
  if (catalystSources.length >= 2 && activeGroups === 3) evidence = "Strong evidence";
  else if (catalystSources.length >= 1 && activeGroups >= 2) evidence = "Corroborated";
  else if (activeGroups >= 2) evidence = "Developing";

  const reasons = [];
  if (catalystSources.length) reasons.push(`${catalystSources.length} catalyst source${catalystSources.length === 1 ? "" : "s"}`);
  if (activeGroups >= 2) reasons.push(`${activeGroups}/3 evidence groups active`);
  if (item.momentum >= 15) reasons.push(`Attention +${item.momentum.toFixed(0)}% vs prior`);
  if (item.relativeVolume >= 1.2) reasons.push(`${item.relativeVolume.toFixed(1)}× relative volume`);
  if (item.priceMove > 0 && item.priceMove < 12) reasons.push(`Price confirming +${item.priceMove.toFixed(1)}%`);
  if (!reasons.length) reasons.push("Monitoring for a second confirming signal");

  const move = `${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}%`;
  let summary = "Attention is present, but the setup still needs stronger independent confirmation.";
  if (tone === "early") summary = `Unusual participation is appearing before broad attention. Watch for a credible catalyst and continued price confirmation.`;
  if (tone === "confirmed") summary = `A public catalyst and market participation align. The next question is whether attention continues without the move becoming extended.`;
  if (tone === "building") summary = `Attention is building across the tracked channels. Evidence is improving, but the move is not fully confirmed yet.`;
  if (tone === "crowded") summary = `The ${move} move is already attention-grabbing. Treat this as crowding risk, not an invitation to chase.`;
  if (tone === "cooling") summary = `Attention remains visible, but price or mention momentum is cooling. Wait for the signal to repair before prioritizing it.`;

  return {
    score,
    stage,
    tone,
    evidence,
    summary,
    reasons: reasons.slice(0, 3),
    risks: [...new Set(risks)].slice(0, 3),
    activeSources: activeSources.length,
    activeGroups,
    concentration,
    catalystSources: catalystSources.length,
  };
}

function renderBuyCandidates(items) {
  const scored = [...items]
    .map((item) => ({ ...item, discovery: item.discovery || discoveryProfile(item) }))
    .filter((item) => item.discovery.score >= 20 && item.mentions >= 2)
    .sort((a, b) => b.discovery.score - a.discovery.score);
  const lowerRisk = scored.filter((item) => !["crowded", "cooling"].includes(item.discovery.tone));
  const candidates = (lowerRisk.length >= 4 ? lowerRisk : scored).slice(0, 4);

  byId("buyCandidates").innerHTML = candidates.length
    ? candidates.map((item, index) => buyCard(item, index)).join("")
    : `<div class="buy-empty">No setup has enough independent evidence yet. The honest result is to wait for another confirming signal.</div>`;

  document.querySelectorAll("[data-buy-ticker]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTicker = button.dataset.buyTicker;
      byId("tickerSearch").value = "";
      render();
      document.getElementById("ranking-heading").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function buyCard(item, index) {
  const profile = item.discovery || discoveryProfile(item);
  return `
    <article class="buy-card" data-stage="${profile.tone}">
      <div class="buy-card-top">
        <span class="stage-badge stage-${profile.tone}">${escapeHtml(profile.stage)}</span>
        <button type="button" data-buy-ticker="${item.ticker}" class="buy-ticker">${item.ticker}</button>
      </div>
      <p class="buy-name">${escapeHtml(item.name || item.ticker)}</p>
      <p class="buy-why">${escapeHtml(profile.summary)}</p>
      <div class="buy-score-row">
        <span>Setup score</span>
        <strong>${profile.score}</strong>
      </div>
      <div class="buy-meter" aria-label="Setup score ${profile.score} out of 100">
        <span style="width:${profile.score}%"></span>
      </div>
      <div class="radar-evidence"><span>${escapeHtml(profile.evidence)}</span><span>${profile.activeSources} sources</span></div>
      <ul>${profile.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>
      ${profile.risks.length ? `<div class="risk-row" aria-label="Risk flags">${profile.risks.map((risk) => `<span>${escapeHtml(risk)}</span>`).join("")}</div>` : ""}
    </article>`;
}

function updateStatus() {
  const generated = new Date(snapshot.generatedAt).getTime();
  const ageHours = Number.isFinite(generated) ? (Date.now() - generated) / 3_600_000 : Infinity;
  const stale = ageHours > 36;
  byId("dataStatus")?.classList.toggle("stale", stale);
  setDataStatus(`${stale ? "Stale snapshot" : "Updated"} · ${formatDateTime(snapshot.generatedAt)}`);
  const notice = byId("freshnessNotice");
  if (notice) {
    notice.hidden = !stale;
    notice.textContent = stale
      ? `Data freshness warning: this snapshot is from ${formatDateTime(snapshot.generatedAt)}. Use it to study prior market attention, not as a current trading signal.`
      : "";
  }
}

function renderTable(items) {
  const capLabel = capFilter === "large" ? " large-cap" : capFilter === "small" ? " small-cap" : "";
  const attnLabel = attentionFilter === "quiet" ? " quiet-mover" : attentionFilter === "attention" ? " big-attention" : "";
  const watchLabel = watchlistFilter ? " watchlist" : "";
  const filterLabel = `${watchLabel}${attnLabel}${capLabel}`;
  if (watchlistFilter && watchlist.size === 0) {
    byId("rankSubhead").textContent = "Your watchlist is empty — tap ☆ on any ticker to add it.";
  } else {
    byId("rankSubhead").textContent = items.length
      ? `Showing ${items.length}${filterLabel} real-data ticker${items.length === 1 ? "" : "s"}`
      : `No${filterLabel} tickers in this snapshot — try clearing a filter`;
  }
  const prevRanks = previousRankMap();
  byId("rankingBody").innerHTML = items
    .map((item, index) => {
      const profile = item.discovery || discoveryProfile(item);
      const total = Math.max(1, item.mentions);
      const sourceBars = SOURCES.map(
        (source) => `<span style="width:${((item.sources[source] || 0) / total) * 100}%; background:${SOURCE_COLORS[source]}"></span>`
      ).join("");
      const momentumClass = item.momentum >= 0 ? "up" : "down";
      const chips = `<div class="setup-context"><span>${escapeHtml(profile.evidence)}</span>${profile.risks[0] ? `<span class="risk">${escapeHtml(profile.risks[0])}</span>` : ""}</div>`;
      const nameLine = item.name && item.name !== item.ticker ? `<small>${escapeHtml(item.name)}</small>` : "";
      const spark = sparkline(tickerHistory(item.ticker).map((h) => h.mentions));
      const catalystBadge =
        item.topHeadline && CATALYST_WORDS_RE.test(item.topHeadline.title)
          ? `<span class="catalyst-badge" title="${escapeHtml(item.topHeadline.title)}">${item.topHeadline.isNewsArticle ? "News" : "Buzz"}</span>`
          : "";
      return `
        <tr class="${item.ticker === selectedTicker ? "selected" : ""}" data-ticker="${item.ticker}">
          <td><span class="rank-num">#${index + 1}</span>${rankBadge(item.ticker, index + 1, prevRanks)}</td>
          <td>
            <div class="ticker-cell">
              ${starButton(item.ticker)}
              <span class="ticker-icon">${item.ticker.slice(0, 2)}</span>
              <span class="ticker-name"><strong>${item.ticker}</strong>${nameLine}</span>
              ${catalystBadge}
              ${spark ? `<span class="ticker-spark" title="Mention trend">${spark}</span>` : ""}
            </div>
            ${chips}
          </td>
          <td><div class="setup-cell"><span class="signal-pill tone-${profile.tone}">${profile.score}</span><small>${escapeHtml(profile.stage)}</small></div></td>
          <td>${formatQuoteCell(item)}</td>
          <td class="col-secondary">${fmt.format(item.mentions)}</td>
          <td><span class="momentum ${momentumClass}">${item.momentum >= 0 ? "+" : ""}${item.momentum.toFixed(1)}%</span></td>
          <td class="col-tertiary">${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}% / ${item.relativeVolume.toFixed(1)}x</td>
          <td class="col-secondary"><div class="mix-bar" aria-label="Source mix for ${item.ticker}">${sourceBars}</div></td>
        </tr>`;
    })
    .join("");

  document.querySelectorAll("#rankingBody tr").forEach((row) => {
    row.addEventListener("click", () => {
      selectedTicker = row.dataset.ticker;
      render();
      // On narrow screens the detail panel sits below the table; bring it into view.
      if (window.matchMedia("(max-width: 980px)").matches) {
        document.querySelector(".side-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
  bindStars(byId("rankingBody"));
}

// Three market-psychology states are more useful than three versions of "hot."
// They let the user distinguish early participation, corroborated moves, and
// attention that may have arrived too late to offer a favorable setup.
function renderMovers(items) {
  const board = byId("moversBoard");
  if (!board) return;
  if (!items.length) {
    board.innerHTML = `<p class="muted-note">No signals in this snapshot yet.</p>`;
    return;
  }

  const staged = items.map((item) => ({ ...item, discovery: item.discovery || discoveryProfile(item) }));
  const early = staged
    .filter((item) => ["early", "building"].includes(item.discovery.tone))
    .sort((a, b) => b.discovery.score - a.discovery.score)
    .slice(0, 5);
  const confirmed = staged
    .filter((item) => item.discovery.tone === "confirmed")
    .sort((a, b) => b.discovery.score - a.discovery.score)
    .slice(0, 5);
  const crowded = staged
    .filter((item) => item.discovery.tone === "crowded")
    .sort((a, b) => Math.abs(b.priceMove) - Math.abs(a.priceMove))
    .slice(0, 5);

  const columns = [
    { title: "Early ignition", sub: "Participation before broad crowding", list: early, value: (item) => `${item.discovery.score} setup` },
    { title: "Confirmed", sub: "Catalyst and market action agree", list: confirmed, value: (item) => `${item.discovery.score} setup` },
    { title: "Crowded risk", sub: "Attention arrived after a large move", list: crowded, value: (item) => `${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}%` },
  ];

  board.innerHTML = columns.map(moverColumn).join("");

  board.querySelectorAll("[data-mover-ticker]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedTicker = button.dataset.moverTicker;
      byId("tickerSearch").value = "";
      render();
      if (window.matchMedia("(max-width: 980px)").matches) {
        document.querySelector(".side-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function moverColumn(column) {
  const rows = column.list.length
    ? column.list
        .map(
          (item) => `
          <button type="button" class="mover-row" data-mover-ticker="${item.ticker}">
            <span class="mover-tk">${escapeHtml(item.ticker)}</span>
            <span class="mover-name">${escapeHtml(item.name || item.ticker)}</span>
            <span class="mover-val">${column.value(item)}</span>
          </button>`
        )
        .join("")
    : `<p class="muted-note">No names meet this state in the current snapshot.</p>`;
  return `
    <div class="mover-col">
      <div class="mover-head">
        <h3>${column.title}</h3>
        <p>${column.sub}</p>
      </div>
      <div class="mover-list">${rows}</div>
    </div>`;
}

function updateRangeNote() {
  const note = byId("rangeNote");
  if (!note) return;
  const history = historySnapshots().length;
  note.classList.remove("range-note-warn");
  note.textContent =
    history <= 1
      ? "Showing the latest daily snapshot. History builds automatically with each daily refresh."
      : `Showing the latest of ${history} daily snapshots. Multi-day ranges unlock as history grows.`;
}

function renderDetail(items, top50) {
  const selected = items.find((item) => item.ticker === selectedTicker) || top50[0];
  if (!selected) return;
  const rank = items.findIndex((item) => item.ticker === selected.ticker) + 1;
  byId("detailPanel").innerHTML = detailMarkup(selected, rank);
  bindStars(byId("detailPanel"));
}

function detailMarkup(item, rank) {
  const profile = item.discovery || discoveryProfile(item);
  return `
    <div class="selected-stock">
      <span id="selectedRank">Discovery rank #${rank}</span>
      <div class="selected-head">
        <h2 id="selectedTicker">${escapeHtml(item.ticker)}</h2>
        ${starButton(item.ticker)}
      </div>
      <p id="selectedName">${escapeHtml(item.name || item.ticker)}</p>
      ${profileMetaMarkup(item)}
      ${item.description ? `<p class="company-blurb">${escapeHtml(item.description)}${item.descriptionUrl ? ` <a href="${item.descriptionUrl}" target="_blank" rel="noopener">Wikipedia</a>` : ""}</p>` : ""}
    </div>

    ${topHeadlineMarkup(item)}

    <div class="setup-assessment" data-stage="${profile.tone}">
      <div class="assessment-head">
        <span class="stage-badge stage-${profile.tone}">${escapeHtml(profile.stage)}</span>
        <strong>${profile.score}<small>/100 setup</small></strong>
      </div>
      <p>${escapeHtml(profile.summary)}</p>
      <div class="assessment-grid">
        <div><span>Evidence</span><strong>${escapeHtml(profile.evidence)}</strong></div>
        <div><span>Coverage</span><strong>${profile.activeGroups}/3 groups · ${profile.activeSources} sources</strong></div>
      </div>
      ${profile.risks.length ? `<div class="risk-row" aria-label="Risk flags">${profile.risks.map((risk) => `<span>${escapeHtml(risk)}</span>`).join("")}</div>` : ""}
    </div>

    <div class="stat-grid">
      ${statBlock("Attention", `${item.signalScore.toFixed(0)}`, "/ 100 composite")}
      ${statBlock("Price", formatPrice(item.lastPrice), priceMoveText(item), priceTone(item.priceMove))}
      ${statBlock("Rel. volume", item.relativeVolume ? `${item.relativeVolume.toFixed(1)}×` : "-", item.relativeVolume >= VOL_HOT ? "elevated" : "normal", item.relativeVolume >= VOL_HOT ? "up" : "")}
      ${statBlock("Acceleration", `${item.momentum >= 0 ? "+" : ""}${item.momentum.toFixed(0)}%`, "attention vs prior", momentumTone(item.momentum))}
      ${statBlock("Public tone", sentimentLabel(item.sentiment), "descriptive, not predictive", sentimentTone(item.sentiment))}
      ${statBlock("Market cap", Number.isFinite(item.marketCap) && item.marketCap > 0 ? `$${shortFmt.format(item.marketCap)}` : "-", capTierName(item))}
    </div>

    ${detailTrendMarkup(item)}

    <div class="detail-section">
      <h3>What is supporting the setup</h3>
      <p class="why-line">${escapeHtml(trendInterpretation(item))}</p>
      <div class="why-chips">${profile.reasons.map((chip) => `<span class="why-chip">${escapeHtml(chip)}</span>`).join("")}</div>
    </div>

    ${attentionMarkup(item)}

    ${headlinesMarkup(item)}

    <div class="detail-section research-links">
      <h3>Dig deeper</h3>
      <div class="research-row">
        <a href="https://finance.yahoo.com/quote/${encodeURIComponent(item.ticker)}" target="_blank" rel="noopener">Yahoo Finance</a>
        <a href="https://stocktwits.com/symbol/${encodeURIComponent(item.ticker)}" target="_blank" rel="noopener">StockTwits</a>
        <a href="https://apewisdom.io/stocks/${encodeURIComponent(item.ticker)}/" target="_blank" rel="noopener">ApeWisdom</a>
      </div>
    </div>`;
}

function profileMetaMarkup(item) {
  const bits = [item.sector, item.industry].filter(Boolean);
  if (!bits.length) return "";
  return `<p class="company-meta">${bits.map((bit) => escapeHtml(bit)).join(" · ")}</p>`;
}

function statBlock(label, value, sub, tone = "") {
  return `
    <div class="stat-block${tone ? ` tone-${tone}` : ""}">
      <span class="stat-label">${escapeHtml(label)}</span>
      <strong class="stat-value">${value}</strong>
      ${sub ? `<span class="stat-sub">${escapeHtml(sub)}</span>` : ""}
    </div>`;
}

function priceMoveText(item) {
  if (!Number.isFinite(item.priceMove)) return "";
  return `${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}% today`;
}

function priceTone(move) {
  if (!Number.isFinite(move) || Math.abs(move) < 0.05) return "";
  return move > 0 ? "up" : "down";
}

function momentumTone(value) {
  if (value >= 15) return "up";
  if (value <= -15) return "down";
  return "";
}

function sentimentTone(value) {
  if (value > 0.08) return "up";
  if (value < -0.08) return "down";
  return "";
}

function capTierName(item) {
  const tier = item.capTier;
  if (tier === "large") return "Large cap";
  if (tier === "small") return "Small cap";
  return Number.isFinite(item.marketCap) && item.marketCap > 0 ? "" : "no SEC cap";
}

// Condensed attention: group totals (Social / News / Market) and only list the
// individual sources that actually returned something, so empty rows don't bury
// the signal.
function attentionMarkup(item) {
  const groups = [
    { label: "Social", sources: DISCOVERY_SOCIAL_SOURCES, color: "#2bd4d6" },
    { label: "News", sources: DISCOVERY_CATALYST_SOURCES, color: "#e0b94a" },
    { label: "Market", sources: DISCOVERY_MARKET_SOURCES, color: "#7c9aff" },
  ];
  const totals = groups.map((group) => ({
    ...group,
    value: group.sources.reduce((sum, source) => sum + (item.sources[source] || 0), 0),
  }));
  const grandMax = Math.max(...totals.map((group) => group.value), 1);

  const active = SOURCES.map((source) => ({ source, value: item.sources[source] || 0 }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);

  if (!active.length) {
    return `
      <div class="detail-section">
        <h3>Where the attention is</h3>
        <p class="muted-note">No mentions captured in this snapshot — this stock is here on price/volume signals.</p>
      </div>`;
  }

  const groupBars = totals
    .filter((group) => group.value > 0)
    .map(
      (group) => `
        <div class="attn-group">
          <span class="attn-group-label">${group.label}</span>
          <div class="attn-track"><div class="attn-fill" style="width:${(group.value / grandMax) * 100}%; background:${group.color}"></div></div>
          <strong>${shortFmt.format(group.value)}</strong>
        </div>`
    )
    .join("");

  const activeMax = Math.max(...active.map((row) => row.value), 1);
  const activeRows = active
    .map(
      (row) => `
        <div class="source-row">
          <span><span class="src-dot" style="background:${SOURCE_COLORS[row.source] || "#888"}"></span>${escapeHtml(row.source)}</span>
          <div class="source-track"><div class="source-fill" style="width:${(row.value / activeMax) * 100}%; background:${SOURCE_COLORS[row.source] || "#888"}"></div></div>
          <strong>${shortFmt.format(row.value)}</strong>
        </div>`
    )
    .join("");

  return `
    <div class="detail-section">
      <h3>Where the evidence is coming from</h3>
      <div class="attn-groups">${groupBars}</div>
      <div class="attn-detail">${activeRows}</div>
      ${(item.sources["FINRA Short Volume"] || 0) > 0 ? `<p class="data-caveat">FINRA daily short-sale volume is trading activity, not short interest or proof of a squeeze.</p>` : ""}
    </div>`;
}

// The single best explanation for "why is this ticker in the news" --
// prioritizes M&A/major-catalyst vocabulary and real impact words over
// synthetic activity-count strings (see headlineQualityScore). Shown above
// the setup assessment so a real catalyst (an acquisition rumor, a lawsuit,
// an FDA decision) isn't buried under mention-count bars.
function topHeadlineMarkup(item) {
  const headline = item.topHeadline;
  if (!headline || !headline.title) return "";
  const when = headline.published ? formatShortDateTime(headline.published) : "";
  // Only a genuine published article/filing gets called a "headline" --
  // social commentary that happens to mention a catalyst is real signal,
  // but labeling a stranger's forum comment as reporting would be dishonest.
  const label = headline.isNewsArticle ? "Top headline" : "Notable chatter (not a news article)";
  return `
    <div class="catalyst-callout${headline.isNewsArticle ? "" : " catalyst-callout-social"}">
      <span class="catalyst-label">${label}</span>
      ${headline.url ? `<a href="${headline.url}" target="_blank" rel="noopener">${escapeHtml(headline.title)}</a>` : `<span>${escapeHtml(headline.title)}</span>`}
      <span class="catalyst-meta"><span class="headline-src" style="color:${SOURCE_COLORS[headline.source] || "#555"}">${escapeHtml(headline.source)}</span>${when ? ` · ${when}` : ""}</span>
    </div>`;
}

function headlinesMarkup(item) {
  const topTitle = item.topHeadline?.title;
  const latest = (item.latest || []).filter((entry) => entry.title && entry.title !== topTitle).slice(0, 5);
  if (!latest.length) return "";
  return `
    <div class="detail-section">
      <h3>Recent source evidence</h3>
      <ul class="headline-list">
        ${latest
          .map(
            (entry) => `
            <li>
              <span class="headline-src" style="color:${SOURCE_COLORS[entry.source] || "#555"}">${escapeHtml(entry.source)}</span>
              ${entry.url ? `<a href="${entry.url}" target="_blank" rel="noopener">${escapeHtml(entry.title)}</a>` : escapeHtml(entry.title)}
            </li>`
          )
          .join("")}
      </ul>
    </div>`;
}

// ---- "Why it's trending" interpretation + attention grouping ----
// Shared definition of the human-attention a stock is getting, so the chips,
// the plain-English takeaway, and the Quiet/Big-attention split all agree.
const VOL_HOT = 1.3; // relative volume that counts as "elevated"
const SOCIAL_BUZZ = 3; // social mentions that count as a crowd forming
const NEWS_BUZZ = 4; // news hits that count as media attention
const ATTENTION_HIGH = 5; // social + news that counts as "big attention"

function attentionStats(item) {
  const socialSources = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan"];
  const social = socialSources.reduce((sum, source) => sum + (item.sources[source] || 0), 0);
  const newsSources = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch"];
  const news = newsSources.reduce((sum, source) => sum + (item.sources[source] || 0), 0);
  return {
    social,
    news,
    attention: social + news,
    volHot: item.relativeVolume >= VOL_HOT,
    priceHot: item.priceMove >= 3,
    momentumHot: item.momentum >= 20,
  };
}

// Peer-relative cutoff for "big attention": the 70th-percentile of combined
// social + news chatter across the current set (min ATTENTION_HIGH so a near-dead
// snapshot doesn't crown noise). Recomputed each render so the split always divides
// the data meaningfully even when a source like Reddit is blocked.
function computeAttentionThreshold(items) {
  const values = items
    .map((item) => attentionStats(item).attention)
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (!values.length) return Infinity;
  const p70 = values[Math.min(values.length - 1, Math.floor(values.length * 0.7))];
  return Math.max(ATTENTION_HIGH, p70);
}

// Big attention = top tier of combined social + news chatter.
// Quiet mover  = elevated volume but attention below that tier (the crowd hasn't arrived).
function attentionGroupFor(item) {
  const { attention, volHot } = attentionStats(item);
  if (attention > 0 && attention >= attentionHighThreshold) return "attention";
  if (volHot && attention < attentionHighThreshold) return "quiet";
  return null;
}

function trendInterpretation(item) {
  const { social, news, volHot, priceHot } = attentionStats(item);
  const activeSources = SOURCES.filter((s) => (item.sources[s] || 0) > 0).length;

  // Quiet mover: volume spike with crowd still absent — lead with the anomaly.
  if (volHot && social < SOCIAL_BUZZ && news < NEWS_BUZZ) {
    return `Under-the-radar: volume running ${item.relativeVolume.toFixed(1)}× normal${priceHot ? ` with price up ${item.priceMove.toFixed(1)}%` : ""} — crowd attention hasn't arrived yet, making this an early-mover signal.`;
  }

  // Build a differentiated description from the most distinctive signals.
  // Ranked in descending order of user interest so each card feels unique.
  const parts = [];
  if (priceHot) parts.push(`${item.priceMove >= 10 ? "strong " : ""}${item.priceMove.toFixed(1)}% price move`);
  if (volHot) parts.push(`${item.relativeVolume.toFixed(1)}× normal volume`);
  if (social >= SOCIAL_BUZZ) parts.push(`${fmt.format(social)} social mention${social === 1 ? "" : "s"}`);
  if (news >= NEWS_BUZZ) parts.push(`${fmt.format(news)} news hit${news === 1 ? "" : "s"}`);
  if (activeSources >= 4) parts.push(`${activeSources} data platforms`);
  if (item.sector) parts.push(item.sector);

  const lead =
    social >= news && social >= SOCIAL_BUZZ ? "Retail" :
    news >= NEWS_BUZZ ? "News" :
    priceHot || volHot ? "Price/volume" : "Multi-source";

  if (parts.length === 0) {
    return `Composite signal: ${item.signalScore.toFixed(0)}/100 across ${activeSources} data source${activeSources === 1 ? "" : "s"} — no single dominant catalyst yet.`;
  }

  return `${lead}: ${parts.join(" · ")}.`;
}

function sentimentLabel(value) {
  if (value > 0.25) return "Bullish";
  if (value > 0.08) return "Positive";
  if (value < -0.18) return "Bearish";
  if (value < -0.04) return "Soft";
  return "Neutral";
}

function formatPrice(value) {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatQuoteCell(item) {
  const price = formatPrice(item.lastPrice);
  if (price === "-") return "-";
  const meta = [item.quoteSource, item.quoteAsOf ? formatShortDateTime(item.quoteAsOf) : ""].filter(Boolean).join(" • ");
  const cap = Number.isFinite(item.marketCap) && item.marketCap > 0 ? `<small class="quote-cap">${capLabelFor(item)}</small>` : "";
  return `<span class="quote-price" title="${escapeHtml(meta)}">${price}</span>${cap}<small class="quote-meta">${escapeHtml(meta)}</small>`;
}

function capLabelFor(item) {
  const tier = item.capTier || capTierFor(item.marketCap);
  const tierName = tier === "large" ? "Large cap" : tier === "small" ? "Small cap" : "";
  return `$${shortFmt.format(item.marketCap)}${tierName ? ` • ${tierName}` : ""}`;
}

function formatShortDateTime(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function exportCsv() {
  const data = filteredSignals().slice(0, 50);
  const header = ["rank", "ticker", "name", "market_price", "setup_score", "attention_score", "stage", "evidence", "risk_flags", "mentions", "momentum_percent", "sentiment", "price_move_percent", "relative_volume", ...SOURCES];
  const lines = [header.join(",")].concat(
    data.map((item, index) => {
      const profile = item.discovery || discoveryProfile(item);
      return [
        index + 1,
        item.ticker,
        `"${String(item.name || item.ticker).replaceAll('"', '""')}"`,
        item.lastPrice ?? "",
        profile.score,
        item.signalScore.toFixed(1),
        `"${profile.stage}"`,
        `"${profile.evidence}"`,
        `"${profile.risks.join(" | ")}"`,
        item.mentions,
        item.momentum.toFixed(2),
        item.sentiment.toFixed(3),
        item.priceMove.toFixed(2),
        item.relativeVolume.toFixed(2),
        ...SOURCES.map((source) => item.sources[source] || 0),
      ].join(",");
    })
  );
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `stock-real-public-signals-${isoDate(new Date(snapshot.generatedAt || Date.now()))}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function bindEvents() {
  byId("tickerSearch").addEventListener("input", render);
  document.querySelectorAll('input[name="source"]').forEach((input) => input.addEventListener("change", render));
  byId("clearFocus").addEventListener("click", () => {
    byId("tickerSearch").value = "";
    selectedTicker = "";
    render();
  });
  document.querySelectorAll("th.sortable[data-sort]").forEach((th) => {
    th.addEventListener("click", () => setRankMode(th.dataset.sort));
  });
  byId("capLarge").addEventListener("click", () => setCapFilter(capFilter === "large" ? "all" : "large"));
  byId("capSmall").addEventListener("click", () => setCapFilter(capFilter === "small" ? "all" : "small"));
  byId("attnAttention").addEventListener("click", () => setAttentionFilter(attentionFilter === "attention" ? "all" : "attention"));
  byId("attnQuiet").addEventListener("click", () => setAttentionFilter(attentionFilter === "quiet" ? "all" : "quiet"));
  byId("watchFilter").addEventListener("click", () => setWatchlistFilter(!watchlistFilter));
  byId("refreshData").addEventListener("click", async () => {
    await loadSnapshot(true);
    render();
  });
  byId("exportCsv").addEventListener("click", exportCsv);
  byId("togglePanel").addEventListener("click", toggleDetailPanel);
  byId("toggleSidebar").addEventListener("click", toggleSidebar);
  window.addEventListener("resize", render);
}

function setRankMode(mode) {
  rankMode = mode;
  document.querySelectorAll("th.sortable[data-sort]").forEach((th) => {
    const active = th.dataset.sort === mode;
    th.classList.toggle("sort-active", active);
    th.setAttribute("aria-sort", active ? "descending" : "none");
  });
  render();
}

function setCapFilter(filter) {
  capFilter = filter;
  byId("capLarge").classList.toggle("active", filter === "large");
  byId("capLarge").setAttribute("aria-pressed", String(filter === "large"));
  byId("capSmall").classList.toggle("active", filter === "small");
  byId("capSmall").setAttribute("aria-pressed", String(filter === "small"));
  render();
}

function setAttentionFilter(filter) {
  attentionFilter = filter;
  byId("attnAttention").classList.toggle("active", filter === "attention");
  byId("attnAttention").setAttribute("aria-pressed", String(filter === "attention"));
  byId("attnQuiet").classList.toggle("active", filter === "quiet");
  byId("attnQuiet").setAttribute("aria-pressed", String(filter === "quiet"));
  render();
}

function setWatchlistFilter(on) {
  watchlistFilter = on;
  byId("watchFilter").classList.toggle("active", on);
  byId("watchFilter").setAttribute("aria-pressed", String(on));
  render();
}

// Mirror the current filter/sort state onto the control buttons. Used after
// hydrating state from the URL so deep-linked views show the right active
// toggles without firing a render per control.
function syncControls() {
  document.querySelectorAll("th.sortable[data-sort]").forEach((th) => {
    const active = th.dataset.sort === rankMode;
    th.classList.toggle("sort-active", active);
    th.setAttribute("aria-sort", active ? "descending" : "none");
  });
  byId("capLarge").classList.toggle("active", capFilter === "large");
  byId("capLarge").setAttribute("aria-pressed", String(capFilter === "large"));
  byId("capSmall").classList.toggle("active", capFilter === "small");
  byId("capSmall").setAttribute("aria-pressed", String(capFilter === "small"));
  byId("attnAttention").classList.toggle("active", attentionFilter === "attention");
  byId("attnAttention").setAttribute("aria-pressed", String(attentionFilter === "attention"));
  byId("attnQuiet").classList.toggle("active", attentionFilter === "quiet");
  byId("attnQuiet").setAttribute("aria-pressed", String(attentionFilter === "quiet"));
  byId("watchFilter").classList.toggle("active", watchlistFilter);
  byId("watchFilter").setAttribute("aria-pressed", String(watchlistFilter));
}

// Hydrate shareable state from the query string (ticker, sort, cap, attention,
// watchlist). Unknown values are ignored so a malformed link degrades to the
// default view rather than breaking.
function applyUrlParams() {
  let params;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    return;
  }
  const ticker = params.get("ticker");
  if (ticker) selectedTicker = ticker.toUpperCase();
  const sort = params.get("sort");
  if (["signal", "mentions", "momentum"].includes(sort)) rankMode = sort;
  const cap = params.get("cap");
  if (["large", "small"].includes(cap)) capFilter = cap;
  const attn = params.get("attn");
  if (["attention", "quiet"].includes(attn)) attentionFilter = attn;
  if (params.get("watch") === "1") watchlistFilter = true;
}

// Reflect the current view back into the URL so it can be copied and shared.
// replaceState keeps it out of history; wrapped because file:// can reject it.
function updateUrl() {
  try {
    const params = new URLSearchParams();
    if (selectedTicker) params.set("ticker", selectedTicker);
    if (rankMode !== "signal") params.set("sort", rankMode);
    if (capFilter !== "all") params.set("cap", capFilter);
    if (attentionFilter !== "all") params.set("attn", attentionFilter);
    if (watchlistFilter) params.set("watch", "1");
    const qs = params.toString();
    window.history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}`);
  } catch {
    /* file:// or sandboxed — sharing via URL just won't reflect, no functional impact */
  }
}

function toggleDetailPanel() {
  const grid = document.querySelector(".dashboard-grid");
  const hidden = grid.classList.toggle("details-hidden");
  const button = byId("togglePanel");
  button.textContent = hidden ? "Show details" : "Hide details";
  button.setAttribute("aria-pressed", String(hidden));
}

function toggleSidebar() {
  const shell = document.querySelector(".app-shell");
  const hidden = shell.classList.toggle("sidebar-hidden");
  const button = byId("toggleSidebar");
  button.setAttribute("title", hidden ? "Show filters" : "Hide filters");
  button.setAttribute("aria-label", hidden ? "Show filters" : "Hide filters");
  button.setAttribute("aria-pressed", String(!hidden));
}

function setDataStatus(message) {
  byId("dataStatus").textContent = message;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function markBlockedSources() {
  // Parse failures like "Wallstreetbets: 403 Blocked" and badge each affected source.
  const failures = snapshot?.failures || [];
  const blockedSources = new Set(
    failures
      .map((f) => {
        const match = f.match(/^([^:]+):/);
        return match ? match[1].trim() : null;
      })
      .filter(Boolean)
  );

  document.querySelectorAll('input[name="source"]').forEach((input) => {
    const row = input.closest(".check-row");
    if (!row) return;
    // Remove any prior badge
    row.querySelector(".source-status")?.remove();
    if (blockedSources.has(input.value)) {
      const badge = document.createElement("span");
      badge.className = "source-status source-blocked";
      badge.textContent = "blocked";
      badge.title = failures.find((f) => f.startsWith(input.value)) || "Source unavailable";
      row.appendChild(badge);
    }
  });
}

async function init() {
  const loaded = await loadSnapshot();
  if (loaded) markBlockedSources();
  // Default to the latest daily snapshot (start === end === latest date).
  const snapshots = historySnapshots();
  const latestDate = snapshots.at(-1)?.date || isoDate(new Date(snapshot?.generatedAt || Date.now()));
  rangeStart = latestDate;
  rangeEnd = latestDate;
  watchlist = loadWatchlist();
  applyUrlParams();
  bindEvents();
  syncControls();
  // On narrow viewports default the sidebar to hidden so main content isn't
  // pushed below a long filter panel. The Filters button reveals it on demand.
  if (window.innerWidth <= 980 && !location.search.includes("watch=1")) {
    const shell = document.querySelector(".app-shell");
    if (shell && !shell.classList.contains("sidebar-hidden")) {
      shell.classList.add("sidebar-hidden");
      const toggleBtn = byId("toggleSidebar");
      if (toggleBtn) {
        toggleBtn.setAttribute("aria-pressed", "false");
        toggleBtn.setAttribute("title", "Show filters");
        toggleBtn.setAttribute("aria-label", "Show filters");
      }
    }
  }
  if (loaded) render();
  else renderEmptyState();
}

init();
