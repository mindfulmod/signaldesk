import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import registry from "../technology-registry.js";
import config from "../research-config.js";
import model from "../technology-model.js";
import reviewModel from "../research-model.js";
import { collectTechnology, publicMonitor } from "./lib/technology-monitor.mjs";
import { buildDocuments, discoverTopics } from "./lib/research-intelligence.mjs";
import { collectCompanies } from "./lib/company-intelligence.mjs";

async function saved(path, fallback = {}) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return fallback; throw e; }
}

export async function main(args = process.argv.slice(2)) {
  const errors = model.validate(registry);
  if (errors.length) throw new Error(errors.join("\n"));
  const outputArg = args.indexOf("--output");
  if (outputArg >= 0 && !args[outputArg + 1]) throw new Error("--output requires a directory");
  const output = resolve(outputArg >= 0 ? args[outputArg + 1] : new URL("../data/", import.meta.url).pathname);
  const statePath = resolve(output, "technology-monitor-state.json");
  const [previous, previousResearch, previousCompanies, reviews] = await Promise.all([
    saved(statePath), saved(resolve(output, "research.json")), saved(resolve(output, "company-intelligence.json")),
    saved(new URL("../research-reviews.json", import.meta.url), { schemaVersion: 1, reviews: [] }),
  ]);
  const known = registry.themes.flatMap(t => t.evidence.map(e => e.id));
  const evidence = registry.themes.flatMap(t => t.evidence.map(e => ({ ...e, themeId: t.id })));
  for (const review of reviews.reviews) {
    const problems = reviewModel.validateReview(review, { themeIds: registry.themes.map(t => t.id), knownIds: known, evidence, config });
    if (problems.length) throw new Error(`Invalid published review ${review.id}: ${problems.join("; ")}`);
    if (known.includes(review.id)) throw new Error(`Duplicate published review ${review.id}`);
    known.push(review.id);
    evidence.push(review);
  }
  const now = new Date().toISOString();
  const state = await collectTechnology(registry, previous, { now, force: args.includes("--force"), retryErrors: args.includes("--retry-errors") });
  const data = publicMonitor(state);
  const documents = buildDocuments(registry, state, previousResearch, now);
  const companies = args.includes("--sources-only") ? previousCompanies : await collectCompanies(config, state, previousCompanies, { now, apiKey: process.env.SIGNALDESK_QUOTE_API_KEY || "" });
  const research = { schemaVersion: 1, collectionId: randomUUID(), generatedAt: now, sourceCheckedAt: data.generatedAt,
    runUrl: process.env.GITHUB_RUN_ID ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    documents, reviews: reviews.reviews, companies: companies.companies || {}, providerMode: companies.providerMode || "Not collected",
    discovery: discoverTopics(documents, registry.themes, previousResearch.discovery, now, config.sources.filter(s => s.discovery), state.sources),
    coverage: { totalSources: config.sources.length, readableSources: Object.values(data.sources).filter(s => s.status === "ok").length, companies: config.companies.length },
  };
  for (const [name, content] of [
    ["technology-monitor-state.json", JSON.stringify(state, null, 2) + "\n"],
    ["technology-monitor.json", JSON.stringify(data, null, 2) + "\n"],
    ["technology-monitor.js", `window.SIGNALDESK_TECH_MONITOR = ${JSON.stringify(data)};\n`],
    ["company-intelligence.json", JSON.stringify(companies, null, 2) + "\n"],
    ["research.json", JSON.stringify(research, null, 2) + "\n"],
    ["research.js", `window.SIGNALDESK_RESEARCH = ${JSON.stringify(research)};\n`],
  ]) {
    const destination = resolve(output, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(`${destination}.tmp`, content);
    await rename(`${destination}.tmp`, destination);
  }
  const rows = Object.values(data.sources);
  console.log(`Technology monitor: ${rows.filter(s => s.status === "ok").length}/${rows.length} sources readable; ${data.events.length} unverified changes retained.`);
  for (const source of rows.filter(s => s.status === "error")) console.log(`${source.id}: ${source.error}`);
  console.log(`Research: ${documents.length} unreviewed document versions, ${research.discovery.candidates.length} discovery leads, ${Object.keys(research.companies).length}/${config.companies.length} permanent company records.`);
  for (const error of companies.errors || []) console.log(error);
  return research;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
