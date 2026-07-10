import { writeFile, readFile, mkdir } from "node:fs/promises";
import { loadLedger, saveLedger, updateLedger, articleFromWikipediaUrl } from "./lib/ledger.mjs";
import { refreshThemeRegistry, saveThemeRegistry, loadThemeRegistry } from "./lib/theme-registry.mjs";
import { computeSprings, loadSprings, saveSprings } from "./lib/coil-detector.mjs";
import { computeThemeHeat, saveThemes, loadThemes, hotThemeTickers } from "./lib/theme-heat.mjs";
import {
  loadAlertState,
  saveAlertState,
  loadAlertLog,
  saveAlertLog,
  detectSpringEvents,
  detectThemeEvents,
  nextSpringStateMap,
  nextThemeStageMap,
  isoWeekKey,
  buildWeeklyDigest,
  postNtfy,
  ALERTS_LOG_MAX,
} from "./lib/alerts.mjs";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/signals.json", ROOT);
const OUT_JS = new URL("data/signals.js", ROOT);
const HISTORY = new URL("data/history.json", ROOT);
const HISTORY_JS = new URL("data/history.js", ROOT);
const HISTORY_DAYS = 120;
const USER_AGENT = "SignalDeskDaily/1.0 (+https://openai.com/; codex automation)";
// Reddit blocks generic bot UAs; use a transparent but descriptive string for Reddit requests
const REDDIT_USER_AGENT = "bot:SignalDeskPublic:1.0 (by /u/mindfulmod; read-only public data aggregation)";
const DISCOVERY_LIMIT = 80;
const PRICE_UNIVERSE_LIMIT = 140;
const NEWS_UNIVERSE_LIMIT = 70;
// Beyond the most-mentioned tickers, also fetch news for the biggest price movers
// (whatever moved hardest today) so "Driving the tape" can explain the move even
// when the ticker has little social chatter.
const MOVER_NEWS_LIMIT = 45;
const MOVER_MIN_MOVE = 2.0; // percent; |move| at/above this qualifies as a mover
// "Driving the tape" — a standalone feed of market-moving news, independent of the
// ranking table. An entry needs a real news headline AND a price move of at least
// this magnitude, so we only show stories that actually moved a stock.
const MARKET_NEWS_LIMIT = 14;
const MARKET_NEWS_MIN_MOVE = 1.5; // percent
// News sources that count as "real" press coverage for the market-news feed.
const MARKET_NEWS_SOURCES = new Set([
  "GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings",
]);
// Headline words that signal an article is explaining a market move (used to pick
// the most relevant story when a ticker has several).
const IMPACT_WORDS = /\b(surge|surges|surged|soar|soars|plunge|plunges|plunged|tumble|tumbles|sink|sinks|slump|jump|jumps|jumped|rally|rallies|crash|crashes|spike|spikes|drop|drops|dropped|fall|falls|fell|slide|slides|rise|rises|rose|gain|gains|gained|beat|beats|miss|misses|cut|cuts|raise|raises|raised|hike|hikes|warn|warns|warned|guidance|earnings|upgrade|downgrade|spook|spooks|spooked|%)\b/i;
// StockTwits ("fintwit") — free, no-key public API. Best-effort: shared cloud IPs
// may be rate-limited (~200 req/hr) or 403'd, so failures degrade gracefully.
const STOCKTWITS_LIMIT = 45;
// Hacker News (Algolia) comment search — keyless. Per-ticker cashtag lookups for
// the most-mentioned tickers, limited to recent comments.
const HN_LIMIT = 35;
const HN_LOOKBACK_DAYS = 21;
// Company profile blurbs (Wikipedia REST, keyless) for the top-ranked tickers.
const DESCRIPTION_LIMIT = 60;
// FINRA universe: how many candidates to register from the short-volume file
const FINRA_UNIVERSE_LIMIT = 200;
const FINRA_MIN_RATIO = 0.30;
const FINRA_MIN_SHORT_VOL = 50_000;
// SEC requires a descriptive User-Agent with contact info for its public data APIs.
const SEC_USER_AGENT = "SignalDesk/1.0 (m.aali9@gmail.com)";
// Market-cap split (USD). A single $500M threshold makes the UI a clean two-way toggle.
const LARGE_CAP_MIN = 500_000_000; // large cap: >= $500M
const SMALL_CAP_MAX = 500_000_000; // small cap:  < $500M

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

// Always-covered "majors" watchlist. The dynamic FINRA/social universe is great
// for surfacing squeezes and micro-cap pumps, but those names rarely carry the
// causal, market-moving news the "Driving the tape" section is built for ("Apple
// raised prices and spooked the market"). These high-profile large/mega caps are
// therefore always price-checked AND news-checked on top of the dynamic universe,
// so when one of them actually moves we can explain why. They do NOT get a ranking
// head-start — they only earn a spot in the table if their real signal warrants it.
const MAJORS = [
  // SPY first: the Theme Engine's Layer 1 beta guard needs a live SPY price
  // series in the ledger to compute relative returns.
  ["SPY", "SPDR S&P 500 ETF Trust"],
  ["AAPL", "Apple Inc."], ["MSFT", "Microsoft Corp."], ["NVDA", "NVIDIA Corp."],
  ["AMZN", "Amazon.com Inc."], ["GOOGL", "Alphabet Inc."], ["META", "Meta Platforms Inc."],
  ["TSLA", "Tesla Inc."], ["AVGO", "Broadcom Inc."], ["AMD", "Advanced Micro Devices Inc."],
  ["NFLX", "Netflix Inc."], ["INTC", "Intel Corp."], ["MU", "Micron Technology Inc."],
  ["QCOM", "Qualcomm Inc."], ["ORCL", "Oracle Corp."], ["CRM", "Salesforce Inc."],
  ["ADBE", "Adobe Inc."], ["PLTR", "Palantir Technologies Inc."], ["SMCI", "Super Micro Computer Inc."],
  ["COIN", "Coinbase Global Inc."], ["MSTR", "MicroStrategy Inc."], ["JPM", "JPMorgan Chase & Co."],
  ["BAC", "Bank of America Corp."], ["GS", "Goldman Sachs Group Inc."], ["WFC", "Wells Fargo & Co."],
  ["V", "Visa Inc."], ["MA", "Mastercard Inc."], ["XOM", "Exxon Mobil Corp."],
  ["CVX", "Chevron Corp."], ["BA", "Boeing Co."], ["DIS", "Walt Disney Co."],
  ["WMT", "Walmart Inc."], ["COST", "Costco Wholesale Corp."], ["NKE", "Nike Inc."],
  ["SBUX", "Starbucks Corp."], ["MCD", "McDonald's Corp."], ["KO", "Coca-Cola Co."],
  ["PEP", "PepsiCo Inc."], ["PFE", "Pfizer Inc."], ["LLY", "Eli Lilly & Co."],
  ["UNH", "UnitedHealth Group Inc."], ["GM", "General Motors Co."], ["UBER", "Uber Technologies Inc."],
  ["ABNB", "Airbnb Inc."], ["PYPL", "PayPal Holdings Inc."], ["SHOP", "Shopify Inc."],
];

// No hardcoded seed list for the ranking universe. It is built dynamically each run:
//   1. FINRA short-volume file  → primary universe (hundreds of actively traded tickers)
//   2. News article extraction  → discovery of mentioned tickers not yet in registry
//   3. SEC / GDELT / RSS feeds  → additional discovery signals
// This means the dashboard reflects whatever is actually being traded and discussed today.
const stockRegistry = new Map();

const POSITIVE = ["beat", "beats", "surge", "surges", "jump", "jumps", "rally", "bullish", "upgrade", "growth", "record", "strong", "buy", "breakout", "higher", "gain", "gains"];
const NEGATIVE = ["miss", "misses", "fall", "falls", "drop", "drops", "lawsuit", "probe", "downgrade", "weak", "bearish", "sell", "lower", "loss", "cuts", "cut"];
const AMBIGUOUS_TICKERS = new Set(["AI", "ARM", "NET", "T", "F", "ON", "ARE", "CAN", "NOW", "A", "GO", "IT"]);
// Brand words too generic to use as a headline-matching alias on their own — a
// company literally named "Block" or "Open" would otherwise hoover up unrelated
// articles. For these we keep only the symbol/cashtag match.
const BRAND_STOPWORDS = new Set([
  "block", "open", "square", "beyond", "match", "unity", "carnival", "national",
  "general", "global", "american", "united", "first", "next", "core", "energy",
  "power", "capital", "financial", "holdings", "group", "trust", "fund", "growth",
  "value", "metals", "mining", "gold", "silver", "bank", "health", "medical",
  "digital", "data", "cloud", "systems", "solutions", "technologies", "industries",
  "international", "enterprise", "partners", "realty", "resources", "materials",
  "motors", "auto", "retail", "media", "five", "best", "good", "real", "world",
  "service", "services", "products", "brands", "company", "corporation",
]);
const TICKER_STOPWORDS = new Set([
  "CEO",
  "CFO",
  "IPO",
  "ETF",
  "ETFS",
  "SEC",
  "USA",
  "US",
  "USD",
  "EPS",
  "GDP",
  "AI",
  "API",
  "URL",
  "RSS",
  "FAQ",
  "THE",
  "AND",
  "FOR",
  "NEW",
  "OLD",
  "BUY",
  "SELL",
  "HOLD",
  "CALL",
  "PUT",
  "PUTS",
  "MOON",
  "YOLO",
  "ATH",
  "CEO",
  "CPI",
  "FOMC",
  "FED",
  "NYSE",
  "NASDAQ",
]);

