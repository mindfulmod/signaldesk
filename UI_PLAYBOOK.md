# SignalDesk — UI/UX Maintenance Playbook

Written 2026-07-19 so that UI fixes, enhancements, and new panels can be done
safely by any model or session (Sonnet is the default executor). This encodes
the conventions and the traps discovered while building the site. Read this
before touching frontend code.

## Architecture map (who owns what)

Static GitHub Pages site. **No build step, no framework, no dependencies.**
Script load order in `index.html` matters:

| File | Role |
|---|---|
| `data/*.js` | Generated data (`window.SIGNALDESK_*` globals). **Never hand-edit** — the pipeline (`scripts/update-data.mjs`, 4x/day weekdays) regenerates them. |
| `script.js` | Core render: ranking table, research radar, attention map, detail panel/sheet, filters, URL state. Also holds *fallback* copies of headline-ranking helpers. |
| `enhancements.js` | **Monkey-patches `render`, `realSignals`, `filteredSignals` and is the LIVE code path** for signal aggregation, multi-day windows, and the "Driving the tape" panel (which it injects — it is not in index.html). |
| `springs.js`, `themes.js`, `phrase-radar.js`, `clusters.js`, `calibration.js`, `alerts.js` | One file per Theme Engine panel; each reads its own `window.SIGNALDESK_*` global and renders into its container. Independent — safe to edit in isolation. |
| `layout-fix.js` | Injected `<style>` overrides (lots of `!important`). If a CSS change in styles.css mysteriously doesn't apply, look here. |
| `declutter.js` | Collapsible-panel mechanism + mobile bottom-sheet support file. |
| `tabs.js` / `tabs.css` | **The tabbed shell.** Moves each panel section into one of four tab panels (Today / Themes / Deep dive / Track record) at runtime. Owns tab state, the URL hash, the tab count badges, and hiding the Filters control off the Deep dive tab. |
| `styles.css` | Single stylesheet. New feature styles get appended as commented blocks at the end. |

## The traps (each one cost real debugging time)

1. **enhancements.js is the executed path.** Changes to signal aggregation,
   headline ranking, or anything `render`-adjacent must be made in
   enhancements.js AND mirrored in script.js (script.js is the fallback when
   enhancements.js fails to load). Editing only script.js will look correct in
   code review and do nothing in the browser.
2. **Cache busting:** `enhancements.js`, `layout-fix.js`, and `declutter.js`
   are referenced with `?v=` params — bump the param when editing them.
   `script.js`/`styles.css` have no param and ride the 10-minute CDN cache.
3. **Deploys can fail silently.** After every push to main, verify the
   `pages-build-deployment` workflow run for that commit reports `success`
   (GitHub API: `actions/workflows` on the repo). A failed build serves the
   previous version with no visible error — the site just looks stale.
   `.nojekyll` (repo root) prevents the known Jekyll-failure class; do not
   delete it.
4. **Breakpoints** (both styles.css and layout-fix.js define rules at these):
   - `≥1181px`: desktop — sticky detail side panel next to the table.
   - `≤1180px`: detail side panel is `display:none`; ticker clicks open the
     bottom sheet (`#detailSheet`). The sheet must never appear ≥1181px.
   - `≤980px`: sidebar stacks below main; auto-hidden on load.
   - `≤760px`: ranking table becomes stacked cards (layout-fix.js owns this).
   - `≤680px`: tightest paddings; hero method cards hidden; tape capped at 4.
5. **Bottom sheet re-render guard:** `renderDetailSheetContent()` skips
   identical HTML because mobile URL-bar show/hide fires `resize` → full
   `render()` — without the guard the sheet jumps to the top mid-scroll.
   Don't remove it. New detail content added to `detailMarkup()` flows into
   both the desktop panel and the sheet automatically.
6. **Collapsible panels:** to make a new section collapsible, add it to
   `PANELS` in declutter.js. The section must follow the standard skeleton
   (see below). State persists in localStorage `signaldesk-panels-v1`.
