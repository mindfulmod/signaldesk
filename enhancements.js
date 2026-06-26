(() => {
  const LIVE_SOURCES = [
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

  const SOCIAL_SOURCES = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan"];
  const NEWS_SOURCES = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings"];
  const MARKET_SOURCES = ["FINRA Short Volume", "Price/Volume"];
  const WINDOW_KEY = "signaldesk-data-window";

  let dataWindowMode = localStorage.getItem(WINDOW_KEY) || "latest";

  const safeClamp = (min, max, value) => Math.min(max, Math.max(min, value));
  const safeRelVol = (value) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0 || number > 25) return 1;
    return number;
  };
  const sourceCount = (item) => LIVE_SOURCES.filter((source) => (item.sources?.[source] || 0) > 0).length;
  const sourceSum = (item, sources) => sources.reduce((sum, source) => sum + (Number(item.sources?.[source]) || 0), 0);
  const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value || 0).toFixed(1)}`;

  function install() {
    injectStyles();
    installWindowControl();
    installPulsePanel();
    patchSourceAwarePipeline();
    patchRender();
    refreshEnhancements();
  }

  function patchSourceAwarePipeline() {
    if (typeof selectedRangeSnapshots === "function") {
      const originalSelectedRangeSnapshots = selectedRangeSnapshots;
      selectedRangeSnapshots = function enhancedSelectedRangeSnapshots() {
        if (dataWindowMode === "history") {
          const snapshots = historySnapshots();
          return snapshots.length ? snapshots : originalSelectedRangeSnapshots();
        }
        return originalSelectedRangeSnapshots();
      };
    }

    if (typeof previousRangeSnapshots === "function") {
      const originalPreviousRangeSnapshots = previousRangeSnapshots;
      previousRangeSnapshots = function enhancedPreviousRangeSnapshots() {
        if (dataWindowMode === "history") return [];
        return originalPreviousRangeSnapshots();
      };
    }

    if (typeof realSignals === "function") {
      realSignals = function enhancedRealSignals(snapshots = selectedRangeSnapshots(), previousSnapshots = previousRangeSnapshots()) {
        if (snapshots.length > 1 || previousSnapshots.length) {
          return enhancedAggregateSnapshotSignals(snapshots, previousSnapshots);
        }

        const sourceSnapshot = snapshot?.signals?.length ? snapshot : window.SIGNALDESK_DATA;
        if (!sourceSnapshot?.signals?.length) return [];

        const items = sourceSnapshot.signals.map((item) => ({
          ticker: item.ticker,
          name: item.name,
          mentions: Number(item.mentions) || 0,
          momentum: Number(item.momentum) || 0,
          sentiment: Number(item.sentiment) || 0,
          lastPrice: Number.isFinite(Number(item.lastPrice)) ? Number(item.lastPrice) : null,
          quoteAsOf: item.quoteAsOf || null,
          quoteSource: item.quoteSource || null,
          priceMove: Number(item.priceMove) || 0,
          relativeVolume: safeRelVol(item.relativeVolume),
          marketCap: Number.isFinite(Number(item.marketCap)) ? Number(item.marketCap) : null,
          capTier: item.capTier || (typeof capTierFor === "function" ? capTierFor(Number(item.marketCap)) : null),
          description: item.description || null,
          descriptionUrl: item.descriptionUrl || null,
          sector: item.sector || null,
          industry: item.industry || null,
          optionsActivity: Number(item.optionsActivity) || 0,
          sources: Object.fromEntries(LIVE_SOURCES.map((source) => [source, Number(item.sources?.[source]) || 0])),
          latest: item.latest || [],
        }));

        return scoreSignals(items);
      };
    }

    if (typeof filteredSignals === "function") {
      filteredSignals = function enhancedFilteredSignals() {
        const state = getState();
        const selectedSources = state.sources.length ? state.sources : LIVE_SOURCES;
        const base = realSignals()
          .map((item) => ({
            ...item,
            mentions: sourceSum(item, selectedSources),
          }))
          .filter((item) => item.mentions > 0)
          .filter((item) => (!state.query ? true : `${item.ticker} ${item.name}`.toUpperCase().includes(state.query)));

        return scoreSignals(base, selectedSources).sort(sortForMode);
      };
    }

    if (typeof buyScore === "function") {
      buyScore = function enhancedBuyScore(item) {
        const signal = safeClamp(0, 1, item.signalScore / 85);
        const momentum = safeClamp(0, 1, (item.momentum + 10) / 80);
        const sentiment = safeClamp(0, 1, (item.sentiment + 0.2) / 0.65);
        const price = safeClamp(0, 1, (item.priceMove + 1) / 7);
        const volume = safeClamp(0, 1, item.relativeVolume / 2.5);
        const shortPressure = safeClamp(0, 1, (item.sources["FINRA Short Volume"] || 0) / Math.max(8, item.mentions));
        const breadth = sourceCount(item) / LIVE_SOURCES.length;
        return 100 * (0.31 * signal + 0.17 * momentum + 0.15 * sentiment + 0.13 * price + 0.09 * volume + 0.08 * breadth + 0.07 * shortPressure);
      };
    }

    if (typeof attentionStats === "function") {
      attentionStats = function enhancedAttentionStats(item) {
        const social = sourceSum(item, SOCIAL_SOURCES);
        const news = sourceSum(item, NEWS_SOURCES);
        return {
          social,
          news,
          attention: social + news,
          volHot: item.relativeVolume >= VOL_HOT,
          priceHot: item.priceMove >= 3,
          momentumHot: item.momentum >= 20,
        };
      };
    }

    if (typeof exportCsv === "function") {
      exportCsv = function enhancedExportCsv() {
        const data = filteredSignals().slice(0, 50);
        const header = ["rank", "ticker", "name", "market_price", "early_signal", "mentions", "momentum_percent", "sentiment", "price_move_percent", "relative_volume", ...LIVE_SOURCES];
        const lines = [header.join(",")].concat(
          data.map((item, index) =>
            [
              index + 1,
              item.ticker,
              `"${String(item.name || item.ticker).replaceAll('"', '""')}"`,
              item.lastPrice ?? "",
              item.signalScore.toFixed(1),
              item.mentions,
              item.momentum.toFixed(2),
              item.sentiment.toFixed(3),
              item.priceMove.toFixed(2),
              item.relativeVolume.toFixed(2),
              ...LIVE_SOURCES.map((source) => item.sources[source] || 0),
            ].join(",")
          )
        );
        const blob = new Blob([lines.join("\n")], { type: "text/csv" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `stock-real-public-signals-${isoDate(new Date((window.SIGNALDESK_DATA || {}).generatedAt || Date.now()))}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      };
    }
  }

  function enhancedAggregateSnapshotSignals(snapshots, previousSnapshots = []) {
    const previousMentions = mentionTotals(previousSnapshots);
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
            sources: Object.fromEntries(LIVE_SOURCES.map((source) => [source, 0])),
            latest: [],
          };

        item.mentions += mentions;
        item.weightedSentiment += (Number(signal.sentiment) || 0) * mentions;
        item.weightedPrice += (Number(signal.priceMove) || 0) * mentions;
        item.weightedVolume += safeRelVol(signal.relativeVolume) * mentions;
        LIVE_SOURCES.forEach((source) => {
          item.sources[source] += Number(signal.sources?.[source]) || 0;
        });

        if ((daily.generatedAt || "") >= item.latestGeneratedAt && Number.isFinite(Number(signal.lastPrice))) {
          item.lastPrice = Number(signal.lastPrice);
          item.quoteAsOf = signal.quoteAsOf || null;
          item.quoteSource = signal.quoteSource || null;
          item.marketCap = Number.isFinite(Number(signal.marketCap)) ? Number(signal.marketCap) : item.marketCap;
          item.capTier = signal.capTier || (typeof capTierFor === "function" ? capTierFor(Number(signal.marketCap)) : item.capTier);
          item.latestGeneratedAt = daily.generatedAt || "";
        }

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

    const items = [...map.values()].map((item) => {
      const prev = previousMentions.get(item.ticker) || 0;
      const momentum = prev ? ((item.mentions - prev) / prev) * 100 : snapshots.length > 1 ? 0 : item.mentions > 2 ? 35 : 0;
      const sentiment = item.mentions ? item.weightedSentiment / item.mentions : 0;
      const priceMove = item.mentions ? item.weightedPrice / item.mentions : 0;
      const relativeVolume = item.mentions ? item.weightedVolume / item.mentions : 1;
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
        signalScore: 0,
        sources: item.sources,
        latest: item.latest.slice(0, 6),
      };
    });

    return scoreSignals(items).sort((a, b) => b.signalScore - a.signalScore).slice(0, 75);
  }

  function scoreSignals(items, activeSources = LIVE_SOURCES) {
    const maxMentions = Math.max(1, ...items.map((item) => Number(item.mentions) || 0));
    const rawScores = items.map((item) => {
      const breadth = activeSources.filter((source) => (item.sources?.[source] || 0) > 0).length / LIVE_SOURCES.length;
      return (
        30 * Math.sqrt((Number(item.mentions) || 0) / maxMentions) +
        22 * safeClamp(0, 1, (Number(item.momentum) || 0) / 80 + 0.25) +
        18 * safeClamp(0, 1, ((Number(item.sentiment) || 0) + 0.25) / 0.7) +
        12 * safeClamp(0, 1, (Number(item.priceMove) || 0) / 6) +
        10 * safeClamp(0, 1, safeRelVol(item.relativeVolume) / 2.5) +
        8 * breadth
      );
    });
    const scale = 85 / Math.max(1, ...rawScores);
    return items.map((item, index) => ({
      ...item,
      relativeVolume: safeRelVol(item.relativeVolume),
      signalScore: safeClamp(0, 100, rawScores[index] * scale),
    }));
  }

  function mentionTotals(snapshots) {
    const totals = new Map();
    snapshots.forEach((daily) => {
      (daily.signals || []).forEach((signal) => {
        totals.set(signal.ticker, (totals.get(signal.ticker) || 0) + (Number(signal.mentions) || 0));
      });
    });
    return totals;
  }

  function patchRender() {
    if (typeof render !== "function" || render.__signaldeskEnhanced) return;
    const originalRender = render;
    render = function enhancedRender() {
      originalRender();
      refreshEnhancements();
    };
    render.__signaldeskEnhanced = true;
  }

  function installWindowControl() {
    const section = document.getElementById("range-heading")?.closest(".control-group");
    if (!section || document.getElementById("windowMode")) return;
    const note = document.getElementById("rangeNote");
    const wrapper = document.createElement("label");
    wrapper.className = "field window-mode-field";
    wrapper.innerHTML = `
      <span>Data window</span>
      <select id="windowMode">
        <option value="latest">Latest refresh window</option>
        <option value="history">Full saved history</option>
      </select>`;
    section.insertBefore(wrapper, note || null);
    const select = document.getElementById("windowMode");
    select.value = dataWindowMode;
    select.addEventListener("change", () => {
      dataWindowMode = select.value;
      localStorage.setItem(WINDOW_KEY, dataWindowMode);
      if (typeof render === "function") render();
      else refreshEnhancements();
    });
  }

  function installPulsePanel() {
    if (document.querySelector(".market-pulse")) return;
    const metrics = document.querySelector(".metrics-grid");
    if (!metrics) return;
    metrics.insertAdjacentHTML(
      "afterend",
      `<section class="market-pulse" aria-labelledby="pulse-heading">
        <div class="section-head compact">
          <div>
            <h2 id="pulse-heading">Market Pulse</h2>
            <p>Higher-confidence context for longer-term watchlist review</p>
          </div>
        </div>
        <div class="pulse-grid">
          <article id="pulseToneCard">
            <span>Market tone</span>
            <strong id="pulseTone">Loading</strong>
            <p id="pulseToneMeta">Checking broad price confirmation</p>
          </article>
          <article id="pulseQualityCard">
            <span>Quality setups</span>
            <strong id="pulseQuality">0</strong>
            <p id="pulseQualityMeta">High-confidence candidates</p>
          </article>
          <article id="pulseMoveCard">
            <span>Interesting movement</span>
            <strong id="pulseMove">-</strong>
            <p id="pulseMoveMeta">Waiting for price and volume confirmation</p>
          </article>
          <article id="pulseBreadthCard">
            <span>Breadth</span>
            <strong id="pulseBreadth">-</strong>
            <p id="pulseBreadthMeta">Positive vs negative price confirmation</p>
          </article>
        </div>
      </section>`
    );
  }

  function refreshEnhancements() {
    refreshWindowNote();
    refreshMarketPulse();
    refreshFooterCadence();
  }

  function refreshWindowNote() {
    const note = document.getElementById("rangeNote");
    if (!note || typeof historySnapshots !== "function") return;
    const snapshots = historySnapshots();
    const latest = currentSnapshotEntry?.();
    if (dataWindowMode === "history") {
      note.textContent =
        snapshots.length > 1
          ? `Full saved history is aggregating ${snapshots.length} daily snapshots.`
          : "Full saved history needs more successful refreshes before range trends are meaningful.";
      return;
    }
    note.textContent = latest
      ? `Latest refresh window from ${formatShort(latest.generatedAt)}. Switch to Full saved history for accumulated trends.`
      : "Latest refresh window has no saved data yet.";
  }

  function refreshMarketPulse() {
    const items = typeof filteredSignals === "function" ? filteredSignals() : [];
    if (!items.length || !document.getElementById("pulseTone")) return;
    const tone = marketToneInfo(items);
    const quality = qualityInfo(items);
    const move = movementInfo(items);
    const breadth = breadthInfo(items);
    writePulse("pulseTone", "pulseToneMeta", "pulseToneCard", tone);
    writePulse("pulseQuality", "pulseQualityMeta", "pulseQualityCard", quality);
    writePulse("pulseMove", "pulseMoveMeta", "pulseMoveCard", move);
    writePulse("pulseBreadth", "pulseBreadthMeta", "pulseBreadthCard", breadth);
  }

  function writePulse(valueId, metaId, cardId, info) {
    document.getElementById(valueId).textContent = info.label;
    document.getElementById(metaId).textContent = info.meta;
    document.getElementById(cardId).dataset.status = info.status;
  }

  function marketToneInfo(items) {
    const broadTickers = new Set(["SPY", "QQQ", "IWM", "DIA"]);
    const broad = items.filter((item) => broadTickers.has(item.ticker) && Number.isFinite(Number(item.priceMove)));
    const sample = broad.length ? broad : items.filter((item) => Number.isFinite(Number(item.priceMove))).slice(0, 20);
    if (!sample.length) return { label: "Unknown", meta: "No quote-confirmed tickers loaded", status: "warn" };
    const avgMove = sample.reduce((sum, item) => sum + Number(item.priceMove || 0), 0) / sample.length;
    const scope = broad.length ? broad.map((item) => item.ticker).join(", ") : "top signal universe";
    if (avgMove >= 0.7) return { label: "Risk-on", meta: `${scope}: ${signed(avgMove)}% average price move`, status: "good" };
    if (avgMove <= -0.7) return { label: "Defensive", meta: `${scope}: ${signed(avgMove)}% average price move`, status: "bad" };
    return { label: "Mixed", meta: `${scope}: ${signed(avgMove)}% average price move`, status: "warn" };
  }

  function qualityInfo(items) {
    const qualified = items
      .filter((item) => item.signalScore >= 58 && item.mentions >= 2 && sourceCount(item) >= 2 && Number.isFinite(Number(item.lastPrice)))
      .sort((a, b) => b.signalScore - a.signalScore);
    if (!qualified.length) return { label: "0", meta: "No high-confidence setups in this window", status: "warn" };
    const top = qualified[0];
    return {
      label: String(qualified.length),
      meta: `Top: ${top.ticker}, ${top.signalScore.toFixed(0)}/100 signal across ${sourceCount(top)} sources`,
      status: qualified.length >= 3 ? "good" : "warn",
    };
  }

  function movementInfo(items) {
    const candidate = [...items]
      .filter((item) => Number.isFinite(Number(item.lastPrice)))
      .map((item) => ({
        ...item,
        movementScore:
          Math.abs(Number(item.priceMove || 0)) * 1.7 +
          Math.max(0, safeRelVol(item.relativeVolume) - 1) * 7 +
          Math.max(0, Number(item.momentum || 0)) / 12 +
          sourceCount(item) * 0.5,
      }))
      .sort((a, b) => b.movementScore - a.movementScore)[0];
    if (!candidate || candidate.movementScore < 3) {
      return { label: "-", meta: "No strong price/volume divergence yet", status: "warn" };
    }
    return {
      label: candidate.ticker,
      meta: `${signed(candidate.priceMove)}% price, ${safeRelVol(candidate.relativeVolume).toFixed(1)}x volume, ${signed(candidate.momentum)}% mention momentum`,
      status: candidate.priceMove >= 0 ? "good" : "bad",
    };
  }

  function breadthInfo(items) {
    const priced = items.filter((item) => Number.isFinite(Number(item.lastPrice)));
    if (!priced.length) return { label: "Unknown", meta: "No quote-confirmed tickers loaded", status: "warn" };
    const positive = priced.filter((item) => Number(item.priceMove) > 0.25).length;
    const negative = priced.filter((item) => Number(item.priceMove) < -0.25).length;
    const neutral = priced.length - positive - negative;
    const ratio = positive / Math.max(1, positive + negative);
    const status = ratio >= 0.58 ? "good" : ratio <= 0.42 ? "bad" : "warn";
    return {
      label: `${positive}/${priced.length}`,
      meta: `${positive} positive, ${negative} negative, ${neutral} flat price confirmations`,
      status,
    };
  }

  function refreshFooterCadence() {
    const footer = document.querySelector(".footer-sub");
    if (footer) footer.textContent = "Refreshes market weekdays at 9:17, 12:17, 15:17, and 17:17 ET";
  }

  function formatShort(value) {
    if (!value) return "unknown time";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }

  function injectStyles() {
    if (document.getElementById("signaldesk-enhancement-styles")) return;
    const style = document.createElement("style");
    style.id = "signaldesk-enhancement-styles";
    style.textContent = `
      .window-mode-field { margin-top: 12px; }
      .market-pulse {
        width: min(1320px, 100%);
        margin: 0 auto 16px;
        padding: 18px 20px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
      }
      .pulse-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
      }
      .pulse-grid article {
        min-width: 0;
        padding: 15px;
        border: 1px solid var(--line);
        border-left: 3px solid var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      .pulse-grid article[data-status="good"] { border-left-color: var(--up); }
      .pulse-grid article[data-status="warn"] { border-left-color: var(--amber); }
      .pulse-grid article[data-status="bad"] { border-left-color: var(--down); }
      .pulse-grid span {
        display: block;
        margin-bottom: 8px;
        color: var(--faint);
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.07em;
      }
      .pulse-grid strong {
        display: block;
        color: var(--ink);
        font-size: clamp(1.18rem, 1.8vw, 1.55rem);
        line-height: 1.08;
        overflow-wrap: anywhere;
      }
      .pulse-grid p {
        margin: 9px 0 0;
        color: var(--muted);
        font-size: 0.83rem;
        line-height: 1.4;
      }
      @media (max-width: 1180px) {
        .pulse-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      @media (max-width: 680px) {
        .market-pulse { padding: 14px; }
        .pulse-grid { grid-template-columns: 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  install();
})();
