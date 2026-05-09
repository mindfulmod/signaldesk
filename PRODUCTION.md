# SignalDesk Production Path

This prototype runs as a static browser app with a generated **real public no-key** snapshot (see `data/signals.json` and `data/signals.js`). To make it production-grade with near-real-time coverage and durability, use a backend that collects data on a schedule, stores normalized ticker signals, and serves the dashboard through a private API.

## Access Now

Open the local site directly:

```text
file:///Users/main/Documents/Codex/2026-05-02/design-and-create-a-functioning-website/index.html
```

Or serve it from the project folder with any static web server and open:

```text
http://localhost:8000
```

## Recommended Production Stack

- Frontend: Next.js or Vite/React
- Backend API: Node.js/Express, FastAPI, or Next.js API routes
- Database: Postgres with TimescaleDB extension for time-series mention data
- Jobs: scheduled workers every 1-5 minutes during market hours, hourly outside market hours
- Cache: Redis for latest top-30 rankings and chart series
- Hosting: Vercel for frontend, Render/Fly.io/Railway for backend workers, Supabase/Neon for Postgres

## Live Data Sources

Recommended first production feeds:

- Reddit: Reddit API for Wallstreetbets and broader finance subreddits.
- X: X API for public posts/search/trends. Budget is required because access is pay-per-use.
- Google Trends: official Google Trends API alpha if accepted; otherwise use a third-party provider until access opens more broadly.
- SEC: SEC EDGAR APIs for filings. No API key required, but requests must follow SEC access rules.
- Market data: Polygon, Finnhub, Alpha Vantage, or Tradier for price, volume, news, and options.
- StockTwits: official new developer registrations are currently paused; use a licensed third-party StockTwits data provider or wait for registrations to reopen.

## Environment Variables

Keep keys on the backend only. Never put these in client-side JavaScript.

```text
DATABASE_URL=
REDIS_URL=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=
X_BEARER_TOKEN=
GOOGLE_TRENDS_API_KEY=
POLYGON_API_KEY=
FINNHUB_API_KEY=
ALPHA_VANTAGE_API_KEY=
TRADIER_ACCESS_TOKEN=
STOCKTWITS_PROVIDER_API_KEY=
SEC_USER_AGENT=YourAppName contact@example.com
```

## Data Model

Store normalized source events:

```text
source_events
- id
- source
- ticker
- company_name
- captured_at
- raw_text
- url
- mentions
- sentiment_score
- engagement_score
- author_score
```

Store aggregated signals:

```text
ticker_signals
- ticker
- bucket_start
- bucket_size
- mention_count
- mention_momentum
- source_breadth
- sentiment_score
- price_change_pct
- relative_volume
- options_activity
- early_signal_score
```

## Backend Endpoints

```text
GET /api/signals?start=2026-05-01&end=2026-05-02&sources=reddit,x,google_trends
GET /api/signals/top?limit=30&metric=early_signal
GET /api/tickers/:ticker/timeseries?metric=early_signal
GET /api/sources/status
```

## Early Signal Formula

The current prototype formula should become a configurable backend score:

```text
early_signal =
  mention_volume_weight +
  mention_acceleration_weight +
  source_breadth_weight +
  sentiment_weight +
  price_confirmation_weight +
  relative_volume_weight +
  options_activity_weight
```

For live trading usefulness, rank by acceleration and source breadth first, not only raw mention count. That helps catch names that are newly heating up.

## Production Build Order

1. Move the current sample data generator behind `/api/signals` so the frontend stops caring whether data is mock or live.
2. Add Postgres tables and scheduled ingestion jobs.
3. Connect one low-friction live source first: SEC plus one market data provider.
4. Add Reddit and X next, with rate-limit handling and de-duplication.
5. Add alerting for early-signal spikes by ticker/watchlist.
6. Deploy frontend and backend.
7. Add auth so the site is private while it uses paid API keys.
