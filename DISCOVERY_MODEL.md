# SignalDesk Discovery Model

SignalDesk is an attention-discovery tool, not a price-prediction engine. Its job is to reduce a large market universe into a small, explainable research queue while making weak evidence and crowding risk hard to miss.

## Product thesis

Investor attention matters because it changes the set of stocks people consider. Research by Barber and Odean found that individual investors are net buyers of attention-grabbing stocks, including names in the news, on abnormal volume, or making extreme one-day moves. That makes attention useful for discovery, but it does not make attention a sufficient buy signal.

The model therefore treats a setup as five distinct questions:

1. **Attention:** Is the name registering meaningfully relative to its peers?
2. **Acceleration:** Is interest increasing rather than merely remaining large?
3. **Breadth:** Are independent social, catalyst, and market groups participating?
4. **Confirmation:** Do price and relative volume support the attention?
5. **Catalyst evidence:** Is there public news or an SEC filing that can explain the move?

The score then subtracts penalties for:

- an already extended price move;
- extreme volume;
- one-source concentration;
- micro-cap volatility;
- social attention with no verified catalyst;
- evidence from only one group; and
- price moving against the attention signal.

## Why the UI separates attention from setup quality

Attention can create buying pressure, but research also documents overreaction and later partial reversals around highly salient moves. Social attention can also be manipulated, particularly in small, thinly traded names. SignalDesk therefore displays:

- an **attention score**, which describes how visible a stock is;
- a **setup score**, which describes the current balance of evidence and risk;
- a **stage**: Early ignition, Building, Confirmed, Crowded, Cooling, or Watching;
- an **evidence grade**; and
- explicit **risk flags** beside the positive evidence.

No stage or score implies a guaranteed outcome. “Crowded” is intentionally not presented as a top opportunity even when its raw attention is very high.

## Important data interpretation

FINRA daily short-sale volume is not short interest. It measures certain short-sale transactions reported for a trade date and does not show the size of open short positions. SignalDesk may use it as market-activity context, but it must not label the value as short interest, short pressure, or proof of a squeeze.

Public sentiment is descriptive, not predictive. Positive language can follow price, repeat promotional posts, or reflect selective attention to gains. It receives less weight than independent catalyst and market confirmation.

## Current score weights

| Component | Weight | Purpose |
| --- | ---: | --- |
| Attention | 14% | Peer-relative visibility |
| Acceleration | 22% | Change in interest versus the prior window |
| Breadth | 20% | Independent source and group participation |
| Market confirmation | 22% | Price and relative-volume agreement |
| Catalyst evidence | 22% | Public news and SEC filing support |

Penalties are applied after the weighted score. The score is a research-ranking heuristic and should be backtested before its weights are treated as stable.

## Next validation milestones

1. Store intraday mention counts so acceleration is based on comparable windows rather than daily totals.
2. Measure source independence by deduplicating syndicated stories and repeated social posts.
3. Add float, liquidity, spreads, halts, dilution, and recent offering risk for small-cap names.
4. Separate catalyst types such as earnings, guidance, regulatory decisions, financing, and analyst actions.
5. Backtest each feature and stage against forward returns, maximum adverse excursion, and reversal rates at 1-day, 5-day, and 20-day horizons.
6. Publish calibration: how often each score band advanced, reversed, or failed, including delisted names to avoid survivorship bias.
7. Replace the single score with horizon-specific models only after there is enough history to validate them out of sample.

## Theme lifecycle (Springs, themes, alerts)

The discovery score above answers "is this one ticker worth a look right now?" It does not
model that most large moves outside megacap tech arrive in **theme waves** diffusing through a
supply chain over months, or that sustained attention with price compression ("coiled spring")
is a separately measurable, backtested precursor. That lifecycle — Spark → Naming → Diffusion →
Wave → Saturation → Decay, plus the frozen coil detector and theme-heat scoring built on top of
it — is specified in [THEME_ENGINE.md](THEME_ENGINE.md). It keeps the same honest-labeling rule
as this document: every coil and theme card shows its base rates and risk flags, and stage never
implies a guaranteed outcome.

## Research references

- Barber and Odean, [All That Glitters: The Effect of Attention and News on the Buying Behavior of Individual and Institutional Investors](https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/allthatglitters_rfs_2008.pdf)
- FINRA, [Short Interest — What It Is, What It Is Not](https://www.finra.org/investors/insights/short-interest)
- SEC, [Pump&Dump.con: Tips for Avoiding Stock Scams on the Internet](https://www.sec.gov/investor/pubs/pump.htm)
- SEC, [Social Media and Investing — Avoiding Fraud](https://www.sec.gov/investor/alerts/socialmediaandfraud.pdf)
- Kowalski, [Skills for Design Engineers](https://github.com/emilkowalski/skills)
