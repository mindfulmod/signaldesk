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
    "Press Releases",
    "Financial Media",
    "Nasdaq",
    "FINRA Short Volume",
    "Price/Volume",
  ];

  const SOCIAL_SOURCES = ["Wallstreetbets", "Reddit Finance", "StockTwits", "ApeWisdom", "Hacker News", "4chan"];
  const NEWS_SOURCES = ["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "Press Releases", "Financial Media", "Nasdaq", "SEC Filings"];
  const MARKET_SOURCES = ["FINRA Short Volume", "Price/Volume"];
  const WINDOW_KEY = "signaldesk-data-window";

  let dataWindowMode = localStorage.getItem(WINDOW_KEY) || "latest";

  const safeClamp = (min, max, value) => Math.min(max, Math.max(min, value));
  const safeRelVol = (value) => {
    return window.SIGNALDESK_QUALITY.relativeVolume(value);
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
  const NEWS_ARTICLE_SOURCES = new Set(["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "Press Releases", "Financial Media", "Nasdaq", "SEC Filings"]);
  // Mirrors update-data.mjs's isClassActionSpam: templated law-firm
  // class-action solicitation PR is scored like a synthetic title and kept
  // out of the "Driving the tape" feed (also cleans snapshots written before
  // the pipeline learned to drop these at collection time).
  const LAW_FIRM_NAMES_RE =
    /\b(rosen law|the rosen law firm|pomerantz|glancy prongay|bronstein,? gewirtz|levi & korsinsky|kessler topaz|robbins geller|hagens berman|bragar eagel|kirby mcinerney|faruqi & faruqi|schall law|kahn swick|portnoy law|gross law firm|howard g\.? smith|johnson fistel|block & leviton|berger montague|wolf haldenstein|saxena white|scott\+scott|grabar law)\b/i;
  const CLASS_ACTION_TOPIC_RE = /\b(class action|lead plaintiff|securities (?:fraud|litigation)|shareholder rights|investor rights)\b/i;
  const SOLICITATION_CUES_RE = /\b(law firm|counsel|encourages?|reminds?|urges?|notifies|alert|deadline|losses|recover|investigat\w+|on behalf of)\b/i;
  const isClassActionSpam = (text) => {
    const value = String(text || "");
    if (!value) return false;
    return LAW_FIRM_NAMES_RE.test(value) || (CLASS_ACTION_TOPIC_RE.test(value) && SOLICITATION_CUES_RE.test(value));
  };
  const headlineQualityScore = (entry) => {
    const title = entry?.title || "";
    if (!title) return -1;
    if (SYNTHETIC_TITLE_PATTERNS.some((pattern) => pattern.test(title))) return 0;
    if (isClassActionSpam(title)) return 0;
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

    // The board, source scope and export share script.js's integrity pipeline.
    // Do not replace it with a second aggregation/scoring implementation.
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
            <h2 id="pulse-heading">Recent news & moves</h2>
            <p>Global feed, independent of board filters. Articles from the past 72 hours alongside recent quotes; not proof of what caused a move.</p>
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
    const headlines = marketNewsFeed(4);
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
      .filter((entry) => entry && entry.marketMetricsVersion === 2 && entry.title && !isClassActionSpam(entry.title) && Number.isFinite(entry.priceMove))
      .filter(entry => window.SIGNALDESK_QUALITY.usableNews(entry) && window.SIGNALDESK_QUALITY.quoteState(entry.quoteAsOf ? entry : (data.signals || []).find(item => item.ticker === entry.ticker)) === "current")
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
      .filter((item) => marketEvidenceCurrent(item) && Number.isFinite(Number(item.priceMove)) && Math.abs(Number(item.priceMove)) >= 1.5)
      .map((item) => {
        const stories = (item.latest || [])
          .filter((entry) => NEWS_SOURCES.includes(entry.source) && window.SIGNALDESK_QUALITY.usableNews(entry) && !isClassActionSpam(entry.title))
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
    // Only claim throttling when a news-source failure actually carries a
    // throttle status. Any news-source failure used to trigger this copy, so
    // the panel blamed rate limits for windows where the real reason was that
    // no covered name moved enough to qualify.
    const newsThrottled = failures.some((f) => {
      const text = String(f);
      return NEWS_SOURCES.some((src) => text.includes(src)) && /\b(429|403|throttl)/i.test(text);
    });
    const reason = newsThrottled
      ? "The latest refresh was throttled on several news feeds, so no market-moving articles came through. Headlines will populate on the next clean refresh."
      : "No recent article matched a notable move with a recent quote. Missing coverage is not evidence that no catalyst exists.";
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
    if (footer) footer.textContent = "Technology checks: daily, including weekends, with six-hour retry opportunities. Market runs: weekdays at 9:17, 12:17, 15:17, and 17:17 Toronto time. Schedules are best-effort; inspect each source timestamp. Claims require editorial review.";
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
