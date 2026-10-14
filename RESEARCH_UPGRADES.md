# Research intelligence work plan

## October 14 broader discovery: public procurement pilot

Review-stage implementation only: not connected to the app, scheduled collection,
published data or headline-momentum scores.

- Added `scripts/pilot-procurement.mjs` and a bounded, fixture-tested adapter for
  the [official USAspending public API](https://api.usaspending.gov/). The
  [transaction contract](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/search/spending_by_transaction.md)
  supports a keyword-free sample of federal scientific R&D contract actions
  (NAICS prefix 5417). It does not cover all technology spending, private demand,
  grants or technologies purchased under other classifications.
- One live request returned 100 actions across 99 awards: 30 positive obligation
  changes, 25 negative changes and 45 zero-dollar changes. The sample reached
  its cap and the provider reported more results. These are sample composition,
  not market growth, adoption or newly awarded customer counts. Several records
  describe work on established programs; new action dates do not imply new tech.
- Preserves award/modification identity, exact signed cents, original action
  date, separate observation time and an unknown publication date. Conflicting
  duplicate identities reject the sample. A failed refresh retains prior
  evidence and its original successful-check time. One bounded request, no
  pagination or retries, redirect refusal and response-size/time limits.
- As the [federal spending guide](https://www.usaspending.gov/federal-spending-guide)
  explains, obligations represent commitments, not payments. Negative changes
  can reduce earlier commitments. Do not present these amounts as recipient
  revenue, delivered products, repeat customers or consumer adoption.
- Access decision: the official API explicitly provides public access, and the
  pilot uses factual award metadata and a short description, not full reports
  or recipient profiles. The API code's license is not treated as a blanket
  license for every linked document. No account, paid access or terms acceptance.
- Verification: all 405 tests pass on Node 20 and Node 24, including nine pilot
  regressions for query scope, identity, dates, money, sampling limits, bounded
  requests, malformed replies and preservation of prior evidence on failure.

### Procurement journal follow-up

- `procurement-history.mjs` now preserves immutable checked observations and
  content-addressed record versions. Corrections and reversions retain the same
  action identity; unchanged observations reuse records. Absence from a capped
  or empty sample never deletes an action or labels it cancelled. Summary counts
  mean first observed / record changed / unchanged / not in latest sample, not
  new awards, growth, adoption or independent confirmation.
- Validates every retained record, hash, reference, coverage receipt and date
  before fetching or writing. Rejects conflicting replay and older observations.
  Original pilot snapshots migrate using their original observation time, not
  the migration date. Failed checks preserve prior snapshot and history.
- The pilot command resumes its output history by default. Exclusive output
  locks prevent overlapping writers; atomic replacement avoids partial JSON.
  Corrupt files and attempts to replace history from a different prior file fail
  without changing the destination. Review-stage limits are 400 observations,
  30,000 unique record versions and 40 MB; reaching a limit requires an explicit
  archive decision, never silent pruning. Stale locks need process review.
- Real migration plus one fresh API request retained all 100 original actions,
  with two observations and no new/changed actions. A real 320-character excerpt
  ending in a space exposed a reconstruction edge case; its exact original
  representation is now preserved and regression-tested. This is repeatability
  evidence, not coverage of delayed records or adoption trends.
- All 415 tests pass on Node 20 and Node 24. Ten journal tests cover corrections,
  reversions, disappearance, replay, corrupt metadata, migration, failed refresh,
  retention limits, automatic resumption and overlapping writers.

Before activation: resolve retention/reuse scope and delayed-record
reconciliation; choose a documented sampling protocol
and daily freshness contract; wire source health and failure visibility; create
a distinct **Public R&D spending** evidence lane. Never mix its counts or action
dates into research-publication acceleration. Back-test coverage before making
any trend comparisons. Keep consumer usage, deployments and repeat orders as
separate evidence gaps requiring their own validated sources.

## October 14 coherent research refresh and recovery

Branch implementation, not deployed:

- Technology now has a shared, compact publication status and reload action on
  every view. Failed first loads explicitly mean no automatic snapshot, not no
  activity. Failed later loads name the retained snapshot and offer retry.
- `research-loader.js` loads research and source checks as one compatible pair.
  It validates both HTTP and local-file payloads, rejects mismatched source-check
  generations and older responses, and preserves the last complete pair on
  failure. Overlapping refresh requests share a single in-flight operation.
- Refresh progress does not rerender content. Completed refreshes preserve open
  evidence-review editors and dirty notebook forms; other views keep disclosures
  and source-health reload focus. No reload initiates a collector or changes its
  schedule. File-mode copy explicitly says to reopen the page for changed bundles.
- Isolated browser tests exercised partial download failure, incompatible files,
  successful retry, failed initial loading, view switching and dirty notebook
  preservation. Verified desktop light/mobile dark layouts without overflow and
  normal stock selection through all three entry points. Direct file-URL browser
  QA was blocked by browser policy; payload validation is covered by unit tests.

## October 14 permanent-company quote integrity

Branch implementation, not deployed:

- The collector, company cards/profiles and research watchdog now share
  `research-model.js.companyQuote`. A recent timestamp alone is not coverage:
  require matching record ticker, positive numeric price, explicit three-letter
  currency, inspectable HTTPS source, valid original date/precision and a
  consistent collection timestamp. Invalid prices are withheld with a reason
  and source link; valid observations older than 96 hours remain historical.
- Quote parsers reject impossible calendar dates and boolean prices. A valid
  new response can replace an invalid retained quote rather than being blocked
  by its malformed or future timestamp. Existing retry/cache cadence remains.
- Removed the capitalization path that copied a quote timestamp onto an
  undated provider market-cap field. Configured adapters do not provide an
  independently dated capitalization observation, so valuation stays unknown.
  Cached legacy valuation is cleared by the collector and rejected by health
  checks; the UI never displays that unsupported figure.
- Saved data passes the stricter audit: eight of eight permanent company
  quotes usable/current. No generated snapshots were changed in this pass.
  Live production quotes also pass, but the branch watchdog correctly reports
  missing branch-only discovery feeds (MIT, NIST and Hacker News) on production.
  That is a deployment/configuration gap, not proof those collectors failed.
- Isolated browser fixtures covered missing price, mismatched identity and
  historical price, including source recovery and legacy valuation suppression.
  Verified 1440px light / 375px dark layouts, no horizontal overflow or console
  errors, and all three stock-selection entry points on the normal app.

## October 14 personal research checks in the daily brief

Branch implementation, not deployed:

- The daily brief now surfaces up to three active personal investigations,
  ordered by review date, with overdue/today/upcoming labels and their next
  evidence check. Paused and closed investigations stay out of the active queue.
  These UTC dates are a manual checklist, not alerts, collection schedules or
  company events. Reported-record counts exclude targets and withdrawn records.
- Personal checks are independent of preset-theme filters, including an empty
  theme result. View all opens the complete local notebook. With no notebook,
  one compact Explore new leads action opens the keyword-free Open scan rather
  than displaying an empty personal-research panel.
- Returning from the brief to the same investigation resumes pending plan or
  observation fields without asking to discard them. The pending form reopens
  and the editor labels unsaved changes both while typing and after rerender.
  Moving to the notebook shelf or Open scan preserves the discard safeguard.
- Fixed Open scan navigation reopening a previously active notebook editor.
  Source-health recovery now clears that editor only after handling unsaved edits.
- Browser QA used three clearly labeled example investigations on an isolated
  origin, not user research. Verified due ordering, theme-filter independence,
  notebook access, unsaved-edit round trips, broad-discovery recovery, desktop
  light mode and 375px dark mode without horizontal overflow or console errors.

Scheduled-refresh reconciliation: production commit `f6743ce` arrived during
verification. Accepted its newer company records and quotes for all eight
companies while preserving all 1,066 branch document versions, discovery
history and actual source-check timestamps. The upstream document inventory
was unchanged from its parent and was already fully represented in the branch.
Recomputed discovery from retained source state without adding collection-day
receipts; the one-day comparable history and momentum hold remain intact.
Research health passes with 21/22 active sources readable, five current
discovery feeds, four content checks and two intentional permission pauses.

## October 14 notebook recovery and storage safety

Branch implementation, not deployed. Fixed a data-loss edge case where saving a
valid investigation cleared the dirty-form flag even when local storage failed;
closing the page could then discard session-only records without the app's exit
warning.

- Added a tested storage session that distinguishes form submission from a
  verified write/read-back. Quota errors, denied getters, silent write failures,
  malformed saved data and cross-tab changes stay explicit; existing storage is
  not overwritten after an unresolved conflict or initial read failure.
- Exit protection now covers both pending form edits and unpersisted committed
  records, including imported backups and withdrawal changes. Browser unload
  prompts are best-effort, not a recovery mechanism; the visible session-only
  warning and export instruction remain necessary.
- Export text states that the backup includes session-only records but excludes
  unsaved form edits. Requesting a download or showing the copyable JSON does not
  claim a completed backup or clear protection. No server-side storage or sync
  is implied.
- Verified in an isolated quota-failure preview with synthetic research only:
  failed-persistence import remained accessible after a reload attempt; editor
  labels stayed session-only; exported JSON contained the complete record.
  Phone width 375px had no horizontal overflow. User notebook data and appearance
  preferences were not used by the isolated preview.

## October 14 discovery history: actual daily collection, not cached replays

Branch implementation, not deployed. The previous builder could treat a
still-readable cached source check as a new UTC history day, even though the
collector itself follows Toronto calendar days. Earlier history saved topic IDs
but not the source-check receipts needed to verify daily coverage.

- `discovery-history.mjs` now requires actual successful checks from every
  discovery source on the same Toronto date, usable dated samples, matching
  endpoints and a compatible collection contract. Rebuilding cached data cannot
  mint another day. Contract identity includes owner, lane, extractor version and
  publication-age policy as well as endpoint/extraction configuration.
- Each comparable day records its per-source check timestamps. Missing/invalid
  receipts, conflicting duplicate dates and future dates cannot count. Later
  failed retries preserve earlier successful daily receipts but block a current
  growth claim. Calendar arithmetic covers both DST transitions.
- A growth percentage needs today plus all preceding 28 collection dates, a
  complete retained story window and a nonzero prior story count. The public
  health gate rejects unsupported percentages and inconsistent count arithmetic.
  These remain sampled story counts, never adoption or customer growth.
- Legacy rows remain in a separate audit list (90-day retention, at most 500
  records), not the comparable history. Existing lead first-observed dates survive
  a contract reset; a methodology change cannot create a newly discovered lead.
- Fresh real-source collection at 2026-10-14 00:59 UTC: all five discovery feeds
  readable with dated samples, 11 current phrase leads and 363 deduplicated dated
  stories in the 28-day window. One new-contract Toronto collection day; two
  legacy rows retained. Existing archive gaps remain flagged and all momentum
  percentages stay withheld. Overall source status remains 21/22 active readable,
  with two permission pauses and the QuantumScape 403 retained explicitly.

## October 14 source audit and measured-traction follow-up

Branch implementation, not deployed:

- Review → Source health is now an exception-first audit, with separate counts
  for readable active sources, content checks, collection checks and pauses.
  Readability includes sources with content warnings; it is not an adoption or
  accuracy score. Detailed dates, samples, terms and limitations are disclosed
  per source. Healthy and paused groups start collapsed.
- The audit stays available even when theme filters match nothing. Its source
  universe is global, while the evidence-review queue still respects filters.
  Open disclosures survive saved-data reloads. A recovery action opens the
  keyword-free Open scan with its search and lane filters reset.
- The scheduled health checker shares source identity/readability logic and
  reports missing dates and empty samples outside the discovery feeds too.
  Irregular filings are not given arbitrary daily publication deadlines, and
  undated capability pages remain page-change checks, not dated adoption.
- Saved collection inspected: 2026-10-13 22:49 UTC, 21/22 active sources readable,
  five discovery feeds current, two T-Mobile sources paused. QuantumScape's
  newsroom refuses collection (403). Toyota/FCC samples have no matching items;
  BMW/AST link inventories lack extracted publication dates. These remain
  explicit warnings, not fabricated zeros or permission workarounds.

### Next measured-use adapter: CPUC autonomous-vehicle reporting

Candidate only; **not connected to the scheduled collector**. Inspection of the
[official quarterly reporting page](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting)
and its linked deployment template and 2026 Q2 archive confirmed a monthly
aggregate CSV inside the public Waymo driverless-deployment report. A bounded
range read retrieved the small monthly member without downloading or extracting
the trip-level records. No public app metrics have been created from it.

Activation gates:

1. Resolve reuse of company-submitted data. CPUC's [conditions of use](https://www.cpuc.ca.gov/about-cpuc/conditions-of-use)
   distinguish state-owned information from third-party material. Public
   availability is not a blanket reuse clearance; do not infer authorization
   from the regulator hosting a company submission. The robots endpoint returned
   an unsuccessful response during inspection, which is not a permission grant.
2. Keep California driverless **deployment** separate from pilot programs,
   other states and all-US marketing totals. The dictionary defines `TotalTrips`
   as completed trips—not paid rides, unique users, revenue or independent audit.
   Passenger counts likewise are not unique people. Preserve redactions.
3. Use CSV Year/Month as the reporting period; the filename month is submission
   time. Start with the 2025 reporting definition and do not silently splice
   earlier periods across the changed calendar/template. Verify at least two
   consecutive quarter archives before drawing a trend.
4. Poll the index daily but label the underlying releases quarterly and the
   observations monthly. Preserve revisions, original period, collection time,
   archive member and checksum. A fresh check does not make an old period new.
5. Bound all ranges/decompression/CSV sizes, validate archive consistency and
   checksum, refuse an ignored Range request, reject ambiguous duplicate months,
   and retain last-valid observations with a failure warning. Never fetch the
   granular trip/location files to fill this aggregate-only feature.
6. Show an accessible monthly chart with a value table, scope, reporting lag and
   original link. Machine-parsed reports are not automatically accepted editorial
   claims. Test revisions, redactions, missing months and incompatible scopes.

### Finding trends we did not already name

Keep a broad discovery lane without a theme-keyword gate; balance sources so
one prolific publisher cannot dominate it. Then separate three evidence lanes:
research novelty, attention, and measured use. Save unfamiliar leads and record
one falsifiable next check. Promote a lead only after original evidence and
compatible measurements support it—not because several outlets repeat a release.

Remaining coverage work: permitted consumer-demand and repeat-use datasets,
international/non-English sources, and time series of delivered output or paid
usage. Search interest, repository stars and community votes can help prioritize
research but must not be presented as customers. Battery yield/deliveries and
satellite paying usage remain unknown until suitable disclosures are reviewed.

## October 14 attention-comparison integrity

Branch implementation, not yet deployed:

- Reproduced two misleading comparison paths: prior-source totals were not
  normalized for rejected company matches, and global source health could
  substitute for a ticker missing from one window. Current-side partial
  collection and unobserved catalog zeros were also insufficiently gated.
- Added a versioned sampled-attention contract and explicit per-ticker observed
  sources. Comparisons need usable observations and source health on both sides,
  no identity exclusions, equal sample counts/spacing, and dated ordered windows.
  No source is silently dropped from a user's requested comparison scope.
  Old snapshots remain unverified; no historical version is fabricated.
- A valid observed zero can produce -100%; a missing observation cannot. A zero
  baseline has no percentage growth. Named-source fixture comparisons still
  work, including unaffected sources alongside quarantined prior news.
- History now shows only the latest comparable common-source sequence (up to
  14 saved snapshots), names those sources and breaks on missing records,
  coverage changes or long gaps. Dated all-source totals remain inspectable
  separately. Snapshot windows can overlap and are not unique-post counts,
  continuous daily coverage, adoption or predictions of returns.
- Added comparison notes/window dates to detail and CSV. Unsafe rank deltas
  are withheld when source coverage or the tracked universe differs. Public
  health rejects unsupported saved attention percentages.
- Renamed the mixed Attention-map group Developing attention and display each
  member's true stage. Replaced social mention/news hit counts in the summary
  with weighted activity, and removed the unsupported claim that low captured
  activity proves the crowd has not arrived. Scoring thresholds are unchanged.
- Full refresh completed with a 2026-10-14 00:04:58 UTC collection timestamp:
  75/75 recent collected quotes, 74 complete comparisons, 75 versioned attention
  records, and no unsupported headline/cap/attention claims in the health gate.
  This is the first new-protocol collection; all prior attention coverage remains
  unverified, so no all-source percentage is promoted. 68 company caps remain
  unknown and 7 ETFs are not applicable. Provider failures remain explicit.
- All 81 existing daily snapshot records are preserved exactly; a new UTC
  date brings the archive to 82 unique dates. JSON/file-browser payloads match.
  Normal ledger retention pruned 29 dormant tickers; no history dates were lost.
  Push notifications were disabled. This does not verify the hosted schedule.
- Verification: 346 tests on Node 24 and Node 20, syntax/diff checks, desktop
  1440px and phone 375px. Checked source-history disclosures, exact stage labels,
  all three stock-selection routes and phone detail dismissal. No horizontal
  overflow or console errors. A full-history normalization probe returned 1,308
  distinct tickers in roughly 352ms locally; not a mobile performance guarantee.
- Still required: historical detector provenance/calibration, a permitted
  capitalization source, representative adoption metrics, production merge/
  deployment approval and verification of hosted scheduled refreshes. Healthy
  sample comparisons alone do not establish any of these release requirements.

## October 13 release follow-up

Capitalization integrity follow-up (branch implementation, not yet deployed):

- Removed the Desk's SEC share-count × price enrichment. It did not establish
  share-class/ADR basis, period or corporate-action alignment. SEC issuer-name
  enrichment remains; no share-count requests are needed for Desk size labels.
- Probed the configured Yahoo chart response for AAPL, GOOG and SXTC: all three
  returned prices, symbol and instrument type, but no capitalization or shares
  outstanding field. This is bounded evidence, not a claim about every ticker.
  No new provider or undocumented authenticated endpoint has been connected.
- The shared capitalization gate requires a provider-reported value with its
  own metric date, collection date, exact ticker, currency and source URL.
  Unknown, stale, foreign-currency and non-equity observations cannot become USD
  size classifications. Fresh quote dates cannot refresh old capitalization.
- Historical estimates stay in the raw archive and are retained as unverified
  during normalization. The board, detail, both controller paths, risk labels
  and CSV export all withhold them. Size coverage is explicit, with Unknown and
  specific empty-state recovery. $500M ranges replace misleading large/small
  labels without changing the threshold. Unknown size adds no numeric penalty.
- Added a public-health failure for unsupported capitalization or size tiers,
  and coverage warnings for missing values. A clean health result is not proof
  of complete fundamental-data coverage. Regression fixtures cover legacy
  ADR/class/split-like rows, identity, currency, invalid values/dates/URLs,
  stale observations, aggregate carry-forward, filters, risk labels and exports.
- Remaining requirement: select a permitted, sustainable capitalization source
  with field-specific dates and methodology. Current adapters intentionally
  leave this measure unknown; no active adapter is claimed to fill the new
  evidence contract. Verify licensing, share-class treatment and hosted daily
  availability before enabling it. This gap remains on the release checklist.
- Full collector completed at 23:53:52 UTC: 75/75 recent collected quotes, 74
  price/volume comparisons, 66 equities with unavailable capitalization and 9
  ETFs marked not applicable. No unsupported caps or headline mismatches passed
  the shared health gate. JSON and file-browser fallbacks match. Push alerts
  were disabled. This does not certify hosted scheduled-run performance.
- Desktop (1440px) and phone (375px) checks verified filter recovery, unknown
  metrics, selection feedback, detail navigation, no horizontal overflow and
  no console errors. A missing pressed state on the new Unknown button was
  caught in the browser and fixed with a regression test.
- Verification: all 337 tests pass on Node 24 and Node 20; syntax and diff
  checks pass. Stock links from the board, Research radar and Attention map
  still select the correct detail. No production deployment has been performed.
- Follow-up UI finding: the Attention map groups both `early` and `building`
  stages under "Early ignition", while the detail labels them differently.
  Reconcile the grouping label and per-row stage without retuning score rules.
  Some saved explanation copy still calls weighted social activity "mentions";
  audit that copy alongside prior-period comparability and detector provenance.

Full-refresh validation follow-up (branch implementation, not yet deployed):

- Ran the complete market collector with outbound push notifications disabled.
  The 23:33 UTC run recovered 75/75 newly collected recent quotes and 74 complete
  price/volume comparisons, versus production's 31/75 and 30. One comparison
  remained quarantined; missing candidate symbols and provider refusals stayed
  in the warnings. This does not establish performance from GitHub's network.
- Manual inspection of that first refreshed dataset caught additional false
  matches that the initial lexical health gate did not: Take-Two from the verb
  "take", Johnson & Johnson from a reporting person's surname, and ETF tickers
  mistaken for the underlying business. Added regressions and stricter rules:
  compound company names and SEC filing aliases require the full company name;
  funds require their full fund name, cashtag or exchange-qualified symbol.
- The published health watchdog now independently flags unsupported highlighted
  headlines and market-news identities, even when all quotes are present.
  Quarantined records remain warnings, not promoted evidence. Malformed news
  payloads fail rather than slipping past identity checks.
- Paused Yahoo Public News's broad RSS endpoint after saved 404 failures on
  October 9, 12 and 13. Existing CNBC/MarketWatch/Google and other wires remain;
  Yahoo price quotes are separate and active. A no-network regression verifies
  the paused adapter cannot issue a request. No replacement source is assumed.
- Added stage progress messages to the collector so long profile/enrichment
  stages are distinguishable from a stalled job. The full-history normalization
  check covered 81 snapshots / 6,075 stock rows in about 305 ms on this machine;
  this is not a browser/mobile performance guarantee.
- Re-ran the full collector after those fixes and the Yahoo-news pause. The
  23:40:21 UTC dataset contains 75/75 newly collected recent quotes, 74 complete
  comparisons, 14 news/quote records and no highlighted identity mismatches.
  Manually checked all 14 titles against their named issuers: the Take-Two,
  Johnson reporting-person and SK ETF false positives are absent; SK hynix's
  own company record remains. One extreme-price comparison is still withheld.
  The four paused sources are explicit; StockTwits refusal and candidate quote
  failures remain warnings. No external push alerts were sent.
- Verification: 328 tests pass on Node 24 and Node 20. The stronger live-site
  check correctly fails the older production snapshot; the regenerated local
  snapshot passes. Generated files come from the normal collector, not manual
  replacements. Both JSON and file-browser data copies are verified together.

Historical finding addressed above: the Desk's former `enrichMarketCaps`
multiplies the latest SEC share value by its saved price without establishing
share-class/ADR basis, share period or corporate-action consistency. The
research-company economics path already avoids this assumption, but the Desk
does not. Replace it with attributable provider capitalization or explicit
unknowns, repair cap filters/risk labels/exports, and verify with class/split/
stale fixtures before claiming data readiness. Historical detector outputs also
need identity-version provenance before they can be retrospectively certified.

Company/headline identity follow-up (branch implementation, not yet deployed):

- Reproduced the SXTC false match: a generated `china` alias attached Samsung /
  SK Hynix and Visa news to China SXT Pharmaceuticals. Shared issuer matching now
  rejects generic/geographic aliases, requires exact symbol boundaries and
  stronger evidence for common-word tickers. Aggregator publisher suffixes and
  GDELT domain/country metadata do not establish company identity.
- Collection records the matching symbol/name and method. Per-ticker searches
  are filters, not identity proof; an unrelated result cannot stop the next
  news source from being tried. HN comment matching uses the same identity rules.
- Browser normalization quarantines unsupported saved headlines, preserving
  titles/dates/HTTPS links in Source evidence. Since the top-six archive cannot
  reconstruct all original article weights, the affected source total is excluded
  from scoring and tone/change are unknown. Multi-day views preserve that
  exclusion and audit trail. Raw historical files are not rewritten or "repaired".
- Fixed the global news panel reading a file-only global on HTTP pages, then
  incorrectly falling back to filtered board rows. Both paths now use the loaded
  snapshot independently of search/filter selection. Market measurements can
  no longer become fallback "notable chatter" after a headline is removed.
- Verification: 324 tests pass on Node 24/20, including actual collection,
  browser feed execution, exact symbol classes/prefixes, legitimate Meta/Bank of
  America matches, generic alias rejection, source-total quarantine, multi-day
  preservation and escaped audit links. Desktop/light and 375px/dark QA verified
  SXTC's rejected evidence, independent WDC/STX/LCID news and no horizontal overflow.
- Limits: lexical identity evidence is not full article/entity verification or
  causality. Historical detector outputs outside the normalized Desk remain
  historical, not retroactively certified. Ambiguous legacy brand aliases can
  be withheld pending stronger issuer evidence. Deployment and the first full
  scheduled collection still require release verification.

Market reliability follow-up (branch implementation, not yet deployed):

- Production snapshot at 19:57 UTC contained 75 stocks: 31 newly collected
  recent quotes, 30 complete comparisons, 5 still-recent retained prices,
  1 stale retained price and 38 missing quotes at the audit time. The scheduled
  job was green despite this loss of coverage.
- Reproduced Yahoo's symbol-specific 404 for BBBYQ followed by a successful GME
  quote. Missing symbols had been counted as provider failures, causing the
  shared host circuit breaker to skip valid tickers. Yahoo 404 now leaves the
  provider available; 403/429 still trigger backoff. No access blocks bypassed.
- Added a published market health check after refresh and in the twice-daily
  watchdog, independent of research health. Operational targets are at least
  50 stocks, 75% recent quotes collected in this snapshot, and publication within
  96 hours (warning after 36). Retained prices cannot satisfy collection targets;
  quarantined comparisons stay unknown. Targets are availability requirements,
  not investment-model tuning or a guarantee of complete market coverage.
- Desk summary explicitly separates refreshed quotes, retained prices and
  usable comparisons. The existing compact layout and source disclosures remain.
- Live health correctly fails the published 31/75 snapshot. A bounded real
  adapter probe confirms BBBYQ 404 no longer prevents GME from returning a dated
  quote. Full-universe recovery still needs verification after deployment.
- Verification: all 313 tests pass on Node 24 and Node 20, including missing-symbol
  transport, genuine refusals, partial/retained/stale coverage, malformed data,
  zero comparisons, workflow wiring and Desk counts. Syntax/whitespace checks
  pass. Desktop/light and 375px/dark browser checks show no page overflow or
  console errors.
- Follow-up found during browser QA: a Samsung/SK Hynix headline appears beside
  SXTC in the news panel. Audit ticker/headline identity matching next; do not
  treat retrieval by ticker query as proof that an article concerns that company.

Personal investigations follow-up (branch implementation, not yet deployed):

- Discover → Saved → Investigate turns any retained story/pattern into a personal
  hypothesis, defined metric/unit/scope, next evidence check and dated review
  checkpoint. Separate metric series are supported without rewriting old units.
- Manually entered observations require original source links, reporting owner,
  publication date, period and limitations. Zero is distinct from missing.
  Future reported results, impossible dates, percentage values over 100 and
  unsafe source URLs are rejected. Future targets remain explicitly targets.
- Corrections withdraw/restore old observations without deleting their content.
  No automatic growth or adoption score is calculated from these manual entries.
- Link metadata persists outside the shared discovery archive. Browser-local
  backup export includes a copyable fallback; restore validates all entries and
  rejects conflicting versions without overwriting. Concurrent-tab writes and
  unavailable/corrupt storage preserve existing data and show session-only warnings.
- Limits: 25 investigations / 40 records each. This is a research workspace, not
  cross-device sync, an automated source adapter or published editorial approval.
  Public theme promotion and adoption-series collectors remain separate work.
- A browser trial exposed unscoped Desk column widths squeezing research tables.
  Those rules now apply only to the Desk; notebook source columns retain usable
  width and horizontal scrolling stays inside evidence tables on phones.
- Verification: 15 notebook/layout regressions cover provenance, impossible dates,
  zero/missingness, future targets, fixed metric definitions, immutable record IDs,
  retention bounds, atomic restore conflicts, escaping and due-date semantics.
  Browser QA on isolated local origins covered save/reload, real JSON download,
  restore into a clean notebook, withdrawal/restoration, separate metric series,
  cross-tab conflict preservation, simultaneous form edits and rejected future
  reported results. Test records are explicitly labeled QA and never entered
  repository evidence. Desktop/light and phone/dark checks preserve readable
  tables without page overflow. Full suite: 298 tests.

- Open scan now supports saving individual source records, including stories
  outside the extracted pattern vocabulary. The local shortlist mixes stories
  and patterns, preserves source dates, gives lane-specific validation steps,
  and exposes missing records rather than silently dropping saved IDs.
- Production checked October 13: research snapshot 21:31 UTC, 19/20 active
  sources readable, 8/8 quotes within the health window. QuantumScape newsroom
  still returns 403; two T-Mobile sources remain permission-paused. Research
  refresh, Pages deployment and the public watchdog all succeeded. The new
  five-feed discovery configuration remains branch-only until deployment.
- Promotion into a new curated technology still needs editorial review. A
  saved story is not a verified theme or an automated adoption metric. Additional
  consumer-demand, usage and international sources remain separate gated work.
- Release reconciliation preserved all 948 branch and 800 main document versions
  (972 unique before collection), both identity histories and source events.
  The normal collector then produced 1,030 retained versions; health passed
  with 21/22 active sources, 5/5 discovery feeds and 8/8 quote coverage. Old
  discovery archive gaps still suppress momentum; this merge does not invent
  missing history. Main's newer company quote timestamps are retained.
- Verification: 283 deterministic tests pass on Node 24 and Node 20. Browser
  checks covered story save/reload/remove, empty-state focus return, a 375px dark
  layout and 1440px light layout without horizontal overflow or console errors.


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

Retention: 4,000 document versions / 180 days, 400 source events, 90 discovery
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

### Implementation update — October 9, 2026

Merged latest `main` (`3ea4881edf184a8a553e5b24923822e58ab81427`) before
implementation. The underlying code paths remained present. Historical SCNX and
MNDY/QURE examples, and latent lifecycle cases, were regression fixtures rather
than claims about today's hosted output. Hank's candidate ZIP was not reused.

Implemented locally, with automated regressions:

- **H01/H04/H05/H08:** one shared normalization, source-scope and selection
  contract for both the fallback and actual enhanced controller. Market weights
  no longer inflate attention; return/volume comparisons keep dates and units,
  and uncertain splits/extreme moves are quarantined. Invalid volume is unknown,
  not 1×. Full-history shows the latest selected session, not a blended return.
  Scores are continuous at zero; unknown prior coverage stays unknown. CSV and
  board share capitalization, attention, watchlist, search, source and sort
  selection. Global history/news context is explicitly labeled; incomparable
  rank deltas are hidden. Arbitrary empty-date fallback is also guarded.
- **H02:** no new carried-forward prices or synthetic zero attention in ledger
  gaps/backfill. Coil/breadth calculations require observed data, and benchmark
  comparisons join dates. Legacy coil/theme/diffusion outputs are withheld until
  a new integrity-checked collection. Frozen thresholds were not tuned.
- **H03/H06:** ambiguous issuer descriptions are withheld, including the six
  audited mismatches. SEC facts expose accession, period, taxonomy/context and
  share-class warnings; the exact ASTS and QS audited filing contexts have narrow
  filing-backed adjudications. Conflicting same-period facts remain unknown.
  Legacy revenue/share displays wait for a context-aware refresh. This is not a
  general dimensional-XBRL parser or assurance that every taxonomy is covered.
- **H07/H11/H12/H13/H14:** document-attributed co-mentions are replay-safe;
  original/observed dates stay separate. Compact version identity survives
  800-record/180-day text eviction; published review references are pinned.
  Canonical stories count once across wording revisions, and original story
  dates cannot be renewed by a headline edit. Biological regulation no longer
  implies policy. Bounded Waymo article/paper metadata enrichment and SEC item,
  report/acceptance-date and exhibit-index metadata preserve unknowns explicitly.
- **H09/H10/H15:** Review text search no longer prefilters technologies. New
  reviews require explicit decision, technology, evidence kind and relevance.
  Published drafts reconcile after reload; corrections use new immutable IDs and
  link the latest predecessor. Confidence labels describe activity, not verified
  outcomes; unreproducible historical study percentages are withheld.
- **H16:** T-Mobile's two website collectors are permission-paused even on forced
  runs, with visible health explanations. Existing historical references remain
  labeled with their original dates. Source health excludes paused collectors.
- **Latent calibration:** event-time theme membership is frozen. Missing target
  prices retry later, never become zero returns, and an incomplete frozen basket
  cannot silently shrink to surviving members.

Verification: full 255-test suite on Node 24 and Node 20; fixtures exercise the
actual `enhancements.js` controller, not just helpers. Local browser checks cover
incident/holographic/Nobel search, explicit review defaults, combined small-cap
and high-attention CSV (FLYE/MRNO only), and an isolated save → export → simulated
publication → reload → correction → second-correction cycle. Test reviews stayed
on a separate localhost origin and were never written to repository evidence.
The refreshed brief and review form also passed desktop/mobile checks in light
and dark mode (375px mobile viewport, no horizontal page overflow or console
warnings/errors). Permission-paused sources are explicitly separated in the
freshness watchdog as well as the UI; they are not disguised as outages.

Retention policy (expanded October 10): full document text is bounded to 180 days / 4,000 versions except
published-review references; compact hashed identity/version dates persist without
expiry. Co-mention attribution persists per hashed URL while only the trailing
13 weeks contributes to the live graph. Earlier unattributed graph totals remain
quarantined for inspection, not silently repaired or included in new scores.

**Still open release/research gates:** merge/deployment and hosted verification;
first scheduled collection under the new contracts; any historical repair beyond
quarantine; reproducible investment/model calibration; source rights and parser
validation for new candidates. H16 source expansion is not complete. No licensed
market provider has been selected, and no promise of uninterrupted daily data is
made. Existing scheduled jobs/retries remain best-effort and timestamped. Do not
mark all H01–H16 production-closed from green local tests alone.

The audit details below preserve the original evidence and acceptance criteria.

### October 10 · Open discovery and source-quality pass

The earlier visual/audit PR #5 was merged on October 9. A read-only production
health check on October 10 passed with 19/20 active sources and 8/8 recent quotes:
QuantumScape's newsroom returned 403; two T-Mobile collectors remained
permission-paused. These are distinct from a stale local checkout. This is an
observed snapshot, not a guarantee that future scheduled runs succeed.

Implemented in the next branch:

- Replace the energy-only MIT feed with its broad research feed. Remove the
  keyword-filtered Microsoft company blog from open discovery (retain it for
  the existing AI-work theme). Add NIST's official broad news feed and a bounded
  sample from the official Hacker News API. Total: 24 contracts, 22 active,
  five open-discovery feeds. No accounts or paid subscriptions were added.
- Hacker News: 30 top + 20 new + 10 Show HN IDs, deduplicated; at most three
  concurrent item requests. Never fetch story destinations or user profiles.
  Deleted/dead/non-story records are excluded. A request failure marks the
  sample incomplete, not a readable zero. Preserve submission dates separately
  from article dates and nullable point/comment observations. These counts do
  not create new document versions or prove product use.
- MIT is link/title/date metadata only; no copied story body or imagery.
  New source contracts link to publisher/API documentation and state their
  purpose, bias and content-quiet threshold. Metadata access is not a blanket
  license for commercial republication of full articles or media.
- Open scan exposes dated, unmapped stories without the pattern extractor's
  technical-vocabulary gate. A feed-balanced preview prevents community volume
  from hiding quieter science sources. It is bounded to 120 stories, not a
  census. Pattern grouping remains deliberately heuristic; unfamiliar wording
  can be missed there, and adjacent patterns may overlap.
- Linked primary stories and exact repeated titles are deduplicated. HN is one
  reporting owner, not a new independent owner for every contributor or linked
  domain. Paraphrased syndication and research-institution conflicts still need
  editorial checks.
- Momentum requires each of the preceding 28 UTC collection days, unchanged
  coverage and a nonzero prior-period sample. Config/method changes reset
  comparability. A missing day, quiet/failed feed or clipped 28-day archive
  withholds momentum. Compact identity memory keeps truncation warnings alive
  after full-text eviction. The enlarged archive remains bounded to 4,000
  versions / 180 days, with published reviews pinned.
- Discover now separates Patterns, Open scan and browser-local Saved leads;
  includes a signal-type filter; shows concise evidence counts and a next check;
  and moves methodology/source detail into an accessible disclosure. Unknown
  adoption is never turned into a numeric traction score.
- The existing twice-daily watchdog also checks discovery coverage and loss of
  an entire research/community lane, and warns about readable-but-undated/quiet
  feeds. Six-hour collection opportunities, Toronto calendar-day checks and
  bounded retries remain best-effort. Browser reloads do not initiate collection.
  The brief, source-health labels and watchdog now share a 36-hour check window.

The local collection returned 21/22 active sources, all five discovery feeds,
and 8/8 recent quotes. The compact identity ledger also exposed 20 discovery
records that had already left the previous 800-version text archive. That gap
is now visible: current checks continue to accumulate, but counts are explicitly
limited to retained stories and momentum remains withheld until a complete
28-day comparison window exists. Missing text was not reconstructed or invented.

How to take an unfamiliar lead from attention to traction:

1. Daily automated intake: broad research + developer attention. Inspect both
   patterns and Open scan; save useful patterns. A lead is not an investment call.
2. Editorial corroboration: resolve the original story, separate institutions,
   companies and customers, and require distinct evidence over time. Do not use
   reprints or a funding announcement as a customer-demand count.
3. Define the adoption test before promoting a new theme: paying active users
   and retention for software; qualified customer deliveries, repeat orders,
   yield and cost for hardware; usage, reliability and capacity for infrastructure.
   Keep units, denominators, dates, geography and targets explicit. Add the theme
   and primary/customer/regulator contracts through repository review.
4. Only then map public-company exposure, product-level economics and valuation.
   Technology progress does not establish stock upside.

Remaining H16 work: a theme-proposal workflow for unclassified stories; consented
or licensed consumer-demand/app-usage datasets; repository/release activity using
official APIs; broader international coverage; and product-specific usage/revenue
series. GitHub stars, Google Trends and app usage are **not connected** in this
pass. A future weekly editorial review should investigate the strongest leads and
sample unclassified stories to audit recall; no unattended editorial approval or
new notification subscription was created.

Primary source contracts reviewed: [MIT RSS](https://news.mit.edu/rss),
[MIT reuse policy](https://news.mit.edu/terms-of-use),
[NIST RSS](https://www.nist.gov/coo/nist-rss-feeds),
[official Hacker News API](https://github.com/HackerNews/API).
arXiv expansion is not enabled here; its [API terms](https://info.arxiv.org/help/api/tou.html)
require a single connection and at least three seconds between legacy API requests.

Verification: 280 tests pass on Node 20 and Node 24, including 17 new discovery
regressions. Browser checks at 375, 980 and 1440px cover both palettes, source
disclosures, research/community filtering, search-empty recovery, saved-lead
persistence/removal, pagination focus and no horizontal overflow. The browser
reported no console warnings/errors. Test-only saves were removed afterward.

Release gate: publish through a new PR, then verify hosted data and the first
scheduled run after merge. Do not equate local collection success with deployment.

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
  Evaluate Nasdaq RSS, CPUC Waymo quarterly reports (with some monthly measures)
  and USAspending as candidates,
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

October 9 source disposition:

- [CPUC reporting](https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting):
  reports are quarterly, not monthly publications; preserve California scope,
  revisions/redactions and reporting-definition changes before building a parser.
- [USAspending](https://www.usaspending.gov/federal-spending-guide): obligations
  are commitments, not company revenue. Its
  [source documentation](https://www.usaspending.gov/data/data-sources-download.pdf)
  describes delayed DoD/USACE contract reporting. No integration activated.
- [Nasdaq issuer RSS](https://ir.nasdaq.com/tools/rss-feeds) is Nasdaq Inc. investor
  relations, not a demonstrated broad-market news replacement. Keep the broad
  Nasdaq adapter paused until an appropriate source contract is verified.
- T-Mobile automated collection remains paused pending an access/reuse decision.
  SEC item/exhibit-index enrichment is implemented; exhibits still require review
  and are not automatically treated as adoption events. Other proposed providers
  and Essilor/Federal Register adapters remain separately gated.

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

### October 14 — cluster provenance and next-step UI

- Replaced pair-only graph history with recheckable original headline, source,
  URL and issuer observations. Preserved all 1,443 legacy documents for audit;
  none can contribute graph weight. Same URL/different text cannot fabricate
  a pair, and repeat collection cannot inflate its weight.
- Manual inspection of the fresh collection exposed TV, SNES and forum SMG
  as false ticker matches. Clusters now require distinctive company names,
  cashtags or exchange-qualified symbols; bare abbreviations are insufficient.
  This intentionally reduces recall. Five current documents support ten
  tickers and five edges; no community qualifies. The prior 13 groups are not
  evidence of themes disappearing—they used an incompatible matching method.
- Retained proof-quarter leaders recalculate neighbors from the checked graph;
  hot-monitor version 3 excludes old neighbor lists. Original historical alerts
  are preserved. Model thresholds have not been tuned or validated by this fix.
- Cluster cards show document counts, original headline links, date limitations
  and a concrete business-relationship check. Empty states link directly to
  Discover → Open scan. Removed the unsupported Springs claim that a release
  was a breakout that “historically mattered.”
- Fresh market collection at 2026-10-14 00:23 UTC produced 75/75 collected
  quotes and 74/75 complete comparisons. Capitalization remains unverified;
  attention percentages remain withheld; one ticker's saved news is quarantined.
  StockTwits returned 403 and GDELT failed. All 81 earlier daily snapshots and
  all legacy co-mention documents were preserved; JSON/file-mode bundles match.
- Existing technology intake checks daily, including weekends, with six-hour
  retry opportunities. The latest technology snapshot has all five discovery
  feeds readable, but QS returns 403 and two T-Mobile sources are paused.
  Readability is not accuracy, independence, permission for full-text reuse,
  exhaustive recall or evidence of adoption. Automatic consumer usage, retention,
  deployments, repeat orders and product-level revenue series remain gaps.
- 354 tests pass on Node 20 and Node 24, including replay, legacy quarantine,
  cross-headline contamination, bare-acronym false positives, inherited neighbor
  removal, original-link safety and UI guidance. Browser checks cover stock
  selection from board/radar/map at 1440px and 375px. Not merged or deployed;
  hosted collection still needs verification after separately approved release.

#### Broader discovery intake — next source pilot, not enabled

Keep three independent evidence lanes: research novelty, developer/community
interest, and demonstrated use. Sample unclassified stories as well as popular
patterns, deduplicate reporting owners, and only compare time windows with
unchanged source coverage. Promotion to a tracked theme needs an explicit
adoption metric, dated primary/customer evidence, and a review checkpoint.

- OpenAlex is a candidate for broader research metadata beyond the current
  institutional feeds. Its [API reference](https://help.openalex.org/api/)
  supports works/topics and basic keyless access; its
  [filter documentation](https://help.openalex.org/api/filtering/) supports
  publication-date windows but reserves updated/created-date synchronization
  filters for paid plans. No paid access or account was activated.
- A bounded, three-record keyless probe returned HTTP 200, but its date-sorted
  sample included journal-title records rather than three unambiguous new
  papers. A working endpoint is not a validated discovery feed. A pilot must
  verify record type, original publication dates, DOI/source identity, duplicate
  editions, language/geography coverage and sampling bias before enabling it.
  Do not label those returned dates as new breakthroughs or use raw counts as
  acceleration. Retain metadata only; full-text rights are separate.
- GitHub's [starring documentation](https://docs.github.com/en/rest/activity/starring)
  distinguishes stargazers from subscribers; even its `watchers_count` field
  represents stars. A future developer lane must keep repository attention,
  release/maintenance activity and actual product usage separate. No GitHub
  popularity collector or automatic adoption series was added in this pass.

#### Scheduled-data reconciliation before release

The production data commit `2b317766ddfbce499363954f764572a8e0e60cb5`
arrived during verification and conflicted with the review branch. Reconciled
the JSON histories by identity/date rather than selecting one whole file:
82 daily dates, 401 incoming-only ledger rows, 2,301 tracked ledger tickers,
and 1,651 preserved legacy graph records including conflicting revisions.
Unchanged-base values accept the other branch's change; competing ledger rows
retain the repaired branch's version, with both originals recoverable from the
merge parents. The next real collection rewrote today's ledger rows normally.

Post-reconciliation full collection at 2026-10-14 00:36:42 UTC again passed
market health: 75 collected quotes, 74 complete comparisons, no unsupported
highlighted headline matches. The same 81 earlier daily snapshots remain
unchanged, and all generated JSON/browser bundles match. GDELT now returned
without an error but had no matched tickers; StockTwits remained forbidden.
No external push notifications were sent. The graph remains five supporting
documents / ten tickers / five edges / no qualifying communities. These results
are branch verification, not a production deployment.