const feeds = [
  // Reddit JSON (primary) — may return 403 on GitHub Actions; RSS feeds below act as fallback
  { source: "Wallstreetbets", type: "reddit", url: "https://www.reddit.com/r/wallstreetbets/hot.json?limit=100" },
  { source: "Wallstreetbets", type: "reddit", url: "https://www.reddit.com/r/wallstreetbets/new.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/stocks/hot.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/investing/hot.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/options/hot.json?limit=100" },
  // Reddit RSS fallbacks
  { source: "Wallstreetbets", type: "rss-reddit", url: "https://www.reddit.com/r/wallstreetbets/.rss?limit=100" },
  { source: "Wallstreetbets", type: "rss-reddit", url: "https://old.reddit.com/r/wallstreetbets/new/.rss?limit=100" },
  { source: "Reddit Finance", type: "rss-reddit", url: "https://www.reddit.com/r/stocks/.rss?limit=100" },
  { source: "Reddit Finance", type: "rss-reddit", url: "https://www.reddit.com/r/investing/.rss?limit=100" },
  { source: "Reddit Finance", type: "rss-reddit", url: "https://www.reddit.com/r/options/.rss?limit=100" },
  { source: "SEC Filings", type: "atom", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=100&output=atom" },
  { source: "CNBC", type: "rss", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { source: "MarketWatch", type: "rss", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
];

const DISCOVERY_QUERIES = [
  "\"stock\" \"ticker\" \"shares\"",
  "\"shares\" \"surge\" OR \"shares\" \"plunge\" stock",
  "\"IPO\" \"stock\" \"ticker\"",
  "\"retail investors\" \"stock\" \"ticker\"",
  "\"most active stocks\" OR \"trending stocks\"",
];

async function main() {
  const previous = await readPrevious();
  const events = [];
  const discovery = new Map();
  const failures = [];

  // Step 1: Build the dynamic universe from FINRA short-volume data.
  // This runs first so stockRegistry is populated before any text-matching starts.
  const finraEvents = await buildFinraUniverse(failures);
  events.push(...finraEvents);
  console.log(`FINRA universe built: ${stockRegistry.size} tickers registered`);

  // StockTwits trending ("fintwit") — registers hot tickers into the universe so
  // they are discoverable even if no other feed mentions them today.
  await collectStockTwitsTrending(events, failures);

  // ApeWisdom — pre-aggregated Reddit+4chan social mention counts per ticker.
  await collectApeWisdom(events, failures);

  // 4chan /biz/ — raw board chatter; parse cashtags from thread subjects/bodies.
  await collectFourChanBiz(events, failures, discovery);

  // Always-covered majors: register them so they get priced + news-checked below.
  // They feed "Driving the tape" (a standalone market-moving-news feed) even when
  // they never earn a spot in the dynamic ranking table.
  for (const [ticker, name] of MAJORS) registerStock(ticker, name, [ticker, name]);

  // Give the freshly-registered universe real company names + brand aliases now,
  // so the market-wide news steps below can match "Apple"/"Nvidia" style headlines.
  await enrichRegistryNamesFromSec(failures);

  for (const feed of feeds) {
    try {
      let items;
      if (feed.type === "reddit") {
        items = await redditItems(feed);
      } else if (feed.type === "rss-reddit") {
        items = await redditRssItems(feed);
      } else {
        items = await xmlItems(feed);
      }
      for (const item of items) {
        collectMentions(events, feed.source, item.title, item.url, item.score || 1, item.published, "", discovery);
      }
    } catch (error) {
      failures.push(`${feed.source}: ${error.message}`);
    }
  }

  try {
    const items = await gdeltMarketNews();
    for (const item of items) {
      collectMentions(events, "GDELT News", item.title, item.url, item.score || 2, item.published, "", discovery);
    }
  } catch (error) {
    failures.push(`GDELT News: ${error.message}`);
  }

  try {
    const items = await discoveryNewsItems();
    for (const item of items) {
      collectMentions(events, item.source, item.title, item.url, item.score || 2, item.published, "", discovery);
    }
  } catch (error) {
    failures.push(`Discovery News: ${error.message}`);
  }

  const discoveredEvents = await validateDiscoveredTickers(discovery, failures);
  events.push(...discoveredEvents);

  for (const { ticker } of dedupeEntries([...rankedStockEntries(events, PRICE_UNIVERSE_LIMIT), ...majorEntries()])) {
    try {
      let market = await fetchMarket(ticker);
      if (!market?.lastPrice) {
        // Yahoo throttles long bursts; pause and retry once before giving up.
        await sleep(400);
        market = await fetchMarket(ticker);
      }
      if (market) {
        // Fill in a real name + brand aliases for any ticker the SEC map missed.
        if (market.name && market.name !== ticker) enrichRegistryName(ticker, market.name);
        events.push({
          source: "Price/Volume",
          ticker,
          name: stockName(ticker),
          title: `${ticker} $${market.lastPrice.toFixed(2)}, price ${signed(market.priceMove)}%, volume ${market.relativeVolume.toFixed(1)}x`,
          url: `https://finance.yahoo.com/quote/${ticker}`,
          mentions: Math.max(1, Math.round(Math.abs(market.priceMove) + market.relativeVolume * 3)),
          sentiment: market.priceMove > 1 ? 0.25 : market.priceMove < -1 ? -0.18 : 0,
          priceMove: market.priceMove,
          relativeVolume: market.relativeVolume,
          lastPrice: market.lastPrice,
          volume: Number.isFinite(market.volume) ? market.volume : null,
          quoteAsOf: market.quoteAsOf,
          quoteSource: market.quoteSource,
          published: new Date().toISOString(),
        });
      }
    } catch (error) {
      failures.push(`Price/Volume ${ticker}: ${error.message}`);
    }
    // Gentle pacing to stay under Yahoo/Stooq burst limits.
    await sleep(70);
  }

  const newsTargets = dedupeEntries([...newsTargetEntries(events, NEWS_UNIVERSE_LIMIT), ...majorEntries()]);
  for (const { ticker } of newsTargets) {
    try {
      const items = await yahooTickerNews(ticker);
      for (const item of items) {
        collectMentions(events, "Yahoo Public News", item.title, item.url, 2, item.published, ticker);
      }
    } catch (error) {
      failures.push(`Yahoo Public News ${ticker}: ${error.message}`);
    }
  }

  for (const { ticker, name } of newsTargets) {
    await collectTickerNews(events, failures, ticker, name);
  }

  // StockTwits per-symbol sentiment for the most-mentioned tickers. Bullish/Bearish
  // tags make this our richest explicit social-sentiment signal.
  for (const { ticker, name } of newsUniverseEntries(events, STOCKTWITS_LIMIT)) {
    await collectStockTwitsSentiment(events, failures, ticker, name);
    await sleep(350);
  }

  // Hacker News comments mentioning the top tickers (keyless Algolia search).
  for (const { ticker, name } of newsUniverseEntries(events, HN_LIMIT)) {
    await collectHackerNews(events, failures, ticker, name);
    await sleep(150);
  }

  const signals = aggregate(events, previous);
  await enrichMarketCaps(signals, failures);
  await enrichProfiles(signals, failures);

  // Standalone market-moving-news feed for "Driving the tape" (not tied to ranking).
  const marketNews = buildMarketNews(events);
  console.log(`Market news feed: ${marketNews.length} move-driving headlines`);

  await updateLedgerFromRun({ events, signals, failures });
  await refreshThemeRegistryStep(failures);
  const hotTickers = await computeThemeHeatStep(failures);
  await computeSpringsStep(failures, hotTickers);
  await runAlertsStep(failures, hotTickers);

  const hasFreshData = events.length > 0 && signals.length > 0;
  const previousHasSignals = previous?.signals?.length > 0;
  if (!hasFreshData && previous?.signals?.length) {
    console.warn(
      `No fresh public data could be fetched (likely network/DNS restrictions). Keeping previous snapshot from ${previous.generatedAt || "unknown time"}.`
    );
    await mkdir(new URL("data/", ROOT), { recursive: true });
    const history = await updateHistory(previous);
    const historyJson = JSON.stringify(history, null, 2);
    await writeFile(HISTORY, `${historyJson}\n`);
    await writeFile(HISTORY_JS, `window.SIGNALDESK_HISTORY = ${historyJson};\n`);
    console.log(`History now contains ${history.snapshots.length} daily snapshots.`);
    return;
  }

  if (!hasFreshData) {
    console.warn("No fresh public data could be fetched (likely network/DNS restrictions). Leaving existing files unchanged.");
    if (!previousHasSignals) {
      console.warn("No previous usable snapshot exists, so the dashboard will show its real-data empty state.");
    }
    return;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    dataMode: "real-public-no-key",
    sourceNote:
      "Real snapshot from public no-key sources with dynamic ticker discovery. Coverage is best-effort. Reddit may be unavailable in scheduled runs, so SignalDesk also uses GDELT, public news RSS, SEC EDGAR, FINRA short-volume files, and public price/volume data.",
    discoveryNote:
      "Fully dynamic universe: FINRA short-volume data builds the daily ticker list, supplemented by ticker extraction from public news articles and SEC filings. No hardcoded seed list.",
    sources: SOURCES,
    failures: failures.slice(0, 20),
    signals,
    marketNews,
    events: events.slice(0, 400),
  };

  await mkdir(new URL("data/", ROOT), { recursive: true });
  const history = await updateHistory(payload);
  const json = JSON.stringify(payload, null, 2);
  const historyJson = JSON.stringify(history, null, 2);
  await writeFile(OUT, `${json}\n`);
  await writeFile(OUT_JS, `window.SIGNALDESK_DATA = ${json};\n`);
  await writeFile(HISTORY, `${historyJson}\n`);
  await writeFile(HISTORY_JS, `window.SIGNALDESK_HISTORY = ${historyJson};\n`);
  console.log(`Wrote ${signals.length} ticker signals from ${events.length} source events to ${OUT.pathname}`);
  console.log(`History now contains ${history.snapshots.length} daily snapshots.`);
  if (failures.length) console.log(`Source warnings: ${failures.slice(0, 5).join(" | ")}`);
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return null;
  }
}

async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(HISTORY, "utf8"));
    return Array.isArray(parsed.snapshots) ? parsed.snapshots : [];
  } catch {
    return [];
  }
}

