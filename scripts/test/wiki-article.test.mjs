import { test } from "node:test";
import assert from "node:assert/strict";
import { nameTokens, nameOverlap, looksLikeOrganisation, verifyArticle, searchQuery } from "../lib/wiki-article.mjs";

// Real REST summaries, captured 2026-08-29. These are the exact cases that made
// naive resolution unsafe: two of them return a clean 399-day pageview series
// for entirely the wrong subject.
const ONSEMI = {
  type: "standard",
  title: "Onsemi",
  description: "American semiconductor company",
  extract:
    "ON Semiconductor Corporation is an American semiconductor supplier company, based in Scottsdale, Arizona. Products include power and signal management, logic, discrete, and custom devices.",
};
const CANAAN = {
  type: "standard",
  title: "Canaan",
  description: "Region in the ancient Near East",
  extract:
    "Canaan was an ancient Semitic-speaking civilization and region of the Southern Levant during the late 2nd millennium BC.",
};
const DATA_CENTER = {
  type: "standard",
  title: "Data center",
  description: "Facility used to house computer servers",
  extract:
    "A data center is a physical room, building, or facility for storing, managing, and disseminating data and information.",
};
const OR_ROYALTIES = {
  type: "standard",
  title: "OR Royalties",
  description: "Canadian mining company",
  extract:
    "OR Royalties Inc. is a Canadian company that holds royalties in gold, silver and diamond mines, principally in the form of net smelter return royalties and streams. Like its predecessor company, Osisko Mining, it is headquartered in Montreal.",
};

test("nameTokens: drops corporate decoration", () => {
  assert.deepEqual(nameTokens("Red Cat Holdings, Inc."), ["red", "cat"]);
  assert.deepEqual(nameTokens("Osisko Gold Royalties"), ["osisko", "gold", "royalties"]);
});

// "ON" and "OR" are real tickers whose names lead with a two-letter word; those
// match almost any English prose and would wave through anything.
test("nameTokens: prefers distinctive tokens, but never returns nothing", () => {
  assert.deepEqual(nameTokens("ON Semiconductor"), ["semiconductor"]);
  assert.deepEqual(nameTokens("ON"), ["on"], "a name with only short words keeps them");
});

test("looksLikeOrganisation: separates issuers from regions and concepts", () => {
  assert.equal(looksLikeOrganisation(ONSEMI), true);
  assert.equal(looksLikeOrganisation(OR_ROYALTIES), true);
  assert.equal(looksLikeOrganisation(CANAAN), false, "an ancient region is not a company");
  assert.equal(looksLikeOrganisation(DATA_CENTER), false, "a concept page is not a company");
});

// Wikipedia follows renames: the correct article for ON Semiconductor is titled
// "Onsemi". Scoring the title alone would reject the right answer.
test("nameOverlap: matches through a rename via the extract", () => {
  assert.equal(nameOverlap("ON Semiconductor", ONSEMI), 1);
  assert.equal(nameOverlap("Osisko Gold Royalties", OR_ROYALTIES), 1);
});

test("verifyArticle: accepts the real companies and returns the canonical title", () => {
  const onsemi = verifyArticle("ON Semiconductor", ONSEMI);
  assert.equal(onsemi.ok, true);
  // The canonical title, not the search term -- pageviews are counted under it.
  assert.equal(onsemi.article, "Onsemi");

  const osisko = verifyArticle("Osisko Gold Royalties", OR_ROYALTIES);
  assert.equal(osisko.ok, true);
  assert.equal(osisko.article, "OR Royalties");
});

// The whole reason this module exists. Canaan passes the name check perfectly --
// exact title match -- so only the organisation check saves us.
test("verifyArticle: rejects the ancient region that shares the company's name", () => {
  const result = verifyArticle("Canaan", CANAAN);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not an organisation/);
  assert.equal(nameOverlap("Canaan", CANAAN), 1, "name check alone would have accepted it");
});

