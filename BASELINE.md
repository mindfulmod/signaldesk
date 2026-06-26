# SignalDesk Live Baseline

As of June 26, 2026, the `mindfulmod/signaldesk` GitHub repository is the canonical baseline for SignalDesk.

## Source Of Truth

- Build new features on top of the files in `main`.
- Treat local files from earlier Codex sessions as draft material only.
- Do not overwrite the live dark/mobile UI with older local drafts.
- Prefer small additive changes unless a full refactor is explicitly planned.

## Current Product Shape

SignalDesk is a GitHub Pages stock scanner for US stocks and ETFs. It is built for mobile review and long-term watchlist discovery, not direct trade execution.

The live app currently includes:

- dark, mobile-first app shell,
- dynamic ticker discovery,
- FINRA short-volume universe seeding,
- public no-key social/news/filing/price sources,
- ranking table with quote, momentum, price/volume, and source mix,
- research candidate cards,
- market movers board,
- ticker detail panel with source breakdown, recent chatter, and research links,
- market-cap and attention filters,
- CSV export,
- weekday GitHub Actions refreshes.

## Enhancement Rules

When adding features:

1. Preserve the existing dark/mobile layout and app shell.
2. Keep new UI dense, scan-friendly, and useful on phone browsers.
3. Avoid direct buy/sell claims; use research/watchlist language.
4. Prefer fewer, higher-confidence signals over noisy alerts.
5. Keep public no-key sources working without exposing API keys in the browser.
6. If free API keys are added later, use GitHub Actions secrets and server-side refresh scripts only.
7. Keep source lists synchronized across `scripts/update-data.mjs`, `script.js`, `enhancements.js`, UI controls, and data files.
8. Validate JavaScript and data shape before pushing changes.

## Current Additive Layer

`enhancements.js` is intentionally loaded after `script.js`. It adapts local draft ideas to the live baseline by adding:

- latest refresh window vs full saved history mode,
- Market Pulse cards,
- all-source normalization for StockTwits, ApeWisdom, Hacker News, and 4chan,
- relative-volume sanity capping for display calculations,
- updated CSV source export.

This keeps the recent live UI intact while bringing forward useful local enhancements.
