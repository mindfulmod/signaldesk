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

const SOURCE_COLORS = {
  Wallstreetbets: "#b3414a",
  "Reddit Finance": "#7a5a40",
  "GDELT News": "#087d7f",
  "Google News": "#315fba",
  "Bing News": "#7255b7",
  "SEC Filings": "#5e7468",
  "Yahoo Public News": "#ad6b12",
  CNBC: "#386c87",
  MarketWatch: "#355b48",
  "FINRA Short Volume": "#8f4b2e",
  "Price/Volume": "#111f4d",
};

const LINE_COLORS = ["#146c43", "#315fba", "#b3414a", "#ad6b12", "#087d7f", "#7255b7", "#8f4b2e", "#3f6f53"];

let snapshot = null;
let history = null;
let selectedTicker = "";
let rankMode = "signal";
let capFilter = "all"; // "all" | "large" | "small"
let selectedDays = 1;

const LARGE_CAP_MIN = 500_000_000; // large cap: >= $500M
const SMALL_CAP_MAX = 500_000_000; // small cap:  < $500M

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
    start: byId("startDate").value,
    end: byId("endDate").value,
    sources: [...document.querySelectorAll('input[name="source"]:checked')].map((input) => input.value),
    metric: byId("metricSelect").value,
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
    relativeVolume: Number(item.relativeVolume) || 1,
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
          latestGeneratedAt: "",
          sources: Object.fromEntries(SOURCES.map((source) => [source, 0])),
          latest: [],
        };

      item.mentions += mentions;
      item.weightedSentiment += (Number(signal.sentiment) || 0) * mentions;
      item.weightedPrice += (Number(signal.priceMove) || 0) * mentions;
      item.weightedVolume += (Number(signal.relativeVolume) || 1) * mentions;
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
  const ranked = applyCapFilter(items);
  const top50 = ranked.slice(0, 50);
  if (!selectedTicker || !top50.some((item) => item.ticker === selectedTicker)) {
    selectedTicker = top50[0]?.ticker || "";
  }

  updateStatus();
  updateRangeNote();
  updateMetrics(items);
  renderBuyCandidates(items);
  renderTable(top50);
  renderChart(state, items);
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
  byId("fastestRiser").textContent = "-";
  byId("fastestRiserMeta").textContent = "Run the data update";
  byId("bestSignal").textContent = "-";
  byId("bestSignalMeta").textContent = "No signal data";
  byId("dominantSource").textContent = "-";
  byId("dominantSourceMeta").textContent = "No source data";
  byId("trackedUniverse").textContent = "0";
  byId("rankingBody").innerHTML = "";
  byId("buyCandidates").innerHTML = "";
  byId("trendChart").innerHTML = "";
  byId("chartLegend").innerHTML = "";
  byId("sourceBreakdown").innerHTML = "";
  byId("attentionNotes").innerHTML = [
    "<li>No generated or dummy fallback stock data is shown.</li>",
    "<li>If sources are unreachable, the dashboard stays empty until the next successful refresh.</li>",
    snapshot?.failures?.length
      ? `<li>Most recent refresh warnings: ${snapshot.failures.slice(0, 4).join(" | ")}${snapshot.failures.length > 4 ? " | …" : ""}</li>`
      : "",
  ].join("");
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
      document.getElementById("chart-heading").scrollIntoView({ behavior: "smooth", block: "start" });
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
  const fastest = [...items].sort((a, b) => b.momentum - a.momentum)[0];
  const bestSignal = [...items].sort((a, b) => b.signalScore - a.signalScore)[0];
  const sourceTotals = SOURCES.map((source) => ({
    source,
    mentions: items.reduce((sum, item) => sum + (item.sources[source] || 0), 0),
  })).sort((a, b) => b.mentions - a.mentions);

  byId("totalMentions").textContent = shortFmt.format(total);
  byId("mentionDelta").textContent = `${items.length} tickers in the real snapshot`;
  byId("fastestRiser").textContent = fastest?.ticker || "-";
  byId("fastestRiserMeta").textContent = fastest ? `${fastest.momentum.toFixed(1)}% mention momentum` : "Momentum unavailable";
  byId("bestSignal").textContent = bestSignal?.ticker || "-";
  byId("bestSignalMeta").textContent = bestSignal ? `${bestSignal.signalScore.toFixed(0)}/100 composite score` : "Signal unavailable";
  byId("dominantSource").textContent = sourceTotals[0]?.mentions ? sourceTotals[0].source : "-";
  byId("dominantSourceMeta").textContent = sourceTotals[0]?.mentions
    ? `${Math.round((sourceTotals[0].mentions / Math.max(1, total)) * 100)}% of selected mentions`
    : "No source selected";
  byId("trackedUniverse").textContent = snapshot.signals.length;
}

