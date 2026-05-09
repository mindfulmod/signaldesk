import { writeFile, readFile, mkdir } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("data/signals.json", ROOT);
const OUT_JS = new URL("data/signals.js", ROOT);
const USER_AGENT = "SignalDeskDaily/1.0 (+https://openai.com/; codex automation)";

const SOURCES = [
  "Wallstreetbets",
  "Reddit Finance",
  "SEC Filings",
  "Yahoo Public News",
  "CNBC",
  "MarketWatch",
  "Price/Volume",
];

const STOCKS = [
  ["NVDA", "NVIDIA Corporation", ["nvidia", "nvda"]],
  ["TSLA", "Tesla", ["tesla", "tsla"]],
  ["AMD", "Advanced Micro Devices", ["advanced micro devices", "amd"]],
  ["AAPL", "Apple", ["apple", "aapl"]],
  ["PLTR", "Palantir", ["palantir", "pltr"]],
  ["SMCI", "Super Micro Computer", ["super micro", "smci"]],
  ["GME", "GameStop", ["gamestop", "gme"]],
  ["AMZN", "Amazon", ["amazon", "amzn"]],
  ["META", "Meta Platforms", ["meta platforms", "meta"]],
  ["MSFT", "Microsoft", ["microsoft", "msft"]],
  ["COIN", "Coinbase", ["coinbase", "coin"]],
  ["MSTR", "MicroStrategy", ["microstrategy", "mstr"]],
  ["RIVN", "Rivian", ["rivian", "rivn"]],
  ["SOFI", "SoFi", ["sofi"]],
  ["HOOD", "Robinhood", ["robinhood", "hood"]],
  ["NFLX", "Netflix", ["netflix", "nflx"]],
  ["GOOGL", "Alphabet", ["alphabet", "google", "googl"]],
  ["BABA", "Alibaba", ["alibaba", "baba"]],
  ["NIO", "NIO", ["nio"]],
  ["LCID", "Lucid", ["lucid", "lcid"]],
  ["INTC", "Intel", ["intel", "intc"]],
  ["AVGO", "Broadcom", ["broadcom", "avgo"]],
  ["ARM", "Arm Holdings", ["arm holdings"]],
  ["SHOP", "Shopify", ["shopify", "shop"]],
  ["SNOW", "Snowflake", ["snowflake", "snow"]],
  ["DKNG", "DraftKings", ["draftkings", "dkng"]],
  ["SPY", "SPDR S&P 500 ETF", ["spy", "s&p 500", "s&p"]],
  ["QQQ", "Invesco QQQ ETF", ["qqq", "nasdaq 100"]],
  ["UBER", "Uber", ["uber"]],
  ["DIS", "Disney", ["disney", "dis"]],
  ["PYPL", "PayPal", ["paypal", "pypl"]],
  ["T", "AT&T", ["at&t", " att "]],
  ["F", "Ford", ["ford", " f "]],
  ["AMC", "AMC Entertainment", ["amc entertainment", "amc"]],
  ["RBLX", "Roblox", ["roblox", "rblx"]],
  ["WMT", "Walmart", ["walmart", "wmt"]],
  ["JPM", "JPMorgan Chase", ["jpmorgan", "jpm"]],
  ["COST", "Costco", ["costco", "cost"]],
  ["PFE", "Pfizer", ["pfizer", "pfe"]],
  ["BA", "Boeing", ["boeing", "ba"]],
  ["XOM", "Exxon Mobil", ["exxon", "xom"]],
  ["CVNA", "Carvana", ["carvana", "cvna"]],
  ["UPST", "Upstart", ["upstart", "upst"]],
  ["AI", "C3.ai", ["c3.ai"]],
  ["RKLB", "Rocket Lab", ["rocket lab", "rklb"]],
  ["IONQ", "IonQ", ["ionq"]],
  ["DELL", "Dell Technologies", ["dell"]],
  ["ORCL", "Oracle", ["oracle", "orcl"]],
  ["CRM", "Salesforce", ["salesforce", "crm"]],
  ["MU", "Micron", ["micron", "mu"]],
  ["WBD", "Warner Bros. Discovery", ["warner bros", "wbd"]],
  ["MRNA", "Moderna", ["moderna", "mrna"]],
  ["CRWD", "CrowdStrike", ["crowdstrike", "crwd"]],
  ["NET", "Cloudflare", ["cloudflare"]],
  ["ROKU", "Roku", ["roku"]],
];

const POSITIVE = ["beat", "beats", "surge", "surges", "jump", "jumps", "rally", "bullish", "upgrade", "growth", "record", "strong", "buy", "breakout", "higher", "gain", "gains"];
const NEGATIVE = ["miss", "misses", "fall", "falls", "drop", "drops", "lawsuit", "probe", "downgrade", "weak", "bearish", "sell", "lower", "loss", "cuts", "cut"];
const AMBIGUOUS_TICKERS = new Set(["AI", "ARM", "NET", "T", "F", "ON", "ARE", "CAN", "NOW", "A", "GO", "IT"]);