async function updateHistory(payload) {
  const existing = await readHistory();
  const date = payload.generatedAt.slice(0, 10);
  const dailySnapshot = {
    date,
    generatedAt: payload.generatedAt,
    signals: payload.signals,
    events: payload.events,
    failures: payload.failures,
  };
  const snapshots = existing
    .filter((item) => item?.date && item.date !== date)
    .concat(dailySnapshot)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-HISTORY_DAYS);

  return {
    dataMode: "real-public-no-key-history",
    updatedAt: payload.generatedAt,
    retentionDays: HISTORY_DAYS,
    sourceNote:
      "Daily real public no-key snapshots retained for range aggregation. Longer ranges become more complete as scheduled refreshes accumulate.",
    snapshots,
  };
}

async function redditItems(feed) {
  const json = await fetchJson(feed.url);
  return (json.data?.children || []).map(({ data }) => ({
    title: `${data.title || ""} ${data.selftext || ""}`,
    url: data.url_overridden_by_dest || `https://reddit.com${data.permalink}`,
    score: Math.max(1, Math.log10((data.score || 0) + 10) * 3 + (data.num_comments || 0) / 40),
    published: new Date((data.created_utc || Date.now() / 1000) * 1000).toISOString(),
  }));
}

async function xmlItems(feed) {
  const xml = await fetchText(feed.url);
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.map((block) => ({
    title: cleanXml(textBetween(block, "title") || textBetween(block, "summary") || ""),
    url: cleanXml(textBetween(block, "link") || attrBetween(block, "link", "href") || feed.url),
    score: 2,
    published: cleanXml(textBetween(block, "published") || textBetween(block, "updated") || textBetween(block, "pubDate") || ""),
  }));
}

async function yahooTickerNews(ticker) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(ticker)}&region=US&lang=en-US`;
  const xml = await fetchText(url);
  return xmlItems({ source: "Yahoo Public News", type: "rss", url }).then((items) => items.slice(0, 8));
}

async function collectTickerNews(events, failures, ticker, name) {
  const jobs = [
    ["Google News", () => newsRssItems("Google News", ticker, name)],
    ["Bing News", () => newsRssItems("Bing News", ticker, name)],
  ];
  for (const [source, load] of jobs) {
    try {
      const items = await load();
      for (const item of items) {
        collectMentions(events, source, item.title, item.url, item.score || 2, item.published, ticker);
      }
    } catch (error) {
      failures.push(`${source} ${ticker}: ${error.message}`);
    }
  }
}

async function gdeltMarketNews() {
  const query = encodeURIComponent(`("stock" OR "stocks" OR "shares" OR "earnings" OR "analyst")`);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=ArtList&format=json&maxrecords=100&timespan=2d&sort=datedesc`;
  const json = await fetchJsonRetry(url);
  return (json.articles || [])
    .map((item) => ({
      title: `${item.title || ""} ${item.domain || ""} ${item.sourceCountry || ""}`.trim(),
      url: item.url || url,
      score: 2,
      published: item.seendate ? parseGdeltDate(item.seendate) : new Date().toISOString(),
    }))
    .filter((item) => hasMarketContext(item.title))
    .slice(0, 80);
}

async function discoveryNewsItems() {
  const jobs = DISCOVERY_QUERIES.flatMap((query) => [
    ["Google News", googleNewsSearchUrl(query)],
    ["Bing News", bingNewsSearchUrl(query)],
  ]);
  const results = [];
  const seen = new Set();

  for (const [source, url] of jobs) {
    try {
      const items = await xmlItems({ source, type: "rss", url });
      for (const item of items.slice(0, 12)) {
        const key = `${item.title}|${item.url}`;
        if (seen.has(key) || !hasMarketContext(item.title)) continue;
        seen.add(key);
        results.push({ ...item, source, score: 2.5 });
      }
    } catch {
      // Broad discovery is opportunistic; source-specific failures are covered by normal feeds.
    }
  }

  return results.slice(0, 100);
}

async function newsRssItems(source, ticker, name) {
  const query = encodeURIComponent(`"${name}" ${ticker} stock`);
  const url =
    source === "Google News"
      ? googleNewsSearchUrl(query)
      : bingNewsSearchUrl(query);
  const items = await xmlItems({ source, type: "rss", url });
  return items.slice(0, 8).map((item) => ({ ...item, score: 2 }));
}

function googleNewsSearchUrl(query) {
  const q = query.includes("%") ? query : encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
}

function bingNewsSearchUrl(query) {
  const q = query.includes("%") ? query : encodeURIComponent(query);
  return `https://www.bing.com/news/search?q=${q}&format=rss`;
}

// Builds the dynamic ticker universe from FINRA short-volume data.
// Runs before any other step so stockRegistry is populated for text matching.
async function buildFinraUniverse(failures) {
  let text;
  try {
    text = await fetchRecentFinraShortFile();
  } catch (error) {
    failures.push(`FINRA Short Volume: ${error.message}`);
    return [];
  }

  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  const candidates = [];

  for (const line of lines.slice(1)) {
    const [date, symbol, shortVolume, , totalVolume] = line.split("|");
    if (!symbol || !isPossibleTicker(symbol) || AMBIGUOUS_TICKERS.has(symbol)) continue;
    const shortVol = Number(shortVolume);
    const totalVol = Number(totalVolume);
    if (!Number.isFinite(shortVol) || !Number.isFinite(totalVol) || totalVol <= 0) continue;
    const ratio = shortVol / totalVol;
    if (ratio < FINRA_MIN_RATIO || shortVol < FINRA_MIN_SHORT_VOL) continue;
    candidates.push({ date, symbol, shortVol, totalVol, ratio });
  }

  // Sort by significance: high short-volume × high ratio floats to top
  candidates.sort((a, b) => b.shortVol * b.ratio - a.shortVol * a.ratio);

  const events = [];
  for (const { date, symbol, shortVol, totalVol, ratio } of candidates.slice(0, FINRA_UNIVERSE_LIMIT)) {
    // Register with symbol as placeholder name; price fetch will later add quote data
    registerStock(symbol, symbol, [symbol]);
    events.push({
      source: "FINRA Short Volume",
      ticker: symbol,
      name: symbol,
      title: `${symbol} FINRA short volume ${(ratio * 100).toFixed(0)}% of reported volume (${shortVol.toLocaleString()} shares)`,
      url: "https://www.finra.org/finra-data/browse-catalog/short-sale-volume-data/daily-short-sale-volume-files",
      mentions: Math.max(1, Math.round(ratio * 10 + Math.log10(shortVol + 1))),
      sentiment: ratio > 0.55 ? -0.1 : 0,
      priceMove: 0,
      relativeVolume: 1 + Math.min(2, ratio),
      lastPrice: null,
      quoteAsOf: null,
      quoteSource: null,
      published: finraDateToIso(date),
    });
  }

  return events;
}

// Reddit RSS fallback — used when the JSON endpoint returns 403.
// Uses REDDIT_USER_AGENT and parses the Atom/RSS feed Reddit serves at /.rss
async function redditRssItems(feed) {
  const xml = await fetchTextWithUA(feed.url, REDDIT_USER_AGENT);
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((block) => ({
    title: cleanXml(
      textBetween(block, "title") ||
      textBetween(block, "summary") ||
      textBetween(block, "content") ||
      ""
    ),
    url: cleanXml(textBetween(block, "link") || attrBetween(block, "link", "href") || feed.url),
    score: 1.5,
    published: cleanXml(textBetween(block, "published") || textBetween(block, "updated") || textBetween(block, "pubDate") || ""),
  })).filter((item) => item.title.length > 5);
}

async function fetchRecentFinraShortFile() {
  const dates = recentMarketDates(9);
  const failures = [];
  for (const date of dates) {
    const url = `https://cdn.finra.org/equity/regsho/daily/CNMSshvol${date}.txt`;
    try {
      return await fetchText(url);
    } catch (error) {
      failures.push(`${date}: ${error.message}`);
    }
  }
  throw new Error(`No recent FINRA file available (${failures.slice(0, 3).join("; ")})`);
}

