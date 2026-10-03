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
  const quote = yahooQuote(quoteData, "QS", now), previous = { companies: { QS: { factsVersion: 2, factsCheckedAt: now, quoteAttemptAt: now, quote, quoteCheckedAt: now } } };
  let calls = 0;
  const result = await collectCompanies({ companies: [company] }, {}, previous, { now, sleep: async () => {}, fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal(calls, 0); assert.equal(result.companies.QS.quote, quote);
});
test("a new filing refreshes company facts before the weekly cache expires", async () => {
  let calls = 0;
  const previous = { companies: { QS: { factsVersion: 2, factsCheckedAt: now, factsAccession: "old", quoteAttemptAt: now, quote: yahooQuote(quoteData, "QS", now) } } };
  const result = await collectCompanies({ companies: [company] }, { sources: { "sec-qs": { items: [{ accession: "new" }] } } }, previous, { now, sleep: async () => {}, fetchImpl: async () => { calls++; return json({ facts: { "us-gaap": { CashAndCashEquivalentsAtCarryingValue: fact([point("2026-06-30", 300)]) } } }); } });
  assert.equal(calls, 1); assert.equal(result.companies.QS.factsAccession, "new");
});
test("cash-only coverage is absent for incompatible periods, currencies, stale or positive flows", () => {
  const cash = { value: 100, unit: "USD", end: "2026-06-30" }, operatingCashFlow = { value: -50, unit: "USD", start: "2026-01-01", end: "2026-06-30" };
  assert.ok(model.financialContext({ financials: { cash, operatingCashFlow } }).runwayMonths > 11);
  for (const patch of [{ unit: "JPY" }, { end: "2026-03-31" }, { value: 50 }, { stale: true }, { start: "2026-06-01" }]) assert.equal(model.financialContext({ financials: { cash, operatingCashFlow: { ...operatingCashFlow, ...patch } } }).runwayMonths, null);
  assert.match(model.financialContext({}).runwayCaveat, /Excludes marketable securities/);
});
