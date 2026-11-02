import { test } from "node:test";
import assert from "node:assert/strict";
import { financialFacts, yahooQuote, stooqQuote, alphaQuote, collectCompanies } from "../lib/company-intelligence.mjs";
import model from "../../research-model.js";

const now = "2026-10-02T21:00:00Z", company = { ticker: "QS", name: "QuantumScape", cik: "0001811414", reportingCurrency: "USD", themes: ["batteries"] };
const point = (end, val, extra = {}) => ({ end, val, filed: "2026-08-01", form: "10-Q", accn: "0001811414-26-000001", ...extra });
const fact = rows => ({ units: { USD: rows } });
const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const quoteData = { chart: { result: [{ meta: { symbol: "QS", regularMarketPrice: 5, regularMarketTime: Date.parse("2026-10-02T20:00:00Z") / 1000, currency: "USD" } }] } };

test("newer reported periods outrank an older preferred accounting tag", () => {
  const result = financialFacts({ cik: company.cik, facts: { "us-gaap": { RevenueFromContractWithCustomerExcludingAssessedTax: fact([point("2024-12-31", 100)]), Revenues: fact([point("2026-06-30", 200)]) } } }, company, now);
  assert.equal(result.financials.revenue.value, 200); assert.equal(result.financials.revenue.tag, "Revenues");
});
test("financial facts preserve units, restatements, periods and source accession", () => {
  const result = financialFacts({ facts: { "us-gaap": { Revenues: fact([point("2026-06-30", 200, { start: "2026-01-01", filed: "2026-07-01" }), point("2026-06-30", 220, { start: "2026-01-01", form: "10-Q/A" })]) } } }, company, now);
  const f = result.financials.revenue;
  assert.equal(f.value, 220); assert.equal(f.unit, "USD"); assert.equal(f.start, "2026-01-01");
  assert.match(f.url, /1811414\/000181141426000001/); assert.equal(result.histories.revenue.length, 1);
});
test("identity mismatches and future facts cannot become financial observations", () => {
  assert.throws(() => financialFacts({ cik: 7, facts: {} }, company, now), /identity/);
  assert.equal(Object.keys(financialFacts({ facts: { "us-gaap": { Revenues: fact([point("2027-01-01", 5)]) } } }, company, now).financials).length, 0);
});
test("native reporting currency wins; historical facts are explicitly marked stale", () => {
  const data = { facts: { "ifrs-full": { Revenue: { units: { USD: [point("2026-06-30", 5)], JPY: [point("2024-03-31", 1000)] } } } } };
  const f = financialFacts(data, { ...company, reportingCurrency: "JPY" }, now).financials.revenue;
  assert.equal(f.unit, "JPY"); assert.equal(f.value, 1000); assert.equal(f.stale, true);
});
test("quote parsers validate ticker, price and original timestamp", () => {
  const q = yahooQuote(quoteData, "QS", now);
  assert.equal(q.price, 5); assert.equal(q.asOf, "2026-10-02T20:00:00.000Z"); assert.equal(q.marketCap, null);
  assert.throws(() => yahooQuote(quoteData, "SLDP", now), /matching/);
  assert.throws(() => yahooQuote(quoteData, "QS", "2026-09-01"), /future/);
  const csv = "Symbol,Date,Time,Open,High,Low,Close,Volume\nQS.US,2026-10-02,22:00,1,2,1,1.5,20";
  assert.equal(stooqQuote(csv, "QS", now).price, 1.5);
  assert.throws(() => stooqQuote(csv, "SLDP", now));
  assert.throws(() => alphaQuote({ Note: "API limit" }, "QS", now));
  assert.equal(alphaQuote({ "Global Quote": { "01. symbol": "QS", "05. price": "5", "07. latest trading day": "2026-10-02" } }, "QS", now).precision, "day");
});
test("permanent company coverage survives provider failures without erasing old data", async () => {
  const quote = yahooQuote(quoteData, "QS", now), previous = { companies: { QS: { quote, quoteAttemptAt: "2026-09-30", financials: { cash: { value: 100, end: "2026-06-30" } } } } };
  const collected = await collectCompanies({ companies: [company] }, {}, previous, { now, sleep: async () => {}, fetchImpl: async () => new Response(null, { status: 503 }) });
  assert.equal(collected.companies.QS.quote, quote); assert.equal(collected.companies.QS.financials.cash.value, 100);
  assert.ok(collected.companies.QS.factsError); assert.ok(collected.companies.QS.quoteError);
  assert.equal(collected.companies.QS.quoteCheckedAt, undefined);
});
test("cached prices respect a 12-hour cadence while companies remain present", async () => {
  const quote = yahooQuote(quoteData, "QS", now), previous = { companies: { QS: { factsVersion: 4, factsCheckedAt: now, quoteAttemptAt: now, quote, quoteCheckedAt: now } } };
  let calls = 0;
  const result = await collectCompanies({ companies: [company] }, {}, previous, { now, sleep: async () => {}, fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal(calls, 0); assert.equal(result.companies.QS.quote, quote);
});
test("a new filing refreshes company facts before the daily cache expires", async () => {
  let calls = 0;
  const previous = { companies: { QS: { factsVersion: 4, factsCheckedAt: now, factsAccession: "old", quoteAttemptAt: now, quote: yahooQuote(quoteData, "QS", now) } } };
  const result = await collectCompanies({ companies: [company] }, { sources: { "sec-qs": { items: [{ accession: "new" }] } } }, previous, { now, sleep: async () => {}, fetchImpl: async () => { calls++; return json({ facts: { "us-gaap": { CashAndCashEquivalentsAtCarryingValue: fact([point("2026-06-30", 300)]) } } }); } });
  assert.equal(calls, 1); assert.equal(result.companies.QS.factsAccession, "new");
});
test("funding context distinguishes missing investment coverage without calculating runway", () => {
  const financials = { cash: { value: 100, end: "2026-06-30" }, marketableSecuritiesCurrent: { value: 200, end: "2026-06-30" }, shortTermInvestments: { value: 200, end: "2026-06-30" } };
  const context = model.fundingContext({ factsVersion: 4, financials });
  assert.deepEqual(context.investmentKeys, ["marketableSecuritiesCurrent", "shortTermInvestments"]);
  assert.match(context.coverage, /overlap/);
  assert.match(context.caveat, /No runway forecast/);
  assert.equal(context.runwayMonths, undefined);
  assert.equal(context.totalLiquidity, undefined);
  assert.match(model.fundingContext({ factsVersion: 4 }).coverage, /does not mean.*zero/);
  const legacy = model.financialDisplay({ factsVersion: 3, financials });
  assert.deepEqual(legacy.financials, { cash: { value: 100, end: "2026-06-30" } });
  assert.match(model.fundingContext(legacy).coverage, /not been collected/);
});
test("older investment balances remain inspectable without becoming current funding", () => {
  const financials = { cash: { value: 100, end: "2026-09-30" }, marketableSecuritiesCurrent: { value: 200, end: "2026-06-30" }, marketableSecuritiesNoncurrent: { value: 30, end: "2011-03-31", stale: true } };
  const context = model.fundingContext({ factsVersion: 4, financials });
  assert.deepEqual(context.investmentKeys, []);
  assert.deepEqual(context.historicalInvestmentKeys, ["marketableSecuritiesCurrent", "marketableSecuritiesNoncurrent"]);
  assert.match(context.coverage, /Current holdings are not established/);
});
test("investment lines remain distinct and exclude generic, restricted, duration and invalid facts", () => {
  const data = { facts: { "us-gaap": {
    MarketableSecuritiesCurrent: fact([point("2026-06-30", 200)]),
    MarketableSecuritiesNoncurrent: fact([point("2026-03-31", 30)]),
    ShortTermInvestments: fact([point("2026-06-30", 200)]),
    MarketableSecurities: fact([point("2026-06-30", 999)]),
    RestrictedCashAndCashEquivalentsCurrent: fact([point("2026-06-30", 500)]),
  } } };
  const result = financialFacts(data, company, now);
  assert.equal(result.financials.marketableSecuritiesCurrent.value, 200);
  assert.equal(result.financials.marketableSecuritiesNoncurrent.end, "2026-03-31");
  assert.equal(result.financials.shortTermInvestments.value, 200);
  assert.equal(Object.keys(result.financials).length, 3);
  assert.equal(result.financials.cash, undefined);
  for (const patch of [{ start: "2026-01-01" }, { val: -1 }, { end: "2026-06-99" }, { filed: "2026-02-30" }, { filed: "2026-01-01" }, { accn: "123-4" }]) {
    const bad = financialFacts({ facts: { "us-gaap": { MarketableSecuritiesCurrent: fact([point("2026-06-30", 200, patch)]) } } }, company, now);
    assert.equal(bad.financials.marketableSecuritiesCurrent, undefined, JSON.stringify(patch));
  }
  const zero = financialFacts({ facts: { "us-gaap": { MarketableSecuritiesCurrent: fact([point("2026-06-30", 0)]) } } }, company, now);
  assert.equal(zero.financials.marketableSecuritiesCurrent.value, 0);
});
test("conflicting investment facts are withheld, with provenance and alternatives retained", () => {
  const result = financialFacts({ facts: { "us-gaap": { MarketableSecuritiesCurrent: fact([point("2026-06-30", 200), point("2026-06-30", 300)]) } } }, company, now);
  const current = result.financials.marketableSecuritiesCurrent;
  assert.equal(current.value, null);
  assert.equal(current.alternatives.length, 2);
  assert.equal(current.tag, "MarketableSecuritiesCurrent");
  assert.match(current.selectionBasis, /Conflicting/);
});
test("financial coverage upgrades once, refreshes daily and bounds failed retries", async () => {
  const quote = yahooQuote(quoteData, "QS", now);
  const prior = { factsVersion: 3, factsCheckedAt: now, quoteAttemptAt: now, quote, quoteCheckedAt: now };
  let calls = 0, pauses = [];
  const good = async () => { calls++; return json({ facts: { "us-gaap": { CashAndCashEquivalentsAtCarryingValue: fact([point("2026-06-30", 100)]), MarketableSecuritiesCurrent: fact([point("2026-06-30", 200)]) } } }); };
  const options = { now, fetchImpl: good, sleep: async ms => pauses.push(ms) };
  const upgraded = await collectCompanies({ companies: [company] }, {}, { companies: { QS: prior } }, options);
  assert.equal(calls, 1); assert.equal(upgraded.companies.QS.factsVersion, 4);
  assert.deepEqual(pauses, [200]);
  const fresh = await collectCompanies({ companies: [company] }, {}, upgraded, options);
  assert.equal(calls, 1);
  const tomorrow = "2026-10-03T21:00:00Z";
  fresh.companies.QS.quoteAttemptAt = tomorrow;
  await collectCompanies({ companies: [company] }, {}, fresh, { ...options, now: tomorrow });
  assert.equal(calls, 2);
  const failed = await collectCompanies({ companies: [company] }, {}, fresh, { ...options, now: tomorrow, fetchImpl: async () => { calls++; throw Error("temporary source failure"); } });
  assert.equal(failed.companies.QS.financials.marketableSecuritiesCurrent.value, 200);
  assert.equal(failed.companies.QS.factsCheckedAt, now);
  const attempted = calls;
  await collectCompanies({ companies: [company] }, {}, failed, { ...options, now: "2026-10-03T23:00:00Z" });
  assert.equal(calls, attempted);
  failed.companies.QS.quoteAttemptAt = "2026-10-04T03:00:00Z";
  await collectCompanies({ companies: [company] }, {}, failed, { ...options, now: "2026-10-04T03:00:00Z" });
  assert.equal(calls, attempted + 1);
});