function recentMarketDates(days) {
  const dates = [];
  const cursor = new Date();
  while (dates.length < days) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10).replaceAll("-", ""));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function finraDateToIso(value) {
  if (!/^\d{8}$/.test(value || "")) return new Date().toISOString();
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T22:00:00.000Z`;
}

function parseGdeltDate(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 14) return new Date().toISOString();
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}.000Z`;
}

function hasMarketContext(value) {
  return /\b(stock|stocks|share|shares|earnings|analyst|analysts|investor|investors|market|markets|nasdaq|dow|nyse|revenue|profit|guidance|valuation|trading|trader|traders|wall street)\b/i.test(value);
}

function discoverTickerMentions(discovery, source, text, url, weight = 1, published = "") {
  if (!discovery || !hasMarketContext(text)) return;
  for (const candidate of extractTickerCandidates(text)) {
    if (stockRegistry.has(candidate.ticker)) continue;
    const existing =
      discovery.get(candidate.ticker) ||
      {
        ticker: candidate.ticker,
        mentions: 0,
        score: 0,
        events: [],
      };
    const mentions = Math.max(1, Math.round(weight * candidate.confidence));
    existing.mentions += mentions;
    existing.score += mentions + candidate.confidence;
    existing.events.push({ source, text, url, mentions, published: published || new Date().toISOString() });
    discovery.set(candidate.ticker, existing);
  }
}

function extractTickerCandidates(text) {
  const raw = String(text || "");
  const candidates = new Map();
  const add = (ticker, confidence) => {
    const normalized = ticker.toUpperCase();
    if (!isPossibleTicker(normalized)) return;
    candidates.set(normalized, Math.max(candidates.get(normalized) || 0, confidence));
  };

  for (const match of raw.matchAll(/\$([A-Z][A-Z0-9]{0,4})(?![A-Z0-9])/g)) add(match[1], 3);
  for (const match of raw.matchAll(/\(([A-Z][A-Z0-9]{1,4})\)/g)) add(match[1], 2.4);
  for (const match of raw.matchAll(/\bticker[:\s]+([A-Z][A-Z0-9]{0,4})\b/g)) add(match[1], 2.6);
  for (const match of raw.matchAll(/\b[A-Z][A-Z0-9]{1,4}\b/g)) {
    const token = match[0];
    if (AMBIGUOUS_TICKERS.has(token)) continue;
    add(token, 1);
  }

  return [...candidates.entries()].map(([ticker, confidence]) => ({ ticker, confidence }));
}

function isPossibleTicker(ticker) {
  if (!/^[A-Z][A-Z0-9]{0,4}$/.test(ticker)) return false;
  if (TICKER_STOPWORDS.has(ticker)) return false;
  if (/^\d+$/.test(ticker)) return false;
  return true;
}

async function validateDiscoveredTickers(discovery, failures) {
  const events = [];
  const candidates = [...discovery.values()].sort((a, b) => b.score - a.score).slice(0, DISCOVERY_LIMIT);

  for (const candidate of candidates) {
    try {
      const market = await fetchMarket(candidate.ticker);
      if (!market?.lastPrice) continue;
      const name = market.name || candidate.ticker;
      registerStock(candidate.ticker, name, [candidate.ticker, name]);
      stockRegistry.get(candidate.ticker).discoveredMentions = candidate.mentions;
      for (const item of candidate.events.slice(0, 8)) {
        events.push({
          source: item.source,
          ticker: candidate.ticker,
          name,
          title: item.text.slice(0, 240),
          url: item.url,
          mentions: item.mentions,
          sentiment: scoreSentiment(` ${item.text.toLowerCase()} `),
          priceMove: 0,
          relativeVolume: 1,
          lastPrice: null,
          quoteAsOf: null,
          quoteSource: null,
          published: item.published,
        });
      }
    } catch (error) {
      failures.push(`Discovery ${candidate.ticker}: ${error.message}`);
    }
  }

  return events;
}

function registerStock(ticker, name, aliases = []) {
  const normalized = ticker.toUpperCase();
  if (!isPossibleTicker(normalized)) return;
  const existing = stockRegistry.get(normalized);
  const normalizedAliases = [...new Set([normalized, ...aliases].filter(Boolean).map((value) => String(value).toLowerCase()))];
  if (existing) {
    existing.aliases = [...new Set([...(existing.aliases || []), ...normalizedAliases])];
    if (name && existing.name === existing.ticker) existing.name = name;
    return;
  }
  stockRegistry.set(normalized, {
    ticker: normalized,
    name: name || normalized,
    aliases: normalizedAliases,
    seeded: false,
    discoveredMentions: 0,
  });
}

// Derive distinctive headline-matching aliases from a company name so news that
// says "Apple" (not "$AAPL") still attaches to the ticker. We keep the full
// suffix-stripped brand ("palantir technologies") and, when it is distinctive
// enough, the lead brand word ("palantir"). Generic single words are dropped so a
// company called "Block" doesn't match every article containing that word.
function brandAliasesFor(name) {
  const cleaned = cleanCompanyForSearch(name).toLowerCase();
  if (!cleaned || !/[a-z]/.test(cleaned)) return [];
  const aliases = new Set();
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length > 1 && cleaned.length >= 6) aliases.add(cleaned);
  const lead = words[0];
  if (lead && lead.length >= 4 && !BRAND_STOPWORDS.has(lead)) aliases.add(lead);
  return [...aliases];
}

// Write a real company name + brand aliases back into the registry. FINRA seeds
// tickers with the symbol as a placeholder name, so this is what gives most of the
// universe a human name and a chance to match news headlines.
function enrichRegistryName(ticker, name) {
  const entry = stockRegistry.get(String(ticker).toUpperCase());
  if (!entry || !name) return;
  if (!entry.name || entry.name === entry.ticker) entry.name = name;
  if (AMBIGUOUS_TICKERS.has(entry.ticker)) return; // symbol-only matching for these
  const merged = new Set([...(entry.aliases || []), ...brandAliasesFor(name)]);
  entry.aliases = [...merged];
}

// Pre-enrich the freshly-built universe with real names from the SEC ticker map
// BEFORE market-wide news (GDELT / RSS) is matched, so a headline like
// "Apple raises prices, spooking the market" can attach to AAPL in the same run.
async function enrichRegistryNamesFromSec(failures) {
  let secMap;
  try {
    secMap = await fetchSecTickerMap();
  } catch (error) {
    failures.push(`SEC name pre-enrich: ${error.message}`);
    return;
  }
  let named = 0;
  for (const entry of stockRegistry.values()) {
    const record = secMap.get(entry.ticker.toUpperCase());
    if (record?.title) {
      enrichRegistryName(entry.ticker, cleanCompanyName(record.title));
      named += 1;
    }
  }
  console.log(`SEC name pre-enrich: named ${named}/${stockRegistry.size} tickers`);
}

function rankedStockEntries(events, limit) {
  const mentionScores = new Map();
  for (const event of events) {
    mentionScores.set(event.ticker, (mentionScores.get(event.ticker) || 0) + (Number(event.mentions) || 0));
  }
  return [...stockRegistry.values()]
    .sort((a, b) => {
      const scoreA = (mentionScores.get(a.ticker) || 0) + (a.discoveredMentions || 0);
      const scoreB = (mentionScores.get(b.ticker) || 0) + (b.discoveredMentions || 0);
      return scoreB - scoreA || a.ticker.localeCompare(b.ticker);
    })
    .slice(0, limit);
}

function newsUniverseEntries(events, limit) {
  return rankedStockEntries(events, limit);
}

// Registry entries for the always-covered majors (those that registered cleanly).
function majorEntries() {
  return MAJORS.map(([ticker]) => stockRegistry.get(ticker.toUpperCase())).filter(Boolean);
}

// De-duplicate a list of registry entries by ticker, preserving first-seen order.
function dedupeEntries(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry.ticker)) continue;
    seen.add(entry.ticker);
    out.push(entry);
  }
  return out;
}

// Build the standalone "Driving the tape" feed: news headlines that explain a real
// price move, ranked by impact. Decoupled from the ranking table — a story counts
// as long as we have a news headline for the ticker AND a meaningful price move,
// regardless of whether that ticker appears in the dashboard ranking.
function buildMarketNews(events, limit = MARKET_NEWS_LIMIT) {
  const market = new Map(); // ticker -> latest Price/Volume snapshot
  for (const event of events) {
    if (event.source === "Price/Volume") {
      market.set(event.ticker, {
        priceMove: Number(event.priceMove),
        lastPrice: Number(event.lastPrice),
        relativeVolume: Number(event.relativeVolume) || 1,
      });
    }
  }

  const stories = new Map(); // ticker -> [{source,title,url,published}]
  for (const event of events) {
    if (!MARKET_NEWS_SOURCES.has(event.source) || !event.title) continue;
    const title = String(event.title).trim();
    if (title.length < 12) continue;
    if (!stories.has(event.ticker)) stories.set(event.ticker, []);
    stories.get(event.ticker).push({ source: event.source, title, url: event.url, published: event.published });
  }

  const rows = [];
  for (const [ticker, list] of stories) {
    const quote = market.get(ticker);
    if (!quote || !Number.isFinite(quote.priceMove)) continue;
    const move = Math.abs(quote.priceMove);
    if (move < MARKET_NEWS_MIN_MOVE) continue;

    // De-dupe by headline text and rank stories: impact-word headlines first, then newest.
    const seenTitles = new Set();
    const unique = [];
    for (const story of list) {
      const key = story.title.toLowerCase().replace(/\s+/g, " ").slice(0, 90);
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      unique.push(story);
    }
    unique.sort((a, b) => {
      const impactA = IMPACT_WORDS.test(a.title) ? 1 : 0;
      const impactB = IMPACT_WORDS.test(b.title) ? 1 : 0;
      if (impactA !== impactB) return impactB - impactA;
      return new Date(b.published || 0) - new Date(a.published || 0);
    });

    const best = unique[0];
    rows.push({
      ticker,
      name: stockName(ticker),
      priceMove: quote.priceMove,
      lastPrice: Number.isFinite(quote.lastPrice) ? quote.lastPrice : null,
      relativeVolume: quote.relativeVolume,
      source: best.source,
      title: best.title.slice(0, 200),
      url: best.url,
      published: best.published,
      coverage: unique.length,
      impact: move + unique.length * 3 + Math.max(0, quote.relativeVolume - 1) * 3,
    });
  }

  rows.sort((a, b) => b.impact - a.impact);
  return rows.slice(0, limit).map(({ impact, ...row }) => row);
}

