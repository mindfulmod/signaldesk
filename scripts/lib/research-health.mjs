import model from "../../research-model.js";
import config from "../../research-config.js";
export function researchHealth(research, monitor, now = Date.now(), scope = config) {
  const errors = [], warnings = [];
  if (model.freshness(research?.generatedAt, now, 36) !== "current") errors.push("Research publication is missing or more than 36 hours old");
  const states = Object.values(monitor?.sources || {}), expected = scope.sources.length;
  if (research?.coverage?.totalSources !== expected || scope.sources.some(s => !monitor?.sources?.[s.id])) errors.push("Published source coverage differs from configured sources");
  const active = scope.sources.filter(s => s.accessStatus !== "permission-required"), activeIds = new Set(active.map(s => s.id));
  const current = states.filter(s => activeIds.has(s.id) && s.status === "ok" && model.freshness(s.lastSuccessAt, now, 36) === "current");
  if (!active.length || states.length !== expected || current.length < Math.ceil(active.length * .8)) errors.push(`Only ${current.length}/${active.length} active sources passed a check in the last 36 hours (target: at least 80%)`);
  for (const s of states.filter(s => activeIds.has(s.id) && !current.includes(s))) warnings.push(`${s.id}: ${s.error || "Source check overdue"}`);
  for (const s of scope.sources.filter(s => !activeIds.has(s.id))) warnings.push(`${s.id}: intentionally paused pending permission review; retained records are historical`);
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
  const companies = Object.values(research?.companies || {}), covered = companies.filter(c => model.freshness(c.quote?.asOf, now, 96) === "current");
  if (!companies.length || companies.length !== scope.companies.length || scope.companies.some(c => !research?.companies?.[c.ticker])) errors.push("Permanent company universe is incomplete");
  for (const [ticker, company] of Object.entries(research?.companies || {})) if (company.factsError || model.freshness(company.factsCheckedAt, now, 192) !== "current") warnings.push(ticker + ": financial source check unavailable or older than eight days; inspect original reporting periods");
  if (covered.length < companies.length) warnings.push(`Recent prices: ${covered.length}/${companies.length}; missing/stale prices must remain labeled`);
  if (companies.length && covered.length < Math.ceil(companies.length * .75)) errors.push("Fewer than 75% of tracked companies have a quote within 96 hours");
  return { ok: !errors.length, errors, warnings, sourceCoverage: `${current.length}/${active.length} active`, pausedSources: expected - active.length, discoveryCoverage: `${discoveryCurrent.length}/${discovery.length} current`, quoteCoverage: `${covered.length}/${companies.length}` };
}
