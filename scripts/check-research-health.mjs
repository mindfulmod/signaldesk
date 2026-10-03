import { readFile } from "node:fs/promises";
import { researchHealth } from "./lib/research-health.mjs";
import { boundedJson } from "./lib/research-fetch.mjs";
const live = process.argv.includes("--live");
const read = async name => live ? boundedJson(`https://mindfulmod.github.io/signaldesk/data/${name}.json?check=${Date.now()}`) : JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), "utf8"));
try {
  const [research, monitor] = await Promise.all([read("research"), read("technology-monitor")]);
  const result = researchHealth(research, monitor);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (e) { console.error(`Freshness check failed: ${e.message}`); process.exitCode = 1; }
