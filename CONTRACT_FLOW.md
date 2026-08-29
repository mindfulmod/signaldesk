# SignalDesk — Contract Flow Layer (federal award evidence)

> **Status (2026-08-29): specced, not built.** No code exists for this layer —
> no `scripts/lib/contract-flow.mjs`, no `data/contract-packs.json`. Decisions
> here are locked; the build order has not been started.

Decision set locked 2026-07-30 via discovery interview. This spec is the source of
truth for the contract-award evidence layer. Nothing ships to a diffusion-map or
Springs badge until the backtest gate below passes.

## Why this layer exists

Two independent gaps, one source closes both.

**1. The "proof quarter" leg is price-derived.** THEME_ENGINE.md's lifecycle runs
*event → leader proof quarter → language diffusion → coils → wave*. Stage 1 is
detected today as an **≥8% earnings gap on ≥3× volume** — that is a *reaction* to
news, not the news. Contract awards are dated, dollar-denominated, pre-revenue
facts about a named company. They are the only genuinely leading fundamental
input available without an API key.

**2. The `language` leg has never worked from CI.** GDELT has been rate-limited
or unreachable from the build machine for this project's entire life (429,
documented in UI_PLAYBOOK.md), so theme heat's language score leans on EDGAR
alone. USAspending returns 200 from CI today. Award flow is a second corroborating
input for theme heat that does not depend on a host that blocks us.

**What this layer is NOT.** It is not a contract-news feed. A Boeing award is in
the tape within minutes of the announcement and there is no edge in reprinting it.
The two things nobody watches, and therefore the only two things this layer
computes, are:

- **Materiality** — award dollars *relative to market cap*. $65M re-rates a $400M
  company and is rounding error for a prime.
- **Acceleration** — trailing-12m award flow versus the prior 12m, per company and
  per theme. A rate-of-change signal, structurally the same shape as the coil
  detector.

## Locked decisions (2026-07-30)

| Decision | Choice |
|---|---|
| Build order | **Contracts first**; the traffic layer (TRAFFIC_LAYER.md) follows after this one has accumulated live data |
| Product shape | Evidence layer woven into existing surfaces — **no standalone panel**. The 4-tab declutter of 2026-07-28 is not being undone |
| Surfaces | (1) **Diffusion map column** — contract flow beside ran/running/coiled/lagging on theme cards; (2) **ticker-detail evidence row** — alongside the Insider Evidence row, labeled context-not-signal |
| Theme heat | **Yes — scoring input, with a visible per-theme breakdown** on the theme card. Never a black-box contribution |
| Primary metric | **Composite: materiality × acceleration.** Materiality alone favours microcaps; acceleration alone favours giants. Both legs required |
| Latency | USAspending as system of record **+ the DoD daily announcement feed** for freshness (weeks earlier), reconciled and deduped |
| Universe | **Seeds the universe.** A material award force-covers that ticker for ~2 quarters even at zero social chatter — mirrors the existing hot-monitor pattern. The quiet microcap with a huge award is the case with the most edge and an attention-driven ledger cannot reach it |
| Curation | **Curated theme packs only.** Hand-mapped recipient→ticker per pack. NAICS/PSC is a *discovery aid*, never an authority (see "NAICS is dirty") |
| First packs | **Satellite / space** and **Nuclear / SMR** |
| Validation | Backtest **before** any badge, on the existing 419 frozen coil regimes — same gate as INSIDER_EVIDENCE.md |
| Kill criterion (pre-committed) | Coils with material contract flow must beat coils without by **≥10pts win rate** (or a clearly better median SPY-relative return). Below that, no badge and no theme-heat contribution; the ticker evidence row ships regardless, labeled context |
| Cadence | **Once daily**, on the last weekday refresh. USAspending updates daily at best and the DoD feed posts weekday evenings — four sweeps a day is pure waste |
| Declined 2026-07-30 | **Standalone "Contract flow" panel** — commodity feed, re-clutters the tabs, priced instantly for large caps. **Commercial/PR-wire contracts** — dollar extraction from press releases is unreliable; revisit if federal coverage proves too thin. **FCC satellite licence filings** — satellite-specific, does not generalise to other packs. **Defense primes pack** — large caps where awards are instantly priced; weak edge despite the cleanest data. **AI power pack** — most spend is private utility capex, so the layer would look empty. Do not relitigate without new evidence |

## Data sources (all probed 2026-07-30 from this machine)