const feeds = [
  { source: "Wallstreetbets", type: "reddit", url: "https://www.reddit.com/r/wallstreetbets/hot.json?limit=100" },
  { source: "Wallstreetbets", type: "reddit", url: "https://www.reddit.com/r/wallstreetbets/new.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/stocks/hot.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/investing/hot.json?limit=100" },
  { source: "Reddit Finance", type: "reddit", url: "https://www.reddit.com/r/options/hot.json?limit=100" },
  { source: "SEC Filings", type: "atom", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=&company=&dateb=&owner=include&start=0&count=100&output=atom" },
  { source: "CNBC", type: "rss", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html" },
  { source: "MarketWatch", type: "rss", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories" },
];

async function main() {
  const previous = await readPrevious();
  const events = [];
  const failures = [];

  for (const feed of feeds) {
    try {
      const items = feed.type === "reddit" ? await redditItems(feed) : await xmlItems(feed);
      for (const item of items) {
        collectMentions(events, feed.source, item.title, item.url, item.score || 1, item.published);
      }
    } catch (error) {
      failures.push(`${feed.source}: ${error.message}`);
    }
  }

  for (const [ticker] of STOCKS) {
    try {
      const market = await fetchMarket(ticker);
      if (market) {
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
          published: new Date().toISOString(),
        });
      }
    } catch (error) {
      failures.push(`Price/Volume ${ticker}: ${error.message}`);
    }
  }

  for (const [ticker] of STOCKS.slice(0, 35)) {
    try {
      const items = await yahooTickerNews(ticker);
      for (const item of items) {
        collectMentions(events, "Yahoo Public News", item.title, item.url, 2, item.published, ticker);
      }
    } catch (error) {
      failures.push(`Yahoo Public News ${ticker}: ${error.message}`);
    }
  }

  const signals = aggregate(events, previous);

  const hasFreshData = events.length > 0 && signals.length > 0;
  const previousHasSignals = previous?.signals?.length > 0;
  if (!hasFreshData && previous?.signals?.length) {
    console.warn(
      `No fresh public data could be fetched (likely network/DNS restrictions). Keeping previous snapshot from ${previous.generatedAt || "unknown time"}.`
    );
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
      "Real snapshot from public no-key sources. Coverage is best-effort and less complete than paid APIs for X, Google Trends, StockTwits, and options flow.",
    sources: SOURCES,
    failures: failures.slice(0, 20),
    signals,
    events: events.slice(0, 400),
  };

  await mkdir(new URL("data/", ROOT), { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  await writeFile(OUT, `${json}\n`);
  await writeFile(OUT_JS, `window.SIGNALDESK_DATA = ${json};\n`);
  console.log(`Wrote ${signals.length} ticker signals from ${events.length} source events to ${OUT.pathname}`);
  if (failures.length) console.log(`Source warnings: ${failures.slice(0, 5).join(" | ")}`);
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(OUT, "utf8"));
  } catch {
    return null;
  }
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

async function fetchMarket(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=5d&interval=1d`;
  const json = await fetchJson(url);
  const result = json.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0];
  const closes = (quote?.close || []).filter(Number.isFinite);
  const volumes = (quote?.volume || []).filter(Number.isFinite);
  if (closes.length < 2 || volumes.length < 2) return null;
  const last = closes.at(-1);
  const prev = closes.at(-2);
  const avgVolume = volumes.slice(0, -1).reduce((sum, value) => sum + value, 0) / Math.max(1, volumes.length - 1);
  return {
    lastPrice: last,
    priceMove: ((last - prev) / prev) * 100,
    relativeVolume: avgVolume ? volumes.at(-1) / avgVolume : 1,
  };
}

function collectMentions(events, source, text, url, weight = 1, published = "", forceTicker = "") {
  const normalized = ` ${text.toLowerCase().replace(/[^a-z0-9.$&+ -]/g, " ")} `;
  for (const [ticker, name, aliases] of STOCKS) {
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
        published: published || new Date().toISOString(),
      });
    }
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
        sources: Object.fromEntries(SOURCES.map((source) => [source, 0])),
        latest: [],
      };
    item.mentions += event.mentions;
    item.weightedSentiment += event.sentiment * event.mentions;
    item.weightedPrice += event.priceMove * event.mentions;
    item.weightedVolume += event.relativeVolume * event.mentions;
    if (Number.isFinite(event.lastPrice)) item.lastPrice = event.lastPrice;
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

function scoreSentiment(text) {
  const positives = POSITIVE.reduce((sum, word) => sum + countWord(text, word), 0);
  const negatives = NEGATIVE.reduce((sum, word) => sum + countWord(text, word), 0);
  return clamp(-1, 1, (positives - negatives) / Math.max(3, positives + negatives + 1));
}

function countWord(text, word) {
  return (text.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "g")) || []).length;
}

function textBetween(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
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

async function fetchText(url) {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, text/xml, */*" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function stockName(ticker) {
  return STOCKS.find(([symbol]) => symbol === ticker)?.[1] || ticker;
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
