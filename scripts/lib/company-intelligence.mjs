import { boundedJson } from "./research-fetch.mjs";
const SEC_HEADERS = { "User-Agent": "SignalDesk/2.0 (m.aali9@gmail.com)", Accept: "application/json" };
const day = value => String(value || "").slice(0, 10);
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const METRICS = {
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"],
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "Revenue", "SalesRevenueNet"],
  operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"],
  shares: ["EntityCommonStockSharesOutstanding", "CommonStockSharesOutstanding"],
  debtCurrent: ["LongTermDebtCurrent"],
  debtNoncurrent: ["LongTermDebtNoncurrent"],
};
export function financialFacts(data, company, now = new Date().toISOString()) {
  if (!data?.facts || (data.cik && Number(data.cik) !== Number(company.cik))) throw new Error("Company facts identity/schema mismatch");
  const financials = {}, histories = {};
  for (const [metric, tags] of Object.entries(METRICS)) {
    let chosen = [];
    for (const tag of tags) {
      const facts = [data.facts["us-gaap"]?.[tag], data.facts["ifrs-full"]?.[tag], data.facts.dei?.[tag]].filter(Boolean);
      const points = facts.flatMap(fact => Object.entries(fact.units || {}).flatMap(([unit, values]) => values.map(v => ({ ...v, unit, tag }))));
      const valid = points.filter(p => Number.isFinite(p.val) && p.end && p.filed && p.end <= day(now) && p.filed <= day(now) && /^(10-K|10-Q|20-F|6-K)(\/A)?$/.test(p.form) && /^[\d-]+$/.test(p.accn || "") && (metric === "shares" ? p.unit === "shares" : /^[A-Z]{3}$/.test(p.unit)));
      chosen.push(...valid.filter(p => metric === "shares" || !company.reportingCurrency || p.unit === company.reportingCurrency));
    }
    chosen.sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed) || (b.start || "").localeCompare(a.start || "") || tags.indexOf(a.tag) - tags.indexOf(b.tag));
    const seen = new Set();
    const rows = chosen.filter(p => { const key = `${p.end}|${p.start || ""}|${p.unit}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 12).map(p => ({
      value: p.val, unit: p.unit, start: p.start || null, end: p.end, filed: p.filed, form: p.form, tag: p.tag, accession: p.accn, stale: Date.parse(now) - Date.parse(p.end) > 450 * 86400000,
      url: `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${p.accn.replaceAll("-", "")}/${p.accn}-index.html`,
    }));
    if (rows.length) { financials[metric] = rows[0]; histories[metric] = rows; }
  }
  return { financials, histories };
}
export function yahooQuote(data, ticker, now = new Date().toISOString()) {
  const result = data?.chart?.result?.[0], meta = result?.meta;
  if (!meta || meta.symbol?.toUpperCase() !== ticker || !finite(meta.regularMarketPrice) || Number(meta.regularMarketPrice) <= 0 || !meta.regularMarketTime || !meta.currency) throw new Error("No valid matching quote");
  const asOf = new Date(meta.regularMarketTime * 1000).toISOString();
  if (Date.parse(asOf) > Date.parse(now) + 300000) throw new Error("Quote timestamp is in the future");
  return { price: Number(meta.regularMarketPrice), currency: meta.currency, asOf, precision: "time", provider: "Yahoo public chart", url: `https://finance.yahoo.com/quote/${ticker}/`, marketCap: finite(meta.marketCap) && Number(meta.marketCap) > 0 ? Number(meta.marketCap) : null };
}
export function alphaQuote(data, ticker, now = new Date().toISOString()) {
  const q = data?.["Global Quote"];
  if (!q || q["01. symbol"] !== ticker || !finite(q["05. price"]) || Number(q["05. price"]) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(q["07. latest trading day"] || "") || q["07. latest trading day"] > day(now)) throw new Error("Licensed quote unavailable or quota reached");
  return { price: Number(q["05. price"]), currency: "USD", asOf: q["07. latest trading day"], precision: "day", provider: "Alpha Vantage end-of-day", url: `https://www.alphavantage.co/documentation/#latestprice`, marketCap: null };
}
export function stooqQuote(csv, ticker, now = new Date().toISOString()) {
  const row = csv.trim().split(/\r?\n/).at(-1)?.split(",");
  if (!row || row[0]?.toUpperCase() !== `${ticker}.US` || !/^\d{4}-\d{2}-\d{2}$/.test(row[1]) || row[1] > day(now) || !finite(row[6]) || Number(row[6]) <= 0) throw new Error("No matching Stooq daily quote");
  return { price: Number(row[6]), currency: "USD", asOf: row[1], precision: "day", provider: "Stooq public daily quote", url: `https://stooq.com/q/?s=${ticker.toLowerCase()}.us`, marketCap: null };
}
export async function collectCompanies(config, monitor, previous = {}, { now = new Date().toISOString(), fetchImpl = fetch, apiKey = "", sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const companies = {}, errors = [];
  const age = value => value ? (Date.parse(now) - Date.parse(value)) / 3600000 : Infinity;
  for (const c of config.companies) {
    const prior = previous.companies?.[c.ticker] || {};
    const row = { ...prior, ticker: c.ticker, name: c.name, cik: c.cik, themes: c.themes, financials: prior.financials || {}, histories: prior.histories || {} };
    const filing = monitor.sources?.[`sec-${c.ticker.toLowerCase()}`]?.items?.[0];
    row.latestFiling = filing || prior.latestFiling || null;
    if (prior.factsVersion !== 2 || age(prior.factsCheckedAt) >= (prior.factsError ? 6 : 168) || (filing && filing.accession !== prior.factsAccession)) {
      row.factsAttemptAt = now;
      try {
        const facts = await boundedJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`, { fetchImpl, headers: SEC_HEADERS });
        const parsed = financialFacts(facts, c, now);
        if (!Object.keys(parsed.financials).length) throw new Error("No supported financial facts in filing taxonomy");
        Object.assign(row, parsed, { factsVersion: 2, factsCheckedAt: now, factsAccession: filing?.accession || null, factsError: null });
      } catch (e) { row.factsError = `Financial facts: ${e.message}`; errors.push(`${c.ticker}: ${row.factsError}`); }
    }
    // Two quote opportunities a day. Never replace a valid quote with null on failure.
    if (age(prior.quoteAttemptAt) >= 12 || !prior.quote) {
      row.quoteAttemptAt = now;
      const failures = [];
      let quote;
      if (apiKey) {
        try {
          quote = alphaQuote(await boundedJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${c.ticker}&apikey=${encodeURIComponent(apiKey)}`, { fetchImpl }), c.ticker, now);
        } catch { failures.push("Configured quote provider unavailable / quota reached"); }
        await sleep(13000); // Respect the documented free-tier request rate; at most 16 quotes/day for eight companies.
      }
      if (!quote) try {
        quote = yahooQuote(await boundedJson(`https://query1.finance.yahoo.com/v8/finance/chart/${c.ticker}?interval=1d&range=5d`, { fetchImpl, headers: { "User-Agent": "SignalDesk public company research" } }), c.ticker, now);
      } catch (e) { failures.push(`Yahoo: ${e.message}`); }
      if (!quote) try {
        const r = await fetchImpl(`https://stooq.com/q/l/?s=${c.ticker.toLowerCase()}.us&f=sd2t2ohlcv&h&e=csv`, { signal: AbortSignal.timeout(10000) });
        if (!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
        const text = await r.text(); if (text.length > 10000) throw new Error("Unexpected quote response size");
        quote = stooqQuote(text, c.ticker, now);
      } catch (e) { failures.push(`Stooq: ${e.message}`); }
      if (quote) {
        if (!row.quote || Date.parse(quote.asOf) >= Date.parse(row.quote.asOf)) row.quote = quote;
        row.quoteCheckedAt = now; row.quoteError = null;
        row.quoteHistory = [...(prior.quoteHistory || []).filter(p => day(p.asOf) !== day(quote.asOf)), quote].slice(-120);
      } else { row.quoteError = failures.join("; "); errors.push(`${c.ticker}: ${row.quoteError}`); }
      await sleep(200);
    }
    // Valuation is never fabricated from ADRs, mixed share classes or missing shares.
    row.valuation = row.quote?.marketCap ? { marketCap: row.quote.marketCap, currency: row.quote.currency, asOf: row.quote.asOf, provider: row.quote.provider } : null;
    companies[c.ticker] = row;
  }
  return { schemaVersion: 1, generatedAt: now, providerMode: apiKey ? "Configured end-of-day provider with public fallback" : "Public quote fallbacks; no licensed provider configured", companies, errors };
}
