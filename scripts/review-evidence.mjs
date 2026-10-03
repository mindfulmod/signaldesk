// A review export does not publish itself. Validate and append it, then use normal Git review.
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import registry from "../technology-registry.js";
import model from "../research-model.js";
import config from "../research-config.js";
export function appendReviews(bundle, incoming, documents, themes = registry.themes) {
  const reviews = [...bundle.reviews], known = new Set([...reviews.map(r => r.id), ...themes.flatMap(t => t.evidence.map(e => e.id))]);
  for (const review of incoming) {
    const duplicate = reviews.find(r => r.id === review.id);
    if (duplicate) { if (JSON.stringify(duplicate) !== JSON.stringify(review)) throw new Error("Published review IDs are immutable; append a correction instead"); continue; }
    const errors = model.validateReview(review, { themeIds: themes.map(t => t.id), knownIds: [...known], documents, config, evidence: [...themes.flatMap(t => t.evidence.map(e => ({ ...e, themeId: t.id }))), ...reviews] });
    if (!documents.some(d => d.id === review.candidateId)) errors.push("Candidate not found in collection; refresh or review its replacement");
    if (review.supersedes) {
      const oldTheme = reviews.find(r => r.id === review.supersedes)?.themeId || themes.find(t => t.evidence.some(e => e.id === review.supersedes))?.id;
      if (oldTheme !== review.themeId) errors.push("A correction must stay in the original technology");
      if (reviews.some(r => r.decision === "accepted" && r.supersedes === review.supersedes)) errors.push("This evidence was already corrected; supersede its current revision");
    }
    if (errors.length) throw new Error(`${review.id || "Review"}: ${errors.join("; ")}`);
    reviews.push(review); known.add(review.id);
  }
  return { schemaVersion: 1, reviews };
}
async function main() {
  const input = process.argv[2]; if (!input) throw new Error("Usage: node scripts/review-evidence.mjs /path/to/review-export.json");
  const root = new URL("../", import.meta.url);
  const [bundle, incoming, research] = await Promise.all(["research-reviews.json", resolve(input), "data/research.json"].map(p => readFile(p.startsWith("/") ? p : new URL(p, root), "utf8").then(JSON.parse)));
  const updated = appendReviews(bundle, incoming.reviews || [], research.documents || []);
  const path = new URL("research-reviews.json", root), temp = new URL("research-reviews.json.tmp", root);
  await writeFile(temp, JSON.stringify(updated, null, 2) + "\n"); await rename(temp, path);
  console.log(`Validated ${updated.reviews.length - bundle.reviews.length} new reviews. Run the research collector, inspect the diff, then commit for publication.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
