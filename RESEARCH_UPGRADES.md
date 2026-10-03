# Research intelligence upgrades 1–9

Implementation scope: daily collection; living source contracts; permanent company
coverage; reviewed evidence revisions; battery programs; satellite rollouts;
emerging-topic discovery; company economics; a focused daily brief.

The existing static, dependency-free stack and light/dark palettes are retained.
The principal design issue is that an undifferentiated radar requires the reader
to rediscover what changed. The new default brief prioritizes changes,
research gaps and next checkpoints, with detailed tools one level deeper.

Evidence rules: targets are not observations; source availability is not truth;
collection dates are not publication dates; company reports are not independent
tests; technology success is not a stock-return forecast. No synthetic quotes,
operating metrics or sample discoveries may be shipped as real data.

Global reviewed evidence is repository-backed. Browser review drafts are local
and exportable, never silently published. New source documents enter an
unreviewed inventory. Initial backfills are labeled as such, not breaking news.

## The nine upgrades

1. **Daily reliability:** a separate seven-day research workflow runs at 00:43,
   06:43, 12:43 and 18:43 America/Toronto. Successful sources are checked once
   per local calendar day; failures get later retry opportunities. Transport
   and 5xx errors get one immediate retry, not 403/429 responses. Both data
   writers serialize, rebase before pushing, and verify the deployed snapshot.
2. **Living sources:** 22 contracts replace historical-page monitoring:
   rolling company/customer newsrooms, carrier product pages, research RSS /
   Atom / RDF, FCC releases and eight SEC submissions feeds. Article patterns
   exclude navigation/biographies; broken contracts fail visibly.
3. **Permanent companies:** QS, SLDP, TM, TMUS, ASTS, META, MSFT and GOOGL retain
   records and quote history regardless of stock-attention ranking.
4. **Evidence review:** versioned documents, before/after excerpts, local drafts,
   export, a validating import command, immutable reviews and correction history.
5. **Battery programs:** QS Eagle, Solid Power/BMW and Toyota/Idemitsu have stage
   filters and comparisons for yield, output, pack cost, cycle life and density.
   Unknown metrics stay unknown; cell and pack measures are not combined.
6. **Satellite rollouts:** country/carrier/device records distinguish text,
   selected-app data, voice and unrestricted internet. US T-Mobile and Canadian
   Rogers records preserve limits; AST remains an explicit research gap.
7. **Discovery:** technical noun phrases from dated headlines, story
   deduplication, reporting-owner breadth, saveable leads and linked evidence.
   Story momentum requires 28 collected days with unchanged, healthy coverage.
8. **Economics:** SEC facts and history with native units, periods, accounting
   tags and filing provenance; company exposure, dilution research and risks.
   Cash-only burn coverage excludes securities/other liquidity and is not total
   runway. No ADR or share-class assumptions fabricate market capitalization.
9. **Daily brief:** unreviewed changes, published reviews, next checkpoints,
   collection gaps and direct links to the two priority trackers. Follows
   personalize it. Light/dark/system and the existing Desk remain.

Upgrade 10 (a thesis journal/outcome tracker) is outside this change.
Feature-branch changes and schedules become public only after merge/deployment.

## Update cadence and operating limits

| Data | Cadence | Limit |
| --- | --- | --- |
| Source inventory | Daily, seven days; later retries for failed checks | Readable does not mean newly published or true |
| Company prices | Twice daily, 12-hour cache | Saved quotes, not a real-time trading feed |
| SEC financial facts | Weekly or when a new filing is detected | Unsupported custom tags remain gaps; old periods are labeled |
| Discovery | Each research run | Limited feed sample, not a whole-web census |
| Reviewed claims/stages/capabilities | Human review and Git publication | Collection never automatically verifies a claim |
| Public-site watchdog | 10:11 and 22:11 Toronto daily | Separate job, but still on GitHub Actions |

GitHub schedules are best-effort and may be delayed or dropped. The watchdog
fails for publication older than 36 hours, coverage/configuration mismatches,
fewer than 80% recently readable sources, missing permanent companies, or fewer
than 75% of companies with quotes within 96 hours. Individual failures remain
visible even when the aggregate gate passes. No paid service or notification
subscription was created; existing repository notification settings apply.

The October 2 live baseline reached 22/22 sources and recent prices for 8/8
companies, with 491 document versions. This is not a reliability SLA. Some feeds
have no recent relevant publications; that differs from a failed fetch.
Some SEC metrics remain historical-only or absent.

## Operations

Requires Node 20+, without a build or added dependency:

    node scripts/update-technology.mjs
    node scripts/check-research-health.mjs
    node scripts/check-research-health.mjs --live
    node --test scripts/test/*.test.mjs

Diagnostics: `--output /tmp/signaldesk-research`, `--sources-only`,
`--retry-errors` after repairing a contract, or `--force` for all sources.
Do not repeatedly force blocked sources. Never hand-edit generated data.

Configuration is in `research-config.js`. To publish a reviewed claim:

1. Open **Review**, read the original, and draft a bounded claim with definition,
   period, qualifier, source date and caveat.
2. Save locally and export. Neither action changes public evidence.
3. Run `node scripts/review-evidence.mjs /path/to/signaldesk-review-drafts.json`.
   It validates provenance, units, tracker/theme compatibility, immutable IDs
   and correction chains. Rejected candidates cannot replace evidence.
4. Inspect `research-reviews.json`, run collection/tests and publish through
   normal Git review. Corrections append; originals stay in history. Editorial
   stage/checkpoint assessments are updated separately.

Retention: 800 document versions / 180 days, 400 source events, 90 discovery
history days, a 200-topic / 90-day saved-lead archive and 120 quote observations per company. Export local review drafts
before clearing browser storage; follows/drafts do not sync across devices.

### Quote-provider limits

Yahoo public chart and Stooq fallbacks are not a purchased availability or
redistribution guarantee. Optional server-side `SIGNALDESK_QUOTE_API_KEY`
uses paced Alpha Vantage end-of-day quotes; configure only with appropriate
display/redistribution rights. No key was configured. Never put one in browser
code. Market capitalization/multiples remain unavailable unless the provider
supplies them; initial public responses did not. Technology-specific revenue,
margins, retention, battery metrics and paying satellite usage are not invented.

References: [SEC APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
[Alpha Vantage quotes](https://www.alphavantage.co/documentation/#latestprice),
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).

## Verification

223 deterministic tests cover the existing stock behavior plus collection,
calendar cadence, retries, financial identity/units/periods, immutable reviews,
discovery comparability, escaping, publication checks and workflow wiring.
Browser QA covers the research paths at mobile/desktop sizes in both palettes.
No synthetic observations ship as real data, and no claim is made about
measured investment returns or conversion improvements.
