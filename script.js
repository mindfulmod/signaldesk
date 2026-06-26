const SOURCES = [
  "Wallstreetbets",
  "Reddit Finance",
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


let snapshot = null;
let history = null;
let selectedTicker = "";
let rankMode = "signal";
let capFilter = "all"; // "all" | "large" | "small"
let attentionFilter = "all"; // "all" | "quiet" | "attention"
let attentionHighThreshold = Infinity; // peer-relative cutoff, recomputed each render
let rangeStart = ""; // ISO date; empty = all available snapshots
let rangeEnd = "";

const LARGE_CAP_MIN = 500_000_000; // large cap: >= $500M
const SMALL_CAP_MAX = 500_000_000; // small cap:  < $500M
// Relative-volume values above this are almost always a data artifact (thin name
// divided by a near-zero average), so we treat them as unknown rather than a signal.
const MAX_PLAUSIBLE_REL_VOL = 100;

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
    optionsActivity: Number(item.optionsActivity) || 0,
    sources: Object.fromEntries(SOURCES.map((source) => [source, Number(item.sources?.[source]) || 0])),
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
        latest: item.latest.slice(0, 6),
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

  return signals.sort(sortForMode);
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

function sortForMode(a, b) {
  if (rankMode === "mentions") return b.mentions - a.mentions;
  if (rankMode === "momentum") return b.momentum - a.momentum;
  return b.signalScore - a.signalScore;
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
  const ranked = applyAttentionFilter(applyCapFilter(items));
  const top50 = ranked.slice(0, 50);
  if (!selectedTicker || !top50.some((item) => item.ticker === selectedTicker)) {
    selectedTicker = top50[0]?.ticker || "";
  }

  updateStatus();
  updateRangeNote();
  updateMetrics(items);
  renderBuyCandidates(items);
  renderTable(top50);
  renderMovers(ranked);
  renderDetail(items, top50);
}

function renderEmptyState() {
  if (snapshot?.dataMode === "real-public-no-key") {
    const warnings = snapshot.failures?.length ? ` Source warnings: ${snapshot.failures.length}.` : "";
    setDataStatus(
      `Real public no-key snapshot loaded: ${formatDateTime(snapshot.generatedAt)}. 0 ticker signals in this refresh.${warnings}`
    );
  } else {
    setDataStatus(
      "No real public snapshot is available (or it could not be fetched). Run `node scripts/update-data.mjs` to refresh data/signals.json and data/signals.js from public no-key sources."
    );
  }
  byId("totalMentions").textContent = "0";
  byId("mentionDelta").textContent =
    snapshot?.dataMode === "real-public-no-key" ? "Real snapshot loaded (0 signals)" : "No real data loaded";
  byId("bestSignal").textContent = "-";
  byId("bestSignalMeta").textContent = "No signal data";
  byId("trackedUniverse").textContent = "0";
  byId("trackedUniverseMeta").textContent = "validated stocks and ETFs tracked";
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

function buyScore(item) {
  const signal = clamp(0, 1, item.signalScore / 85); // peer-scale ceiling is 85
  const momentum = clamp(0, 1, (item.momentum + 10) / 80);
  const sentiment = clamp(0, 1, (item.sentiment + 0.2) / 0.65);
  const price = clamp(0, 1, (item.priceMove + 1) / 7);
  const volume = clamp(0, 1, item.relativeVolume / 2.5);
  const shortPressure = clamp(0, 1, (item.sources["FINRA Short Volume"] || 0) / Math.max(8, item.mentions));
  const sourceBreadth = SOURCES.filter((source) => (item.sources[source] || 0) > 0).length / SOURCES.length;
  return 100 * (0.31 * signal + 0.17 * momentum + 0.15 * sentiment + 0.13 * price + 0.09 * volume + 0.08 * sourceBreadth + 0.07 * shortPressure);
}

function renderBuyCandidates(items) {
  const candidates = [...items]
    .map((item) => ({ ...item, buyScore: buyScore(item) }))
    .filter((item) => item.signalScore >= 35 && item.mentions >= 2)
    .sort((a, b) => b.buyScore - a.buyScore)
    .slice(0, 5);

  byId("buyCandidates").innerHTML = candidates.length
    ? candidates.map((item, index) => buyCard(item, index)).join("")
    : `<div class="buy-empty">No buy candidates meet the current real-data filters.</div>`;

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
  const reasons = buyReasons(item);
  return `
    <article class="buy-card">
      <div class="buy-card-top">
        <span class="buy-rank">#${index + 1}</span>
        <button type="button" data-buy-ticker="${item.ticker}" class="buy-ticker">${item.ticker}</button>
      </div>
      <p class="buy-name">${item.name}</p>
      <p class="buy-why">${escapeHtml(trendInterpretation(item))}</p>
      <div class="buy-score-row">
        <span>Buy score</span>
        <strong>${item.buyScore.toFixed(0)}</strong>
      </div>
      <div class="buy-meter" aria-label="Buy score ${item.buyScore.toFixed(0)} out of 100">
        <span style="width:${clamp(0, 100, item.buyScore)}%"></span>
      </div>
      <ul>
        ${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}
      </ul>
    </article>`;
}

function buyReasons(item) {
  const reasons = [
    `${item.signalScore.toFixed(0)}/100 early signal`,
    `${item.momentum >= 0 ? "+" : ""}${item.momentum.toFixed(1)}% mention momentum`,
  ];
  if (item.sentiment > 0.08) reasons.push(`${sentimentLabel(item.sentiment)} public sentiment`);
  if (item.priceMove > 0) reasons.push(`${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}% price confirmation`);
  if (item.relativeVolume > 1.1) reasons.push(`${item.relativeVolume.toFixed(1)}x relative volume`);
  if ((item.sources["FINRA Short Volume"] || 0) > 0) reasons.push("FINRA short-volume pressure");
  const sourceCount = SOURCES.filter((source) => (item.sources[source] || 0) > 0).length;
  reasons.push(`${sourceCount} public sources detected`);
  return reasons.slice(0, 4);
}

function updateStatus() {
  const warnings = snapshot.failures?.length ? ` Source warnings: ${snapshot.failures.length}.` : "";
  const historyCount = historySnapshots().length;
  setDataStatus(
    `Real public no-key data loaded: ${formatDateTime(snapshot.generatedAt)}. History: ${historyCount} daily snapshot${historyCount === 1 ? "" : "s"}. Sources: GDELT, Google/Bing/Yahoo public news, SEC EDGAR, FINRA short volume, public price/volume, and best-effort Reddit.${warnings}`
  );
}

function updateMetrics(items) {
  const total = items.reduce((sum, item) => sum + item.mentions, 0);
  const bestSignal = [...items].sort((a, b) => b.signalScore - a.signalScore)[0];

  byId("totalMentions").textContent = shortFmt.format(total);
  byId("mentionDelta").textContent = `across ${items.length} ranked ticker${items.length === 1 ? "" : "s"}`;
  byId("bestSignal").textContent = bestSignal?.ticker || "-";
  byId("bestSignalMeta").textContent = bestSignal ? `${bestSignal.signalScore.toFixed(0)}/100 composite early signal` : "Signal unavailable";
  byId("trackedUniverse").textContent = snapshot.signals.length;
  byId("trackedUniverseMeta").textContent = "validated stocks and ETFs tracked";
}

function renderTable(items) {
  const capLabel = capFilter === "large" ? " large-cap" : capFilter === "small" ? " small-cap" : "";
  const attnLabel = attentionFilter === "quiet" ? " quiet-mover" : attentionFilter === "attention" ? " big-attention" : "";
  const filterLabel = `${attnLabel}${capLabel}`;
  byId("rankSubhead").textContent = items.length
    ? `Showing ${items.length}${filterLabel} real-data tickers`
    : `No${filterLabel} tickers in this snapshot — try clearing a filter`;
  byId("rankingBody").innerHTML = items
    .map((item, index) => {
      const total = Math.max(1, item.mentions);
      const sourceBars = SOURCES.map(
        (source) => `<span style="width:${((item.sources[source] || 0) / total) * 100}%; background:${SOURCE_COLORS[source]}"></span>`
      ).join("");
      const momentumClass = item.momentum >= 0 ? "up" : "down";
      const highlights = trendHighlights(item);
      const chips = highlights.length
        ? `<div class="why-chips">${highlights
            .map((tag) => `<span class="why-chip"><span aria-hidden="true">${tag.icon}</span>${escapeHtml(tag.text)}</span>`)
            .join("")}</div>`
        : "";
      const nameLine = item.name && item.name !== item.ticker ? `<small>${escapeHtml(item.name)}</small>` : "";
      return `
        <tr class="${item.ticker === selectedTicker ? "selected" : ""}" data-ticker="${item.ticker}">
          <td>#${index + 1}</td>
          <td>
            <div class="ticker-cell">
              <span class="ticker-icon">${item.ticker.slice(0, 2)}</span>
              <span class="ticker-name"><strong>${item.ticker}</strong>${nameLine}</span>
            </div>
            ${chips}
          </td>
          <td><span class="signal-pill">${item.signalScore.toFixed(0)}</span></td>
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
}

// "Today's Movers" — three mini-leaderboards that turn the raw signals into an
// at-a-glance read: who's accelerating, who's seeing unusual volume, and who the
// crowd is talking about. Each row is clickable and opens the ticker's profile.
function renderMovers(items) {
  const board = byId("moversBoard");
  if (!board) return;
  if (!items.length) {
    board.innerHTML = `<p class="muted-note">No signals in this snapshot yet.</p>`;
    return;
  }

  const momentum = [...items]
    .filter((item) => Number.isFinite(item.momentum) && item.momentum > 0)
    .sort((a, b) => b.momentum - a.momentum)
    .slice(0, 5);
  // Guard against broken relative-volume values (thin names can divide by a
  // near-zero average and report absurd multiples).
  const volume = [...items]
    .filter((item) => Number.isFinite(item.relativeVolume) && item.relativeVolume > 1.2 && item.relativeVolume < 100)
    .sort((a, b) => b.relativeVolume - a.relativeVolume)
    .slice(0, 5);
  const social = [...items]
    .map((item) => ({ item, social: attentionStats(item).social }))
    .filter((row) => row.social > 0)
    .sort((a, b) => b.social - a.social)
    .slice(0, 5)
    .map((row) => row.item);

  const columns = [
    { title: "🚀 Momentum risers", sub: "Mentions accelerating fastest", list: momentum, value: (item) => `+${item.momentum.toFixed(0)}%` },
    { title: "📊 Volume spikes", sub: "Trading well above normal", list: volume, value: (item) => `${item.relativeVolume.toFixed(1)}×` },
    { title: "🗣️ Social buzz", sub: "Most talked about right now", list: social, value: (item) => `${shortFmt.format(attentionStats(item).social)}` },
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
    : `<p class="muted-note">Nothing standout here in this snapshot.</p>`;
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
}

function detailMarkup(item, rank) {
  return `
    <div class="selected-stock">
      <span id="selectedRank">Signal rank #${rank}</span>
      <h2 id="selectedTicker">${escapeHtml(item.ticker)}</h2>
      <p id="selectedName">${escapeHtml(item.name || item.ticker)}</p>
      ${profileMetaMarkup(item)}
      ${item.description ? `<p class="company-blurb">${escapeHtml(item.description)}${item.descriptionUrl ? ` <a href="${item.descriptionUrl}" target="_blank" rel="noopener">Wikipedia</a>` : ""}</p>` : ""}
    </div>

    <div class="stat-grid">
      ${statBlock("Signal", `${item.signalScore.toFixed(0)}`, "/ 100")}
      ${statBlock("Price", formatPrice(item.lastPrice), priceMoveText(item), priceTone(item.priceMove))}
      ${statBlock("Rel. volume", item.relativeVolume ? `${item.relativeVolume.toFixed(1)}×` : "-", item.relativeVolume >= VOL_HOT ? "elevated" : "normal", item.relativeVolume >= VOL_HOT ? "up" : "")}
      ${statBlock("Momentum", `${item.momentum >= 0 ? "+" : ""}${item.momentum.toFixed(0)}%`, "vs prior", momentumTone(item.momentum))}
      ${statBlock("Sentiment", sentimentLabel(item.sentiment), null, sentimentTone(item.sentiment))}
      ${statBlock("Market cap", Number.isFinite(item.marketCap) && item.marketCap > 0 ? `$${shortFmt.format(item.marketCap)}` : "-", capTierName(item))}
    </div>

    <div class="detail-section">
      <h3>Why it's on the radar</h3>
      <p class="why-line">${escapeHtml(trendInterpretation(item))}</p>
      <div class="why-chips">${whyChips(item).map((chip) => `<span class="why-chip">${escapeHtml(chip)}</span>`).join("")}</div>
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

// Compact "why" chips highlighting only the signals that are actually firing.
function whyChips(item) {
  const { social, news, volHot, priceHot, momentumHot } = attentionStats(item);
  const chips = [];
  if (social > 0) chips.push(`${fmt.format(social)} social`);
  if (news > 0) chips.push(`${fmt.format(news)} news`);
  if (volHot) chips.push(`${item.relativeVolume.toFixed(1)}× volume`);
  if (priceHot) chips.push(`+${item.priceMove.toFixed(1)}% price`);
  if (momentumHot) chips.push(`+${item.momentum.toFixed(0)}% momentum`);
  if ((item.sources["FINRA Short Volume"] || 0) > 0) chips.push("short pressure");
  if (!chips.length) chips.push("steady, no single catalyst");
  return chips;
}

// Condensed attention: group totals (Social / News / Market) and only list the
// individual sources that actually returned something, so empty rows don't bury
// the signal.
function attentionMarkup(item) {
  const groups = [
    { label: "Social", sources: ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan"], color: "#18a0c4" },
    { label: "News", sources: ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings"], color: "#ad6b12" },
    { label: "Market", sources: ["FINRA Short Volume", "Price/Volume"], color: "#111f4d" },
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
      <h3>Where the attention is</h3>
      <div class="attn-groups">${groupBars}</div>
      <div class="attn-detail">${activeRows}</div>
    </div>`;
}

function headlinesMarkup(item) {
  const latest = (item.latest || []).filter((entry) => entry.title).slice(0, 5);
  if (!latest.length) return "";
  return `
    <div class="detail-section">
      <h3>Recent chatter & headlines</h3>
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

function trendHighlights(item) {
  const tags = [];
  const { social, news } = attentionStats(item);
  const shortVol = item.sources["FINRA Short Volume"] || 0;
  const secFilings = item.sources["SEC Filings"] || 0;
  const group = attentionGroupFor(item);

  if (group === "quiet") tags.push({ icon: "🤫", text: "Quiet mover" });
  else if (group === "attention") tags.push({ icon: "📣", text: "Big attention" });
  if (item.relativeVolume >= VOL_HOT) tags.push({ icon: "📈", text: `${item.relativeVolume.toFixed(1)}× normal volume` });
  if (item.momentum >= 20) tags.push({ icon: "🚀", text: `+${item.momentum.toFixed(0)}% mentions vs prior` });
  if (social >= SOCIAL_BUZZ) tags.push({ icon: "🔥", text: `${fmt.format(social)} social mentions` });
  if (item.sentiment > 0.25) tags.push({ icon: "🟢", text: "Bullish chatter" });
  else if (item.sentiment < -0.18) tags.push({ icon: "🔴", text: "Bearish chatter" });
  if (item.priceMove >= 3) tags.push({ icon: "💹", text: `+${item.priceMove.toFixed(1)}% price` });
  if (shortVol > 0) tags.push({ icon: "🩳", text: "Elevated short volume" });
  if (secFilings > 0) tags.push({ icon: "📄", text: "Fresh SEC filing" });
  if (news >= NEWS_BUZZ) tags.push({ icon: "📰", text: `${fmt.format(news)} news hits` });
  return tags.slice(0, 4);
}

function trendInterpretation(item) {
  const { social, news, volHot, priceHot, momentumHot } = attentionStats(item);

  // Quiet mover: trading volume jumping without a big news/social crowd yet.
  if (volHot && social < SOCIAL_BUZZ && news < NEWS_BUZZ) {
    return `Under-the-radar: trading volume is running ${item.relativeVolume.toFixed(1)}× normal${priceHot ? ` and price is up ${item.priceMove.toFixed(1)}%` : ""}, but the crowd hasn't piled in yet (fewer than ${SOCIAL_BUZZ} social mentions and ${NEWS_BUZZ} news hits) — an early mover worth a look.`;
  }
  // Social-led attention.
  if (social >= SOCIAL_BUZZ && social >= news) {
    return `Retail-driven: ${fmt.format(social)} social mentions are leading the attention${momentumHot ? `, up ${item.momentum.toFixed(0)}% vs the prior snapshot` : ""}${volHot ? `, with volume ${item.relativeVolume.toFixed(1)}× normal` : ""}.`;
  }
  // News-led attention.
  if (news >= NEWS_BUZZ) {
    return `News-driven: ${fmt.format(news)} headlines are fueling attention${priceHot ? `, and price is confirming with a ${item.priceMove.toFixed(1)}% move` : ""}${volHot ? ` on ${item.relativeVolume.toFixed(1)}× volume` : ""}.`;
  }
  // Price/momentum-led.
  if (priceHot || momentumHot) {
    return `Momentum building: ${priceHot ? `price up ${item.priceMove.toFixed(1)}%` : `mentions up ${item.momentum.toFixed(0)}%`}${volHot ? ` on ${item.relativeVolume.toFixed(1)}× volume` : ""} — watch for a follow-through catalyst.`;
  }
  return `Steady signal: a ${item.signalScore.toFixed(0)}/100 composite across ${SOURCES.filter((source) => (item.sources[source] || 0) > 0).length} public sources, without a single dominant catalyst yet.`;
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
  const header = ["rank", "ticker", "name", "market_price", "early_signal", "mentions", "momentum_percent", "sentiment", "price_move_percent", "relative_volume", ...SOURCES];
  const lines = [header.join(",")].concat(
    data.map((item, index) =>
      [
        index + 1,
        item.ticker,
        `"${item.name.replaceAll('"', '""')}"`,
        item.lastPrice ?? "",
        item.signalScore.toFixed(1),
        item.mentions,
        item.momentum.toFixed(2),
        item.sentiment.toFixed(3),
        item.priceMove.toFixed(2),
        item.relativeVolume.toFixed(2),
        ...SOURCES.map((source) => item.sources[source] || 0),
      ].join(",")
    )
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
  button.querySelector("span").textContent = hidden ? "☰ Controls" : "☰ Hide";
  button.setAttribute("title", hidden ? "Show controls" : "Hide controls");
  button.setAttribute("aria-label", hidden ? "Show controls" : "Hide controls");
  button.setAttribute("aria-pressed", String(hidden));
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
  bindEvents();
  if (loaded) render();
  else renderEmptyState();
}

init();
