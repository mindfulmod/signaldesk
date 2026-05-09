const SOURCES = [
  "Wallstreetbets",
  "Reddit Finance",
  "SEC Filings",
  "Yahoo Public News",
  "CNBC",
  "MarketWatch",
  "Price/Volume",
];

const SOURCE_COLORS = {
  Wallstreetbets: "#b3414a",
  "Reddit Finance": "#7a5a40",
  "SEC Filings": "#5e7468",
  "Yahoo Public News": "#ad6b12",
  CNBC: "#386c87",
  MarketWatch: "#355b48",
  "Price/Volume": "#111f4d",
};

const LINE_COLORS = ["#146c43", "#315fba", "#b3414a", "#ad6b12", "#087d7f", "#7255b7", "#8f4b2e", "#3f6f53"];

let snapshot = null;
let selectedTicker = "";
let rankMode = "signal";

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

async function loadSnapshot() {
  if (window.SIGNALDESK_DATA?.dataMode === "real-public-no-key") {
    snapshot = window.SIGNALDESK_DATA;
    return true;
  }

  try {
    const response = await fetch(`data/signals.json?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("No real data snapshot found.");
    snapshot = await response.json();
    return snapshot?.dataMode === "real-public-no-key";
  } catch {
    snapshot = null;
    return false;
  }
}

function realSignals() {
  if (!snapshot?.signals?.length) return [];
  return snapshot.signals.map((item) => ({
    ticker: item.ticker,
    name: item.name,
    mentions: Number(item.mentions) || 0,
    momentum: Number(item.momentum) || 0,
    sentiment: Number(item.sentiment) || 0,
    lastPrice: Number.isFinite(Number(item.lastPrice)) ? Number(item.lastPrice) : null,
    priceMove: Number(item.priceMove) || 0,
    relativeVolume: Number(item.relativeVolume) || 1,
    optionsActivity: Number(item.optionsActivity) || 0,
    signalScore: Number(item.signalScore) || 0,
    sources: Object.fromEntries(SOURCES.map((source) => [source, Number(item.sources?.[source]) || 0])),
    latest: item.latest || [],
  }));
}

function filteredSignals() {
  const state = getState();
  const signals = realSignals()
    .map((item) => ({
      ...item,
      mentions: state.sources.reduce((sum, source) => sum + (item.sources[source] || 0), 0),
    }))
    .filter((item) => item.mentions > 0)
    .filter((item) => (!state.query ? true : `${item.ticker} ${item.name}`.toUpperCase().includes(state.query)));

  return signals.sort(sortForMode);
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
  const top30 = items.slice(0, 30);
  if (!selectedTicker || !top30.some((item) => item.ticker === selectedTicker)) {
    selectedTicker = top30[0]?.ticker || "";
  }

  updateStatus();
  updateMetrics(items);
  renderBuyCandidates(items);
  renderTable(top30);
  renderChart(state, items);
  renderDetail(items, top30);
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
  const signal = clamp(0, 1, item.signalScore / 100);
  const momentum = clamp(0, 1, (item.momentum + 10) / 80);
  const sentiment = clamp(0, 1, (item.sentiment + 0.2) / 0.65);
  const price = clamp(0, 1, (item.priceMove + 1) / 7);
  const volume = clamp(0, 1, item.relativeVolume / 2.5);
  const sourceBreadth = SOURCES.filter((source) => (item.sources[source] || 0) > 0).length / SOURCES.length;
  return 100 * (0.34 * signal + 0.18 * momentum + 0.16 * sentiment + 0.14 * price + 0.1 * volume + 0.08 * sourceBreadth);
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
  const sourceCount = SOURCES.filter((source) => (item.sources[source] || 0) > 0).length;
  reasons.push(`${sourceCount} public sources detected`);
  return reasons.slice(0, 4);
}

function updateStatus() {
  const warnings = snapshot.failures?.length ? ` Source warnings: ${snapshot.failures.length}.` : "";
  setDataStatus(
    `Real public no-key data loaded: ${formatDateTime(snapshot.generatedAt)}. Sources: Reddit public JSON, SEC EDGAR, public news RSS, and public price/volume data.${warnings}`
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
  byId("rankSubhead").textContent = `Showing ${items.length} real-data tickers`;
  byId("rankingBody").innerHTML = items
    .map((item, index) => {
      const total = Math.max(1, item.mentions);
      const sourceBars = SOURCES.map(
        (source) => `<span style="width:${((item.sources[source] || 0) / total) * 100}%; background:${SOURCE_COLORS[source]}"></span>`
      ).join("");
      const momentumClass = item.momentum >= 0 ? "up" : "down";
      const sentimentClass = item.sentiment >= 0 ? "up" : "down";
      return `
        <tr class="${item.ticker === selectedTicker ? "selected" : ""}" data-ticker="${item.ticker}">
          <td>#${index + 1}</td>
          <td>
            <div class="ticker-cell">
              <span class="ticker-icon">${item.ticker.slice(0, 2)}</span>
              <span>${item.ticker}<small>${item.name}</small></span>
            </div>
          </td>
          <td><span class="signal-pill">${item.signalScore.toFixed(0)}</span></td>
          <td>${formatPrice(item.lastPrice)}</td>
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
  const labels = ["Previous", "Latest"];
  const series = selected.map((item, index) => ({
    item,
    color: LINE_COLORS[index % LINE_COLORS.length],
    values: twoPointValues(item, state.metric),
  }));
  const values = series.flatMap((line) => line.values);
  const min = metricMin(state.metric, values);
  const max = metricMax(state.metric, values);
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const x = (index) => padding.left + index * innerW;
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
        <circle cx="${x(1)}" cy="${y(line.values[1])}" r="${line.item.ticker === selectedTicker ? 4.5 : 3.2}" fill="${line.color}"></circle>`;
    })
    .join("");
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"></rect>
    ${axis}
    <text class="axis-label" x="${padding.left}" y="${height - 10}">${labels[0]}</text>
    <text class="axis-label" text-anchor="end" x="${width - padding.right}" y="${height - 10}">${labels[1]}</text>
    ${lines}`;
  byId("chartLegend").innerHTML = series
    .map((line) => `<span class="legend-item"><span class="legend-swatch" style="background:${line.color}"></span>${line.item.ticker}</span>`)
    .join("");
  byId("chartSubhead").textContent = chartDescription(state.metric);
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

function renderDetail(items, top30) {
  const selected = items.find((item) => item.ticker === selectedTicker) || top30[0];
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
  const notes = [
    `${selected.ticker} scores ${selected.signalScore.toFixed(0)}/100 using only real public no-key data.`,
    `Sentiment ${sentimentLabel(selected.sentiment).toLowerCase()}, price ${selected.priceMove >= 0 ? "+" : ""}${selected.priceMove.toFixed(1)}%, volume ${selected.relativeVolume.toFixed(1)}x.`,
    ...latest.map((item) => `${item.source}: ${item.title}`),
  ];
  byId("attentionNotes").innerHTML = notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
}

function sentimentLabel(value) {
  if (value > 0.25) return "Bullish";
  if (value > 0.08) return "Positive";
  if (value < -0.18) return "Bearish";
  if (value < -0.04) return "Soft";
  return "Neutral";
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function setPreset(days) {
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
  const data = filteredSignals().slice(0, 30);
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
  byId("refreshData").addEventListener("click", async () => {
    await loadSnapshot();
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

function setDataStatus(message) {
  byId("dataStatus").textContent = message;
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

async function init() {
  const loaded = await loadSnapshot();
  const generated = new Date(snapshot?.generatedAt || Date.now());
  const min = new Date(generated);
  min.setDate(generated.getDate() - 119);
  byId("startDate").min = isoDate(min);
  byId("startDate").max = isoDate(generated);
  byId("endDate").min = isoDate(min);
  byId("endDate").max = isoDate(generated);
  bindEvents();
  if (loaded) setPreset("7");
  else renderEmptyState();
}

init();
