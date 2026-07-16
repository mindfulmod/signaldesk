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

  // Mirrors scripts/update-data.mjs's headlineQualityScore/rankHeadlines --
  // client-side range aggregation (multi-day "Full saved history" view)
  // concatenates each day's already-ranked `latest` list, so without
  // re-ranking after the merge, an older day's real headline can still get
  // pushed out of the top 6 by a newer day's synthetic activity-count entry.
  const IMPACT_WORDS_RE = /\b(surge|surges|surged|soar|soars|plunge|plunges|plunged|tumble|tumbles|sink|sinks|slump|jump|jumps|jumped|rally|rallies|crash|crashes|spike|spikes|drop|drops|dropped|fall|falls|fell|slide|slides|rise|rises|rose|gain|gains|gained|beat|beats|miss|misses|cut|cuts|raise|raises|raised|hike|hikes|warn|warns|warned|guidance|earnings|upgrade|downgrade|spook|spooks|spooked|%)\b/i;
  const CATALYST_WORDS_RE =
    /\b(acquire|acquires|acquired|acquiring|acquisition|merger|merges|merged|buyout|takeover|divest|divestiture|spinoff|spin-off|bankruptcy|delisting|activist|antitrust|lawsuit|settlement|investigation|recall|breach)\b/i;
  const SYNTHETIC_TITLE_PATTERNS = [/social mentions on ApeWisdom/i, /^Trending on StockTwits/i, /FINRA short volume/i, /,\s*price\s+[+-]?\d/i];
  const NEWS_ARTICLE_SOURCES = new Set(["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings"]);
  const headlineQualityScore = (entry) => {
    const title = entry?.title || "";
    if (!title) return -1;
    if (SYNTHETIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return 0;
    let score = 1;
    if (CATALYST_WORDS_RE.test(title)) score += 3;
    else if (IMPACT_WORDS_RE.test(title)) score += 2;
    return score;
  };
  const rankHeadlines = (entries) =>
    [...entries].sort((a, b) => {
      const scoreDiff = headlineQualityScore(b) - headlineQualityScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.published || 0) - new Date(a.published || 0);
    });
  // Prefer a real published article/filing; fall back to social commentary
  // only when it clearly matches catalyst/impact vocabulary, tagged
  // isNewsArticle: false so the UI can label it as chatter, not reporting.
  const pickTopHeadline = (rankedItems) => {
    const newsItem = rankedItems.find((entry) => NEWS_ARTICLE_SOURCES.has(entry.source) && headlineQualityScore(entry) >= 1);
    if (newsItem) return { ...newsItem, isNewsArticle: true };
    const socialItem = rankedItems.find((entry) => headlineQualityScore(entry) >= 2);
    return socialItem ? { ...socialItem, isNewsArticle: false } : null;
  };

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
          topHeadline: item.topHeadline || null,
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

        return scoreSignals(base, selectedSources)
          .map((item) => ({ ...item, discovery: typeof discoveryProfile === "function" ? discoveryProfile(item) : null }))
          .sort(sortForMode);
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
        const header = ["rank", "ticker", "name", "market_price", "setup_score", "attention_score", "stage", "evidence", "risk_flags", "mentions", "momentum_percent", "sentiment", "price_move_percent", "relative_volume", ...LIVE_SOURCES];
        const lines = [header.join(",")].concat(
          data.map((item, index) => {
            const profile = typeof discoveryProfile === "function" ? (item.discovery || discoveryProfile(item)) : null;
            return [
              index + 1,
              item.ticker,
              `"${String(item.name || item.ticker).replaceAll('"', '""')}"`,
              item.lastPrice ?? "",
              profile?.score ?? "",
              item.signalScore.toFixed(1),
              `"${profile?.stage || ""}"`,
              `"${profile?.evidence || ""}"`,
              `"${(profile?.risks || []).join(" | ")}"`,
              item.mentions,
              item.momentum.toFixed(2),
              item.sentiment.toFixed(3),
              item.priceMove.toFixed(2),
              item.relativeVolume.toFixed(2),
              ...LIVE_SOURCES.map((source) => item.sources[source] || 0),
            ].join(",");
          })
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
        topHeadline: pickTopHeadline(rankHeadlines(item.latest)),
        latest: rankHeadlines(item.latest).slice(0, 6),
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
    const anchor = document.getElementById("freshnessNotice") || document.querySelector(".page-hero") || document.querySelector(".buy-panel");
    if (!anchor) return;
    anchor.insertAdjacentHTML(
      "afterend",
      `<section class="market-pulse" aria-labelledby="pulse-heading">
        <div class="section-head compact">
          <div>
            <h2 id="pulse-heading">Driving the tape</h2>
            <p>The news behind today's biggest market moves — headlines that pushed a stock and rattled the tape</p>
          </div>
        </div>
        <div class="pulse-headlines" id="pulseHeadlines"></div>
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
    const latestTime = new Date(latest?.generatedAt || 0).getTime();
    const stale = Number.isFinite(latestTime) && latestTime > 0 && Date.now() - latestTime > 36 * 60 * 60 * 1000;
    note.classList.toggle("range-note-warn", stale);
    if (dataWindowMode === "history") {
      note.textContent =
        snapshots.length > 1
          ? `Full saved history is aggregating ${snapshots.length} daily snapshots.`
          : "Full saved history needs more successful refreshes before range trends are meaningful.";
      return;
    }
    note.textContent = latest
      ? `${stale ? "Stale snapshot" : "Latest refresh"} from ${formatShort(latest.generatedAt)}. ${stale ? "Treat signals as historical until the next successful refresh." : "Switch to Full saved history for accumulated trends."}`
      : "Latest refresh window has no saved data yet.";
  }

  function refreshMarketPulse() {
    const container = document.getElementById("pulseHeadlines");
    if (!container) return;
    const headlines = marketNewsFeed(8);
    if (!headlines.length) {
      container.innerHTML = emptyStateMarkup();
      return;
    }
    container.innerHTML = headlines
      .map((entry, index) => renderHeadline(entry, index === 0))
      .join("");
  }

  // Standalone market-moving-news feed, published by the data pipeline and
  // independent of the ranking table: each entry is a headline that explains a real
  // price move (the pipeline already filtered to news + a notable move and ranked by
  // impact). The frontend just reads, cleans, and renders it.
  function marketNewsFeed(limit) {
    const data = typeof window !== "undefined" ? window.SIGNALDESK_DATA : null;
    const feed = Array.isArray(data?.marketNews) ? data.marketNews : [];
    const published = feed
      .filter((entry) => entry && entry.title && Number.isFinite(Number(entry.priceMove)))
      .slice(0, limit)
      .map((entry) => ({
        ticker: entry.ticker,
        name: entry.name,
        priceMove: Number(entry.priceMove),
        lastPrice: Number(entry.lastPrice),
        relativeVolume: safeRelVol(entry.relativeVolume),
        source: entry.source,
        title: cleanTitle(cleanNewsTitle(entry.source, entry.title)),
        url: entry.url,
        published: entry.published,
        coverage: Number(entry.coverage) || 1,
      }));
    if (published.length) return published;

    // Older snapshots predate the standalone marketNews field. Derive the same
    // evidence-first view client-side so a deploy remains useful until the next
    // scheduled updater run publishes the new field.
    const items = typeof filteredSignals === "function" ? filteredSignals() : [];
    return items
      .filter((item) => Number.isFinite(Number(item.priceMove)) && Math.abs(Number(item.priceMove)) >= 1.5)
      .map((item) => {
        const stories = (item.latest || [])
          .filter((entry) => NEWS_SOURCES.includes(entry.source) && entry.title)
          .sort((a, b) => new Date(b.published || 0) - new Date(a.published || 0));
        return { item, stories };
      })
      .filter((entry) => entry.stories.length)
      .sort((a, b) =>
        Math.abs(Number(b.item.priceMove || 0)) + b.stories.length * 5 + Math.max(0, safeRelVol(b.item.relativeVolume) - 1) * 4 -
        (Math.abs(Number(a.item.priceMove || 0)) + a.stories.length * 5 + Math.max(0, safeRelVol(a.item.relativeVolume) - 1) * 4)
      )
      .slice(0, limit)
      .map(({ item, stories }) => ({
        ticker: item.ticker,
        name: item.name,
        priceMove: Number(item.priceMove),
        lastPrice: Number(item.lastPrice),
        relativeVolume: safeRelVol(item.relativeVolume),
        source: stories[0].source,
        title: cleanTitle(cleanNewsTitle(stories[0].source, stories[0].title)),
        url: stories[0].url,
        published: stories[0].published,
        coverage: stories.length,
      }));
  }

  // GDELT headlines arrive with an appended "<domain> <country>" used upstream for
  // ticker matching; strip it so the displayed headline reads cleanly.
  function cleanNewsTitle(source, title) {
    let out = String(title || "").replace(/\s+/g, " ").trim();
    if (source === "GDELT News") {
      out = out.replace(/\s+[a-z0-9.-]+\.[a-z]{2,}(\s+[a-z]{2,})?\s*$/i, "");
      out = out.replace(/\s*\.\s*$/, "").trim();
    }
    return out;
  }

  function renderHeadline(entry, featured) {
    const pm = Number(entry.priceMove || 0);
    const rv = safeRelVol(entry.relativeVolume);
    const dir = pm >= 0 ? "up" : "down";
    const price = Number.isFinite(Number(entry.lastPrice)) ? `$${Number(entry.lastPrice).toFixed(2)}` : "";
    const moveBits = [`${entry.ticker} ${signed(pm)}%`];
    if (rv >= 1.5) moveBits.push(`${rv.toFixed(1)}× vol`);
    if (price) moveBits.push(price);
    const when = relativeTime(entry.published);
    const more = entry.coverage > 1 ? ` · +${entry.coverage - 1} more article${entry.coverage - 1 === 1 ? "" : "s"}` : "";
    const href = entry.url || `https://finance.yahoo.com/quote/${encodeURIComponent(entry.ticker)}`;
    return `<a class="pulse-headline${featured ? " featured" : ""}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-dir="${dir}">
      <span class="ph-badge">${signed(pm)}%</span>
      <span class="ph-body">
        <span class="ph-headline">${escapeHtml(entry.title)}</span>
        <span class="ph-meta"><span class="ph-src ph-src-news">${escapeHtml(entry.source)}</span>${escapeHtml(moveBits.join(" · "))}${when ? ` · ${when}` : ""}${more}</span>
      </span>
    </a>`;
  }

  // Honest empty state — explains *why* there are no headlines, including when
  // the latest refresh was throttled on news sources.
  function emptyStateMarkup() {
    const data = typeof window !== "undefined" ? window.SIGNALDESK_DATA : null;
    const failures = Array.isArray(data?.failures) ? data.failures : [];
    const newsThrottled = failures.some((f) => NEWS_SOURCES.some((src) => String(f).includes(src)));
    const reason = newsThrottled
      ? "The latest refresh was rate-limited on several news feeds, so no market-moving articles came through. Headlines will populate on the next clean refresh."
      : "No market-moving news matched a notable price move in this window. Headlines appear when a covered name moves on a real catalyst.";
    return `<p class="pulse-empty">${reason}</p>`;
  }

  function relativeTime(value) {
    if (!value) return "";
    const then = new Date(value).getTime();
    if (!Number.isFinite(then)) return "";
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.round(hrs / 24);
    return `${days}d ago`;
  }

  function cleanTitle(text) {
    return String(text || "")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
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
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }
      html,
      body {
        max-width: 100%;
        overflow-x: hidden;
      }
      .app-shell,
      .app-body,
      .main-content,
      .dashboard-grid,
      .table-panel,
      .table-scroll {
        min-width: 0;
        max-width: 100%;
      }
      .dashboard-grid > * {
        min-width: 0;
        max-width: 100%;
      }
      .dashboard-grid {
        width: 100%;
        grid-template-columns: minmax(0, 1fr) !important;
      }
      .table-panel {
        width: 100%;
        box-sizing: border-box;
        overflow: hidden;
      }
      .table-scroll {
        width: 100%;
        box-sizing: border-box;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }
      .market-pulse {
        width: min(1320px, 100%);
        margin: 0 auto 16px;
        padding: 18px 20px;
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: var(--radius);
      }
      .pulse-headlines {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .pulse-headline {
        display: flex;
        align-items: flex-start;
        gap: 13px;
        padding: 13px 15px;
        border: 1px solid var(--line);
        border-left: 3px solid var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
        text-decoration: none;
        transition: border-color 160ms var(--ease-out), background 160ms var(--ease-out), transform 160ms var(--ease-out);
      }
      .pulse-headline:hover {
        background: var(--panel-3);
        border-color: var(--line-2);
        transform: translateX(2px);
      }
      .pulse-headline[data-dir="up"] { border-left-color: var(--up); }
      .pulse-headline[data-dir="down"] { border-left-color: var(--down); }
      .pulse-headline.featured {
        background: linear-gradient(180deg, var(--panel-2), var(--panel-3));
        padding: 16px 17px;
      }
      .ph-badge {
        flex: 0 0 auto;
        min-width: 62px;
        padding: 6px 8px;
        border-radius: 8px;
        text-align: center;
        font-family: var(--mono);
        font-weight: 700;
        font-size: 0.86rem;
        line-height: 1.1;
        background: var(--panel-3);
        color: var(--ink);
      }
      .pulse-headline[data-dir="up"] .ph-badge { color: var(--up); }
      .pulse-headline[data-dir="down"] .ph-badge { color: var(--down); }
      .pulse-headline.featured .ph-badge { font-size: 1rem; min-width: 72px; padding: 9px 10px; }
      .ph-body { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
      .ph-headline {
        color: var(--ink);
        font-weight: 700;
        font-size: 0.98rem;
        line-height: 1.32;
        overflow-wrap: anywhere;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .pulse-headline.featured .ph-headline { font-size: 1.12rem; -webkit-line-clamp: 3; }
      .ph-meta {
        color: var(--muted);
        font-size: 0.8rem;
        font-weight: 600;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .ph-src {
        display: inline-block;
        margin-right: 8px;
        padding: 1px 6px;
        border-radius: 5px;
        font-size: 0.68rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        vertical-align: middle;
        background: var(--accent-dim);
        color: var(--accent);
      }
      .pulse-empty {
        margin: 0;
        padding: 18px 16px;
        text-align: center;
        color: var(--muted);
        font-size: 0.9rem;
        line-height: 1.5;
        border: 1px dashed var(--line-2);
        border-radius: var(--radius);
        background: var(--panel-2);
      }
      @media (max-width: 680px) {
        .main-content {
          padding-inline: 8px;
        }
        .page-hero,
        .market-pulse,
        .buy-panel,
        .movers-panel,
        .whatchanged-panel,
        .themes-panel,
        .phraseradar-panel,
        .clusters-panel,
        .springs-panel,
        .calibration-panel,
        .dashboard-grid {
          width: 100%;
          max-width: 100%;
        }
        .market-pulse { padding: 14px; }
        .pulse-headline { padding: 12px; gap: 10px; }
        .ph-badge { min-width: 56px; font-size: 0.8rem; }
        .ph-headline { font-size: 0.94rem; }
        .table-panel {
          padding-inline: 10px;
        }
        .table-scroll table {
          width: max-content;
          min-width: 620px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  install();
})();
