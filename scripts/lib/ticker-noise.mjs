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
export const COMMON_WORD_TICKERS = new Set([
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
  "YET", "YOU", "YOUR",
]);

export function isCommonWordTicker(ticker) {
  return COMMON_WORD_TICKERS.has(String(ticker || "").toUpperCase());
}
