import { readFile, writeFile, rename, mkdir, open, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { refreshProcurementArchive, procurementHistorySummary } from "./lib/procurement-history.mjs";
async function readArchive(path) {
  try {
    if ((await stat(path)).size > 40000000) throw new Error("Procurement archive exceeds review-stage size limit");
    const archive = JSON.parse(await readFile(path, "utf8"));
    if (!archive || typeof archive !== "object" || Array.isArray(archive) || !Object.keys(archive).length) throw new Error("Invalid procurement archive contract");
    return archive;
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function main(args = process.argv.slice(2), options = {}) {
  const output = args.indexOf("--output"), previous = args.indexOf("--previous");
  if (!args.includes("--live") || output < 0 || !args[output + 1] || args[output + 1].startsWith("--")) throw new Error("Review-stage pilot: require --live --output /path/to/pilot.json; optional --previous /path/to/pilot.json. This does not enable scheduled collection.");
  const destination = resolve(args[output + 1]), publicData = resolve(new URL("../data", import.meta.url).pathname);
  if (destination === publicData || destination.startsWith(publicData + "/")) throw new Error("Pilot output must stay outside published data; production activation needs separate review.");
  if (previous >= 0 && (!args[previous + 1] || args[previous + 1].startsWith("--"))) throw new Error("--previous requires a file");
  await mkdir(dirname(destination), { recursive: true });
  const lockPath = `${destination}.lock`, temporary = `${destination}.${randomUUID()}.tmp`;
  const lock = await open(lockPath, "wx").catch(error => { if (error.code === "EEXIST") throw new Error("Procurement archive is locked; check the owning process before retrying or removing a stale lock"); throw error; });
  let state;
  try {
    const existing = await readArchive(destination);
    const priorPath = previous >= 0 ? resolve(args[previous + 1]) : destination;
    if (existing && priorPath !== destination) throw new Error("Cannot replace an existing archive with a different --previous file");
    const prior = priorPath === destination ? existing : await readArchive(priorPath);
    if (previous >= 0 && !prior) throw new Error("Previous procurement archive does not exist");
    state = await refreshProcurementArchive(prior || {}, options);
    const serialized = JSON.stringify(state, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 40000000) throw new Error("Procurement archive exceeds review-stage size limit; existing file retained");
    await writeFile(temporary, serialized, { flag: "wx" });
    await rename(temporary, destination);
  } finally {
    try { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
    finally { try { await lock.close(); } finally { await unlink(lockPath); } }
  }
  console.log(JSON.stringify({ status: state.status, output: destination, lastSuccessAt: state.lastSuccessAt || null, error: state.error,
    coverage: state.snapshot?.coverage || null, history: state.history ? procurementHistorySummary(state.history) : null,
    note: "Review-stage sample; not enabled in the app or scheduled workflows." }, null, 2));
  if (state.status !== "ok") process.exitCode = 1;
  return state;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