test("verifyArticle: rejects a generic concept page reached by redirect", () => {
  const result = verifyArticle("Hyperscale Data, Inc.", DATA_CENTER);
  assert.equal(result.ok, false);
});

test("verifyArticle: rejects disambiguation pages and missing articles", () => {
  assert.equal(verifyArticle("Acme", { type: "disambiguation", title: "Acme" }).ok, false);
  assert.equal(verifyArticle("Acme", null).ok, false);
});

// A company page that happens to mention its exchange but has a terse
// description should still pass.
test("verifyArticle: an exchange listing rescues a terse description", () => {
  const terse = {
    type: "standard",
    title: "Widgetco",
    description: "",
    extract: "Widgetco is listed on the Nasdaq under the ticker WDGT.",
  };
  assert.equal(verifyArticle("Widgetco", terse).ok, true);
});

// Searching and scoring need different token sets. opensearch is a PREFIX
// search, so the registered name misses its own article; stripping the
// corporate suffix is what recovers it.
test("searchQuery: strips corporate suffixes so the prefix search can hit", () => {
  assert.equal(searchQuery("Indivior PLC"), "indivior");
  assert.equal(searchQuery("SelectQuote, Inc."), "selectquote");
  assert.equal(searchQuery("Genmab A/S"), "genmab");
});

// The regression that split stripCorporate out of nameTokens: reducing this to
// its SCORING tokens gives "semiconductor", which searches into the generic
// concept page rather than the company.
test("searchQuery: keeps short leading words that scoring drops", () => {
  assert.equal(searchQuery("ON Semiconductor"), "on semiconductor");
  assert.deepEqual(nameTokens("ON Semiconductor"), ["semiconductor"]);
});

// Found by running the real resolver over the real ledger, not by unit tests:
// three of fourteen accepts were wrong, and two of them were a DIFFERENT
// COMPANY with a clean 398-day pageview series. Both names reduce to the single
// generic scoring token ["energy"] once short fragments are dropped, so overlap
// against "TC Energy"/"CMS Energy" was a confident 1.0. The distinctive part of
// those names is exactly the fragment that was being discarded.
test("nameOverlap: scores short fragments, so near-miss companies are caught", () => {
  const tcEnergy = {
    type: "standard",
    title: "TC Energy",
    description: "Canadian energy company",
    extract: "TC Energy Corporation is a Canadian energy company headquartered in Calgary.",
  };
  assert.equal(verifyArticle("T1 Energy Inc.", tcEnergy).ok, false);

  const cmsEnergy = {
    type: "standard",
    title: "CMS Energy",
    description: "Electric and gas company in Jackson, Michigan, US",
    extract: "CMS Energy Corporation is an American energy company based in Jackson, Michigan.",
  };
  assert.equal(verifyArticle("Cn Energy Group. Inc.", cmsEnergy).ok, false);
});

// Word-boundary rather than substring matching is what makes scoring short
// tokens safe: "on" is a substring of "Corporation" and would otherwise match
// essentially any company article.
test("nameOverlap: short tokens match words, not substrings", () => {
  const unrelated = {
    type: "standard",
    title: "Acme Corporation",
    description: "American manufacturing company",
    extract: "Acme Corporation is an American manufacturing company.",
  };
  assert.equal(nameOverlap("ON Semiconductor", unrelated), 0, "'on' inside 'Corporation' must not count");
});

// An article about a company's product is not an article about the company.
test("verifyArticle: rejects a product page belonging to the right company", () => {
  const vaccine = {
    type: "standard",
    title: "ImmunityBio COVID-19 vaccine",
    description: "Viral vector COVID-19 vaccine",
    extract:
      "The ImmunityBio COVID-19 vaccine, codenamed hAd5, is a non replicating viral vector vaccine developed by the American company ImmunityBio.",
  };
  const result = verifyArticle("ImmunityBio Inc", vaccine);
  assert.equal(result.ok, false);
  assert.match(result.reason, /not an organisation/);
});
