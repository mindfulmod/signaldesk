# SignalDesk Stock Mentions

SignalDesk is a static stock-attention dashboard that can be hosted for free on GitHub Pages and refreshed daily with GitHub Actions.

## Free Mobile Access With GitHub Pages

1. Create a new public GitHub repository, for example `signaldesk`.
2. Upload all files from this folder into the repository.
3. In GitHub, open **Settings** > **Pages**.
4. Under **Build and deployment**, choose:
   - **Source:** Deploy from a branch
   - **Branch:** `main`
   - **Folder:** `/root`
5. Save.

Your website will be available at:

```text
https://YOUR-GITHUB-USERNAME.github.io/signaldesk/
```

Open that link from your phone to view the dashboard.

## Daily Data Refresh

The workflow at `.github/workflows/refresh-data.yml` runs every day at 16:00 UTC, which is 12:00 PM in America/Toronto during daylight saving time.

It:

- validates the JavaScript files,
- runs `scripts/update-data.mjs`,
- refreshes `data/signals.json` and `data/signals.js`,
- commits those updated data files back to the repository.

You can also refresh manually in GitHub:

1. Open the repository.
2. Go to **Actions**.
3. Select **Refresh SignalDesk Data**.
4. Click **Run workflow**.

## Data Sources

The updater uses public no-key sources only:

- Wallstreetbets public Reddit JSON
- Reddit finance subreddit public JSON
- SEC EDGAR current filings feed
- Yahoo public ticker news RSS
- CNBC RSS
- MarketWatch RSS
- public price/volume chart data

No API keys are required. If public sources are temporarily unreachable, the updater keeps the last working snapshot instead of replacing the dashboard with empty data.

## Local Use

Open `index.html` directly in a browser, or run any local static server from this folder.

