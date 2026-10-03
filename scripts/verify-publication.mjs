import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedJson } from "./lib/research-fetch.mjs";
export async function verifyPublication(expected, get, { attempts = 24, sleep = ms => new Promise(r => setTimeout(r, ms)), clock = Date.now, timeoutMs = 240000 } = {}) {
  const deadline = clock() + timeoutMs;
  for (let i = 0; i < attempts; i++) {
    if (clock() >= deadline) break;
    try {
      const actual = await get();
      if (expected.collectionId ? actual.collectionId === expected.collectionId || Date.parse(actual.generatedAt) > Date.parse(expected.generatedAt) : actual.generatedAt === expected.generatedAt || Date.parse(actual.generatedAt) > Date.parse(expected.generatedAt)) return true;
    } catch { /* Deploy propagation may temporarily return 404. */ }
    if (i < attempts - 1) await sleep(Math.max(0, Math.min(10000, deadline - clock())));
  }
  throw new Error("The refreshed snapshot did not reach the public site within four minutes. Check the Pages deployment; a successful collection is not publication.");
}
async function main() {
  const name = process.argv[2];
  if (!["research", "signals"].includes(name)) throw new Error("Usage: node scripts/verify-publication.mjs research|signals");
  const expected = JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
  await verifyPublication(expected, () => boundedJson(`https://mindfulmod.github.io/signaldesk/data/${name}.json?verify=${Date.now()}`));
  console.log(`${name}: public snapshot verified`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