function renderTable(items) {
  const capLabel = capFilter === "large" ? " large-cap (≥$500M)" : capFilter === "small" ? " small-cap (<$500M)" : "";
  byId("rankSubhead").textContent = items.length
    ? `Showing ${items.length}${capLabel} real-data tickers`
    : `No${capLabel} tickers in this snapshot${capFilter === "all" ? "" : " — market caps come from SEC filings and may be missing for ETFs or new listings"}`;
  byId("rankingBody").innerHTML = items
    .map((item, index) => {
      const total = Math.max(1, item.mentions);
      const sourceBars = SOURCES.map(
        (source) => `<span style="width:${((item.sources[source] || 0) / total) * 100}%; background:${SOURCE_COLORS[source]}"></span>`
      ).join("");
      const momentumClass = item.momentum >= 0 ? "up" : "down";
      const sentimentClass = item.sentiment >= 0 ? "up" : "down";
      const highlights = trendHighlights(item);
      const chips = highlights.length
        ? `<div class="why-chips">${highlights
            .map((tag) => `<span class="why-chip"><span aria-hidden="true">${tag.icon}</span>${escapeHtml(tag.text)}</span>`)
            .join("")}</div>`
        : "";
      return `
        <tr class="${item.ticker === selectedTicker ? "selected" : ""}" data-ticker="${item.ticker}">
          <td>#${index + 1}</td>
          <td>
            <div class="ticker-cell">
              <span class="ticker-icon">${item.ticker.slice(0, 2)}</span>
              <span>${item.ticker}<small>${item.name}</small></span>
            </div>
            ${chips}
          </td>
          <td><span class="signal-pill">${item.signalScore.toFixed(0)}</span></td>
          <td>${formatQuoteCell(item)}</td>
          <td>${fmt.format(item.mentions)}</td>
          <td><span class="momentum ${momentumClass}">${item.momentum >= 0 ? "+" : ""}${item.momentum.toFixed(1)}%</span></td>
          <td><span class="momentum ${sentimentClass}">${sentimentLabel(item.sentiment)}</span></td>
          <td>${item.priceMove >= 0 ? "+" : ""}${item.priceMove.toFixed(1)}% / ${item.relativeVolume.toFixed(1)}x</td>
          <td><div class="mix-bar" aria-label="Source mix for ${item.ticker}">${sourceBars}</div></td>
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

function renderChart(state, items) {
  const svg = byId("trendChart");
  const width = svg.clientWidth || 900;
  const height = svg.clientHeight || 360;
  const padding = { top: 26, right: 26, bottom: 34, left: 54 };
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const selected = items.some((item) => item.ticker === selectedTicker)
    ? [items.find((item) => item.ticker === selectedTicker), ...items.filter((item) => item.ticker !== selectedTicker).slice(0, 7)]
    : items.slice(0, 8);
  const dailySnapshots = selectedRangeSnapshots();
  const chartPoints = dailySnapshots.length > 1 ? dailyChartPoints(selected, state.metric, dailySnapshots) : null;
  const labels = chartPoints?.labels || ["Previous", "Latest"];
  const series =
    chartPoints?.series ||
    selected.map((item, index) => ({
      item,
      color: LINE_COLORS[index % LINE_COLORS.length],
      values: twoPointValues(item, state.metric),
    }));
  const values = series.flatMap((line) => line.values);
  const min = metricMin(state.metric, values);
  const max = metricMax(state.metric, values);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const x = (index) => padding.left + index * (innerW / Math.max(1, labels.length - 1));
  const y = (value) => {
    if (state.metric === "rank") return padding.top + ((value - min) / (max - min || 1)) * innerH;
    return padding.top + innerH - ((value - min) / (max - min || 1)) * innerH;
  };
  const axis = Array.from({ length: 5 }, (_, index) => {
    const value = min + ((max - min) / 4) * index;
    const yy = padding.top + innerH - (index / 4) * innerH;
    return `<text class="axis-label" x="12" y="${yy + 4}">${formatAxis(value, state.metric)}</text>`;
  }).join("");
  const lines = series
    .map((line) => {
      const path = line.values.map((value, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
      return `
        <path d="${path}" fill="none" stroke="${line.color}" stroke-width="${line.item.ticker === selectedTicker ? 3.6 : 2.4}" stroke-linecap="round"></path>
        <circle cx="${x(line.values.length - 1)}" cy="${y(line.values.at(-1))}" r="${line.item.ticker === selectedTicker ? 4.5 : 3.2}" fill="${line.color}"></circle>`;
    })
    .join("");
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${axis}
    <text class="axis-label" x="${padding.left}" y="${height - 10}">${labels[0]}</text>
    <text class="axis-label" text-anchor="end" x="${width - padding.right}" y="${height - 10}">${labels.at(-1)}</text>
    ${lines}`;
  byId("chartLegend").innerHTML = series
    .map((line) => `<span class="legend-item"><span class="legend-swatch" style="background:${line.color}"></span>${line.item.ticker}</span>`)
    .join("");
  byId("chartSubhead").textContent = chartDescription(state.metric);
}

function dailyChartPoints(selected, metric, snapshots) {
  const labels = snapshots.map((daily) => daily.date.slice(5));
  const dailyAggregates = snapshots.map((daily, index) => {
    const previous = index > 0 ? [snapshots[index - 1]] : [];
    return aggregateSnapshotSignals([daily], previous).sort(sortForMode);
  });
  const series = selected.map((item, index) => ({
    item,
    color: LINE_COLORS[index % LINE_COLORS.length],
    values: dailyAggregates.map((dailyItems) => {
      const found = dailyItems.find((entry) => entry.ticker === item.ticker);
      if (metric === "rank") return found ? dailyItems.findIndex((entry) => entry.ticker === item.ticker) + 1 : 30;
      return found ? metricValue(found, metric) : 0;
    }),
  }));
  return { labels, series };
}

function metricValue(item, metric) {
  if (metric === "mentions") return item.mentions;
  if (metric === "momentum") return item.momentum;
  if (metric === "sentiment") return item.sentiment * 100;
  if (metric === "price") return item.priceMove;
  if (metric === "volume") return item.relativeVolume;
  return item.signalScore;
}

function twoPointValues(item, metric) {
  if (metric === "mentions") return [Math.max(0, item.mentions / (1 + item.momentum / 100 || 1)), item.mentions];
  if (metric === "momentum") return [0, item.momentum];
  if (metric === "sentiment") return [0, item.sentiment * 100];
  if (metric === "price") return [0, item.priceMove];
  if (metric === "volume") return [1, item.relativeVolume];
  if (metric === "rank") return [30, filteredSignals().findIndex((entry) => entry.ticker === item.ticker) + 1 || 30];
  return [Math.max(0, item.signalScore - item.momentum / 5), item.signalScore];
}

function metricMin(metric, values) {
  if (metric === "rank") return 1;
  if (metric === "sentiment") return Math.min(-60, ...values);
  if (metric === "price" || metric === "momentum") return Math.min(0, ...values);
  if (metric === "volume") return Math.min(0, ...values);
  return Math.min(0, ...values);
}

function metricMax(metric, values) {
  if (metric === "rank") return Math.max(30, ...values);
  if (metric === "sentiment") return Math.max(60, ...values);
  if (metric === "volume") return Math.max(2, ...values);
  if (metric === "signal") return Math.max(100, ...values);
  return Math.max(10, ...values);
}

function formatAxis(value, metric) {
  if (metric === "rank") return Math.round(value);
  if (metric === "sentiment" || metric === "price" || metric === "momentum") return `${Math.round(value)}%`;
  if (metric === "volume") return `${value.toFixed(1)}x`;
  if (metric === "signal") return Math.round(value);
  return shortFmt.format(value);
}

function chartDescription(metric) {
  const copy = {
    mentions: "Real public mention count",
    signal: "Real public-data early-signal score",
    momentum: "Change versus previous real snapshot when available",
    sentiment: "Headline/post sentiment from public text",
    price: "Public price move confirmation",
    volume: "Public relative volume confirmation",
    rank: "Lower rank is better",
  };
  return copy[metric];
}

function updateRangeNote() {
  const note = byId("rangeNote");
  if (!note) return;
  const available = selectedRangeSnapshots().length;
  const label = selectedDays === "all" ? "All" : `${selectedDays}D`;
  const wantMulti = selectedDays === "all" || Number(selectedDays) > 1;
  if (wantMulti && available <= 1) {
    note.textContent = `⚠ Only ${available} day of history so far — ${label} view is showing today's snapshot. History builds automatically with each daily refresh.`;
    note.classList.add("range-note-warn");
  } else if (available <= 1) {
    note.textContent = "Showing today's snapshot. History builds automatically with each daily refresh.";
    note.classList.remove("range-note-warn");
  } else {
    note.textContent = `${label} view is aggregating ${available} daily snapshots.`;
    note.classList.remove("range-note-warn");
  }
}

function renderDetail(items, top50) {
  const selected = items.find((item) => item.ticker === selectedTicker) || top50[0];
  if (!selected) return;
  const rank = items.findIndex((item) => item.ticker === selected.ticker) + 1;
  byId("selectedRank").textContent = `Signal rank #${rank}`;
  byId("selectedTicker").textContent = selected.ticker;
  byId("selectedName").textContent = selected.name;
  const max = Math.max(...SOURCES.map((source) => selected.sources[source] || 0), 1);
  byId("sourceBreakdown").innerHTML = SOURCES.map(
    (source) => `
      <div class="source-row">
        <span>${source}</span>
        <div class="source-track"><div class="source-fill" style="width:${((selected.sources[source] || 0) / max) * 100}%; background:${SOURCE_COLORS[source]}"></div></div>
        <strong>${shortFmt.format(selected.sources[source] || 0)}</strong>
      </div>`
  ).join("");

  const latest = selected.latest?.slice(0, 4) || [];
  const shortMentions = selected.sources["FINRA Short Volume"] || 0;
  const sourceCount = SOURCES.filter((source) => (selected.sources[source] || 0) > 0).length;
  const notes = [
    trendInterpretation(selected),
    `${selected.ticker} scores ${selected.signalScore.toFixed(0)}/100 using only real public no-key data.`,
    `${sourceCount} source${sourceCount === 1 ? "" : "s"} active${shortMentions ? `, including FINRA short-volume pressure` : ""}.`,
    `Sentiment ${sentimentLabel(selected.sentiment).toLowerCase()}, quote ${formatPrice(selected.lastPrice)}${selected.quoteAsOf ? ` as of ${formatShortDateTime(selected.quoteAsOf)}` : ""}, price move ${selected.priceMove >= 0 ? "+" : ""}${selected.priceMove.toFixed(1)}%, volume ${selected.relativeVolume.toFixed(1)}x.`,
    ...latest.map((item) => `${item.source}: ${item.title}`),
  ];
  byId("attentionNotes").innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

// ---- Phase 1: "Why it's trending" interpretation layer ----
// Turns raw metrics into plain-English catalyst chips and a one-line takeaway,
// using only data already in the snapshot (no new dependencies).
function trendHighlights(item) {
  const tags = [];
  const wsb = item.sources["Wallstreetbets"] || 0;
  const redditFin = item.sources["Reddit Finance"] || 0;
  const social = wsb + redditFin;
  const newsSources = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch"];
  const newsCount = newsSources.reduce((sum, source) => sum + (item.sources[source] || 0), 0);
  const shortVol = item.sources["FINRA Short Volume"] || 0;
  const secFilings = item.sources["SEC Filings"] || 0;

  if (item.relativeVolume >= 1.3) tags.push({ icon: "📈", text: `${item.relativeVolume.toFixed(1)}× normal volume` });
  if (item.momentum >= 20) tags.push({ icon: "🚀", text: `+${item.momentum.toFixed(0)}% mentions vs prior` });
  if (social >= 3) tags.push({ icon: "🔥", text: `${fmt.format(social)} social mentions` });
  if (item.sentiment > 0.25) tags.push({ icon: "🟢", text: "Bullish chatter" });
  else if (item.sentiment < -0.18) tags.push({ icon: "🔴", text: "Bearish chatter" });
  if (item.priceMove >= 3) tags.push({ icon: "💹", text: `+${item.priceMove.toFixed(1)}% price` });
  if (shortVol > 0) tags.push({ icon: "🩳", text: "Elevated short volume" });
  if (secFilings > 0) tags.push({ icon: "📄", text: "Fresh SEC filing" });
  if (newsCount >= 4) tags.push({ icon: "📰", text: `${fmt.format(newsCount)} news hits` });
  return tags.slice(0, 4);
}

function trendInterpretation(item) {
  const wsb = item.sources["Wallstreetbets"] || 0;
  const redditFin = item.sources["Reddit Finance"] || 0;
  const social = wsb + redditFin;
  const newsSources = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch"];
  const newsCount = newsSources.reduce((sum, source) => sum + (item.sources[source] || 0), 0);
  const volHot = item.relativeVolume >= 1.3;
  const priceHot = item.priceMove >= 3;
  const momentumHot = item.momentum >= 20;

  // Quiet mover: trading volume jumping without a big news/social crowd yet.
  if (volHot && social < 3 && newsCount < 4) {
    return `Under-the-radar: trading volume is running ${item.relativeVolume.toFixed(1)}× normal${priceHot ? ` and price is up ${item.priceMove.toFixed(1)}%` : ""}, but the crowd hasn't piled in yet — an early mover worth a look.`;
  }
  // Social-led attention.
  if (social >= 3 && social >= newsCount) {
    return `Retail-driven: ${fmt.format(social)} social mentions are leading the attention${momentumHot ? `, up ${item.momentum.toFixed(0)}% vs the prior snapshot` : ""}${volHot ? `, with volume ${item.relativeVolume.toFixed(1)}× normal` : ""}.`;
  }
  // News-led attention.
  if (newsCount >= 4) {
    return `News-driven: ${fmt.format(newsCount)} headlines are fueling attention${priceHot ? `, and price is confirming with a ${item.priceMove.toFixed(1)}% move` : ""}${volHot ? ` on ${item.relativeVolume.toFixed(1)}× volume` : ""}.`;
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

function setPreset(days) {
  selectedDays = days === "all" ? "all" : Number(days);
  const generated = new Date(snapshot?.generatedAt || Date.now());
  const start = new Date(generated);
  if (days === "all") {
    start.setDate(generated.getDate() - 119);
  } else {
    start.setDate(generated.getDate() - Number(days) + 1);
  }
  byId("startDate").value = isoDate(start);
  byId("endDate").value = isoDate(generated);
  render();
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
  document.querySelectorAll(".preset").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".preset").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      setPreset(button.dataset.days);
    });
  });
  ["startDate", "endDate", "metricSelect", "tickerSearch"].forEach((id) => byId(id).addEventListener("input", render));
  document.querySelectorAll('input[name="source"]').forEach((input) => input.addEventListener("change", render));
  byId("clearFocus").addEventListener("click", () => {
    byId("tickerSearch").value = "";
    selectedTicker = "";
    render();
  });
  byId("viewSignal").addEventListener("click", () => setRankMode("signal"));
  byId("viewMentions").addEventListener("click", () => setRankMode("mentions"));
  byId("viewMomentum").addEventListener("click", () => setRankMode("momentum"));
  byId("capLarge").addEventListener("click", () => setCapFilter(capFilter === "large" ? "all" : "large"));
  byId("capSmall").addEventListener("click", () => setCapFilter(capFilter === "small" ? "all" : "small"));
  byId("refreshData").addEventListener("click", async () => {
    await loadSnapshot(true);
    render();
  });
  byId("exportCsv").addEventListener("click", exportCsv);
  window.addEventListener("resize", render);
}

function setRankMode(mode) {
  rankMode = mode;
  byId("viewSignal").classList.toggle("active", mode === "signal");
  byId("viewMentions").classList.toggle("active", mode === "mentions");
  byId("viewMomentum").classList.toggle("active", mode === "momentum");
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
  const snapshots = historySnapshots();
  const generated = new Date(snapshot?.generatedAt || snapshots.at(-1)?.generatedAt || Date.now());
  const min = snapshots[0]?.date ? new Date(`${snapshots[0].date}T00:00:00`) : new Date(generated);
  if (!snapshots[0]?.date) min.setDate(generated.getDate() - 119);
  byId("startDate").min = isoDate(min);
  byId("startDate").max = isoDate(generated);
  byId("endDate").min = isoDate(min);
  byId("endDate").max = isoDate(generated);
  bindEvents();
  if (loaded) setPreset("1");
  else renderEmptyState();
}

init();