// The set of tickers we fetch per-ticker news for: the most-mentioned tickers
// UNION the biggest price movers. Movers are included even with little chatter so
// "Driving the tape" can show why a stock jumped or dropped today.
function newsTargetEntries(events, mentionLimit) {
  const base = rankedStockEntries(events, mentionLimit);
  const seen = new Set(base.map((entry) => entry.ticker));

  const moveByTicker = new Map();
  for (const event of events) {
    if (event.source !== "Price/Volume") continue;
    const move = Math.abs(Number(event.priceMove) || 0);
    if (move > (moveByTicker.get(event.ticker) || 0)) moveByTicker.set(event.ticker, move);
  }

  const movers = [...stockRegistry.values()]
    .map((entry) => ({ entry, move: moveByTicker.get(entry.ticker) || 0 }))
    .filter((row) => row.move >= MOVER_MIN_MOVE && !seen.has(row.entry.ticker))
    .sort((a, b) => b.move - a.move)
    .slice(0, MOVER_NEWS_LIMIT)
    .map((row) => row.entry);

  return [...base, ...movers];
}

async function fetchMarket(ticker) {
  const [yahoo, stooq] = await Promise.allSettled([fetchYahooMarket(ticker), fetchStooqMarket(ticker)]);
  const yahooMarket = yahoo.status === "fulfilled" ? yahoo.value : null;
  const stooqMarket = stooq.status === "fulfilled" ? stooq.value : null;

  if (yahooMarket && stooqMarket) {
    const gap = Math.abs(yahooMarket.lastPrice - stooqMarket.lastPrice) / Math.max(0.01, stooqMarket.lastPrice);
    if (gap > 0.25) {
      return {
        ...stooqMarket,
        quoteSource: `Stooq public daily quote; Yahoo mismatch ${yahooMarket.lastPrice.toFixed(2)}`,
      };
    }
    return yahooMarket;
  }

  return yahooMarket || stooqMarket;
}

async function fetchYahooMarket(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  if (result?.meta?.symbol && result.meta.symbol.toUpperCase() !== ticker.toUpperCase()) return null;
  const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close || []).filter(Number.isFinite);
  const volumes = (quote?.volume || []).filter(Number.isFinite);
  if (closes.length < 2 || volumes.length < 2) return null;
  const last = Number.isFinite(result?.meta?.regularMarketPrice) ? result.meta.regularMarketPrice : closes.at(-1);
  const prev = closes.at(-2);
  const avgVolume = volumes.slice(0, -1).reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.length - 1);
  const quoteAsOf = result?.meta?.regularMarketTime
    ? new Date(result.meta.regularMarketTime * 1000).toISOString()
    : new Date().toISOString();
  return {
    lastPrice: last,
    priceMove: ((last - prev) / prev) * 100,
    relativeVolume: avgVolume ? volumes.at(-1) / avgVolume : 1,
    volume: volumes.at(-1),
    quoteAsOf,
    quoteSource: "Yahoo public chart",
    name: result?.meta?.longName || result?.meta?.shortName || result?.meta?.symbol || ticker,
  };
}

async function fetchStooqMarket(ticker) {
  const symbol = `${ticker.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=d`;
  const csv = await fetchText(url);
  const rows = csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.split(","))
    .filter((row) => row.length >= 6 && row[4] !== "N/D");
  if (rows.length < 2) return null;
  const lastRow = rows.at(-1);
  const prevRow = rows.at(-2);
  const last = Number(lastRow[4]);
  const prev = Number(prevRow[4]);
  const volumes = rows.slice(-6).map((row) => Number(row[5])).filter(Number.isFinite);
  if (!Number.isFinite(last) || !Number.isFinite(prev) || !volumes.length) return null;
  const avgVolume = volumes.slice(0, -1).reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.length - 1);
  return {
    lastPrice: last,
    priceMove: ((last - prev) / prev) * 100,
    relativeVolume: avgVolume ? volumes.at(-1) / avgVolume : 1,
    volume: volumes.at(-1),
    quoteAsOf: `${lastRow[0]}T20:00:00.000Z`,
    quoteSource: "Stooq public daily quote",
    name: ticker,
  };
}

function collectMentions(events, source, text, url, weight = 1, published = "", forceTicker = "", discovery = null) {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9.$&+ -]/g, " ")} `;
  if (!forceTicker) discoverTickerMentions(discovery, source, text, url, weight, published);
  for (const { ticker, name, aliases } of stockRegistry.values()) {
    if (forceTicker && forceTicker !== ticker) continue;
    const cashtag = normalized.includes(`$${ticker.toLowerCase()}`);
    const tickerWord = new RegExp(`(^|[^a-z])${escapeRegExp(ticker.toLowerCase())}([^a-z]|$)`).test(normalized);
    const aliasHit = aliases.some((alias) => normalized.includes(` ${alias.toLowerCase()} `));
    const hit = AMBIGUOUS_TICKERS.has(ticker) ? cashtag || aliasHit : cashtag || tickerWord || aliasHit;
    if (hit) {
      events.push({
        source,
        ticker,
        name,
        title: text.slice(0, 240),
        url,
        mentions: Math.max(1, Math.round(weight)),
        sentiment: scoreSentiment(normalized),
        priceMove: 0,
        relativeVolume: 1,
        lastPrice: null,
        quoteAsOf: null,
        quoteSource: null,
        published: published || new Date().toISOString(),
      });
    }
  }
}

// StockTwits trending symbols: free, no-key. Registers each trending ticker into
// the universe and records a light mention so it can surface even on a quiet news
// day. https://api.stocktwits.com/api/2/trending/symbols.json
async function collectStockTwitsTrending(events, failures) {
  try {
    const json = await fetchJson("https://api.stocktwits.com/api/2/trending/symbols.json");
    const symbols = Array.isArray(json?.symbols) ? json.symbols : [];
    symbols.forEach((entry, index) => {
      const ticker = String(entry?.symbol || "").toUpperCase();
      if (!isPossibleTicker(ticker)) return;
      const name = entry?.title || ticker;
      registerStock(ticker, name, [ticker, name]);
      // StockTwits tags each symbol with a sector/industry — capture for the profile card.
      const reg = stockRegistry.get(ticker);
      if (reg) {
        if (entry?.sector && !reg.sector) reg.sector = spaceCamelCase(entry.sector);
        if (entry?.industry && !reg.industry) reg.industry = spaceCamelCase(entry.industry);
      }
      // Earlier in the trending list = hotter; weight 5 down to 1.
      const weight = Math.max(1, Math.round((symbols.length - index) / Math.max(1, symbols.length) * 5));
      events.push({
        source: "StockTwits",
        ticker,
        name,
        title: `Trending on StockTwits (#${index + 1})`,
        url: `https://stocktwits.com/symbol/${encodeURIComponent(ticker)}`,
        mentions: weight,
        sentiment: 0,
        priceMove: 0,
        relativeVolume: 1,
        lastPrice: null,
        quoteAsOf: null,
        quoteSource: null,
        published: new Date().toISOString(),
      });
    });
    console.log(`StockTwits trending: ${symbols.length} symbols registered`);
  } catch (error) {
    failures.push(`StockTwits trending: ${error.message}`);
  }
}

// StockTwits per-symbol message stream: each recent message can carry an explicit
// Bullish/Bearish tag, giving a real social-sentiment read for a ticker.
// https://api.stocktwits.com/api/2/streams/symbol/{TICKER}.json
async function collectStockTwitsSentiment(events, failures, ticker, name) {
  try {
    const json = await fetchJson(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`);
    const messages = Array.isArray(json?.messages) ? json.messages : [];
    if (!messages.length) return;
    for (const message of messages.slice(0, 8)) {
      const basic = message?.entities?.sentiment?.basic;
      const sentiment = basic === "Bullish" ? 0.3 : basic === "Bearish" ? -0.3 : 0;
      const username = message?.user?.username;
      const url = username && message?.id
        ? `https://stocktwits.com/${username}/message/${message.id}`
        : `https://stocktwits.com/symbol/${encodeURIComponent(ticker)}`;
      events.push({
        source: "StockTwits",
        ticker,
        name: name || ticker,
        title: String(message?.body || `${ticker} chatter on StockTwits`).slice(0, 240),
        url,
        mentions: 1,
        sentiment,
        priceMove: 0,
        relativeVolume: 1,
        lastPrice: null,
        quoteAsOf: null,
        quoteSource: null,
        published: message?.created_at || new Date().toISOString(),
      });
    }
  } catch (error) {
    failures.push(`StockTwits ${ticker}: ${error.message}`);
  }
}

