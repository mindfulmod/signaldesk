# SignalDesk — Web Traffic Layer (phase 2)

> **Status (2026-08-29): specced, deferred.** No code exists for this layer, and
> it is explicitly gated behind the contract layer, which has also not been
> built. It would additionally break the project's standing "no API keys are
> required" promise (a free Cloudflare token) — a cost accepted in the spec but
> not yet paid.

Decisions locked 2026-07-30 via discovery interview. **Deferred by design** —
CONTRACT_FLOW.md ships first and accumulates live data before this is built. This
doc exists so the decisions don't get re-litigated and so the entity schema is
right the first time.

## Why this layer exists, and what it honestly is

The coil detector's validated failure mode is the PLUG trap: coils with no
fundamental inflection die. The existing discriminators are quarterly (XBRL
profitability crossover) or price-derived. Web traffic is a **demand-side proxy
that updates weekly and covers companies before they have earnings worth
reading** — including private ones.

**What it is not:** the free, keyless tier gives **ordinal rank, not visits**.
Probed 2026-07-30:

| Source | Status | Reality |
|---|---|---|
| Cloudflare Radar API | ⛔ 400 without a token; **free token** with any Cloudflare account | Real HTTP-based domain rank + trend series. The chosen source |
| Tranco top-1M | ✅ keyless, 9.7MB/day zip | Ordinal rank only, research aggregate |
| Majestic Million | ✅ keyless | Ordinal, backlink-derived — measures link graph, not people |
| Cisco Umbrella top-1M | ✅ keyless | Ordinal, DNS-derived, infra-domain heavy |
| Similarweb-grade visits | 💰 paid | Declined — not spending money on this |

Ordinal rank is coarse, dominated by infrastructure domains, and unreliable below
roughly rank 50k. Cloudflare Radar was chosen because it is materially better
than that and the token is free.

## Locked decisions (2026-07-30)

| Decision | Choice |
|---|---|
| Source | **Cloudflare Radar, free API token.** Explicitly accepted: this breaks the project's standing "no API keys are required" promise |
| Scope | **Both public tickers and private companies.** A domain surge at a private AI or fintech company is leading theme evidence even when unbuyable — that is the thing Wikipedia pageviews cannot give you, and it is why this layer earns a place next to a signal you already have |
| Schema | **Entities, not tickers** — an entity has domains and *optionally* a ticker. Locked now because retrofitting this later would touch every consumer |
| Curation | Curated theme packs only, same as contracts — shared mapping plumbing |
| Order | After the contract layer has live data |
| Declined 2026-07-30 | **Paid traffic data.** **Keyless-only rank lists** — preserving zero-key was judged not worth the data quality. **Public-tickers-only** — largely duplicates Wikipedia pageviews. **Private-only** — never produces a ticker to act on |

## Ripple effect that must be handled, not ignored

README.md currently states: *"No API keys are required."* That becomes false the
day this ships. Required, not optional:

- Reword the README claim rather than letting it quietly go stale — the honest
  version is that the core pipeline is keyless and this one optional layer takes
  a free token.
- The pipeline must **degrade honestly** when `CLOUDFLARE_RADAR_TOKEN` is absent:
  skip the layer, write an explicit "not configured" state, and keep the last
  good snapshot. It must never silently emit zeros, and it must never fail the
  run for the other layers. This is the same class of failure as the
  `textBetween()` bug — a total data outage that produced no error and looked
  like a data problem for months.
- Token goes in repo secrets; the generated data is committed as usual, so public
  site visitors and forks need no token to *view* anything.

## Entity schema (locked)

```json
{ "id": "anthropic", "name": "Anthropic",
  "domains": ["claude.ai", "anthropic.com"],
  "ticker": null,
  "themes": ["ai-apps"] }
```

`ticker: null` is a first-class case, not a gap. Private entities contribute to
theme evidence and appear as context; they never produce a ranking-table row.

## Open (deliberately, until the contract layer lands)

- Which theme packs get traffic entities first.
- The rank-change metric itself — rank deltas are ordinal, so a percentage change
  in rank is meaningless without a transform. This needs the same
  materiality/acceleration treatment contracts got, and it should be designed
  once real Radar series are in hand rather than guessed now.
- Whether it feeds theme heat or stays evidence-only. Decide after seeing whether
  contract flow's theme-heat contribution behaves.