| Source | Status | Role |
|---|---|---|
| `POST api.usaspending.gov/api/v2/search/spending_by_award/` | ✅ 200, **keyless** | System of record. Award ID, recipient, amount, agency, start date, description, NAICS |
| `www.war.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945` | ✅ 200 | DoD daily >$7.5M announcements, same-day. **`defense.gov` now 301-redirects here** — follow redirects or the feed reads as dead |
| USAspending recipient/UEI endpoints | keyless | Resolving recipient name variants to a stable UEI |

### Verified API gotchas — do not rediscover these

1. **`date_type: "new_awards_only"` is mandatory.** Without it, `time_period`
   matches *modification* dates. A 90-day window returned the 1993 ISS contract
   ($22.4B, Boeing) and the 2020 GBSD award as if they were new. Every query in
   this layer sets it explicitly.
2. **NAICS is dirty.** A three-code space query (336414 / 517410 / 334220)
   returned **Axon Enterprise** DHS awards in the top results. NAICS/PSC filters
   are a *candidate discovery* tool only — see below.
3. Recipient names are legal entities, not brands: `NORTHROP GRUMMAN SYSTEMS
   CORP`, `THE BOEING COMPANY`. Subsidiaries do not carry the parent's name.
   Match on curated UEI lists first, name patterns second.
4. The most interesting results are often **private** (the May-2026 space awards
   went to Lunar Outpost and Venturi Astrolab, neither listed). Unmapped material
   awards are surfaced for review, never silently dropped — they are theme
   evidence even when unbuyable.

## Architecture: curation is the authority, NAICS is the scout

This mirrors how `clusters.js` already works — candidates are surfaced for human
review rather than auto-promoted into the theme registry.

- **`data/contract-packs.json`** (hand-edited, committed, like
  `theme-overrides.json`): per pack, a list of `{ ticker, name, uei[],
  namePatterns[] }`. This file is the *only* thing that turns an award into a
  ticker attribution.
- **A separate NAICS/PSC discovery sweep** runs the same window against the
  pack's code list and reports recipients receiving material dollars that are
  **not** in the pack. Those land in the generated output as
  `unmappedCandidates` for you to review and hand-add. Nothing auto-promotes.

Starting code lists (to be validated against real results, not trusted):

- **Satellite / space** — NAICS 336414, 336415, 336419, 517410, 334511;
  PSC 1810, 1820, 1830, 5820. Agencies: NASA, DoD, Space Force, NOAA.
- **Nuclear / SMR** — NAICS 221113, 541330, 325180; PSC AC/AJ R&D lines.
  Agencies: DOE, NNSA, DoD.

## Scoring

Per ticker, computed daily over the pack universe:

```
T12M  = sum of new-award obligations, trailing 365 days
P12M  = same, the 365 days before that
mcap  = market cap from the existing signals/ledger record

materiality  = T12M / mcap
acceleration = (T12M - P12M) / max(P12M, MIN_BASE)
```

**Qualification gate** (below this, a ticker has no contract flow at all — no
score, no badge, honest empty state):

- `T12M >= $1,000,000` absolute, **and**
- `materiality >= 0.005` (0.5% of market cap).

The absolute floor stops a company going $0 → $50k from scoring full marks on
acceleration; the relative floor stops prime-sized dollars from looking material
on a prime.