// ApeWisdom — free, keyless aggregator of Reddit + 4chan social mentions, already
// mapped to tickers with 24h mention deltas. https://apewisdom.io/api/v1.0/
async function collectApeWisdom(events, failures) {
  let added = 0;
  for (const page of [1, 2]) {
    try {
      const json = await fetchJson(`https://apewisdom.io/api/v1.0/filter/all-stocks/page/${page}`);
      const results = Array.isArray(json?.results) ? json.results : [];
      for (const row of results) {
        const ticker = String(row?.ticker || "").toUpperCase();
        if (!isPossibleTicker(ticker)) continue;
        const name = row?.name || ticker;
        registerStock(ticker, name, [ticker, name]);
        const rawMentions = Number(row?.mentions) || 0;
        if (rawMentions <= 0) continue;
        // Log-scale so ApeWisdom's large counts boost rather than swamp the signal.
        const weight = Math.max(1, Math.round(Math.log10(rawMentions + 1) * 3));
        const prevMentions = Number(row?.mentions_24h_ago) || 0;
        const rising = rawMentions > prevMentions;
        events.push({
          source: "ApeWisdom",
          ticker,
          name,
          title: `${rrFormat(rawMentions)} social mentions on ApeWisdom${prevMentions ? ` (${rising ? "up" : "down"} from ${rrFormat(prevMentions)} a day ago)` : ""}`,
          url: `https://apewisdom.io/stocks/${encodeURIComponent(ticker)}/`,
          mentions: weight,
          sentiment: 0,
          priceMove: 0,
          relativeVolume: 1,
          lastPrice: null,
          quoteAsOf: null,
          quoteSource: null,
          published: new Date().toISOString(),
        });
        added += 1;
      }
    } catch (error) {
      failures.push(`ApeWisdom p${page}: ${error.message}`);
      break;
    }
  }
  console.log(`ApeWisdom: ${added} ticker mention rows added`);
}

function rrFormat(value) {
  return Number(value).toLocaleString("en-US");
}

// Strip corporate suffixes so a company name searches/matches cleanly on HN.
function cleanCompanyForSearch(name) {
  return String(name || "")
    .replace(/\/[a-z]{2}\s*$/i, " ") // SEC state-of-incorporation tags: "Inc/De", "Corp /Ny"
    .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|holdings?|group|class [a-c]|common stock|the)\b/gi, " ")
    .replace(/[.,&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Hacker News comments (Algolia, keyless) that mention a ticker by cashtag in the
// recent window. https://hn.algolia.com/api/v1/search_by_date
async function collectHackerNews(events, failures, ticker, name) {
  if (AMBIGUOUS_TICKERS.has(ticker)) return;
  // HN users write "Nvidia", not "$NVDA", so search by company name when we have
  // one and fall back to the symbol otherwise.
  const cleanName = cleanCompanyForSearch(name);
  const hasName = cleanName && cleanName.toUpperCase() !== ticker;
  const query = hasName ? cleanName : ticker;
  const nameToken = hasName ? cleanName.split(" ").find((word) => word.length >= 4)?.toLowerCase() : "";
  const cutoff = Math.floor(Date.now() / 1000) - HN_LOOKBACK_DAYS * 86400;
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=comment&numericFilters=created_at_i>${cutoff}&hitsPerPage=20`;
  try {
    const json = await fetchJson(url);
    const hits = Array.isArray(json?.hits) ? json.hits : [];
    const cashtag = new RegExp(`\\$${escapeRegExp(ticker)}\\b`, "i");
    const wordTag = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(ticker)}([^A-Za-z0-9]|$)`);
    for (const hit of hits) {
      const text = cleanXml(String(hit?.comment_text || ""));
      const lower = text.toLowerCase();
      // Accept a cashtag, the company name token, or (for 4+ char symbols only) a
      // word-boundary symbol match — keeps out common-word false positives.
      const matches =
        cashtag.test(text) ||
        (nameToken && lower.includes(nameToken)) ||
        (ticker.length >= 4 && wordTag.test(text));
      if (!matches) continue;
      events.push({
        source: "Hacker News",
        ticker,
        name: name || ticker,
        title: text.slice(0, 240) || `${ticker} discussed on Hacker News`,
        url: hit?.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : "https://news.ycombinator.com/",
        mentions: 1,
        sentiment: scoreSentiment(` ${text.toLowerCase()} `),
        priceMove: 0,
        relativeVolume: 1,
        lastPrice: null,
        quoteAsOf: null,
        quoteSource: null,
        published: hit?.created_at || new Date().toISOString(),
      });
    }
  } catch (error) {
    failures.push(`Hacker News ${ticker}: ${error.message}`);
  }
}

// 4chan /biz/ — official keyless read-only JSON. Parse cashtags from thread
// subjects and bodies in the board catalog. https://a.4cdn.org/biz/catalog.json
async function collectFourChanBiz(events, failures, discovery) {
  try {
    const pages = await fetchJson("https://a.4cdn.org/biz/catalog.json");
    let scanned = 0;
    for (const page of Array.isArray(pages) ? pages : []) {
      for (const thread of page?.threads || []) {
        const text = cleanXml(`${thread?.sub || ""} ${thread?.com || ""}`);
        if (!text) continue;
        const url = thread?.no ? `https://boards.4chan.org/biz/thread/${thread.no}` : "https://boards.4chan.org/biz/";
        // replies count gives a rough "how active" weight, capped to avoid swamping.
        const weight = Math.min(5, 1 + Math.round((Number(thread?.replies) || 0) / 40));
        collectMentions(events, "4chan", text, url, weight, new Date().toISOString(), "", discovery);
        scanned += 1;
      }
    }
    console.log(`4chan /biz/: ${scanned} threads scanned`);
  } catch (error) {
    failures.push(`4chan /biz/: ${error.message}`);
  }
}

function aggregate(events, previous) {
  const previousByTicker = new Map((previous?.signals || []).map((item) => [item.ticker, item]));
  const map = new Map();
  for (const event of events) {
    const item =
      map.get(event.ticker) ||
      {
        ticker: event.ticker,
        name: event.name,
        mentions: 0,
        weightedSentiment: 0,
        weightedPrice: 0,
        weightedVolume: 0,
        lastPrice: previousByTicker.get(event.ticker)?.lastPrice ?? null,
        quoteAsOf: previousByTicker.get(event.ticker)?.quoteAsOf ?? null,
        quoteSource: previousByTicker.get(event.ticker)?.quoteSource ?? null,
        sources: Object.fromEntries(SOURCES.map((source) => [source, 0])),
        latest: [],
      };
    item.mentions += event.mentions;
    item.weightedSentiment += event.sentiment * event.mentions;
    item.weightedPrice += event.priceMove * event.mentions;
    item.weightedVolume += event.relativeVolume * event.mentions;
    if (Number.isFinite(event.lastPrice)) {
      item.lastPrice = event.lastPrice;
      item.quoteAsOf = event.quoteAsOf;
      item.quoteSource = event.quoteSource;
    }
    item.sources[event.source] = (item.sources[event.source] || 0) + event.mentions;
    item.latest.push({ source: event.source, title: event.title, url: event.url, published: event.published });
    map.set(event.ticker, item);
  }

  const maxMentions = Math.max(1, ...[...map.values()].map((item) => item.mentions));
  return [...map.values()]
    .map((item) => {
      const prev = previousByTicker.get(item.ticker)?.mentions || 0;
      const momentum = prev ? ((item.mentions - prev) / prev) * 100 : item.mentions > 2 ? 35 : 0;
      const sentiment = item.mentions ? item.weightedSentiment / item.mentions : 0;
      const priceMove = item.mentions ? item.weightedPrice / item.mentions : 0;
      const relativeVolume = item.mentions ? item.weightedVolume / item.mentions : 1;
      const sourceBreadth = SOURCES.filter((source) => item.sources[source] > 0).length / SOURCES.length;
      const shortPressure = clamp(0, 1, (item.sources["FINRA Short Volume"] || 0) / Math.max(8, item.mentions));
      const signalScore = clamp(
        0,
        100,
        27 * Math.sqrt(item.mentions / maxMentions) +
          20 * clamp(0, 1, momentum / 80 + 0.25) +
          17 * clamp(0, 1, (sentiment + 0.25) / 0.7) +
          12 * clamp(0, 1, priceMove / 6) +
          9 * clamp(0, 1, relativeVolume / 2.5) +
          9 * sourceBreadth +
          6 * shortPressure
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
        relativeVolume,
        optionsActivity: 0,
        signalScore,
        sources: item.sources,
        latest: item.latest.slice(0, 6),
      };
    })
    .sort((a, b) => b.signalScore - a.signalScore)
    .slice(0, 75);
}

function scoreSentiment(text) {
  const positives = POSITIVE.reduce((sum, word) => sum + countWord(text, word), 0);
  const negatives = NEGATIVE.reduce((sum, word) => sum + countWord(text, word), 0);
  return clamp(-1, 1, (positives - negatives) / Math.max(3, positives + negatives + 1));
}

function countWord(text, word) {
  return (text.match(new RegExp(`\b${escapeRegExp(word)}\b`, "g")) || []).length;
}

