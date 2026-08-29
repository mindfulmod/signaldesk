# SignalDesk Stock Mentions

SignalDesk is a static, evidence-weighted stock-attention dashboard hosted on GitHub Pages and refreshed during market sessions with GitHub Actions.

The GitHub repository is the baseline going forward. Local drafts should be treated as prototypes unless they have been merged into `main`.

## Free Mobile Access With GitHub Pages

The public site is available at:

```text
https://mindfulmod.github.io/signaldesk/
```

Open that link from your phone to view the dashboard.

## What's on the site

Two surfaces. The **Desk** is everything that works today; **Research** is the
slower theme machinery, which is still accumulating the data it needs to say
anything. The split is deliberate — these panels were previously spread across
four tabs, which hid how few of them had content.

Panel status below is as of **2026-08-29** and is meant to be kept honest. A
panel with nothing in it says what it is waiting for rather than rendering a
blank; the Research tab badge counts only the panels that actually have content.

### The Desk

| Panel | What it answers | State |
|---|---|---|
| Driving the tape | Which headlines actually moved a stock today | Live |
| Research radar | The best-evidence setups right now | Live |
| Discovery board | The full ranked universe, with price, volume, source mix and a top headline per name | Live — 75 names |
| Attention map | Early ignition vs confirmed participation vs crowded | Live |
| What changed | Coil releases, theme stage changes, proof quarters, weekly digest | Live, but see the caveat below |

The board is the product: dynamic ticker discovery rather than a fixed
watchlist, a FINRA short-volume seeded universe, market-cap and attention
filters, ticker detail panels, sparklines, watchlists, and CSV export. Its
discovery score separates attention, confirmation, catalyst evidence, and
crowding risk, and is explained in [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md).

Every headline is honestly labelled: a genuine published article or filing is a
"Top headline", while social commentary that merely mentions a catalyst is
"Notable chatter (not a news article)" — never presented as reporting it isn't.
A "News"/"Buzz" badge on the row makes this visible without opening the ticker.

### Research

| Panel | What it answers | State |
|---|---|---|
| Themes rail | Which themes have breadth *in excess of the market* | Live, but all themes currently read Quiet |
| Springs board | Sustained attention with compressed price (Coiled / Released / Dead coil) | Live, typically 1–2 rows |
| Phrase radar | Novel, accelerating language in the headline stream | Candidates only — **0 confirmed**, and confirmation needs GDELT, which rate-limits this pipeline hard |
| Emerging clusters | Ticker groups that keep co-occurring in the same headline or post | Live |
| Calibration | Forward-graded outcomes for signals the site has already fired | **Empty — 0 events.** See below |

Clicking a theme card opens its **diffusion map**: a supply-chain table ordering
that theme's members ran → running → coiled → lagging, so you can see who is
next. It only opens for hot themes, so it is currently unreachable in practice.

**Calibration is empty for a structural reason, not a temporal one.** It grades
coil releases, dead-coil demotions, and theme stage transitions forward at
30/90/180/365 days — but zero of those events have ever fired. It is not waiting
for time to pass; it is waiting for its upstream detectors to trigger even once.
Treat that as an open question about the detectors, not a panel that just needs
patience.

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

The updater uses public no-key sources only. **No API keys are required.** If
public sources are temporarily unreachable, the updater keeps the last working
snapshot instead of replacing the dashboard with empty data.

Not every source is healthy at any given time, and the list has historically
read as though they all were. Status below was measured on **2026-08-29** — the
failure lines in `data/signals.json` are the live version of this table.

| Source | Role | Status |
|---|---|---|
| FINRA short-volume files | Seeds the market universe | Working |
| Google / Bing news RSS, Yahoo `rssindex`, CNBC, MarketWatch, PR Newswire, GlobeNewswire, Seeking Alpha, Investing.com desks | The primary news path | Working |
| Yahoo / Stooq price and volume | Quotes, relative volume | Working |
| SEC EDGAR feeds + company data | Filings, ticker→CIK map | Working |
| ApeWisdom, Hacker News Algolia, 4chan `/biz/` | Social attention | Working |
| Wikipedia summaries, pageviews, S&P constituents | Company context, Theme Engine | Working |
| GDELT news search | Phrase confirmation | **Degraded** — rate-limits this pipeline aggressively; needs ~8s spacing and still often refuses |
| Nasdaq (`api.nasdaq.com`, markets RSS) | Per-ticker news top-up | **Failing** — connection timeouts |
| StockTwits public endpoints | Social attention | **Failing** — Cloudflare 403 |
| Reddit (Wallstreetbets, finance subs) | Social attention | **Failing from CI** — 403; always documented as best-effort |
| [ntfy.sh](https://ntfy.sh) | Optional push alerts | Off by default |

Degraded sources fail soft: a per-host circuit breaker takes them out of the run
with an escalating cooldown, and every skip is recorded in the snapshot's
`failures` list rather than disappearing. That list is the first place to look
when a panel goes quiet.

## Discovery model

SignalDesk does not claim that any stock is bound to rise. Attention can create buying pressure, but it can also identify an already crowded or manipulated move. The dashboard therefore shows raw attention separately from setup quality and surfaces risk flags beside confirming evidence.

See [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md) for the scoring logic, market-psychology rationale, data caveats, and validation roadmap.

## Local Use

Run a static server from this folder — the preview config `signaldesk` in
`.claude/launch.json` serves it on port 8793:

```bash
node .claude/static-server.mjs 8793
```

Opening `index.html` straight off disk with `file://` also works: the page
detects the protocol and injects the `data/*.js` bundles, which carry the same
payload as the JSON for exactly this case. Over http(s) those bundles are not
requested at all — they used to load on every visit and be discarded, which was
half the weight of the site.

URL state (deep links, the ticker query param) only works over http(s).

## Documentation

Nine docs had accumulated with no way to tell which described the live site,
which were unbuilt plans, and which described a direction that had been
abandoned. Status is now stated on each one.

| Doc | Covers | Status |
|---|---|---|
| [UI_PLAYBOOK.md](UI_PLAYBOOK.md) | Frontend architecture, the traps, verification checklist, copy rules | **Live** — read before touching frontend code |
| [DISCOVERY_MODEL.md](DISCOVERY_MODEL.md) | The discovery score, its rationale and caveats | **Live** |
| [THEME_ENGINE.md](THEME_ENGINE.md) | Theme lifecycle spec: ledger, registry, coils, heat, diffusion, phrases, alerts | **Mostly shipped** — Layers 0–4 built; see its status header |
| [INSIDER_EVIDENCE.md](INSIDER_EVIDENCE.md) | Form 4 cluster-buy evidence layer | **Specced, not built** — gated on a backtest |
| [CONTRACT_FLOW.md](CONTRACT_FLOW.md) | Federal award flow as theme evidence | **Specced, not built** |
| [TRAFFIC_LAYER.md](TRAFFIC_LAYER.md) | Web-traffic demand proxy (Cloudflare Radar) | **Specced, deferred** — would break the no-keys promise |

Removed 2026-08-29: `PRODUCTION.md` (specified a Next.js/Postgres/paid-API
backend — a direction that was abandoned, and it contradicted the static keyless
design the rest of the project is built around) and `BASELINE.md` (a June-2026
note establishing the repo as canonical, which it now plainly is). Both are in
git history if they are ever wanted back.
