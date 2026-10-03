// Editorial research, not generated market data. Preserve observation IDs and
// append new periods/corrections; never promote a scraped page into verified evidence.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./adoption-watchlist.js"));
  else root.SIGNALDESK_TECHNOLOGY = factory(root.SIGNALDESK_ADOPTION);
})(typeof globalThis !== "undefined" ? globalThis : this, function (legacy) {
  const checkedAt = "2026-10-02";
  const urls = {
    qs: "https://www.quantumscape.com/quantumscape-inaugurates-eagle-line-for-solid-state-battery-pilot-production/",
    bmw: "https://www.press.bmwgroup.com/usa/article/detail/T0450262EN_US/bmw-group-and-solid-power-are-testing-all-solid-state-battery-cells-in-a-bmw-i7?language=en_US",
    toyota: "https://global.toyota/en/newsroom/corporate/39865919.html",
    satellite: "https://www.t-mobile.com/news/network/t-satellite-data-ready-app-expansion",
    service: "https://www.t-mobile.com/coverage/satellite-phone-service",
    ast: "https://investors.ast-science.com/",
  };
  const company = (name, ticker, role, relationship, url, asOf, caveat) => ({ name, ticker, role, relationship, url, asOf, caveat, materiality: "Technology-specific revenue exposure not established in this registry." });
  const legacyUrl = id => legacy?.themes.flatMap(t => t.evidence).find(e => e.id === id)?.url;
  const themes = [
    {
      id: "solid-state-batteries", name: "Solid-state batteries", sector: "Energy", stage: "pilot", reviewedAt: checkedAt, reviewDue: "2026-10-30",
      aliases: ["battery", "batteries", "ASSB", "lithium metal", "electrolyte", "QuantumScape", "Solid Power", "Toyota", "QS", "SLDP", "TM"],
      thesis: "Better batteries could change EV range, charging and packaging. The decisive transition is from promising cells to repeatable, economical production.",
      headline: "Pilot lines and vehicle tests; volume adoption still needs proof",
      stageReason: "The cited programs demonstrate pilot production preparation and vehicle testing. This is not a claim that no other program has shipped a product.",
      scope: "Track each chemistry separately. All-solid-state and solid-state lithium-metal programs are not interchangeable; semi-solid batteries are not counted as all-solid-state.",
      horizon: "Watch commercialization milestones, not a single launch forecast",
      risk: "Yield, cycle life under realistic pressure and temperature, cost, pack integration and qualification can delay commercial scale.",
      nextCheck: "Customer qualification, repeatable production yield, delivered cells and paid deployments. A new factory announcement alone does not pass the test.",
      unknowns: ["Comparable production yield", "Pack-level cost per kWh", "Commercial shipped GWh", "Field lifetime across temperatures"],
      evidence: [
        { id: "qs-eagle-2026", kind: "pilot", metric: "Pilot production infrastructure", value: null, qualifier: "reported", unit: "milestone", display: "Eagle Line inaugurated", period: "February 2026", publishedAt: "2026-02-04", checkedAt, publisher: "QuantumScape", owner: "QuantumScape", url: urls.qs, caveat: "A pilot-line inauguration is not gigawatt-hour commercial output. Sampling and scale-up remain distinct steps." },
        { id: "bmw-sldp-i7-2025", kind: "pilot", metric: "Vehicle integration test", value: null, qualifier: "reported", unit: "milestone", display: "BMW i7 road test", period: "May 2025", publishedAt: "2025-05-20", checkedAt, publisher: "BMW", owner: "BMW", url: urls.bmw, caveat: "Solid Power cells in a test vehicle; not a retail vehicle launch or a durability guarantee." },
        { id: "toyota-assb-target", kind: "target", metric: "Stated commercialization window", value: null, qualifier: "target", unit: "years", display: "2027–2028 target", period: "Target stated October 2023", publishedAt: "2023-10-12", checkedAt, publisher: "Toyota", owner: "Toyota", url: urls.toyota, caveat: "An older company target, not an achieved milestone or a newly reaffirmed schedule. Full-scale production was a subsequent phase." },
      ],
      milestones: [
        { id: "battery-qualification", label: "Repeatable customer-qualified cells", kind: "research-check", state: "watch", due: null, window: "No verified date", evidenceNeeded: "A dated customer disclosure with qualification scope, yield and delivered output." },
        { id: "toyota-commercialization", label: "Toyota commercialization window", kind: "company-target", state: "planned", start: "2027-01-01", due: "2028-12-31", window: "2027–2028 · original target", sourceId: "toyota-assb-target", evidenceNeeded: "A production vehicle delivered to customers; separate limited launch from full-scale manufacturing." },
      ],
      companies: [
        company("QuantumScape", "QS", "Cell technology", "Develops solid-state lithium-metal cells and a licensing production platform.", urls.qs, "2026-02-04", "Pilot execution and customer qualification risk; a technology milestone is not a return forecast."),
        company("Solid Power", "SLDP", "Electrolyte / licensing", "Its cells are used in the cited BMW test program; develops sulfide electrolyte and licenses technology.", urls.bmw, "2025-05-20", "A development relationship does not establish high-volume supply or product revenue."),
        company("Toyota", "TM", "Vehicle integrator", "Works with Idemitsu on solid electrolytes and commercialization of all-solid-state BEVs.", urls.toyota, "2023-10-12", "Diversified automaker; the cited target is old and must be rechecked."),
      ],
    },
    {
      id: "satellite-phones", name: "Satellite-to-phone connectivity", sector: "Connectivity", stage: "early-use", reviewedAt: checkedAt, reviewDue: "2026-10-30",
      aliases: ["satellite internet", "direct to cell", "direct-to-device", "D2D", "NTN", "Starlink", "T-Satellite", "AST SpaceMobile", "TMUS", "ASTS", "satellite phones"],
      thesis: "An ordinary phone that still connects beyond cell coverage has an obvious use. The next step is dependable, affordable everyday capacity—not just a successful demo.",
      headline: "Messaging and selected apps are commercially available",
      stageReason: "T-Mobile describes a live US service for compatible devices. That supports early commercial use, not universal broadband availability.",
      scope: "Separate SOS and messaging, optimized app data, voice, and general internet. Availability depends on country, carrier, handset, sky visibility and network capacity.",
      horizon: "Already useful in limited conditions; broader capability to prove",
      risk: "Coverage gaps, low capacity, spectrum approvals and device restrictions can limit utility. Satellite launches are not equivalent to paying users.",
      nextCheck: "Compatible devices and live markets, active paying users, delivered throughput, connection success and service economics. Track each operator separately.",
      unknowns: ["Comparable active paying users", "Busy-hour throughput", "Connection success by geography", "Standalone service profitability"],
      evidence: [
        { id: "tmobile-app-data-2025", kind: "rollout", metric: "Consumer service capability", value: null, qualifier: "reported", unit: "capability", display: "Selected apps over satellite", period: "October 2025 US expansion", publishedAt: "2025-10-01", checkedAt, publisher: "T-Mobile", owner: "T-Mobile", url: urls.satellite, caveat: "Optimized apps on compatible phones; not unrestricted terrestrial-speed internet or worldwide coverage." },
        { id: "tmobile-availability-2026", kind: "rollout", metric: "Current product availability check", value: null, qualifier: "observed-page", unit: "service", display: "US service listed as available", period: "Page checked October 2, 2026", publishedAt: null, checkedAt, publisher: "T-Mobile", owner: "T-Mobile", url: urls.service, caveat: "Undated product page. Limited speeds and possible gaps/time-outs; not an independent performance test or a subscriber count." },
      ],
      milestones: [
        { id: "satellite-reliable-data", label: "Prove reliable everyday data", kind: "research-check", state: "watch", due: null, window: "No verified date", evidenceNeeded: "Repeated field measurements by device and geography, alongside actual paid usage." },
        { id: "satellite-live-markets", label: "Verify the next live carrier market", kind: "research-check", state: "watch", due: null, window: "Watch commercial launches", evidenceNeeded: "A service customers can activate, with device, geography, pricing and capability limits disclosed." },
      ],
      companies: [
        company("T-Mobile", "TMUS", "Carrier / distribution", "Offers T-Satellite with Starlink to compatible phones.", urls.satellite, "2025-10-01", "A bundled service need not produce material standalone revenue."),
        company("AST SpaceMobile", "ASTS", "Satellite network", "Develops direct-to-cell broadband; investor materials identify NASDAQ: ASTS.", urls.ast, checkedAt, "Company role only. This mapping does not verify a particular commercial coverage claim."),
      ],
    },
  ];
  const extensions = {
    "ai-glasses": { sector: "Wearables", stage: "early-use", aliases: ["smart glasses", "wearables", "Meta", "EssilorLuxottica", "META"], scope: "Audio/camera AI glasses and display glasses are different products. Sales do not measure sustained daily use.", unknowns: ["Active daily use", "Return and renewal rates", "Product-level profitability"], companies: [company("Meta", "META", "Product / AI platform", "Co-develops the cited glasses with EssilorLuxottica.", legacyUrl("meta-glasses-launch"), "2026-06-23", "Product adoption need not be material to a diversified platform's earnings.")] },
    "ai-work": { sector: "Software", stage: "scaling", aliases: ["Copilot", "agents", "assistants", "Microsoft", "MSFT"], scope: "Paid assistant seats are not autonomous-agent deployments, active usage or measured productivity.", unknowns: ["Active use per paid seat", "Renewal cohorts", "Cost per successful task"], companies: [company("Microsoft", "MSFT", "Software distribution", "Discloses paid Microsoft 365 Copilot seats.", legacyUrl("msft-q4-2026"), "2026-07-29", "Seat counts alone cannot establish incremental margins or stock value.")] },
    "robotaxis": { sector: "Mobility", stage: "early-use", aliases: ["robotaxi", "autonomous driving", "Waymo", "Alphabet", "GOOGL"], scope: "Completed rides in an operating service are distinct from announced cities, test permits and driver-supervised trips.", unknowns: ["Unit economics by city", "Repeat rider cohorts", "Comparable independent safety measures"], companies: [company("Alphabet / Waymo", "GOOGL", "Service operator", "Waymo operates the ride-hailing program referenced here.", legacyUrl("waymo-sept-2026"), "2026-09-14", "Separate Waymo service growth from Alphabet-wide valuation and profitability.")] },
  };
  for (const item of legacy?.themes || []) {
    const extra = extensions[item.id];
    if (!extra) continue;
    themes.push({ ...item, ...extra, reviewedAt: legacy.reviewedAt, reviewDue: legacy.reviewDue,
      stageReason: "Editorial stage based on the cited company disclosures; not an independent adoption audit.",
      evidence: item.evidence.map(e => ({ ...e, owner: e.publisher, kind: e.unit === "USD" ? "rollout" : "adoption" })),
      milestones: [{ id: `${item.id}-next-proof`, label: "Next comparable adoption disclosure", kind: "research-check", state: "watch", due: null, window: "Reporting cadence · date not verified", evidenceNeeded: item.nextCheck }],
    });
  }
  // Monitoring pages, not scraping claims. Page changes enter an unverified inbox.
  const sources = [
    { id: "qs-resources", name: "QuantumScape resources", owner: "QuantumScape", url: "https://www.quantumscape.com/resources/", themes: ["solid-state-batteries"], mode: "links", terms: ["eagle", "solid-state", "solid state", "battery", "qse"], expectedCadence: "Company updates; irregular" },
    { id: "toyota-target", name: "Toyota commercialization disclosure", owner: "Toyota", url: urls.toyota, themes: ["solid-state-batteries"], mode: "page", terms: ["solid-state"], expectedCadence: "Historical target page; check corrections" },
    { id: "tmobile-network", name: "T-Mobile network newsroom", owner: "T-Mobile", url: "https://www.t-mobile.com/news/category/network", themes: ["satellite-phones"], mode: "links", terms: ["satellite", "starlink", "direct-to-cell"], expectedCadence: "Product announcements; irregular" },
    { id: "tmobile-service", name: "T-Satellite service limits", owner: "T-Mobile", url: urls.service, themes: ["satellite-phones"], mode: "page", terms: ["satellite"], expectedCadence: "Product-page changes; irregular" },
    { id: "ast-investor", name: "AST SpaceMobile investor updates", owner: "AST SpaceMobile", url: urls.ast, themes: ["satellite-phones"], mode: "links", allowedHosts: ["investors.ast-science.com", "feeds.issuerdirect.com", "irp.cdn-website.com"], terms: ["earnings", "results", "bluebird", "launch", "commercial"], expectedCadence: "Quarterly results and launches" },
    ...themes.slice(2).map(t => ({ id: `${t.id}-disclosure`, name: `${t.evidence.at(-1).publisher} evidence page`, owner: t.evidence.at(-1).publisher, url: t.evidence.at(-1).url, themes: [t.id], mode: "page", terms: [t.id === "ai-work" ? "copilot" : t.id === "robotaxis" ? "waymo" : "glasses"], expectedCadence: "Saved disclosure; check corrections, add new periods editorially" })),
  ].map(s => ({ ...s, intervalHours: 24, allowedHosts: s.allowedHosts || [new URL(s.url).hostname] }));
  return { schemaVersion: 1, updatedAt: checkedAt, themes, sources };
});
