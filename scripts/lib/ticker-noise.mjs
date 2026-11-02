// Tickers that are also common English words. Word-boundary text matching
// cannot tell "$YOU the stock" apart from "you" in ordinary prose, so any
// pipeline stage that matches free text against the ticker universe must
// demand stronger evidence (a cashtag, or a distinctive company-name alias)
// before counting a mention for these symbols.
//
// This list started life inside co-mention.mjs (see the history there: a
// first hand-picked list of offenders was followed by a second wave of
// noise, proving the problem is "any function word, pronoun, preposition,
// or common short word that is also a valid 1-5 letter ticker string", not
// a small fixed set). It moved here once the same noise showed up in the
// main mention scanner itself — a live run ranked YOU (CLEAR Secure) #1 on
// the strength of 4chan posts containing the word "you".
//
// Being on this list does NOT exclude a ticker from the dashboard. It only
// raises the bar for what counts as a text mention of it.
import identity from "../../company-identity.js";
export const COMMON_WORD_TICKERS = identity.COMMON_WORD_TICKERS;

export function isCommonWordTicker(ticker) {
  return COMMON_WORD_TICKERS.has(String(ticker || "").toUpperCase());
}
