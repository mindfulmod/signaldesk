# Adoption evidence, not a hype leaderboard

Reviewed September 25, 2026. Horizon: 12–24 months. These are category hypotheses,
not stock recommendations or calibrated probabilities.

## Current view

**AI smart glasses are the leading candidate for a new mass-appeal consumer
category.** Familiar form factor, existing eyewear distribution, a lower entry
price and purchasing evidence support this inference. EssilorLuxottica reported
AI-glasses revenue nearly doubling in Q2 2026. Meta introduced a $299 starting-price
line with prescription compatibility and broad retail distribution. Revenue is
not unit sales or retention; these are interested companies' disclosures.

Sources: [EssilorLuxottica H1/Q2 results](https://www.essilorluxottica.com/en/newsroom/press-releases/q2-h1-2026-results/),
[Meta June launch](https://about.fb.com/news/2026/06/meta-essilorluxottica-partner-launch-meta-glasses/).

For software, **AI inside everyday work has the stronger near-term distribution
story**, but is already scaling rather than wholly new. Microsoft disclosed over
20 million paid M365 Copilot seats in FY26 Q3 and over 30 million in Q4. These are
lower bounds: do not infer an exact 50% growth rate. Paid seats do not establish
active usage, renewal, productivity or autonomous-agent reliability.

Sources: [Microsoft Q3](https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3),
[Microsoft Q4](https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast).

**Robotaxis are a useful comparison**, constrained by city rollout, regulation
and fleet economics. Waymo reported over half a million weekly trips in September.
Planned Tokyo service in 2027 must not count as current adoption.

Source: [Waymo September update](https://waymo-prod.appspot.com/blog/2026/09/opening-tokyo-in-2027-with-nihon-kotsu-go/).

## Shipped seed, not an automated data service

`adoption-watchlist.js` is a human-reviewed evidence registry, outside generated
`data/`, rendered by `adoption.js` in Research. Append observations instead of
overwriting prior periods. Every observation has a metric, period, value (or
explicit qualitative/null value), unit, qualifier, publisher, source URL,
publication date, checked date and caveat. Review dates and overdue status are
visible. Following a theme is a browser-local bookmark, not a scheduled collector
or notification.

Quarterly observations do not expire under the news strip's 72-hour rule. They
remain evidence about their stated quarter; a review can be overdue without
rewriting historical facts. No synthetic mainstream-probability score is shown.

## What to track

| Layer | Useful observations | Guardrail |
| --- | --- | --- |
| Attention | Unique publishers, search interest, developer discussion, sustained 4–12 week interest | Deduplicate syndication; curiosity is not purchasing |
| Adoption | Units, paid seats, completed rides, active users, retention | Keep sold/shipped/active/paid and estimates/reports distinct |
| Distribution | Actual retail availability, enabled users, operating cities | Announcements and pilots are not deployed capacity |
| Economics | Price, renewal, gross margin, utilization, cost per completed task | Growth can hide subsidies or weak margins |
| Stock exposure | Product revenue, supplier relationship, materiality, valuation | A category can succeed while its stocks disappoint |

Use news and phrase detection to discover candidates, not to confirm adoption.
Keep adoption evidence separate from ticker attention scores and theme heat.

## Next implementation sequence

1. Review candidates weekly; append hard metrics on their real reporting cadence.
   Record “not disclosed” for missing retention/economics. Do not disguise proxies
   as measured metrics.
2. Add a primary-source registry: owner, URL, expected cadence, last successful
   fetch, last changed content, last publication date, failure streak and review
   status. Fetch/diff once per source, not once per ticker. A page change queues
   evidence for review; it does not automatically verify a numeric claim.
3. Store append-only observations with category, entity, metric definition, unit,
   geography, period and reported/estimated status. Compute changes only between
   compatible definitions. Preserve corrections and original observations.
4. Alert on substantive changes: a comparable disclosure, repeated growth, new
   live distribution, improving economics, a reversal or a missed expected
   disclosure—not every duplicated headline.
5. Map a public company only when a dated source establishes its role. Keep
   revenue exposure unknown until disclosed. Add valuation work after this link
   is established; a partnership headline alone is not a stock thesis.
6. Grade category forecasts separately from stock returns at 3/6/12 months.
   Preserve the original prediction, evidence then available and a falsifiable
   milestone. Include failures/delistings; do not tune and advertise on the same
   outcome sample.

Promote to “scaling evidence” only with comparable observations across periods
plus a distinct distribution/usage check. Syndicated releases and sources owned
by one company are not independent confirmations. This is an editorial process,
not a backtested return model. Show unknowns and thesis-breaking conditions.
