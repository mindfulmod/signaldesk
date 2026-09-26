// Human-reviewed evidence registry, deliberately separate from generated data/.
// Append observations; do not overwrite prior periods. See ADOPTION_TRACKER.md.
(function (root, factory) {
  const data = factory();
  if (typeof module === "object" && module.exports) module.exports = data;
  else root.SIGNALDESK_ADOPTION = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    reviewedAt: "2026-09-25",
    reviewDue: "2026-10-25",
    themes: [
      {
        id: "ai-glasses", name: "AI smart glasses", category: "Consumer candidate", horizon: "12–24 month thesis",
        thesis: "A familiar accessory is becoming an everyday AI interface. Lower prices and existing eyewear retail make wider adoption plausible.",
        companies: "Meta · EssilorLuxottica",
        headline: "AI-glasses revenue nearly doubled in Q2",
        risk: "Revenue growth is not proof of daily use. Retention, privacy acceptance and product-level profitability remain open questions.",
        nextCheck: "Next reported units / revenue, repeat usage, returns and prescription uptake. Downgrade if sales growth needs heavy discounting or use fades after purchase.",
        evidence: [
          { id: "el-q2-2026", metric: "AI-glasses revenue growth", value: null, qualifier: "qualitative", unit: "year-over-year", display: "Nearly doubled", period: "Q2 2026", publishedAt: "2026-07-28", checkedAt: "2026-09-25", publisher: "EssilorLuxottica", url: "https://www.essilorluxottica.com/en/newsroom/press-releases/q2-h1-2026-results/", caveat: "Company-reported revenue, not unit sales or retention." },
          { id: "meta-glasses-launch", metric: "Starting US launch price", value: 299, qualifier: "from", unit: "USD", display: "$299", period: "June 2026 launch", publishedAt: "2026-06-23", checkedAt: "2026-09-25", publisher: "Meta", url: "https://about.fb.com/news/2026/06/meta-essilorluxottica-partner-launch-meta-glasses/", caveat: "Base price excludes prescription extras. Retail distribution is not sell-through." },
        ],
      },
      {
        id: "ai-work", name: "AI inside everyday work", category: "Software adoption", horizon: "Already scaling",
        thesis: "Assistants can reach people through software they already use. Paid adoption is measurable; reliable autonomous task completion needs separate proof.",
        companies: "Microsoft",
        headline: "30M+ paid Microsoft 365 Copilot seats",
        risk: "Paid seats are not active users, demonstrated productivity or autonomous-agent adoption. Enterprise purchasing differs from consumer appeal.",
        nextCheck: "Comparable paid-seat disclosures, active usage, renewal / expansion and cost per completed task. Downgrade if purchases stop translating into sustained use.",
        evidence: [
          { id: "msft-q3-2026", metric: "Microsoft 365 Copilot paid seats", value: 20000000, qualifier: "over", unit: "seats", display: "20M+", period: "FY2026 Q3", publishedAt: "2026-04-29", checkedAt: "2026-09-25", publisher: "Microsoft", url: "https://www.microsoft.com/en-us/investor/events/fy-2026/earnings-fy-2026-q3", caveat: "Lower-bound disclosure; not an exact count or active-user metric." },
          { id: "msft-q4-2026", metric: "Microsoft 365 Copilot paid seats", value: 30000000, qualifier: "over", unit: "seats", display: "30M+", period: "FY2026 Q4", publishedAt: "2026-07-29", checkedAt: "2026-09-25", publisher: "Microsoft", url: "https://www.microsoft.com/en-us/investor/earnings/fy-2026-q4/press-release-webcast", caveat: "Company-reported paid seats, not autonomous agents or active users." },
        ],
      },
      {
        id: "robotaxis", name: "Driverless ride-hailing", category: "Geographic rollout", horizon: "City-by-city adoption",
        thesis: "A service people already understand, delivered without a driver. Expansion depends on local approvals, safety and fleet economics.",
        companies: "Alphabet / Waymo",
        headline: "500K+ weekly trips reported by Waymo",
        risk: "Trips are not unique riders. Announced markets are not operating markets, and broader access does not establish profitable unit economics.",
        nextCheck: "Completed trips in operating cities, repeat riders, service area, regulator-reported safety and cost per mile. Count Tokyo only when public service actually begins.",
        evidence: [
          { id: "waymo-sept-2026", metric: "Weekly trips", value: 500000, qualifier: "over", unit: "trips/week", display: "500K+", period: "September 2026 disclosure", publishedAt: "2026-09-14", checkedAt: "2026-09-25", publisher: "Waymo", url: "https://waymo-prod.appspot.com/blog/2026/09/opening-tokyo-in-2027-with-nihon-kotsu-go/", caveat: "Company-reported trips. Tokyo 2027 is a plan, not current adoption." },
        ],
      },
    ],
  };
});
