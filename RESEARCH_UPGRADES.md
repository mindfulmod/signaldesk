# Research intelligence work plan

Original implementation scope (upgrades 1–9): daily collection; living source contracts; permanent company
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

The next work is the [Hank audit follow-up](#hank-audit-follow-up) below. It
hardens the existing features rather than treating their original delivery as
proof of data correctness. All follow-up items are pending; adding this plan
does not authorize implementation, collection changes or deployment.

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

## Verification of the original nine-upgrade delivery

The original delivery recorded 223 deterministic tests covering stock behavior plus collection,
calendar cadence, retries, financial identity/units/periods, immutable reviews,
discovery comparability, escaping, publication checks and workflow wiring.
Browser QA covers the research paths at mobile/desktop sizes in both palettes.
No synthetic observations ship as real data, and no claim is made about
measured investment returns or conversion improvements.

## Hank audit follow-up

### Scope, evidence and sequencing

This incorporates Hank's supplied October 5–9 audit findings. Most October 8
reproductions used commit `c638ce98e991db05468f8a55ab31dcd0b0b484bc` and the
unmodified production functions, including `enhancements.js`. Other snapshots
are linked where relevant. These are saved-data, static-code and offline-controller
findings, **not a fresh hosted-browser verification**. “Present” below means
present in the cited audit snapshot, not independently rechecked on today's site.
Remote `main` resolved to `73d82678ee11ad79252ca11cb314e56f5b0e901c` at plan
intake; every fix must first be reproduced or dispositioned against latest `main`.

Status for H01–H16: **open / awaiting latest-main reproduction**, unless a
specific case is explicitly described as historical, latent or closed. This is
a plan-only handoff. No candidate patch has been applied as part of this update.

Execution order:

1. Correct misleading market output, missing-data classifications, issuer
   identity and inconsistent filter scopes. Include H08's export selection with
   H04, and H15's confidence wording in this first release gate.
2. Make review/search usable and safe: H09, H15's review defaults, then H10.
3. Harden event/document lifecycles and metadata before expanding collection.
   H07 remains a high-priority integrity issue even where it shares this foundation.
4. Evaluate additional sources only after integrity and rights checks pass;
   leave currently unreachable safeguards below reproduced user-facing problems.

This consolidates the unresolved aggregation, source independence, missingness
and calibration concerns in [the September production review](PRODUCTION_REVIEW_2026-09-25.md#not-claimed-solved).
H01/H02/H04/H05/H07 also support the existing
[Discovery validation milestones](DISCOVERY_MODEL.md); fixing a defect does not
complete the backtesting or establish predictive stock returns. Research work
extends upgrades 4/7/8/9 above, rather than starting a second competing pipeline.

### Priority 1 — trustworthy output and identity

#### H01 · Separate market measurements from attention activity

- **Audit evidence:** historical SCNX showed +2,211.5% and 2,255 activity weights
  following a confirmed 1-for-25 reverse split; 2,233 weights came from
  Price/Volume, not social posts. Its later absence from the 75-stock list is not
  a fix. The collector's penultimate-close comparison needs same-basis/date
  validation. Non-market zero returns dilute market returns (including NOK/UEC),
  and full-history mention-weighted daily returns are mislabeled “today”.
- **Related fixture:** FLYE had 34,594 weights, 34,565 from Price/Volume
  (99.916%), with unvalidated 11,484.32× relative volume / +82.61%. Neither a
  split nor a genuine move is established by that fixture. The >25× volume
  reset to 1 also needs explicit treatment, not silent normalization.
- **Acceptance:** quarantine uncertain price comparisons; retain units, dates,
  comparison windows and provenance; separate literal attention counts from
  synthetic activity and market measurements. Regress split handling, extreme
  volume, mixed sources, NOK/UEC and FLYE through both the live override and
  fallback paths. Do not equate saved-array rank with default Discovery rank.
- **Candidate, not a completed fix:** Hank's previously delivered
  `signaldesk-split-safety-review.zip`, based on
  `f8f5f75451dc55a10ba66e4317e6eefe0fe60d36`, reportedly passed 273 Node 24 tests
  and applied cleanly there; SCNX activity became 22 with return unknown.
  Re-obtain and inspect before reuse. Its conservative guard can suppress genuine
  moves of at least 50%; Node 20 CI, browser QA, FLYE coverage and deployment
  remain outstanding. It is not comprehensive normalization or historical repair.

Evidence: [SCNX corporate action](https://www.nasdaqtrader.com/TraderNews.aspx?id=ECA2026-704),
[SCNX saved data](https://github.com/mindfulmod/signaldesk/blob/9025c92eb94f41d66ae5b2657096de27f5478428/data/signals.json),
[price comparison](https://github.com/mindfulmod/signaldesk/blob/9025c92eb94f41d66ae5b2657096de27f5478428/scripts/update-data.mjs#L1277-L1299),
[FLYE fixture](https://github.com/mindfulmod/signaldesk/blob/a2b7844336a1bed734ac38fd80ded41a130227ec/data/signals.json#L160),
[activity formula](https://github.com/mindfulmod/signaldesk/blob/a2b7844336a1bed734ac38fd80ded41a130227ec/scripts/update-data.mjs#L465).

#### H02 · Missing observations must not look quiet or coiled

- **Audit evidence:** October 5 MNDY had repeated-price/null-volume observations
  on 44/60 days and QURE on 53/60, yet both appeared “Coiled”. Missing breadth
  became AI semis “Quiet/0”; SPY had 62 observations against 91 required; all
  531 missing current Wikipedia observations became “Cold”.
- **Acceptance:** distinguish observed, carried-forward and missing values;
  require adequate real observations for volatility, breadth and attention
  classifications. Regress gaps, stale flat series and insufficient baselines
  separately from genuinely flat or quiet observed series. Do not tune the
  frozen coil thresholds to conceal missingness.

Evidence: [October 5 baseline](https://github.com/mindfulmod/signaldesk/tree/f8f5f75451dc55a10ba66e4317e6eefe0fe60d36).

#### H03 · Verify issuer/fund identity before displaying descriptions

- **Audit evidence:** SOXS resolved to a solar X-ray payload; KORU to a radio
  station; QQQ to Australian television; MSTR to generic strategy; APLD to
  Applied Digital Data Systems; SES AI to satellite operator SES S.A.
  No ranking or valuation impact was demonstrated.
- **Acceptance:** require positive issuer/fund identity against official
  references, not title overlap. Withhold ambiguous descriptions and regress
  all six cases, including ticker aliases and similarly named organizations.

Evidence: [saved rows](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/data/signals.json#L241),
[identity gate](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/scripts/update-data.mjs#L1952-L1987),
[renderer](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/script.js#L1084).

#### H04 · Give filtered counts, scores and evidence a consistent scope

- **Audit evidence:** ApeWisdom-only INTC changed 4→1 (−75%) while retaining
  all-source acceleration +162.5% (16→42), six sources and “Corroborated”. PEP
  retained disabled market/catalyst evidence.
- **Acceptance:** current and prior counts use the same selected sources;
  unknown prior coverage stays unknown. Headline metrics and supporting evidence
  either follow the filters or clearly identify intentionally global context.
  Regress INTC −75% and PEP through the actual `enhancements.js` override.
  Build the shared selection contract used by H08; do not fix only the fallback.

Evidence: [production override](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/enhancements.js#L157-L170),
[history fixture](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/data/history.json).

#### H05 · Remove the exact-zero momentum scoring discontinuity

- **Audit evidence:** holding other INTC fields fixed gave scores of 41, 47,
  41, 41 and 44 at −0.01%, 0%, +0.01%, +1% and +10%. Zero and unknown share a
  special 0.35 baseline instead of the nonzero function. This is a counterfactual
  fixture, not a claim about today's INTC momentum; MRVL/BTBT impact was limited
  by clipping in the audited data.
- **Acceptance:** distinguish measured zero from unknown; test continuity and
  monotonicity around zero and through clipping boundaries. Keep this bounded
  scoring correction separate from full model calibration/backtesting.

Evidence: [momentum scoring](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/script.js#L672-L676).

#### H06 · Select SEC facts by accounting context, not tag availability alone

- **Audit evidence:** ASTS FY2024 selected $13.825m ExcludingAssessedTax instead
  of consolidated $4.418m IncludingAssessedTax from the same accession. QS's
  95,449,946 shares were Class B dated February 18, 2022; that filing also had
  334,388,936 Class A shares. Both were historical displays; no scoring or
  valuation error was inferred.
- **Acceptance:** select and expose accession, period, consolidated context and
  taxonomy rationale. Label share class and date explicitly; preserve historical
  warnings. Treat current-period/custom-tag coverage as a separate gap, not a
  reason to silently substitute incompatible historical facts.

Evidence: [ASTS filing](https://www.sec.gov/Archives/edgar/data/1780312/000095017025030909/asts-20241231.htm#F_7ea2cc27-f66c-4175-9d77-21c517905871),
[audited saved snapshot](https://github.com/mindfulmod/signaldesk/tree/c638ce98e991db05468f8a55ab31dcd0b0b484bc).

#### H07 · Make social freshness and graph ingestion idempotent

- **Audit evidence:** unchanged 4chan thread 62670923 received fresh September
  10/11/15/18 dates; replaying an identical event increased graph weight 1→2.
  Exact production inflation is unknown without per-document provenance.
- **Acceptance:** stable event identities, separate publication/observation
  times, persisted attribution and idempotent graph accumulation. Test unchanged
  refresh, actual edits, repeated ingestion and recovery/replay. Coordinate the
  identity contract with H11/H12 without treating posts, revisions and stories
  as interchangeable units.

Evidence: [audited thread](https://boards.4chan.org/biz/thread/62670923),
[audited code snapshot](https://github.com/mindfulmod/signaldesk/tree/c638ce98e991db05468f8a55ab31dcd0b0b484bc).

### Priority 2 — workflow correctness and lifecycle safeguards

#### H08 · Export the same selection the user is viewing

- **Audit evidence:** a small-cap board showed SDST/CRBU/SBFM/VERI/MI, but export
  selected 50 names including large caps. Search/source/sort were honored;
  capitalization, attention and watchlist filters were not. This was an offline
  selection reproduction, not a verified browser download.
- **Acceptance:** use H04's shared visible-selection function for board/export;
  explicitly label top-50 versus all-matching export scope. Test combined
  filters, stars, ordering and empty results, then a real browser CSV download.

Evidence: [export selection](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/enhancements.js#L203-L208),
[table selection](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/script.js#L609-L613).

#### H09 · Search Review documents without first filtering out their technology

- **Audit evidence:** “incident” hid Waymo; in All versions, “holographic” hid
  one matching document and “Nobel” hid eleven. Free text first filters the
  technology registry, excluding documents before the document search runs.
- **Acceptance:** explicit theme/follow controls define scope; free text searches
  document content within that scope. Regress these queries, owner/title matches,
  genuine empty states and combined follow/theme restrictions. Moving only the
  empty-state branch is insufficient. The visual-pass brief/follow intersection
  fix does not resolve this separate Review search path.

Evidence: [Review scope and search](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/adoption.js#L84-L109).

#### H10 · Correct published drafts without reusing immutable IDs — latent

- **Audit evidence:** after publish/reload, a retained local draft reused its old
  ID, causing a self-referencing correction or rejection of an edited immutable
  review. The audited snapshot had zero published reviews, so this is a lifecycle
  reproduction, not evidence of corrupted published review history.
- **Acceptance:** reconcile published drafts; clone corrections with new IDs
  and correct predecessor links while preserving unsent edits and immutable
  originals. Test publish→reload→correct in the same browser, a subsequent
  correction and idempotent export/import.

Evidence: [draft identity](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/adoption.js#L182-L193),
[import immutability](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/scripts/review-evidence.mjs#L8-L11).

#### H11 · Retain identity after document eviction — latent

- **Audit evidence:** the 800-record/180-day archive is also the sole version
  memory. Four unchanged 201-item sources produced four false “new-document”
  events on the next collection; aged unchanged items can also return as fresh.
  The audited live inventory had only 579 versions across six days, below the
  capacity/age conditions used in the fixture.
- **Acceptance:** maintain a compact identity/first-seen ledger independent of
  full-content retention, with an explicit retention policy and protected review
  references. Test capacity eviction, aging, unchanged reappearance and genuine
  revisions. Share canonical identity with H12, retaining separate event types.

Evidence: [retention/version memory](https://github.com/mindfulmod/signaldesk/blob/c638ce98e991db05468f8a55ab31dcd0b0b484bc/scripts/lib/research-intelligence.mjs#L18-L37).

### Priority 3 — research quality and gated source expansion

#### H12 · Count canonical stories, not headline revisions

- **Audit evidence:** an October 6 Nature Nobel headline edit produced 118 dated
  versions across 117 URLs; current leads were unaffected in that snapshot.
- **Acceptance:** count canonical stories while retaining revisions and review
  history. Test same URL/new title, revised evidence and unchanged refresh with
  H11's identity ledger. Do not inflate attention merely because wording changed.

Evidence: [story identity](https://github.com/mindfulmod/signaldesk/blob/120a5c657f9370fc33bf65c93b41e07293659649/scripts/lib/research-intelligence.mjs#L55-L58).

#### H13 · Distinguish biological regulation from policy/regulatory evidence

- **Audit evidence:** three Nature papers matched “regulat”; none entered current
  themes, leads or the brief in the audited snapshot.
- **Acceptance:** require approval/policy context. Regress prostate cancer,
  lipopolysaccharide transport and regulatory T cells against actual regulator
  announcements; preserve an unknown/unclassified option.

Evidence: [classification heuristic](https://github.com/mindfulmod/signaldesk/blob/515ac95763613040ac3b1bbae1b1c3e553a90a90/scripts/lib/research-intelligence.mjs#L11-L16).

#### H14 · Preserve original research, announcement and observation dates

- **Audit evidence:** the October 7 Waymo announcement linked research originating
  September 4, but the saved record lacked date, excerpt and paper link. Its
  incident-readiness framework is not measured safety improvement or deployment.
  FCC grant headline 425636 was metadata only; scope/date were unverified.
- **Acceptance:** retain stable linked identities, original research date,
  announcement date and observation date separately. Keep excerpts and primary
  links where permitted; metadata-only records must not imply reviewed outcomes
  or verified authorization scope.

Evidence: [Waymo announcement](https://waymo.com/blog/2026/10/incident-management-exercises/),
[original paper](https://arxiv.org/abs/2609.04777),
[FCC record](https://www.fcc.gov/edoc/425636).

#### H15 · Make relevance decisions explicit and bound confidence language

- **Audit evidence:** an October 5 Toyota buyback was offered as battery proof;
  a protein article defaulted to Accept + solid-state battery. “Confirmed” /
  “Corroborated” reflected cross-type activity, not independent claim verification.
  Springs' frozen 65% / +12.6% study figures had inaccessible methodology.
- **Acceptance:** require explicit review category, decision and relevance;
  unrelated documents cannot become technology proof via defaults. Test the
  buyback/protein examples alongside genuinely relevant battery evidence.
  Label activity corroboration separately from independently reviewed claims.
  Qualify or withhold study figures until reproducible methodology is available;
  do not declare them false or retune frozen thresholds. Confidence wording is
  a Priority 1 release gate; review defaults ship with H09/H10, not after expansion.

Evidence: [October 5 baseline](https://github.com/mindfulmod/signaldesk/tree/f8f5f75451dc55a10ba66e4317e6eefe0fe60d36).

#### H16 · Enrich sources only after provenance, comparability and rights gates

- Deepen existing SEC records with filing dates, items and exhibits first.
  Evaluate Nasdaq RSS, CPUC Waymo monthly reports and USAspending as candidates,
  not committed integrations or verified replacements for existing coverage.
- CPUC observations need California-only scope, company-reported provenance
  and comparability-change warnings. Federal obligations are not revenue or
  deployment; Department of Defense reporting can lag 90 days. Federal Register
  notices may repeat FCC ownership, and meetings are not authorizations.
- The sampled Essilor page was client-rendered: find an appropriate authorized
  feed before promising coverage. SLDP extractor failure was disproved and is
  closed. No unrestricted, keyless full-market quote replacement was verified;
  Twelve Data demo limits/redistribution rights and Alpaca redistribution
  restrictions require review before any provider decision.
- Satellite records must preserve country, effective date, domestic versus
  roaming availability, supported features and exclusions, using carrier evidence
  such as [T-Mobile support](https://www.t-mobile.com/support/coverage/satellite-support)
  and [Rogers satellite](https://www.rogers.com/mobility/satellite).
- **Acceptance:** each proposed source has an access/reuse decision, owner identity,
  stable IDs, publication/observation semantics, cadence/freshness contract,
  failure behavior and fixture-backed parser. Avoid counting duplicate issuers
  as independent evidence. Review the reported automated-collection restrictions
  in [T-Mobile's terms](https://www.t-mobile.com/responsibility/consumer-info/policies/terms-of-use)
  before expansion and review retention/redistribution rights across new sources.
  This is a permission-review gate, not a conclusion that a legal breach occurred.

### Lower-priority safeguards and closed cases

- **Historical-date selection (latent):** arbitrary historical/empty-day selection
  may fall back to today's tickers. The current UI exposes only latest/full-history,
  so this is not a normally reachable current date-selection bug. Add a regression
  and explicit empty state before exposing arbitrary dates.
- **Theme calibration (latent):** freeze event-time basket membership rather than
  applying a later registry, and define retry/missingness behavior for unavailable
  target prices instead of retaining missing targets permanently. No current
  theme-stage entries established a present result error. Keep this under the
  existing Discovery validation plan and below reproduced user-facing defects.
- **Closed:** the transient Nature feed failure recovered; the SLDP extractor
  failure was disproved. Do not reopen either without new evidence.

### Definition of done for each follow-up release

1. Reproduce on latest `main` using pinned fixtures; record whether the issue is
   present, already fixed, historical-only or latent. An absent ticker is not
   proof that its underlying defect was fixed.
2. Add targeted regressions, including actual production overrides in
   `enhancements.js` where relevant, and both saved-data and live/fallback paths.
   Keep evidence units, observation windows, identity and missingness explicit.
3. Pass the full suite and supported Node 20 CI. The audit's existing 13 research
   lifecycle tests passed despite lifecycle defects: green tests alone do not
   demonstrate coverage of these findings. Report actual tested cases, not just
   a higher test count.
4. Verify affected workflows in the browser at desktop/mobile sizes, in light
   and dark modes, including real CSV download and review correction where in
   scope. Preserve current search, filters, follows, keyboard use and disclosure
   state; do not hide warnings during the visual cleanup.
5. After separately authorized merge/deployment, verify the deployed commit,
   affected saved data and scheduled collection behavior without generating
   duplicate events. Decide explicitly whether contaminated history needs repair
   or a warning; no silent historical rewrite. Mark items complete only with
   linked test/review evidence and disclose any remaining limitations.
