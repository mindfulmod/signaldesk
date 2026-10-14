export const companyQuoteFixture = (ticker, now) => ({ ticker, quoteCheckedAt: now,
  quote: { price: 5, currency: "USD", asOf: now, precision: now.length === 10 ? "day" : "time", provider: "Test quote source", url: "https://example.org/quote" } });
