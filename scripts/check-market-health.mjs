import { readFile } from "node:fs/promises";
import { boundedJson } from "./lib/research-fetch.mjs";
import { marketHealth } from "./lib/market-health.mjs";
try {
  const snapshot = process.argv.includes("--live")
    ? await boundedJson(`https://mindfulmod.github.io/signaldesk/data/signals.json?check=${Date.now()}`)
    : JSON.parse(await readFile(new URL("../data/signals.json", import.meta.url), "utf8"));
  const result = marketHealth(snapshot);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} catch (error) { console.error(`Market health check failed: ${error.message}`); process.exitCode = 1; }