function textBetween(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "i"))?.[1] || "";
}

function attrBetween(xml, tag, attr) {
  return xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`, "i"))?.[1] || "";
}

function cleanXml(value) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

// Retry wrapper for rate-limited JSON endpoints (GDELT routinely 429s on shared
// CI IPs). Backs off exponentially with jitter; also retries when the body isn't
// valid JSON, which GDELT returns as an HTML throttle page.
async function fetchJsonRetry(url, { retries = 4, baseDelay = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const text = await response.text();
      try {
        return JSON.parse(text);
      } catch {
        throw new Error("non-JSON response (likely a throttle page)");
      }
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(baseDelay * 2 ** attempt + Math.random() * 400);
    }
  }
  throw lastError;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchTextWithUA(url, ua) {
  const response = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

// Enrich each signal with the issuer's real company name and an estimated market
// cap + size tier, using only free, no-key SEC data: the official ticker→company
// map (names) and XBRL shares outstanding × our public price (cap).
async function enrichMarketCaps(signals, failures) {
  let secMap;
  try {
    secMap = await fetchSecTickerMap();
  } catch (error) {
    failures.push(`SEC ticker map: ${error.message}`);
    return;
  }

  // Names for every ticker we can match — no extra network calls.
  for (const signal of signals) {
    const record = secMap.get(signal.ticker.toUpperCase());
    if (record?.title && (!signal.name || signal.name === signal.ticker)) {
      signal.name = cleanCompanyName(record.title);
    }
  }

  // Market caps only where we have a price to multiply by.
  const withPrice = signals.filter((signal) => Number.isFinite(signal.lastPrice) && signal.lastPrice > 0);
  for (const signal of withPrice) {
    const record = secMap.get(signal.ticker.toUpperCase());
    if (!record?.cik) continue;
    try {
      const shares = await fetchSharesOutstanding(record.cik);
      if (!Number.isFinite(shares) || shares <= 0) continue;
      const marketCap = shares * signal.lastPrice;
      signal.marketCap = Math.round(marketCap);
      signal.capTier = capTierFor(marketCap);
    } catch {
      // Best-effort: leave marketCap/capTier unset if SEC has no data for this issuer.
    }
    // Be polite to SEC's rate limits (<10 req/s).
    await sleep(120);
  }
}

// Add a glanceable company profile to each signal: sector/industry (from the
// StockTwits tags we captured) plus a one-line "what it is" blurb from Wikipedia's
// free, keyless REST summary API. Only the top-ranked tickers are enriched to keep
// runtime and request volume bounded.
async function enrichProfiles(signals, failures) {
  // Sector/industry for any ticker we tagged during discovery — no network cost.
  for (const signal of signals) {
    const reg = stockRegistry.get(signal.ticker.toUpperCase());
    if (reg?.sector && !signal.sector) signal.sector = reg.sector;
    if (reg?.industry && !signal.industry) signal.industry = reg.industry;
  }

  const ranked = [...signals].sort((a, b) => b.signalScore - a.signalScore).slice(0, DESCRIPTION_LIMIT);
  for (const signal of ranked) {
    try {
      const profile = await fetchCompanyBlurb(signal.name, signal.ticker);
      if (profile?.extract) {
        signal.description = profile.extract;
        signal.descriptionUrl = profile.url || null;
      }
    } catch (error) {
      failures.push(`Profile ${signal.ticker}: ${error.message}`);
    }
    await sleep(120);
  }
}

// Resolve a company to its Wikipedia article (via keyless opensearch) and return a
// trimmed one/two-sentence summary. Falls back gracefully if nothing matches.
async function fetchCompanyBlurb(name, ticker) {
  const query = cleanCompanyForSearch(name) || name || ticker;
  if (!query) return null;
  // The bare token alone is ambiguous: "Compass" resolves to the biggest namesake
  // ("Compass Group", a British caterer) rather than the actual issuer ("Compass, Inc.").
  // Keeping the legal suffix ("Compass Inc") disambiguates, so search that fuller form
  // first, then fall back to the bare token for articles that drop the suffix entirely.
  const fuller = String(name || "")
    .replace(/\/[a-z]{2}\/?\s*$/i, " ")
    .replace(/[.,&/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const searchQueries = [];
  if (fuller && fuller.toLowerCase() !== query.toLowerCase()) searchQueries.push(fuller);
  searchQueries.push(query);
  // Pull several candidates instead of blindly trusting the top lexical hit — the
  // closest title is frequently an unrelated city, object, or arena that merely shares
  // a word (e.g. "Corning, New York" for Corning Inc, or a Soxhlet extractor for SOXL).
  const seen = new Set();
  const titles = [];
  for (const q of searchQueries) {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=5&namespace=0&format=json`;
    const search = await fetchJson(searchUrl);
    for (const title of (Array.isArray(search?.[1]) ? search[1] : [])) {
      const key = title && title.toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        titles.push(title);
      }
    }
  }
  // Prefer an article whose title is the company's exact name ("Tesla, Inc." over
  // "Tesla Cybertruck"); otherwise keep the lexical order from the searches above.
  const norm = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const exact = norm(fuller) || norm(query);
  const ordered = titles
    .map((title, index) => ({ title, index, hit: norm(title) === exact ? 0 : 1 }))
    .sort((a, b) => a.hit - b.hit || a.index - b.index)
    .map((entry) => entry.title);
  for (const title of ordered) {
    const summary = await fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
    // Skip disambiguation pages — they don't describe a single company.
    if (!summary?.extract || summary.type === "disambiguation") continue;
    if (!isCompanyMatch(query, summary)) continue;
    const extract = trimToSentences(summary.extract, 2, 280);
    return { extract, url: summary?.content_urls?.desktop?.page || null };
  }
  return null;
}

const COMPANY_STOPWORDS = new Set([
  "the", "inc", "incorporated", "corp", "corporation", "company", "co", "ltd",
  "limited", "plc", "llc", "lp", "sa", "ag", "nv", "holdings", "holding", "group",
  "class", "common", "stock", "ordinary", "shares", "share", "new", "ny",
]);

// One-line Wikidata descriptions that signal the article is NOT a business/fund.
const NON_COMPANY_DESCRIPTION = /\b(city|town|village|township|municipality|county|borough|hamlet|district|region|province|island|river|lake|mountain|peak|ocean|sea|desert|valley|park|species|genus|plant|animal|bird|fish|insect|dinosaur|mineral|apparatus|instrument|arena|stadium|venue|amphitheatre|amphitheater|skyscraper|bridge|castle|palace|church|cathedral|temple|mosque|film|movie|tv series|web series|miniseries|sitcom|album|song|single|soundtrack|music group|musical group|girl group|boy group|vocal group|rock band|pop band|band|novel|magazine|newspaper|video game|comic|character|deity|goddess|mytholog|saint|emperor|princess|footballer|cricketer|actor|actress|singer|rapper|musician|composer|painter|poet|politician|senator|philosopher|given name|surname|family name|language|dialect|battle|treaty|university|college|polytechnic|academy|degree mill|lawsuit|antitrust|court case|legal case)\b/;
// Strong business terms that override the backstop (e.g. "American film studio company").
const COMPANY_DESCRIPTION = /\b(compan|corporation|incorporated|firm|manufactur|supplier|retailer|bank|insurer|insurance|conglomerate|enterprise|fund|etf|exchange-traded|trust|fintech|biotech|pharmaceutical|technolog|software|semiconductor|airline|automaker|provider|operator|holding)\b/;

// Guard against the opensearch returning a lexically-close but semantically-wrong
// article. Require the company name and the article title to actually line up, then
// reject titles whose one-line description is clearly a non-company topic.
function isCompanyMatch(query, summary) {
  const tokens = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((word) => word && !COMPANY_STOPWORDS.has(word));
  const qTokens = tokens(query);
  const tTokens = new Set(tokens(summary.title));
  if (!qTokens.length || !tTokens.size) return false;
  const description = String(summary.description || "").toLowerCase();
  // The article title must line up with the company name. A short Wikipedia title
  // ("AbCellera") still matches "AbCellera Biologics" (title ⊆ name). But when the title
  // carries EXTRA significant words — "Advanced Micro Devices, Inc. v. Intel Corp." (a
  // lawsuit) or "Atlantic International University" (a degree mill) — only trust it if the
  // title still contains the whole name AND the one-liner positively reads as a company.
  const queryInTitle = qTokens.every((word) => tTokens.has(word));
  const titleInQuery = [...tTokens].every((word) => qTokens.includes(word));
  if (!titleInQuery) {
    if (!queryInTitle) return false;
    if (!COMPANY_DESCRIPTION.test(description)) return false;
  }
  // Category backstop: reject places/objects/works/people/bands/schools/legal cases
  // unless the description also carries a clear business term.
  if (description && NON_COMPANY_DESCRIPTION.test(description) && !COMPANY_DESCRIPTION.test(description)) {
    return false;
  }
  return true;
}

function trimToSentences(text, maxSentences, maxChars) {
  const sentences = String(text).match(/[^.!?]+[.!?]+/g) || [String(text)];
  let out = sentences.slice(0, maxSentences).join(" ").trim();
  if (out.length > maxChars) out = `${out.slice(0, maxChars - 1).trim()}…`;
  return out;
}

