import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import registry from "../technology-registry.js";
import model from "../technology-model.js";
import { collectTechnology, publicMonitor } from "./lib/technology-monitor.mjs";

export async function main(args = process.argv.slice(2)) {
  const errors = model.validate(registry);
  if (errors.length) throw new Error(errors.join("\n"));
  const outputArg = args.indexOf("--output");
  if (outputArg >= 0 && !args[outputArg + 1]) throw new Error("--output requires a directory");
  const output = resolve(outputArg >= 0 ? args[outputArg + 1] : new URL("../data/", import.meta.url).pathname);
  const statePath = resolve(output, "technology-monitor-state.json");
  let previous = {};
  try { previous = JSON.parse(await readFile(statePath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const state = await collectTechnology(registry, previous, { force: args.includes("--force") });
  const data = publicMonitor(state);
  for (const [name, content] of [
    ["technology-monitor-state.json", JSON.stringify(state, null, 2) + "\n"],
    ["technology-monitor.json", JSON.stringify(data, null, 2) + "\n"],
    ["technology-monitor.js", `window.SIGNALDESK_TECH_MONITOR = ${JSON.stringify(data)};\n`],
  ]) {
    const destination = resolve(output, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(`${destination}.tmp`, content);
    await rename(`${destination}.tmp`, destination);
  }
  const rows = Object.values(data.sources);
  console.log(`Technology monitor: ${rows.filter(s => s.status === "ok").length}/${rows.length} sources readable; ${data.events.length} unverified changes retained.`);
  for (const source of rows.filter(s => s.status === "error")) console.log(`${source.id}: ${source.error}`);
  return data;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