7. **Sections live in tabs now.** Anything that scrolls to, focuses, or
   measures an element in another section must first call
   `window.SIGNALDESK_SELECT_TAB?.("<tabId>")` — otherwise it targets a hidden
   panel and silently does nothing. Two callers in script.js already do this
   (the research-radar card's scroll to the ranking table, and the search box).
   A new panel needs a `selectors` entry in `TABS` in tabs.js or it will not be
   displayed at all.
8. **Never let optional browser APIs break the shell.** `history.replaceState`
   is unavailable in some embedded webviews; an unguarded call in `select()`
   threw and aborted everything after it, leaving the tab badges permanently
   stale. Deep-linking, localStorage, and similar niceties belong in try/catch.
9. **Generated data files in git conflicts:** `data/history.json` is
   *cumulative* — on merge conflict, union both sides' snapshot arrays by
   date (never `--ours`/`--theirs`; a scheduled run on main may hold real
   days the branch lacks). `data/signals.json` is *latest-wins* — newest
   `generatedAt` is correct.

## Adding a new panel (checklist)

1. HTML in index.html using the standard skeleton:
   `<section class="foo-panel"><div class="section-head compact"><div>`
   `<p class="section-kicker">…</p><h2>…</h2><p>description</p></div></div>`
   `<div id="fooFeed"></div></section>`
2. New `foo.js` reading `window.SIGNALDESK_FOO`, rendering empty states
   honestly ("insufficient data" beats a fake-looking zero).
3. styles.css: add `.foo-panel` to the three shared blocks (base panel style,
   width/padding block, and the ≤680px `padding:14px` block) — grep for
   `.springs-panel` to find all three.
4. declutter.js `PANELS` entry, and a `selectors` entry in tabs.js `TABS`
   choosing which tab the section belongs to (a section in no tab is invisible).
5. If the pipeline feeds it: `scripts/update-data.mjs` step + add the data
   files to BOTH the `node --check` list and the `FILES=` list in
   `.github/workflows/refresh-data.yml` (a missed FILES entry means the
   workflow silently never commits that file).

## Verification (non-negotiable, every UI change)

1. `node --check` every touched JS file.
2. Serve locally: preview server `signaldesk-static` (config in
   `.claude/launch.json`, port 8793) — file:// won't exercise URL state.
3. Test at 375px (sheet, collapsed panels, card table) AND ≥1400px (sticky
   panel, no sheet). Check the console for errors both times.
4. Click a ticker in each surface that selects one (table row, radar card,
   attention map row) — all three route through the same selection path and
   all three have broken independently before.
5. After push: confirm the Pages deploy run succeeded, then curl the live
   `index.html` and grep for your change.

## News sourcing (rewritten 2026-07-28 — do not revert to per-ticker fan-out)

"Driving the tape" was empty or near-empty on most refreshes. The cause was
architectural, not a bad feed choice: the pipeline issued **one news request per
covered ticker per source** (Yahoo per-ticker RSS over ~70 names, then Google
and Bing per-ticker on top — roughly 200 requests per run), against hosts that
rate-limit shared CI IPs hard. Measured 2026-07-28 from a clean IP:

- `feeds.finance.yahoo.com` per-ticker RSS → **429**
- `query1/2.finance.yahoo.com` search JSON → **429**
- GDELT doc API → **429** (documented minimum spacing is 5s)
- StockTwits, Reddit JSON → **403**
- Broad RSS wires (Yahoo `rssindex`, CNBC, MarketWatch, PR Newswire,
  GlobeNewswire, Seeking Alpha, Investing.com company desks, Nasdaq markets)
  → **200**, ~200 headlines total for ~10 requests

**The deeper cause, found 2026-07-28 while verifying the above.** Rate limiting
was real but it was not the whole story: `textBetween()` — the helper every
RSS/Atom parse depends on — was built with `new RegExp` from a *template
literal*, so string escaping ran first and `[\s\S]` collapsed to `[sS]` (the
literal letters s and S) before RegExp saw it. It returned `""` for every
non-empty tag. **No RSS or Atom feed had ever contributed a headline**; the only
news reaching the tape came from GDELT, which is JSON. `countWord()` had the
same defect (`\b` → backspace U+0008), silently zeroing sentiment scoring for
every positive and negative word.

Both are fixed and moved to `scripts/lib/xml.mjs` with regression tests. When
building a regex from a template literal, remember the escape runs twice —
prefer a regex literal, and if you cannot, assert on the `.source` of what you
built.

The general lesson, and the reason `lib/xml.mjs` and `lib/host-guard.mjs` exist:
**pipeline helpers with branching behaviour belong in `scripts/lib/` with tests
in `scripts/test/`.** These two were inline in update-data.mjs and untested, and
a total parse failure produced no error, no warning, and no failure entry — just
quietly empty panels that looked like a data problem for months.

The current design, in `scripts/update-data.mjs`:

1. `collectNewswires()` — the primary path. Fetches each entry in `NEWSWIRES`
   **once**, then matches every headline against the ticker registry locally via
   `collectMentions`. Cost is independent of universe size.
2. `collectTickerNews()` — a capped top-up (`TARGETED_NEWS_LIMIT`) for the few
   big movers no wire covered. Uses Nasdaq's keyless `articlebysymbol` JSON
   first, Google News second, and stops at the first source that works.
3. `fetchTextPolite()` — per-host minimum spacing, a 20s timeout, and a
   **circuit breaker** (`scripts/lib/host-guard.mjs`, unit-tested): a 429/403
   blocks the host for the rest of the run immediately; generic failures
   (`fetch failed`, timeouts — an unreachable host, not a refusing one) block it
   after three in a row. Observed live: `api.nasdaq.com` was unreachable and
   produced 25 identical failures because the first version of the breaker only
   tripped on 429/403.
4. `summariseFailures()` — only 20 failures are published, so identical
   per-ticker lines are collapsed to `3x Nasdaq <ticker>: fetch failed`. Keep
   throttle markers intact in any change here: the tape's empty state reads
   these strings to decide whether to blame throttling.

Rules for future changes:

- Do not add a per-ticker loop over a news host. If a name needs coverage, add a
  broad wire that mentions it, or extend the capped top-up.
- Before adding a wire, actually fetch it and confirm it returns `<item>`/
  `<entry>` elements. Business Wire's public home feed returns HTTP 200 with an
  *empty channel* ("deactivated by the administrator") — a status check alone
  would have called it healthy.
- Investing.com's `news_25` feed is general world news, not markets; the company
  desks (`news_1065`, `stock_stock_picks`) are the useful ones.
- New source names must be added in four places or they will be silently
  filtered out of the UI: `MARKET_NEWS_SOURCES` in update-data.mjs, and
  `SOURCES`/`SOURCE_COLORS`/`DISCOVERY_NEWS_SOURCES`/`NEWS_ARTICLE_SOURCES` in
  **both** script.js and enhancements.js (trap 1 above).
- The tape's empty state must only claim "throttled" when a news failure
  actually carries a 429/403/throttle marker. It used to say that for *any*
  news-source failure, so it blamed rate limits on windows where the real
  reason was that no covered name moved enough to qualify.

## Copy & tone rules (these are product identity — do not drift)

- Never imply a buy/sell recommendation. Scores are "research priorities".
- Never present social chatter as news: real articles get "Top headline";
  social commentary gets "Notable chatter (not a news article)" in muted style.
- Base rates in UI copy must be *measured* numbers (from backtests or the
  calibration panel), never invented. If unmeasured, say so.
- Every signal shows its evidence AND its risk flags. No exceptions for
  "clean-looking" cards.
- Empty states tell the truth ("needs N more days of ledger history"), never
  placeholder content.

## Model routing for future SignalDesk work

- **Haiku:** copy typos, CSS-only tweaks, color/spacing changes, adding a
  ticker to theme-overrides.json.
- **Sonnet (default):** UI fixes and enhancements per this playbook, new
  panels, pipeline steps, test-covered library code, applying pre-specced
  fixes, running the Form 4 backtest per INSIDER_EVIDENCE.md's protocol.
- **Fable / strongest available (reserve):** changing any *claim* the UI
  makes (signal copy, base rates, badge wording), interpreting backtest or
  calibration results when they land in the ambiguous zone, changing scoring
  formulas or thresholds (frozen thresholds in coil-detector must NOT be
  tuned — they're validated), any new evidence-layer design, discovery
  interviews for new features.
