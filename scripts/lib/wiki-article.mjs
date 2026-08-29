// Resolving a Wikipedia article for a ticker, and — the part that matters —
// deciding whether the article we found is actually about that company.
//
// This is the attention pipeline's weakest link. The coil detector reads
// Wikipedia pageviews as its attention series (see THEME_ENGINE.md P1), so a
// wrong article does not degrade gracefully: it produces a clean, plausible,
// fully-populated 400-day series driven by people reading about something else
// entirely. That is worse than no data, because nothing downstream can tell it
// apart from signal. Probed 2026-08-29, naive "search the company name and take
// the first hit" gets these wrong:
//
//   Canaan (CAN, the bitcoin-miner maker) -> "Canaan", the ancient Levantine
//     region. Exact title match, 399 days of history, entirely Bible readers.
//   Hyperscale Data, Inc. (GPUS)          -> "Data center", a generic concept
//     page reached through a redirect.
//
// So an article is accepted only when it passes BOTH checks below: it has to
// look like an organisation at all, and it has to look like *this* one. Either
// alone lets one of the two cases above through — Canaan passes the name check
// perfectly, and a generic concept page can share tokens with a company name.

// Corporate decoration carries no identifying information and would otherwise
// inflate token overlap with any article containing "company" or "holdings".
const CORPORATE_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
  "ltd", "limited", "plc", "llc", "lp", "llp", "sa", "nv", "ag", "se", "as",
  "holding", "holdings", "group", "groupe", "the", "and", "of",
  "trust", "reit", "fund", "etf", "class", "common", "stock", "shares", "adr",
]);

// Words that identify the subject as a business or fund. Drawn from the
// REST summary's `description` field, which is a short human-written gloss
// ("American semiconductor company", "Canadian mining company") and is by far
// the cleanest discriminator available.
const ORGANISATION_HINTS =
  /\b(compan(?:y|ies)|corporation|corporate|conglomerate|firm|business|enterprise|manufacturer|producer|retailer|supplier|developer|operator|provider|bank|insurer|airline|automaker|carrier|miner|brand|subsidiary|startup|fund|exchange-traded|holding company|investment trust)\b/i;

// Exchange listings are near-proof of a public company and rescue entries whose
// description is unusually terse.
const EXCHANGE_HINTS = /\b(nasdaq|nyse|amex|tsx|tsxv|lse|euronext|otcqb|otcqx|ticker symbol|traded as|listed on)\b/i;

// Categories that are common false positives for short or word-like company
// names. A hit here rejects outright: no real issuer's summary calls it an
// ancient region or a studio album.
const NON_ORGANISATION_HINTS =
  /\b(region|ancient|biblical|mytholog\w*|deity|kingdom|empire|province|village|town|municipalit\w*|river|mountain|island|desert|album|song|film|movie|novel|book|television series|video game|given name|surname|genus|species|language|dialect|facility used|physical room|vaccine|drug|medication|therapy|antibod\w*|spacecraft|aircraft)\b/i;

// Strip punctuation and corporate decoration, leaving every identifying word.
export function stripCorporate(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // Single letters are always debris, never identity. They come from
    // punctuation-joined legal forms — "Genmab A/S" (the Danish equivalent of
    // Inc.) splits to "a" and "s", which no suffix list can catch as a unit.
    .filter((w) => w.length > 1)
    .filter((w) => !CORPORATE_SUFFIXES.has(w));
}

// Tokens used for SCORING an article, which is a different job from searching
// for one. Two-letter fragments ("ON", "OR") match almost any English prose, so
// they are dropped here when anything more distinctive survives — otherwise
// every article would score a partial match on them. Names that are ONLY short
// words keep them rather than scoring against an empty set.
export function nameTokens(name) {
  const all = stripCorporate(name);
  const distinctive = all.filter((w) => w.length >= 3);
  return distinctive.length ? distinctive : all;
}

