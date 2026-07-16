# SignalDesk Stock Mentions

SignalDesk is a static, evidence-weighted stock-attention dashboard hosted on GitHub Pages and refreshed during market sessions with GitHub Actions.

The GitHub repository is the baseline going forward. Local drafts should be treated as prototypes unless they have been merged into `main`.

## Free Mobile Access With GitHub Pages

The public site is available at:

```text
https://mindfulmod.github.io/signaldesk/
```

Open that link from your phone to view the dashboard.

## Live Baseline

The current live app is a dark, mobile-first market scanner with:

- dynamic ticker discovery instead of a fixed watchlist,
- FINRA short-volume seeded market universe,
- StockTwits, ApeWisdom, Hacker News, 4chan, Reddit, news, SEC, FINRA, and public price/volume sources,
- market-cap filters,
- big-attention and quiet-mover filters,
- an explainable discovery score that separates attention, confirmation, catalyst evidence, and crowding risk,
- research radar, market-psychology stages, ticker detail panels, sparklines, watchlists, and CSV export,
- an additive enhancement layer in `enhancements.js` for source-list normalization, latest-vs-history window mode, and Market Pulse,
- a **Springs board** (`springs.js`) — sustained-attention/price-compression setups from the [Theme Engine](THEME_ENGINE.md)'s coil detector, shown as three honest states (Coiled, Released, Dead coil) with their backtested base rates, never as a buy signal,
- a **Themes rail** (`themes.js`) — theme heat scored on breadth *in excess of the whole market* (so a market-wide rebound doesn't fake a hot theme), staged Quiet/Naming/Diffusion/Wave/Decay; hot themes (Diffusion/Wave) also waive the Springs board's defensive-sector discount for their members. Click a theme card to open its **diffusion map** (Layer 2) — a supply-chain table of that theme's members ordered ran → running → coiled → lagging, so you can see who's next,
- a **Phrase radar** (`phrase-radar.js`) — novel, week-over-week-accelerating bigrams/trigrams from the news headline stream, confirmed only when *both* GDELT news-volume and SEC EDGAR filing-acceleration corroborate the same phrase; confirmed phrases feed the Themes rail's language score directly,
- an **Emerging clusters** feed (`clusters.js`) — ticker groups the co-mention graph (who keeps appearing together in the same headline or post, trailing ~90 days) finds via greedy-modularity community detection, surfaced for human review rather than auto-promoted into the theme registry,
- a **What changed** feed (`alerts.js`) — every coil release, new coil inside a hot theme, theme stage transition, dead-coil demotion, and proof-quarter detection, logged on-site the moment it happens (each fires at most once per ticker/theme per state change), plus a weekly theme/springs digest; optional push notifications via [ntfy.sh](https://ntfy.sh) are off by default (see below),
- a **Calibration** panel (`calibration.js`) — every coil release, dead-coil demotion, and theme stage transition gets logged with its date and graded forward at 30/90/180/365 days using real price history, reporting win rate and median return per state/stage; the engine grading itself the way [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md) promises for ticker scores. This is forward-graded, not backtested — it only fills in as real time actually passes.

## Weekday Data Refresh

The workflow at `.github/workflows/refresh-data.yml` runs on weekdays at 9:17 AM, 12:17 PM, 3:17 PM, and 5:17 PM in America/Toronto.

It:

- validates the JavaScript files,
- runs `scripts/update-data.mjs`,
- refreshes `data/signals.json` and `data/signals.js`,
- updates `data/history.json` and `data/history.js` so longer-range views improve over time,
- upserts today's row into `data/ledger.json`/`data/ledger.js`, a per-ticker daily ledger (mentions, share-of-voice, close, volume, Wikipedia pageviews) that keeps a persistence trail even for tickers that fall out of the daily top-75,
- refreshes `data/theme-registry.json`/`data/theme-registry.js` (GICS sub-industry baseline + `data/theme-overrides.json` manual theme curation),
- scores theme heat and writes `data/themes.json`/`data/themes.js` for the Themes rail,
- runs the frozen coil detector over the ledger and writes `data/springs.json`/`data/springs.js` for the Springs board,
- classifies each hot theme's members (ran/running/coiled/lagging/dead) and writes `data/diffusion-map.json`/`data/diffusion-map.js` (plus `data/diffusion-state.json`, internal — tracks how long each member has held its current state),
- extracts novel/accelerating phrases from the news stream, confirms them against GDELT (daily) and EDGAR filing acceleration (weekly), and writes `data/phrase-radar.json`/`data/phrase-radar.js` (plus `data/phrase-history.json`, internal — the weekly phrase-mention accumulator and GDELT confirmation cache),
- folds today's headline/post co-mentions into a trailing-~90-day graph and writes `data/clusters.json`/`data/clusters.js` (plus `data/co-mention-history.json`, internal — the weekly edge-weight accumulator),
- checks every ticker for a proof-quarter trigger (>=8% gap on >=3x 60d avg volume + earnings/guidance headline vocabulary) and writes `data/leaders.json`/`data/leaders.js` (candidate theme leaders) and `data/hot-monitor.json`/`data/hot-monitor.js` (their GICS siblings + co-mention neighbors, force-covered for 2 quarters even with zero social chatter),
- diffs this run's springs/themes/leaders against the last recorded state, appends any lifecycle changes to `data/alerts-log.json`/`data/alerts-log.js` (the What changed feed) and `data/alerts-state.json` (internal dedup bookkeeping — do not hand-edit),
- logs every release/dead-coil/theme-stage-transition event with a price snapshot, grades any log entry whose forward horizon has now been reached, and writes `data/calibration.json`/`data/calibration.js` for the Calibration panel (plus `data/calibration-log.json`, internal — the append-only, forward-graded event log; do not hand-edit),
- commits those updated data files back to the repository.

The latest refresh appears on the public GitHub Pages site after GitHub Pages finishes publishing the commit.

You can also refresh manually in GitHub:

1. Open the repository.
2. Go to **Actions**.
3. Select **Refresh SignalDesk Data**.
4. Click **Run workflow**.

### Optional push alerts (ntfy.sh)

Set a repository (or environment) variable named `SIGNALDESK_NTFY_TOPIC` to a
private [ntfy.sh](https://ntfy.sh) topic name to also push each lifecycle
event as a phone notification (subscribe to the same topic in the ntfy app).
Leave it unset and nothing is pushed — the on-site What changed feed still
populates either way, since it doesn't depend on ntfy at all. Pick a random,
hard-to-guess topic name; ntfy topics are public by name.

## Data Sources

The updater uses public no-key sources only:

- FINRA short-volume files
- StockTwits public endpoints
- ApeWisdom public stock-ranking API
- Hacker News Algolia public search
- 4chan `/biz/` public catalog
- Wallstreetbets and finance Reddit public JSON/RSS, best effort
- SEC EDGAR public feeds and company data
- GDELT public news search
- Google and Bing public news RSS
- Yahoo ticker news RSS
- CNBC RSS
- MarketWatch RSS
- public Yahoo/Stooq price and volume data
- Wikipedia public summaries, pageviews, and S&P 500 constituent data for company context and the Theme Engine
- [ntfy.sh](https://ntfy.sh) for optional push alerts

No API keys are required. If public sources are temporarily unreachable, the updater keeps the last working snapshot instead of replacing the dashboard with empty data.

## Discovery model

SignalDesk does not claim that any stock is bound to rise. Attention can create buying pressure, but it can also identify an already crowded or manipulated move. The dashboard therefore shows raw attention separately from setup quality and surfaces risk flags beside confirming evidence.

See [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md) for the scoring logic, market-psychology rationale, data caveats, and validation roadmap.

## Local Use

Open `index.html` directly in a browser, or run any local static server from this folder.
