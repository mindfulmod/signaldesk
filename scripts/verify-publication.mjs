import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { boundedJson } from "./lib/research-fetch.mjs";
import loader from "../research-loader.js";
export async function verifyPublication(expected, get, { attempts = 24, sleep = ms => new Promise(r => setTimeout(r, ms)), clock = Date.now, timeoutMs = 240000 } = {}) {
  const deadline = clock() + timeoutMs;
  let lastError = "";
  for (let i = 0; i < attempts; i++) {
    if (clock() >= deadline) break;
    try {
      const actual = await get();
      if (expected.collectionId ? actual.collectionId === expected.collectionId || Date.parse(actual.generatedAt) > Date.parse(expected.generatedAt) : actual.generatedAt === expected.generatedAt || Date.parse(actual.generatedAt) > Date.parse(expected.generatedAt)) return true;
    } catch (error) { lastError = String(error.message || "Publication unavailable").slice(0, 300); }
    if (i < attempts - 1) await sleep(Math.max(0, Math.min(10000, deadline - clock())));
  }
  throw new Error(`The refreshed snapshot did not reach the public site within the verification window. Check the Pages deployment; a successful collection is not publication.${lastError ? ` Last check: ${lastError}` : ""}`);
}
export async function verifyResearchPublication(expectedResearch, expectedMonitor, get, options = {}) {
  const clock = options.clock || Date.now;
  const expectedError = loader.validatePair(expectedResearch, expectedMonitor, clock());
  if (expectedError) throw new Error(`Cannot verify an invalid local research publication: ${expectedError}`);
  return verifyPublication(expectedResearch, async () => {
    const { research, monitor } = await get();
    const error = loader.validatePair(research, monitor, clock());
    if (error) throw new Error(error);
    if (Date.parse(monitor.generatedAt) < Date.parse(expectedMonitor.generatedAt)) throw new Error("Published source checks are older than the expected collection");
    return research;
  }, options);
}
async function main() {
  const name = process.argv[2];
  if (!["research", "signals"].includes(name)) throw new Error("Usage: node scripts/verify-publication.mjs research|signals");
  const expected = JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
  const readPublic = file => boundedJson(`https://mindfulmod.github.io/signaldesk/data/${file}.json?verify=${Date.now()}`);
  if (name === "research") {
    const expectedMonitor = JSON.parse(await readFile(new URL("../data/technology-monitor.json", import.meta.url), "utf8"));
    await verifyResearchPublication(expected, expectedMonitor, async () => {
      const [research, monitor] = await Promise.all([readPublic("research"), readPublic("technology-monitor")]);
      return { research, monitor };
    });
  } else await verifyPublication(expected, () => readPublic(name));
  console.log(`${name}: public snapshot verified`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(e => { console.error(e.message); process.exitCode = 1; });
