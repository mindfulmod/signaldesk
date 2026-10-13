import quality from "../../data-quality.js";
import identity from "../../company-identity.js";

// Operational release targets, not investment-model parameters. Keep degraded
// snapshots available with warnings; fail the job after publication so an outage
// cannot look like a healthy collection merely because some news was fetched.
export const MARKET_HEALTH_TARGETS = { minTickers: 50, minQuoteFraction: .75, maxSnapshotHours: 96, warnSnapshotHours: 36 };
export function marketHealth(snapshot, now = Date.now(), targets = MARKET_HEALTH_TARGETS) {
  targets = { ...MARKET_HEALTH_TARGETS, ...targets };
  const errors = [], warnings = [], rows = Array.isArray(snapshot?.signals) ? snapshot.signals : [];
  const coverage = quality.marketCoverage(snapshot || {}, now);
  const ids = rows.map(s => s?.ticker);
  if (!rows.length || rows.some(s => !s || typeof s !== "object" || !/^[A-Z][A-Z0-9.-]{0,14}$/.test(s.ticker || "")) || new Set(ids).size !== ids.length) errors.push("Published market universe is empty, malformed or contains duplicate tickers");
  if (snapshot?.dataMode !== "real-public-no-key") errors.push("Published market snapshot does not identify the expected public-data mode");
  if (!quality.recent(snapshot?.generatedAt, now, targets.maxSnapshotHours)) errors.push(`Market publication is missing, future-dated or older than ${targets.maxSnapshotHours} hours`);
  else if (!quality.recent(snapshot.generatedAt, now, targets.warnSnapshotHours)) warnings.push(`Market snapshot is older than ${targets.warnSnapshotHours} hours; the ${targets.maxSnapshotHours}-hour hard limit tolerates weekends/long weekends, not a live-feed SLA`);
  if (coverage.total < targets.minTickers) errors.push(`Only ${coverage.total} tickers in the market universe (operational floor: ${targets.minTickers})`);
  if (coverage.collectedQuotes < Math.ceil(coverage.total * targets.minQuoteFraction)) errors.push(`Only ${coverage.collectedQuotes}/${coverage.total} tickers have a recent quote collected in this snapshot (target: at least ${Math.round(targets.minQuoteFraction * 100)}%)`);
  if (coverage.retainedQuotes) warnings.push(`${coverage.retainedQuotes} recent quotes are retained from earlier collections and do not count as current collection success`);
  if (coverage.missingQuotes || coverage.staleQuotes) warnings.push(`Quotes: ${coverage.missingQuotes} missing, ${coverage.staleQuotes} stale or invalid`);
  if (coverage.completeComparisons < coverage.collectedQuotes) warnings.push(`${coverage.collectedQuotes - coverage.completeComparisons} collected quotes lack a usable price/volume comparison; preserve the quarantine, do not invent normal values`);
  const validHeadline = entry => entry && typeof entry === "object" && typeof entry.title === "string" && entry.title.trim() && quality.SOURCES.includes(entry.source);
  const headlineMismatches = rows.filter(s => s?.topHeadline && (!validHeadline(s.topHeadline) || !quality.articleMatches(s.topHeadline, s))).map(s => s.ticker);
  const marketNews = Array.isArray(snapshot?.marketNews) ? snapshot.marketNews : [];
  if (snapshot?.marketNews != null && !Array.isArray(snapshot.marketNews)) errors.push("Market news feed is malformed");
  const newsMismatches = marketNews.filter(entry => !validHeadline(entry) || !identity.NEWS_SOURCES.has(entry.source) || !quality.articleMatches(entry, entry)).map(entry => entry?.ticker || "unknown");
  if (headlineMismatches.length) errors.push(`Unverified company identity in highlighted headlines: ${headlineMismatches.join(", ")}`);
  if (newsMismatches.length) errors.push(`Unverified company identity in market news: ${newsMismatches.join(", ")}`);
  const quarantinedTickers = rows.filter(s => s?.quarantinedNews?.length).map(s => s.ticker);
  if (quarantinedTickers.length) warnings.push(`Saved news remains quarantined for ${quarantinedTickers.length} tickers; exclusions are not verified absence of news`);
  if (snapshot?.failures != null && !Array.isArray(snapshot.failures)) errors.push("Market failure diagnostics are malformed");
  for (const failure of Array.isArray(snapshot?.failures) ? snapshot.failures : []) if (/Price\/Volume/.test(String(failure))) warnings.push(String(failure));
  return { ok: !errors.length, errors, warnings, generatedAt: snapshot?.generatedAt || null, coverage, targets,
    identity: { headlineMismatches, newsMismatches, quarantinedTickers },
    note: "Snapshot/quote availability and lexical headline identity only. Does not certify provider licensing, complete market coverage, article truth, causality, model calibration or future returns." };
}
