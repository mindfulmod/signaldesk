import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { refreshProcurement } from "./lib/procurement-pilot.mjs";
export async function main(args = process.argv.slice(2)) {
  const output = args.indexOf("--output"), previous = args.indexOf("--previous");
  if (!args.includes("--live") || output < 0 || !args[output + 1] || args[output + 1].startsWith("--")) throw new Error("Review-stage pilot: require --live --output /path/to/pilot.json; optional --previous /path/to/pilot.json. This does not enable scheduled collection.");
  const destination = resolve(args[output + 1]), publicData = resolve(new URL("../data", import.meta.url).pathname);
  if (destination === publicData || destination.startsWith(publicData + "/")) throw new Error("Pilot output must stay outside published data; production activation needs separate review.");
  if (previous >= 0 && (!args[previous + 1] || args[previous + 1].startsWith("--"))) throw new Error("--previous requires a file");
  const prior = previous >= 0 ? JSON.parse(await readFile(resolve(args[previous + 1]), "utf8")) : {};
  const state = await refreshProcurement(prior);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(`${destination}.tmp`, JSON.stringify(state, null, 2) + "\n");
  await rename(`${destination}.tmp`, destination);
  console.log(JSON.stringify({ status: state.status, output: destination, lastSuccessAt: state.lastSuccessAt || null, error: state.error,
    coverage: state.snapshot?.coverage || null, note: "Review-stage sample; not enabled in the app or scheduled workflows." }, null, 2));
  if (state.status !== "ok") process.exitCode = 1;
  return state;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
