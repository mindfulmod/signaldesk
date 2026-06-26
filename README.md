# SignalDesk Stock Mentions

SignalDesk is a static stock-attention dashboard that can be hosted for free on GitHub Pages and refreshed during market sessions with GitHub Actions.

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

## Weekday Data Refresh

The workflow at `.github/workflows/refresh-data.yml` runs on weekdays at 9:17 AM, 12:17 PM, 3:17 PM, and 5:17 PM in America/Toronto.

It:

- validates the JavaScript files,
- runs `scripts/update-data.mjs`,
- refreshes `data/signals.json` and `data/signals.js`,
- updates `data/history.json` and `data/history.js` so longer-range views improve over time,
- commits those updated data files back to the repository.

The latest refresh appears on the public GitHub Pages site after GitHub Pages finishes publishing the commit.

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