**Composite** (weights provisional — to be set by the backtest, not hand-tuned,
same discipline as the insider layer's $250k threshold):

```
materialityScore  = clamp01( log10(1 + materiality) / log10(1 + 0.25) )   # 25% of mcap = full marks
accelerationScore = clamp01( acceleration / 1.0 )                          # +100% YoY  = full marks
flowScore         = 0.6 * materialityScore + 0.4 * accelerationScore
```

Log scaling on materiality because the distribution is heavily skewed and a
linear scale would make every non-microcap read as zero.

### Theme-level flow — breadth, not dollar sum

**Design call, and the important one in this spec.** Theme flow must **not** be
the sum of member award dollars. One prime winning one large award would light up
an entire theme, which is precisely the beta-guard failure mode `theme-heat.mjs`
already solves for price breadth via excess-breadth scoring.

Theme flow is therefore the **breadth of members with qualifying accelerating
flow** — the count (share) of pack members clearing the qualification gate *and*
showing positive acceleration — with the member median acceleration as a
tiebreaker. A theme where four small members all accelerate outranks one where a
single prime doubles.

## Universe seeding

Mirrors `hot-monitor` (proof-quarter siblings, force-covered 2 quarters at zero
chatter). A ticker is force-covered in the ledger for **2 quarters** when:

- a single new award ≥ **2% of market cap**, or
- `T12M >= 10%` of market cap.

Force-covered tickers carry `source: "contract-flow"` so their coverage reason is
visible and their expiry is enforceable. This is what lets a quiet microcap with
a huge award enter the ledger at all.

## Reconciliation: DoD daily vs USAspending

The DoD feed is fast and imprecise; USAspending is slow and authoritative. Never
double count.

- A DoD-feed award enters as `provisional: true, source: "dod-daily"`.
- When a USAspending record appears with a matching recipient and an amount
  within ±2%, within 90 days, the two **merge**; the record becomes confirmed and
  keeps the USAspending award ID.
- Provisional records unconfirmed after 120 days are dropped and logged — the
  announcement may have been restructured or reassigned.
- Provisional dollars count toward `T12M` but are **visibly marked** in the UI.
  Bookkeeping lives in `data/contract-state.json` (internal, never hand-edited).

## Backtest gate — and its honest weakness

Test: on the 419 frozen coil regimes (2019–2026, SPY-adjusted), do coils with
material contract flow at coil time beat coils without, by ≥10pts win rate?
USAspending has history to 2008, so this is genuinely runnable, not aspirational.

**State the limitation up front, before running it:** the frozen regimes are
S&P 500 constituents. Materiality is *definitionally* small for large caps, which
is exactly the population where this metric should have the least power. A null
result on that sample is weak evidence about small caps — the population where
the layer is actually aimed.

Handling, pre-committed so it cannot be rationalised after seeing results:

- Run the primary test on the 419 regimes. **The +10pt bar governs the badge and
  the theme-heat contribution regardless of the coverage complaint.**
- Run a secondary, clearly-labeled descriptive pass on pack small caps with
  whatever history exists. It is reported, it does **not** override the gate.
- If the primary fails: ticker evidence row ships as labeled context, badge and
  theme-heat contribution do not, and the secondary result is recorded as the
  reason to revisit once live data accumulates.

## Files

| File | Kind |
|---|---|
| `scripts/lib/contract-flow.mjs` | New pipeline lib (tests in `scripts/test/`, per the playbook rule for branching helpers) |
| `data/contract-packs.json` | **Hand-curated**, committed. The recipient→ticker authority |
| `data/contracts.json` / `.js` | Generated — per-ticker flow, theme flow, unmapped candidates |
| `data/contract-state.json` | Internal — provisional/dedup bookkeeping. Do not hand-edit |
| `scripts/update-data.mjs` | Once-daily step, last weekday run |
| `.github/workflows/refresh-data.yml` | Add generated files to **both** the `node --check` list and `FILES=` — a missed `FILES=` entry means the workflow silently never commits it |
| `themes.js`, `script.js` detail panel | The two UI surfaces |

**No `tabs.js` entry and no `declutter.js` PANELS entry are needed** — a direct
consequence of choosing woven surfaces over a standalone panel.

## Build order

1. **`contract-flow.mjs` fetch + parse + dedup** — USAspending client with
   `new_awards_only`, war.gov RSS parse via `lib/xml.mjs`, reconciliation.
   Unit tests on fixtures. *(Sonnet — well-specified, mechanical, the API shapes
   are pinned above.)*
2. **`data/contract-packs.json` for satellite/space + nuclear/SMR** — the
   hand-mapped ticker/UEI lists, seeded from a NAICS discovery sweep and then
   verified by hand. *(Haiku or an Explore agent for the candidate sweep and
   name-variant gathering; **you** approve the final list — this file is the
   layer's authority and a wrong mapping is invisible downstream.)*
3. **Scoring + theme-flow breadth** — materiality/acceleration/composite, the
   qualification gate, the breadth-not-sum theme rollup. *(Fable — this is the
   stateful-logic core, and the breadth-vs-sum distinction is exactly the class
   of thing that was silently wrong in `madeNewHighRecently`.)*
4. **Backtest against the 419 frozen regimes** — plus the labeled secondary
   small-cap pass. *(Fable — judgment-heavy, and the pre-committed gate must not
   be rationalised away.)*
5. **Universe seeding + hot-monitor integration** — force-cover rules, expiry.
   *(Sonnet, once 3 is settled.)*
6. **UI: diffusion-map column + ticker evidence row** — honest empty states,
   provisional dollars visibly marked. *(Sonnet — follow UI_PLAYBOOK.md's
   verification checklist: 375px and ≥1400px, console clean both times.)*
7. **Theme-heat contribution + visible breakdown** — gated on step 4 passing.
   *(Fable — it changes a backtested score.)*

## Standing discipline

From the Theme Engine build sessions: **nearly every layer had a real bug that
green unit tests did not catch** — empty-array edges, tautological comparisons,
noise from synthetic text. After each step above, re-run the actual pipeline and
eyeball the real JSON, not just the test output. The Axon result and the 1993 ISS
contract in this spec were both found that way, in the first ten minutes.
