# Technology discovery workspace

Implemented October 2, 2026. Deployment follows merge into `main`; a feature
branch is not production. This is a curated research system, not a prediction
that a technology or its associated stocks must succeed.

## The five upgrades

1. **Technology radar:** searchable by category, company, ticker and aliases;
   sector/stage filters; browser-local follows. Solid-state batteries and
   satellite-to-phone connectivity lead the initial five-category registry.
2. **Research profiles:** observations, original dates, definitions, uncertainty,
   thesis-breaking risks and JSON export. Targets are visibly separate from
   delivered capability. `?tech=solid-state-batteries#research` is shareable.
3. **Milestones:** editorial review dates, sourced company targets and undated
   evidence checks. Passing a target window means “outcome unverified,” not an
   automatically failed forecast. No invented company event dates.
4. **Source-change inbox:** a bounded public-page monitor queues unverified
   changes and exposes source health. Local dismiss/restore never verifies a
   claim. The first fetch is a baseline, not fresh news.
5. **Company exposure map:** dated relationship sources and explicit unknown
   revenue materiality, with exact-ticker navigation into the stock Desk. A
   missing ticker shows a coverage gap; `QS` must never substitute `QSI`.

The Technology tab keeps the historical `research` ID and hash. It is the
default for a new visitor; existing tab preferences and stock deep links still
work. Older stock-research panels remain under **Market research tools**.
The graphite/green brand and original SVG favicon are retained. Mobile filters
use a native disclosure; search and evidence remain prominent.

## Evidence rules

- Solid-state batteries: separate lab cells, pilot lines, vehicle validation,
  production yield, unit cost and customer deliveries. Toyota's cited 2027–2028
  target is explicitly its **2023** disclosure, not a renewed promise.
- Satellite-to-phone: separate SOS/text, optimized app data, voice and general
  internet. Record carrier, handset, country, capacity and visibility limits.
  A satellite launch is not a subscriber count.
- Existing AI-glasses, workplace-AI and robotaxi observations retain their
  original September review dates. Fetching a page does not re-review its facts.
- Count reporting owners, not URLs, for source breadth. Two T-Mobile pages are
  one reporting owner. Company reports are not independent verification.
- Preserve qualifiers: “over 20M” and “over 30M” do not establish exact 50%
  growth. `comparableChange` rejects mismatched metrics, definitions, units,
  geographies, owners, dates and non-exact quantities.
- Category adoption, business materiality, valuation and stock returns are
  different questions. None is inferred from the others.

## Files and collection

| File | Responsibility |
| --- | --- |
| `technology-registry.js` | Human-reviewed evidence, checkpoints, company links and source configuration |
| `adoption-watchlist.js` | Original three-category observations, imported without rewriting history |
| `technology-model.js` | Tested filtering, dates, comparability, provenance validation and source health |
| `adoption.js` / `technology.css` | Workspace rendering, local follows/dismissals, profile export and responsive UI |
| `scripts/lib/technology-monitor.mjs` | Allowlisted fetching, bounded extraction, fingerprints and change deduplication |
| `scripts/update-technology.mjs` | Collector entry point and atomic per-file output |
| `data/technology-monitor-state.json` | Generated internal baselines, validators and previously seen links |
| `data/technology-monitor.json` / `.js` | Generated public status/inbox; `.js` is loaded only for `file://` |

Run a collection with Node 20+:

```bash
node scripts/update-technology.mjs
node scripts/update-technology.mjs --output /tmp/signaldesk-tech-check
node --test scripts/test/*.test.mjs
```

`--force` bypasses the per-source 24-hour cadence for a deliberate diagnostic.
Normal weekday refreshes call the collector before stock collection. Each
source is fetched once per cadence, not per ticker. Sources have 15-second
timeouts, a 1.5 MB body cap, HTTPS/host-restricted redirects and conditional
requests. Partial source failure preserves the last successful baseline. The
workflow publishes only outputs from successful collector steps; a stock-step
failure cannot publish partially written stock artifacts.

Never hand-edit generated monitor files. Changing a source URL or extractor
version establishes a new baseline rather than creating false news. Link
sources track previously seen canonical URLs; publication dates remain unknown
until reviewed. Page fingerprints can reflect boilerplate changes, so they are
always unverified candidates.

Eight pages are configured initially: QuantumScape resources, Toyota's historical
target, T-Mobile's network newsroom and product page, AST investor updates, and
the saved Meta, Microsoft and Waymo disclosures. The latter three check saved
pages for corrections; they do **not** discover every new reporting period.
This is intentionally limited coverage, not a whole-web trend engine. The first
live baseline reached all eight pages and produced zero change candidates.

Health states distinguish not checked, unavailable, overdue, no matching links,
and readable. “Readable” says nothing about whether a business claim is true.
Saved checks older than twice their cadence become overdue; weekend gaps may
therefore show that warning. “Reload saved checks” does not run a live scrape.

## Editorial upkeep

Review newly detected links against the primary source. Append observations
with stable IDs, metric definitions, period, qualifier, publisher/owner,
publication date (or null), checked date, source and caveat. Preserve originals
when recording a correction. Update stage, next checkpoint and review date
only after evaluating the evidence—not just because the monitor ran.

New categories require a falsifiable next checkpoint, stated unknowns and a
source-backed company role. Add rolling newsroom or investor-result indexes
where available; do not treat an old single-disclosure page as ongoing news
coverage. No automatic verification, numeric-claim extraction, notifications,
cross-device account or backtested mainstream-probability score is included.

## Verification

The deterministic suite covers registry integrity, lower-bound comparability,
source-owner counts, review/target dates, failed-source recovery, canonical URLs,
HTML challenge/empty pages, conditional requests, extraction-version baselines,
deduplicated changes and exact stock links. PR checks run syntax validation and
the full suite without external requests.

Browser QA should include 375px and at least 1400px: search/filter recovery,
follow persistence, profile deep-link/reload, export, inbox status and dismiss/
restore, company-to-Desk links, and all three existing stock-selection paths
(table, research radar, attention map). Never use synthetic monitor events as
the shipped baseline.
