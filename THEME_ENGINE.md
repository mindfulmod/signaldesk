# SignalDesk Theme Engine — Specification

Status: spec v1 (2026-07-10). Grounded in the three-phase coiled-spring study
(https://claude.ai/code/artifact/b1f553b3-935a-4e70-b814-28a91978e693) and two live data probes
(EDGAR full-text search phrase counts; GDELT news-volume timelines).

## Thesis: themes have a lifecycle, and each stage is separately measurable

Ten years of S&P 500 data show that most large appreciations outside megacap tech arrive in
**theme waves** — 3+ names in one niche igniting within 12 months (energy 2020-22, housing
2020-21, GLP-1 2021+, AI semis 2023-24, AI power 2022-25, photonics 2024-26). Themes diffuse
through a supply chain in order (AI: semis → datacenter infrastructure → power → optics), and
the later links form **coils** that release months after the earlier links confirm.

Observed lifecycle, with the leading signal for each stage:

| Stage | What happens | Leading observable | Example (AI theme) |
| --- | --- | --- | --- |
| 1. Spark | Real demand/supply shock; a leader has a "proof quarter" | Earnings-day gap ≥8% on ≥3× volume with guidance language | NVDA guide, May 2023 |
| 2. Naming | Media/analysts coin specific vocabulary | Novel-phrase velocity in news (GDELT) | "AI accelerator", "picks and shovels" |
| 3. Diffusion | Other companies claim exposure; institutions position in derivatives | Filing-mention acceleration (EDGAR FTS); co-mention graph densifies; **coils form** in derivative names | VRT/MPWR coils, late 2023 |
| 4. Wave | Breadth of big runs (what the Phase-3 detector saw) | ≥3 members starting +50%-pace runs, strong SPY-relative medians | VRT +176%, CEG/VST 2024 |
| 5. Saturation | Everything "adjacent" pumps; junk joins | Attention breadth extreme; laggard quality collapses | SMCI peak, 2024 |
| 6. Decay | Rotation out | Theme rel-index momentum turns; dead coils accumulate | — |

**Answer to "news or accumulation?"** — the sequence is: *real event → leader proof quarter
(news/earnings) → language diffusion (filings, co-mentions) → accumulation in derivatives (the
coil) → price breadth (the wave)*. News/language leads by one to two quarters; accumulation
confirms and is tradeable (that's the coil detector); breadth is what everyone else sees.
The entry sweet spot is stage 3: theme confirmed by language + a coiled laggard + release trigger.

Empirical anchors (probed 2026-07-10, both keyless):

- EDGAR FTS `"GLP-1"` filings/yr: 108, 137, **241 (2023, +76%)**, 523, 789 — accelerated a year
  before the broad GLP-1 winners/losers trade peaked.
- EDGAR FTS `"co-packaged optics"`: 5, 5, 7, 8, **22 (2025, ~3×)** — jumped ahead of the 2026
  photonics run. The generic word "photonics" stayed flat (~430/yr) — **specific emergent phrases
  discriminate; generic category words do not.**
- VRT coiled Oct-2023→Jan-2024 (months after NVDA's proof quarter), released, +176%.
  COHR coiled as of 2026-07 — downstream of the confirmed photonics wave.

---

## Data plumbing prerequisites (shared by all layers)

### P1. Per-ticker daily ledger — `data/ledger.json`
The single biggest gap today: `history.json` stores only the daily top-75, so persistence
cannot be computed. Once a ticker ever registers, append a daily row and keep ≥400 trading days
(prune tickers dormant >90 days and never coiled/themed):

```json
{ "T": { "meta": {"name": "", "sector": "", "sub": "", "article": ""},
         "rows": [["2026-07-10", 12, 0.0031, 18.62, 1.2, 4520]] } }
// [date, mentions, shareOfVoice, close, relVolume, wikiViews]
```

- `shareOfVoice` = ticker mentions ÷ total mentions that day (source-availability-proof).
- Price backfill: Yahoo v8 chart with explicit `period1/period2` epochs (`range=max` silently
  degrades to monthly; Stooq is IP-blocked on the build machine).
- Wikipedia pageviews daily (article resolution already exists for profile blurbs) — powers
  persistence until SignalDesk's own share-of-voice history matures.

### P2. Theme registry — `data/theme-registry.json`
Three membership sources, merged, provenance kept:

1. **GICS baseline**: ticker → sub-industry from the Wikipedia S&P 500/1500 constituent tables
   (already parsed; includes CIK). Static seed, refreshed monthly.
2. **Dynamic clusters**: co-mention edges (two tickers in one headline/post — computable from the
   existing events stream) + 60d return-correlation clustering. Catches what GICS mislabels
   (VRT="Industrials", CEG="Utilities" — both were AI-infrastructure trades).
3. **Manual overrides**: user-curated entries (`"photonics": ["COHR","LITE","AAOI", ...]`).
   The human eye that spotted photonics in 2026 stays in the loop.

```json
{ "themes": [{ "id": "ai-power", "name": "AI power & electrification",
    "phrases": ["grid capacity", "data center power", "SMR"],
    "members": [{"t": "CEG", "src": ["manual","cluster"]}, {"t": "VRT", "src": ["gics","cluster"]}] }] }
```

---

## Layer 0 — Theme Radar (early detection; stages 1–3)

Purpose: surface candidate themes **before** the wave, from language and proof events.

### 0a. Phrase velocity tracker
- **Candidate generation**: from SignalDesk's own headline stream, extract bigrams/trigrams that
  are (i) new or rare in the trailing year and (ii) accelerating week-over-week. Novelty is the
  filter — established words never qualify (the "photonics vs co-packaged optics" lesson).
- **Confirmation, two independent corpora**:
  - GDELT `mode=timelinevol` (keyless; ≥5s between requests): 90d average article volume ≥2× the
    prior-365d average.
  - EDGAR full-text search `efts.sec.gov/LATEST/search-index?q="<phrase>"&forms=10-K,10-Q,8-K`
    (keyless, needs UA with contact email): quarterly filing count accelerating — YoY ≥2× with a
    minimum of 10 filings, or 3 consecutive rising quarters for small counts. Filings are the
    highest-precision corpus: companies claim exposure under securities law, not for clicks.
- **Output**: phrase → {news velocity, filings velocity, first-seen, associated tickers (from
  co-occurrence in headlines)}. A phrase passing both corpora spawns/updates a theme card at
  stage "Naming" or "Diffusion".

### 0b. Proof-quarter detector
- Trigger per ticker: close gaps ≥+8% on ≥3× 60d avg volume AND same-day headlines contain
  earnings/guidance vocabulary (reuse `IMPACT_WORDS` plus "guidance", "outlook", "raises").
- Effect: mark ticker as candidate **theme leader**; elevate its co-mention neighbors and GICS
  siblings to a hot-monitor list for 2 quarters (news fetch + pageviews + ledger even if they
  have zero social chatter).

### 0c. Co-mention graph
- Weekly job over the trailing 90d of events: nodes = tickers, edge weight = co-appearances.
- Signals: (i) a new dense cluster forming (community detection — greedy modularity is enough at
  this scale) = theme crystallizing; (ii) the neighbor set of a leader changing (who is news
  linking to NVDA now vs 6 months ago) = diffusion direction.

Cadence: 0a daily (GDELT) / weekly (EDGAR); 0b every refresh; 0c weekly.
Failure modes: generic phrases (novelty filter is mandatory); GDELT rate limits (5s spacing,
cache yearly baselines); promoted junk phrases (require ≥2 distinct source domains).

## Layer 1 — Theme heat (stage 4 detection, live-computable)

Purpose: score how hot each registry theme is *now* (the wave detector ran on hindsight
forward-returns; live heat must use only trailing data).

Per theme (min 3 members with data), compute over members:

- **Breadth of relative strength**: share of members with 90d return ≥ +15% over SPY.
- **New-high breadth**: share of members making a 52-week high within the last 60 sessions.
- **Attention breadth**: share of members with attention ratio ≥1.25× (pageviews or
  share-of-voice) — breadth, not depth, so one meme name can't fake a theme.
- **Language score**: max of the theme's phrase-velocity scores (Layer 0a).
- **Beta guard**: compute the same breadth stats over the whole universe; theme heat is scored on
  the *excess* over universe breadth. A crash rebound (2025-04: nine simultaneous "doubles",
  thin SPY-relative gains) lights up every theme equally — excess breadth stays flat.

`heat = 100 × (0.30·relBreadthXS + 0.25·newHighBreadthXS + 0.25·attentionBreadthXS + 0.20·language)`

Stage assignment: Naming (language only) → Diffusion (language + attention breadth, price breadth
still low) → Wave (rel breadth high) → Saturation (attention breadth extreme AND laggard-quality
collapse: members with no revenue exposure joining) → Decay (theme equal-weight rel index below
its 100d average).

Output `data/themes.json` (consumed by the dashboard):

```json
{ "generatedAt": "", "themes": [{ "id": "photonics", "name": "Photonics & optics",
  "stage": "wave", "heat": 78,
  "evidence": {"relBreadth": 0.62, "newHighBreadth": 0.45, "attnBreadth": 0.5,
               "phrase": "co-packaged optics", "filingsYoY": 2.75},
  "members": ["COHR", "LITE", "GLW", "APH"] }] }
```

## Layer 2 — Diffusion map (who's next inside a hot theme)

Purpose: within each theme at stage Diffusion/Wave, rank members by where the wave hasn't reached.

Member states (mutually exclusive, computed from ledger + coil detector):

- **Ran** — 12mo return ≥ +50% and now >30% extended above 200d MA (late; crowding risk).
- **Running** — released coil or 52-week high within last 60 sessions.
- **Coiled** — active coil regime (Layer 3). **The priority state.**
- **Lagging** — rel 90d return < +10%, no coil yet → candidate list for coil formation watch.
- **Dead coil** — coil aged out without release → demoted, shown with the Phase-2 stats as the reason.

UI: theme detail panel = supply-chain table ordered ran → running → coiled → lagging, each row
with sparkline, attention ratio, coil status, days-in-state. This is the "what's next" view —
the VRT-after-NVDA, COHR-after-LITE pattern made a first-class screen.

## Layer 3 — Coil hunt (frozen detector, validated thresholds)

Run over: all hot-theme members (priority) + full tracked universe (background).

- **Coil**: attention persistence ≥0.60 (ratio ≥1.25× own trailing-1yr median on ≥60% of the last
  60 sessions — pageviews now, share-of-voice when the ledger matures) AND 60d high-low range in
  the ≤35th percentile of its trailing year; regime = ≥15 such sessions, gaps ≤10 merged.
- **Release**: close > prior 60d max close on ≥1.5× 60d avg volume.
- **Dead coil**: 126 sessions (~6 months) after regime end with no release → demote.
- Context badges (display, never gates): OBV 60d slope; profit-crossover (SEC XBRL TTM
  NetIncomeLoss crossing zero within ±2 quarters — the APP/PLTR monster marker); revenue
  re-acceleration; sector class (defensive-sector coils shown discounted **unless** inside a hot
  theme — the CEG/VST exception).
- Honest stats shown on every card (from the blind S&P scan): released coils 65% win / +12.6%
  median / 16% reach +50% at 12mo; unreleased coils −18.6% vs SPY, zero doubles.
- Ranking within the springs board: hot-theme coils first, then persistence, then compression.

## Layer 4 — Alerts & lifecycle notifications

Transport: [ntfy.sh](https://ntfy.sh) (free, keyless POST; user subscribes to a private topic on
phone) fired from the existing GitHub Actions refresh; plus an on-site "What changed" feed.

Alert conditions (each at most once per ticker/theme per state-change; daily digest for the rest):

1. **Release fired** on any coiled name (top priority — this is the trade).
2. **New coil inside a hot theme** (stage Diffusion/Wave).
3. **Theme stage transition** (especially → Diffusion: the early-entry window; and → Decay).
4. **Proof quarter detected** (leader event + which theme/siblings got elevated).
5. **Dead-coil demotion** of a watchlist name (position-exit information).
6. Weekly digest: theme leaderboard with heat deltas, springs board changes, phrase-radar newcomers.

---

## Build order

| # | Deliverable | Depends on | Effort | Model |
| --- | --- | --- | --- | --- |
| 1 | P1 ledger + share-of-voice + price/pageview backfill | — | M | Sonnet |
| 2 | P2 theme registry (GICS seed + manual overrides; clusters later) | — | S | Sonnet |
| 3 | Layer 3 coil detector on ledger + springs board UI | 1 | M | Fable (port scoring), Sonnet (UI) |
| 4 | Layer 1 theme heat + themes rail UI | 1, 2 | M | Fable (scoring), Sonnet (UI) |
| 5 | Layer 4 alerts via ntfy.sh in the refresh workflow | 3, 4 | S | Haiku |
| 6 | Layer 0a phrase velocity (GDELT + EDGAR FTS) | 2 | M | Fable (novelty extraction is the hard part) |
| 7 | Layer 2 diffusion map panel | 3, 4 | S | Sonnet |
| 8 | Layer 0b proof-quarter + 0c co-mention clusters | 1 | M | Sonnet |
| 9 | Calibration panel: grade every stage transition & coil forward | 3+ | M | Sonnet |

Effort: S ≈ an evening, M ≈ a weekend.

## Validation plan

- **Replay**: run Layer 0a/1 against 2022-2026 for the AI chain ("AI accelerator", "grid
  capacity", "GLP-1", "co-packaged optics") and confirm stage timestamps lead the known waves.
- **Freeze**: all thresholds above are frozen from the study; no live tuning.
- **Forward grading** (the real test): every theme card and coil logs its creation date and each
  stage transition; the calibration panel reports forward returns by stage/state so the engine
  grades itself the way the DISCOVERY_MODEL doc already promises for ticker scores.
