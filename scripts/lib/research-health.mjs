import model from "../../research-model.js";
import config from "../../research-config.js";
export function researchHealth(research, monitor, now = Date.now(), scope = config) {
  const errors = [], warnings = [];
  if (model.freshness(research?.generatedAt, now, 36) !== "current") errors.push("Research publication is missing or more than 36 hours old");
  const states = Object.values(monitor?.sources || {}), expected = scope.sources.length;
  if (research?.coverage?.totalSources !== expected || scope.sources.some(s => !monitor?.sources?.[s.id])) errors.push("Published source coverage differs from configured sources");
  const current = states.filter(s => s.status === "ok" && model.freshness(s.lastSuccessAt, now, 36) === "current");
  if (!expected || states.length !== expected || current.length < Math.ceil(expected * .8)) errors.push(`Only ${current.length}/${expected} configured sources passed a check in the last 36 hours (target: at least 80%)`);
  for (const s of states.filter(s => !current.includes(s))) warnings.push(`${s.id}: ${s.error || "Source check overdue"}`);
  const companies = Object.values(research?.companies || {}), covered = companies.filter(c => model.freshness(c.quote?.asOf, now, 96) === "current");
  if (!companies.length || companies.length !== scope.companies.length || scope.companies.some(c => !research?.companies?.[c.ticker])) errors.push("Permanent company universe is incomplete");
  for (const [ticker, company] of Object.entries(research?.companies || {})) if (company.factsError || model.freshness(company.factsCheckedAt, now, 192) !== "current") warnings.push(ticker + ": financial source check unavailable or older than eight days; inspect original reporting periods");
  if (covered.length < companies.length) warnings.push(`Recent prices: ${covered.length}/${companies.length}; missing/stale prices must remain labeled`);
  if (companies.length && covered.length < Math.ceil(companies.length * .75)) errors.push("Fewer than 75% of tracked companies have a quote within 96 hours");
  return { ok: !errors.length, errors, warnings, sourceCoverage: `${current.length}/${expected}`, quoteCoverage: `${covered.length}/${companies.length}` };
}