// The query to search with. Wikipedia's opensearch endpoint is a PREFIX search,
// so the ledger's registered names miss their own articles: "Indivior PLC" is
// not a prefix of "Indivior", and neither is "SelectQuote, Inc." of
// "SelectQuote". Measured 2026-08-29 on a 26-ticker sample, this alone was the
// dominant failure — half the sample returned no hit at all, and stripping the
// suffix recovered them.
//
// Deliberately NOT falling back to the full-text search endpoint when this finds
// nothing. Full-text always returns *something*: probed on the same misses it
// answered "Regency Affiliates" with Hyatt, "Generation Income Properties" with
// Passive income, and "Golden Sun Technology" with a video game. A clean miss is
// a better outcome than handing the verifier a confident wrong answer, because
// most tickers here genuinely have no article and should keep none.
// Uses stripCorporate, NOT nameTokens: searching must keep the short words that
// scoring drops. "ON Semiconductor" reduced to its scoring tokens is
// "semiconductor", which searches straight into the generic concept page instead
// of the company.
export function searchQuery(name) {
  const tokens = stripCorporate(name);
  return tokens.length ? tokens.join(" ") : String(name || "").trim();
}

// Both queries worth trying, in order, deduped.
//
// Stripping the suffix is usually the win — it is what finds Indivior and
// SelectQuote at all. But the suffix is sometimes the only thing disambiguating
// a word-like name: "Root Inc" finds the insurer, while bare "root" finds the
// basal organ of a vascular plant. Neither query dominates, so try the stripped
// form first and fall back to the registered name, accepting whichever verifies.
export function articleQueries(name) {
  const raw = String(name || "").trim();
  const stripped = searchQuery(name);
  return [...new Set([stripped, raw].filter(Boolean))];
}

// Fraction of the company's identifying tokens that appear anywhere in the
// article's title, description or opening extract. The extract matters most:
// Wikipedia follows renames, so "ON Semiconductor" resolves to the article
// titled "Onsemi" whose extract still opens "ON Semiconductor Corporation is...".
// Scoring on the title alone would reject exactly the correct answer.
export function nameOverlap(name, summary) {
  // Scores EVERY stripped token, including the short ones nameTokens drops.
  // Dropping them was a real precision hole: "T1 Energy Inc." and "Cn Energy
  // Group. Inc." both reduce to the single generic token ["energy"], which
  // matches "TC Energy" and "CMS Energy" perfectly — two entirely different
  // companies, each accepted with a confident 1.0 and a clean 398-day pageview
  // series. The distinctive part of those names is exactly the short fragment.
  const tokens = stripCorporate(name);
  if (!tokens.length) return 0;
  const haystack = [summary?.title, summary?.description, summary?.extract]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!haystack) return 0;
  // Word-boundary, not substring: short tokens as substrings match almost any
  // prose ("on" is inside "Corporation"), which is what made them look useless
  // and got them excluded in the first place.
  const hits = tokens.filter((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`).test(haystack)).length;
  return hits / tokens.length;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function looksLikeOrganisation(summary) {
  const description = String(summary?.description || "");
  const extract = String(summary?.extract || "");
  const opening = extract.slice(0, 400);
  if (NON_ORGANISATION_HINTS.test(description)) return false;
  if (ORGANISATION_HINTS.test(description)) return true;
  if (EXCHANGE_HINTS.test(opening)) return true;
  // No description (some stubs have none) — fall back to the opening sentence,
  // but only if it does not read like one of the false-positive categories.
  if (NON_ORGANISATION_HINTS.test(opening)) return false;
  return ORGANISATION_HINTS.test(opening);
}

export const MIN_NAME_OVERLAP = 0.6;

// The gate. Returns the canonical title to use for pageviews — Wikipedia
// resolves redirects, and the canonical title is what the pageviews API counts
// under, so passing the search term through would undercount a renamed company.
export function verifyArticle(companyName, summary, { minOverlap = MIN_NAME_OVERLAP } = {}) {
  if (!summary || summary.type !== "standard") {
    return { ok: false, reason: `not a standard article (${summary?.type || "missing"})` };
  }
  if (!summary.title) return { ok: false, reason: "no title" };
  if (!looksLikeOrganisation(summary)) {
    return { ok: false, reason: `not an organisation (${summary.description || "no description"})` };
  }
  const overlap = nameOverlap(companyName, summary);
  if (overlap < minOverlap) {
    return { ok: false, reason: `name overlap ${overlap.toFixed(2)} < ${minOverlap}` };
  }
  return { ok: true, article: summary.title, overlap };
}
