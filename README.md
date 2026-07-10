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
- a **Springs board** (`springs.js`) — sustained-attention/price-compression setups from the [Theme Engine](THEME_ENGINE.md)'s coil detector, shown as three honest states (Coiled, Released, Dead coil) with their backtested base rates, never as a buy signal.

## Weekday Data Refresh

The workflow at `.github/workflows/refresh-data.yml` runs on weekdays at 9:17 AM, 12:17 PM, 3:17 PM, and 5:17 PM in America/Toronto.

It:

- validates the JavaScript files,
- runs `scripts/update-data.mjs`,
- refreshes `data/signals.json` and `data/signals.js`,
- updates `data/history.json` and `data/history.js` so longer-range views improve over time,
- upserts today's row into `data/ledger.json`/`data/ledger.js`, a per-ticker daily ledger (mentions, share-of-voice, close, volume, Wikipedia pageviews) that keeps a persistence trail even for tickers that fall out of the daily top-75,
- refreshes `data/theme-registry.json`/`data/theme-registry.js` (GICS sub-industry baseline + `data/theme-overrides.json` manual theme curation),
- runs the frozen coil detector over the ledger and writes `data/springs.json`/`data/springs.js` for the Springs board,
- commits those updated data files back to the repository.

The latest refresh appears on the public GitHub Pages site after GitHub Pages finishes publishing the commit.

You can also refresh manually in GitHub:

1. Open the repository.
2. Go to **Actions**.
3. Select **Refresh SignalDesk Data**.
4. Click **Run workflow**.

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
- Wikipedia public summaries for company context

No API keys are required. If public sources are temporarily unreachable, the updater keeps the last working snapshot instead of replacing the dashboard with empty data.

## Discovery model

SignalDesk does not claim that any stock is bound to rise. Attention can create buying pressure, but it can also identify an already crowded or manipulated move. The dashboard therefore shows raw attention separately from setup quality and surfaces risk flags beside confirming evidence.

See [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md) for the scoring logic, market-psychology rationale, data caveats, and validation roadmap.

## Local Use

Open `index.html` directly in a browser, or run any local static server from this folder.
