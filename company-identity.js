// Shared issuer matching for collection and saved-snapshot display. No network.
// A lexical match is identity evidence, never proof that news caused a price move.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SIGNALDESK_IDENTITY = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const COMMON_WORD_TICKERS = new Set([
  "A", "ABOUT", "AFTER", "AGAIN", "AGO", "ALL", "ALSO", "AM", "AN", "ANY", "ARE", "AS", "AT",
  "BACK", "BE", "BEEN", "BEST", "BIG", "BUT", "BY",
  "CAN", "CASH", "CLEAR", "COST", "COULD",
  "DAY", "DID", "DO", "DOES", "DOWN",
  "EACH", "EU", "EVEN", "EVER", "EVERY",
  "FAST", "FEW", "FIND", "FOR", "FREE", "FROM", "FUND",
  "GET", "GO", "GOOD", "GOT", "GREAT",
  "HAD", "HAS", "HAVE", "HE", "HELP", "HER", "HERE", "HIGH", "HIM", "HIS", "HOME", "HOPE", "HOUR", "HOW", "HUGE",
  "IF", "IN", "INTO", "IS", "IT", "ITS",
  "JUST",
  "KEEP", "KNOW",
  "LAST", "LESS", "LET", "LIFE", "LIKE", "LONG", "LOT", "LOVE", "LOW",
  "MADE", "MANY", "MAY", "ME", "MIND", "MORE", "MOST", "MUCH", "MUST", "MY",
  "NEED", "NET", "NEW", "NEXT", "NICE", "NO", "NONE", "NOR", "NOT", "NOW",
  "OF", "OFF", "OG", "ON", "ONCE", "ONE", "ONLY", "OPEN", "OR", "OTHER", "OUR", "OUT", "OVER", "OWN",
  "PART", "PAST", "PER", "PLAN", "PLAY",
  "RE", "REAL", "RIDE", "ROAD", "RUN",
  "S", "SAID", "SAME", "SAVE", "SAW", "SAY", "SEE", "SELF", "SET", "SHE", "SO", "SOME", "STILL", "SURE",
  "T", "TALK", "TH", "THAN", "THAT", "THE", "THEM", "THEN", "THERE", "THEY", "THIS",
  "TO", "TOO", "TOP", "TRUE", "TURN", "TWO",
  "UP", "US", "USE",
  "VERY",
  "WANT", "WAS", "WAY", "WE", "WELL", "WENT", "WERE", "WHAT", "WHEN", "WHERE",
  "WHICH", "WHILE", "WHO", "WHY", "WILL", "WISH", "WITH", "WOULD",
  "YET", "YOU", "YOUR", "BULL", "WOLF", "KEY", "STRATEGY", "TAKE",
]);
  const GENERIC = new Set([...[
  "block", "open", "square", "beyond", "match", "unity", "carnival", "national",
  "general", "global", "american", "united", "first", "next", "core", "energy",
  "power", "capital", "financial", "holdings", "group", "trust", "fund", "growth",
  "value", "metals", "mining", "gold", "silver", "bank", "health", "medical",
  "digital", "data", "cloud", "systems", "solutions", "technologies", "industries",
  "international", "enterprise", "partners", "realty", "resources", "materials",
  "motors", "auto", "retail", "media", "five", "best", "good", "real", "world",
  "service", "services", "products", "brands", "company", "corporation",
], "china", "chinese", "america", "americas",
    "canada", "canadian", "europe", "european", "asia", "asian", "japan", "japanese",
    "india", "indian", "australia", "australian", "korea", "korean", "british",
    "universal", "advanced", "applied", "precision", "new", "north", "south", "east", "west", "space", "strategy", "strategic"]);
  const AMBIGUOUS = new Set(["AI", "ARM", "NET", "T", "F", "ON", "ARE", "CAN", "NOW", "A", "GO", "IT"]);
  const NEWS_SOURCES = new Set(["GDELT News", "Google News", "Bing News", "Yahoo Public News", "CNBC", "MarketWatch", "SEC Filings", "Press Releases", "Financial Media", "Nasdaq"]);
  const escaped = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const words = value => String(value || "").toLowerCase().replace(/&(?:amp|apos|quot);/g, " ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
  function companyName(value) {
    return words(String(value || "").replace(/\/[a-z]{2}\s*$/i, "")
      .replace(/\b(inc|incorporated|corp|corporation|company|co|ltd|limited|plc|holdings?|group|class [a-c]|common stock|the)\b/gi, " "));
  }
  function safeAlias(value, ticker) {
    const alias = words(value);
    if (!alias || alias === words(ticker)) return false;
    if (!alias.includes(" ")) return alias.length >= 4 && !GENERIC.has(alias) && !COMMON_WORD_TICKERS.has(alias.toUpperCase());
    return alias.split(" ").length >= 3 || alias.split(" ").some(word => word.length >= 3 && !GENERIC.has(word) && !COMMON_WORD_TICKERS.has(word.toUpperCase()));
  }
  function aliasesFor(name, ticker = "") {
    const full = companyName(name), lead = full.split(" ")[0];
    const compound = /&|\band\b/i.test(String(name || ""));
    return [...new Set([full, ...(compound ? [] : [lead])])].filter(alias => safeAlias(alias, full === words(ticker) ? ticker : ""));
  }
  function match(stock, title, { source = "" } = {}) {
    const ticker = String(stock?.ticker || "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(ticker)) return null;
    // Aggregator publisher suffixes and GDELT metadata are not headline evidence.
    let text = String(title || "");
    if (source === "Google News" || source === "Bing News") text = text.replace(/\s+-\s+[^-]+$/, "");
    if (source === "GDELT News") text = text.replace(/\s+[a-z0-9.-]+\.[a-z]{2,}(?:\s+[a-z]{2,})?\s*$/i, "");
    const symbol = escaped(ticker), end = "(?![A-Za-z0-9]|[.-][A-Za-z0-9])";
    if (new RegExp("(^|[^A-Za-z0-9$])\\$" + symbol + end, "i").test(text)) return { version: 1, kind: "cashtag", value: ticker };
    if (new RegExp("\\b(?:NASDAQ|NYSE|AMEX|OTC(?:MKTS)?)\\s*:\\s*" + symbol + end, "i").test(text)) return { version: 1, kind: "exchange-symbol", value: ticker };
    const fund = /\b(etf|fund|trust)\b/i.test(String(stock?.name || ""));
    if (!fund && ticker.length > 1 && !AMBIGUOUS.has(ticker) && !COMMON_WORD_TICKERS.has(ticker)
        && new RegExp("(^|[^A-Za-z0-9.$-])" + symbol + end).test(text)) return { version: 1, kind: "symbol", value: ticker };
    const normalized = " " + words(text) + " ";
    const derived = aliasesFor(stock?.name, ticker);
    const full = companyName(stock?.name), strictName = source === "SEC Filings" || fund || /&|\band\b/i.test(String(stock?.name || ""));
    const aliases = [...new Set([...derived, ...(Array.isArray(stock?.aliases) ? stock.aliases : [])])]
      .filter(alias => !strictName || words(alias) === full)
      .filter(alias => derived.includes(alias) || safeAlias(alias, ticker)).map(words).sort((a,b) => b.length - a.length);
    const alias = aliases.find(value => normalized.includes(" " + value + " "));
    return alias ? { version: 1, kind: "company-name", value: alias } : null;
  }
  function articleMatches(entry, stock) {
    if (!NEWS_SOURCES.has(entry?.source)) return true;
    const recordedAlias = entry?.companyMatch?.version === 1 && entry.companyMatch.kind === "company-name" ? entry.companyMatch.value : "";
    return Boolean(match({ ...stock, aliases: [...(Array.isArray(stock?.aliases) ? stock.aliases : []), recordedAlias] }, entry?.title, { source: entry?.source }));
  }
  return { COMMON_WORD_TICKERS, NEWS_SOURCES, aliasesFor, match, articleMatches };
});

