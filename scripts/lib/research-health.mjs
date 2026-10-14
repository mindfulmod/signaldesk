import model from "../../research-model.js";
import config from "../../research-config.js";
import { discoveryHistory } from "./discovery-history.mjs";
export function researchHealth(research, monitor, now = Date.now(), scope = config) {
  const errors = [], warnings = [];
  if (model.freshness(research?.generatedAt, now, 36) !== "current") errors.push("Research publication is missing or more than 36 hours old");
  const states = Object.values(monitor?.sources || {}), expected = scope.sources.length;
  if (research?.coverage?.totalSources !== expected || scope.sources.some(s => !monitor?.sources?.[s.id])) errors.push("Published source coverage differs from configured sources");
  const active = scope.sources.filter(s => s.accessStatus !== "permission-required"), activeIds = new Set(active.map(s => s.id));
  const audit = model.sourceAudit(scope.sources, monitor, now);
  const current = audit.rows.filter(row => row.readable).map(row => row.state);
  if (!active.length || states.length !== expected || current.length < Math.ceil(active.length * .8)) errors.push(`Only ${current.length}/${active.length} active sources passed a check in the last 36 hours (target: at least 80%)`);
  for (const s of states.filter(s => activeIds.has(s.id) && !current.includes(s))) warnings.push(`${s.id}: ${s.error || "Source check overdue"}`);
  for (const s of scope.sources.filter(s => !activeIds.has(s.id))) warnings.push(`${s.id}: intentionally paused pending permission review; retained records are historical`);
  for (const row of audit.rows.filter(row => row.issue === "content" && !row.source.discovery)) warnings.push(`${row.source.id}: ${row.label.toLowerCase()}; ${row.next}`);
  const discovery = active.filter(s => s.discovery), discoveryCurrent = discovery.filter(s => current.some(row => row.id === s.id));
  if (discovery.length && discoveryCurrent.length < Math.ceil(discovery.length * .8)) errors.push(`Discovery coverage is incomplete: ${discoveryCurrent.length}/${discovery.length} feeds current`);
  for (const lane of new Set(discovery.map(s => s.tier === "community" ? "community" : "research"))) {
    if (!discoveryCurrent.some(s => (s.tier === "community" ? "community" : "research") === lane)) errors.push(`Discovery ${lane} lane has no current source`);
  }
  for (const s of discoveryCurrent) {
    const state = monitor.sources[s.id];
    if (state.matchedItems === 0 || state.datedItems === 0) warnings.push(`${s.id}: readable but no dated discovery items; check the extraction contract`);
    if (s.quietAfterDays && model.freshness(state.newestPublicationAt, now, s.quietAfterDays * 24) !== "current") warnings.push(`${s.id}: latest content is undated, future-dated or older than ${s.quietAfterDays} days; readable does not mean fresh content`);
  }
  if (research?.discovery?.discoveryTruncated) warnings.push("Discovery archive has gaps in the 28-day window; counts cover retained records only and momentum is withheld");
  const momentum = (research?.discovery?.candidates || []).filter(c => c.momentumPercent !== null && c.momentumPercent !== undefined);
  if (momentum.length) {
    const history = Number.isFinite(Date.parse(research?.generatedAt)) ? discoveryHistory(discovery, monitor?.sources || {}, research.discovery, research.generatedAt) : null;
    if (research.discovery.historyVersion !== 1 || !history?.completeHistory || !history.collectedToday || research.discovery.discoveryTruncated) errors.push("Published discovery momentum lacks compatible daily source-check receipts or has an archive gap");
    for (const candidate of momentum) {
      const validCounts = Number.isInteger(candidate.recentDocuments) && candidate.recentDocuments > 0 && Number.isInteger(candidate.priorDocuments) && candidate.priorDocuments > 0;
      if (!validCounts || !Number.isFinite(candidate.momentumPercent) || Math.abs(candidate.momentumPercent - (candidate.recentDocuments / candidate.priorDocuments - 1) * 100) > 1e-8) errors.push(`Invalid story-count momentum: ${candidate.id}`);
    }
  }
  const companies = Object.values(research?.companies || {}), quotes = scope.companies.map(c => ({ ticker: c.ticker, ...model.companyQuote(research?.companies?.[c.ticker], c.ticker, now) })), covered = quotes.filter(q => q.current);
  for (const quote of quotes.filter(q => !q.current)) warnings.push(`${quote.ticker}: ${quote.reason}`);
  for (const [ticker, company] of Object.entries(research?.companies || {})) if (company.valuation) errors.push(`${ticker}: unsupported capitalization; quote timestamps do not establish capitalization dates`);
  if (!companies.length || companies.length !== scope.companies.length || scope.companies.some(c => !research?.companies?.[c.ticker])) errors.push("Permanent company universe is incomplete");
  for (const [ticker, company] of Object.entries(research?.companies || {})) if (company.factsError || model.freshness(company.factsCheckedAt, now, 192) !== "current") warnings.push(ticker + ": financial source check unavailable or older than eight days; inspect original reporting periods");
  if (covered.length < scope.companies.length) warnings.push(`Usable recent prices: ${covered.length}/${scope.companies.length}; missing, invalid and stale prices must remain labeled`);
  if (scope.companies.length && covered.length < Math.ceil(scope.companies.length * .75)) errors.push("Fewer than 75% of tracked companies have a valid sourced quote within 96 hours");
  return { ok: !errors.length, errors, warnings, sourceCoverage: `${current.length}/${active.length} active`, contentChecks: audit.contentIssues, pausedSources: expected - active.length, discoveryCoverage: `${discoveryCurrent.length}/${discovery.length} current`, quoteCoverage: `${covered.length}/${scope.companies.length}` };
}
