# SignalDesk — Insider Evidence Layer (Form 4)

Decision set locked 2026-07-17 via discovery interview. This spec is the source of
truth for the insider/big-money evidence layer. Nothing here ships to the Springs
badge until the backtest gate below passes.

## Why this layer exists

The coil detector's validated weakness is the PLUG trap: coils with no fundamental
inflection die (−18.6% rel median, 16% win, zero doubles). Insider buying is a
second, independent discriminator for that exact failure mode. The research
literature is consistent: open-market insider **purchases** predict (sales don't),
**cluster buys** (2+ distinct insiders in a short window) are the strongest
pattern, and buys **into weakness/consolidation** — i.e., during coil regimes —
have the best forward returns. Fusion (insider buys × coil / theme state) is the
edge; a raw "smart money feed" is commodity noise and is explicitly not the goal.

## Locked decisions (2026-07-17)

| Decision | Choice |
|---|---|
| Data layer (v1) | SEC Form 4 cluster buys only |
| Product shape | Evidence layer woven into existing surfaces — **no standalone panel** |
| Surfaces | (1) Springs-card badge — gated on backtest; (2) ticker-detail evidence row — ungated, honest "context, not signal" labeling |
| Universe | Full tracked ledger universe (S&P 500 + mention-driven small/mid caps), via SEC `company_tickers.json` ticker→CIK map. Small caps are where insider signal is strongest — SOFI-type names are the origin story |
| Validation | Backtest **before** UI: coil discriminator test on the existing 419 frozen coil regimes (2019–2026) |
| Kill criterion (pre-committed) | If coils-with-cluster-buys don't beat coils-without by a meaningful margin (~+10pts win rate or clearly better median SPY-relative return), the Springs badge does **not** ship. The ticker-panel evidence row ships regardless, labeled as context |
| Filtering | High-conviction only (definition below). No everything-with-scores feed |
| v2 parking lot | 13D/13G activist stakes (same EDGAR pipeline, rare high-value events, cheap increment) |
| Declined 2026-07-17 | **Buybacks** — announcement ≠ execution, moderate signal. **Congress trades** — scrape-hostile official sources, stale free mirrors, 45-day lag. **13F whales** — 45-day quarterly lag makes it stale as a trigger. Do not relitigate without new evidence |

## High-conviction event definition

An insider event is signal-worthy iff:

- Transaction code **P** (open-market purchase) in the non-derivative table.
  Grants (A), option exercises (M), tax withholding (F) are noise — never count them.
- **Not** flagged as a 10b5-1 planned trade (checkbox required on Form 4 since 2023).
- AND one of:
  - **Cluster:** ≥2 distinct insiders with qualifying P buys within a trailing 30-day window, or
  - **Size:** a single P buy ≥ $250k (provisional — final threshold to be derived
    from the backtest, not tuned by hand).

Enrichment worth carrying on each event: insider role (CFO buys empirically
outperform CEO buys), dollar value, buy-into-weakness flag (price below its own
60d midpoint at transaction date).

## Data source notes

- `https://www.sec.gov/files/company_tickers.json` — free, keyless ticker→CIK map.
- Form 4 filings: EDGAR daily index + per-CIK submissions API
  (`data.sec.gov/submissions/CIK##########.json`), structured XML per filing.
- Rate limit: 10 req/s **with a User-Agent header identifying the app** — SEC
  blocks anonymous UAs. Be a good citizen; the 4x/day workflow cadence is plenty
  (Form 4s are due within 2 business days of the trade anyway).

## Backtest design (the gate)

Replay 2019–2026 Form 4 history against the existing frozen coil regimes:

1. For each of the 419 regimes, did a high-conviction event occur during the coil?
2. Split regimes into with-insider vs without-insider cohorts.
3. Compare: release rate, 12-mo forward SPY-relative return, win rate, double rate.
4. Judge against the pre-committed kill criterion. Also use results to finalize
   the dollar threshold and check whether the CFO-role weighting earns its place.

The badge's UI copy must quote the measured base rates, same style as the Springs
board's existing honesty (e.g. "Coils with insider cluster buys released X% of
the time in our 2019–2026 sample").

## Build order (with model tags, per standing preference)

| # | Task | Model |
|---|---|---|
| 1 | Ticker→CIK mapping + Form 4 fetch/parse lib (`scripts/lib/form4.mjs`) + tests | Sonnet |
| 2 | Backtest study against frozen coil regimes; write up results + go/no-go call | Fable |
| 3 | High-conviction event detection lib + tests (thresholds from #2) | Sonnet |
| 4 | Pipeline step in `update-data.mjs` + workflow file list + `data/insider.*` | Sonnet |
| 5 | Ticker-panel evidence row (ships regardless of #2's verdict) | Sonnet |
| 6 | Springs-card badge + base-rate copy (only if #2 passes the gate) | Fable |

Items 1–2 are one session (the validation session); 3–6 are the build session.