// "ElectronicTechnology" → "Electronic Technology"; leaves already-spaced text alone.
function spaceCamelCase(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

// SEC company titles are often ALL CAPS ("NVIDIA CORP"); make them human-friendly.
function cleanCompanyName(title) {
  if (title !== title.toUpperCase()) return title;
  return title.toLowerCase().replace(/\b([a-z])/g, (match) => match.toUpperCase());
}

function capTierFor(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return null;
  return marketCap >= LARGE_CAP_MIN ? "large" : "small";
}

let secTickerMapCache = null;
async function fetchSecTickerMap() {
  if (secTickerMapCache) return secTickerMapCache;
  const json = await fetchJsonWithUA("https://www.sec.gov/files/company_tickers.json", SEC_USER_AGENT);
  const map = new Map();
  for (const entry of Object.values(json)) {
    if (entry?.ticker && Number.isFinite(entry.cik_str)) {
      map.set(String(entry.ticker).toUpperCase(), {
        cik: String(entry.cik_str).padStart(10, "0"),
        title: entry.title || "",
      });
    }
  }
  secTickerMapCache = map;
  return map;
}

async function fetchSharesOutstanding(cik) {
  const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/dei/EntityCommonStockSharesOutstanding.json`;
  const json = await fetchJsonWithUA(url, SEC_USER_AGENT);
  const points = json?.units?.shares;
  if (!Array.isArray(points) || !points.length) return null;
  // Latest reported value by filing date.
  const latest = points
    .filter((point) => Number.isFinite(point.val))
    .sort((a, b) => String(a.filed || a.end).localeCompare(String(b.filed || b.end)))
    .at(-1);
  return latest ? latest.val : null;
}

async function fetchJsonWithUA(url, ua) {
  const response = await fetch(url, { headers: { "User-Agent": ua, Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stockName(ticker) {
  return stockRegistry.get(ticker)?.name || ticker;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function clamp(min, max, value) {
  return Math.min(max, Math.max(min, value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds this run's per-ticker mention/price maps and folds them into
// data/ledger.json (today's row upserted, new tickers backfilled, pageviews
// refreshed once/day, dormant tickers pruned). Skipped when the run produced
// no fresh events, so a throttled run never writes a zeroed-out ledger day.
async function updateLedgerFromRun({ events, signals, failures }) {
  if (!events.length) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const mentionsByTicker = new Map();
  const priceByTicker = new Map();
  for (const event of events) {
    if (!event.ticker) continue;
    mentionsByTicker.set(event.ticker, (mentionsByTicker.get(event.ticker) || 0) + (Number(event.mentions) || 0));
    if (event.source === "Price/Volume" && Number.isFinite(event.lastPrice)) {
      priceByTicker.set(event.ticker, { close: event.lastPrice, volume: Number.isFinite(event.volume) ? event.volume : null });
    }
  }
  const totalMentions = [...mentionsByTicker.values()].reduce((sum, value) => sum + value, 0);

  const signalByTicker = new Map(signals.map((item) => [item.ticker, item]));
  const registryMeta = new Map();
  for (const entry of stockRegistry.values()) {
    const signal = signalByTicker.get(entry.ticker);
    registryMeta.set(entry.ticker, {
      name: signal?.name || entry.name,
      sector: signal?.sector || entry.sector || null,
      sub: signal?.industry || entry.industry || null,
      article: articleFromWikipediaUrl(signal?.descriptionUrl) || undefined,
    });
  }

  const ledger = await loadLedger();
  try {
    const protectedTickers = await loadProtectedTickers();
    const stats = await updateLedger({ ledger, dateStr, mentionsByTicker, totalMentions, priceByTicker, registryMeta, failures, protectedTickers });
    await saveLedger(ledger);
    console.log(
      `Ledger: upserted ${stats.upserted}, backfilled ${stats.backfilled}, pageviews ${stats.pageviewsFetched}, pruned ${stats.pruned}, tracking ${Object.keys(ledger.tickers).length} tickers`
    );
  } catch (error) {
    failures.push(`Ledger update: ${error.message}`);
  }
}

// Tickers that should survive the ledger's 90-day-dormant prune even with no
// recent mentions: current theme-registry members and any active/dead-but-
// recent spring. Reads the *previous* run's committed files (this run's
// theme-registry refresh happens after the ledger update; springs.json does
// not exist until THEME_ENGINE.md build item 3 lands, and the read is
// tolerant of that).
async function loadProtectedTickers() {
  const protectedTickers = new Set();
  try {
    const registry = JSON.parse(await readFile(new URL("data/theme-registry.json", ROOT), "utf8"));
    for (const theme of registry.themes || []) {
      for (const member of theme.members || []) protectedTickers.add(member.t);
    }
  } catch {
    // No registry yet.
  }
  const springs = await loadSprings();
  for (const spring of springs.springs || []) {
    if (spring.state === "coiled" || spring.state === "released") protectedTickers.add(spring.ticker);
  }
  return protectedTickers;
}

// Runs the frozen coil detector (THEME_ENGINE.md Layer 3) over the ledger and
// writes data/springs.json. Uses this run's freshly-refreshed GICS baseline
// for sector classification, and this run's theme-heat output (Layer 1) to
// rank hot-theme coils first / waive the defensive-sector discount for them
// (the CEG/VST exception THEME_ENGINE.md calls out).
async function computeSpringsStep(failures, hotTickers = new Set()) {
  try {
    const ledger = await loadLedger();
    const registry = await loadThemeRegistry();
    const springs = computeSprings(ledger, registry.gics || {}, { hotThemeTickers: hotTickers });
    await saveSprings(springs);
    const counts = springs.springs.reduce((acc, s) => ({ ...acc, [s.state]: (acc[s.state] || 0) + 1 }), {});
    console.log(`Springs: ${springs.springs.length} classified — ${JSON.stringify(counts)}`);
  } catch (error) {
    failures.push(`Springs: ${error.message}`);
  }
}

// Runs Layer 1 (theme heat) over the ledger + theme registry and writes
// data/themes.json. Returns the set of tickers inside a "hot" theme
// (stage diffusion/wave) for computeSpringsStep to rank against.
async function computeThemeHeatStep(failures) {
  try {
    const ledger = await loadLedger();
    const registry = await loadThemeRegistry();
    const themes = computeThemeHeat(ledger, registry);
    await saveThemes(themes);
    const staged = themes.themes.reduce((acc, t) => ({ ...acc, [t.stage]: (acc[t.stage] || 0) + 1 }), {});
    console.log(`Theme heat: ${themes.themes.length} themes — ${JSON.stringify(staged)}`);
    return hotThemeTickers(themes);
  } catch (error) {
    failures.push(`Theme heat: ${error.message}`);
    return new Set();
  }
}

// Layer 4 alerts. Diffs this run's springs/themes output against the last
// recorded state (data/alerts-state.json) so each condition fires at most
// once per ticker/theme per state-change, posts every event to ntfy.sh if
// SIGNALDESK_NTFY_TOPIC is set (silently a no-op otherwise -- alerts still
// land in the on-site "What changed" log, data/alerts-log.json, either way),
// and appends a weekly digest once per ISO week.
async function runAlertsStep(failures, hotTickers = new Set()) {
  try {
    const state = await loadAlertState();
    const springsPayload = await loadSprings();
    const themesPayload = await loadThemes();

    const springEvents = detectSpringEvents(state.springs || {}, springsPayload.springs || [], hotTickers);
    const themeEvents = detectThemeEvents(state.themes || {}, themesPayload.themes || []);
    const events = [...springEvents, ...themeEvents];

    const now = new Date();
    const weekKey = isoWeekKey(now);
    const isNewWeek = state.lastDigestDate !== weekKey;
    if (isNewWeek) events.push(buildWeeklyDigest(themesPayload.themes || [], springsPayload.springs || []));

    const topic = process.env.SIGNALDESK_NTFY_TOPIC || "";
    let sent = 0;
    for (const event of events) {
      const result = await postNtfy(topic, event);
      if (result.sent) sent += 1;
      else if (topic) failures.push(`ntfy ${event.type}: ${result.reason}`);
    }

    const log = await loadAlertLog();
    const dateStr = now.toISOString();
    log.entries = [...events.map((e) => ({ date: dateStr, ...e })), ...log.entries].slice(0, ALERTS_LOG_MAX);
    log.generatedAt = dateStr;
    await saveAlertLog(log);

    await saveAlertState({
      springs: nextSpringStateMap(springsPayload.springs || []),
      themes: nextThemeStageMap(themesPayload.themes || []),
      lastDigestDate: isNewWeek ? weekKey : state.lastDigestDate,
    });

    console.log(`Alerts: ${events.length} events${topic ? ` (${sent} sent to ntfy)` : " (no SIGNALDESK_NTFY_TOPIC set -- on-site log only)"}`);
  } catch (error) {
    failures.push(`Alerts: ${error.message}`);
  }
}

// Refreshes data/theme-registry.json: GICS baseline (re-fetched monthly) +
// manual overrides (re-merged every run so a same-day edit takes effect).
// Independent of the social/news pipeline, so it runs even on a degraded run.
async function refreshThemeRegistryStep(failures) {
  try {
    const registry = await refreshThemeRegistry({ failures });
    await saveThemeRegistry(registry);
    console.log(`Theme registry: ${registry.themes.length} themes, ${Object.keys(registry.gics).length} GICS tickers`);
  } catch (error) {
    failures.push(`Theme registry: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
