# Production review — September 25, 2026

Reviewed the live GitHub Pages page and commit `6796fa2`, the Sep 25 22:28 UTC
snapshot, both Desk and Research, and ten saved daily snapshots (not ten intraday
runs). No generated data was hand-edited.

| Observation | User consequence | Bounded fix |
| --- | --- | --- |
| News strip paired current moves with a 61-day-old CNET valuation page and a 393-day-old BBBY story | Old material looked like current causal evidence | Valid publication date within 72 hours, recent quote, generic prediction/valuation pages excluded; renamed Recent news & moves |
| BBBY quote dated Aug 14 appeared in Sep 25 setup analysis | Stale market action appeared current | Stale/no-quote labels; unavailable current market data cannot confirm a setup or quiet mover |
| CNET valuation text, TDIC forecasts and SHMD generic price-action words triggered proof quarters | Weak matches expanded coverage for two quarters | Keep +8% / 3× thresholds; require recent published earnings/results/guidance evidence; archive legacy matches, stop their expansion |
| Direct Reddit had no coverage in ten saved days; Nasdaq repeatedly timed out | Dead filters and unnecessary requests | Pause direct Reddit and Nasdaq adapters; preserve history and adapters for a future verified reactivation |
| StockTwits, ApeWisdom, HN and 4chan had coverage on all ten days; GDELT on one | Blanket removal would discard useful sources | Retain working social sources and best-effort GDELT; show unavailable/partial status truthfully |
| 14/18 source groups had matches, but only 31/75 tickers had recent quotes plus current-run Price/Volume coverage | Updated timestamp implied too much completeness | Persistent mobile-visible coverage summary; distinct covered/partial/no-matches/unavailable/paused states |
| News, radar, 50 rows, attention map and weeks of alerts repeated information | Core discovery was buried | Desk starts with 15-row expandable board and details; repeated/experimental context moves to Research |
| Theme heat mostly quiet/insufficient; phrase radar empty | Market breadth could be confused with adoption evidence | Separate, explicitly manual adoption watchlist with primary sources and falsifiers |

## Design trial

Kept the dark palette, type stack, CSV, filters, watchlist, deep links, history
mode, detail sheet and saved panel preferences. Trialled the Desk reading order:
tickers appear in the initial desktop viewport instead of after news and radar.
Filters are on demand; mobile cards put related fields side by side. Native
disclosures retain full evidence without permanent walls of text.

Frontend guards clean up existing snapshots on deployment. Collection changes
apply on the next scheduled run. This review branch is not a production deploy.

## Verification

- 138 Node tests, including real market-news builder freshness checks, source
  status parsing, legacy-leader quarantine and adoption evidence validation.
- Syntax checks for every touched JavaScript/module and `git diff --check`.
- Browser checks at 375×812 and 1440×900: no horizontal overflow, searchable
  stale quote labelled correctly, 15→50 rows, keyboard ticker activation,
  watchlist add/filter/remove, sidebar, full-history/latest switching, and
  table/radar/attention-map selection into the mobile sheet or desktop detail.
- Adoption disclosure and browser-local following survive reload. Browser
  console showed no errors or warnings during these checks.
- Did not run the full live collection job locally: it writes generated history
  and could send configured alerts. Its changed rules are covered by unit tests;
  verify the scheduled collection and Pages deploy after a future merge.

## Not claimed solved

- The pipeline still mixes synthetic market weights with human mentions. Separate
  literal post/article counts from market activity; audit blended price/volume
  aggregation and >25× volume sanitation before a scoring-model redesign.
- Aggregators are delivery sources, not independent publishers. Resolve original
  publisher/issuer identity and syndication before claiming independence.
- Missing SPY-relative-return inputs must not imply a quiet market. Theme heat
  needs metric-level completeness before being relied on for theme discovery.
- Audit common-word tickers, corporate actions and SEC share-count market caps.
  The dynamic universe is not a vetted list of investment candidates.
- Four live calibration events do not establish predictive performance. Keep
  retrospective coil base rates separate from forward SignalDesk results and
  provide reproducible provenance before promoting those statistics.

See [ADOPTION_TRACKER.md](ADOPTION_TRACKER.md) for the technology thesis and the
next steps toward an actual adoption-observation pipeline.
