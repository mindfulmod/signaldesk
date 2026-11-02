import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { validatePublication } from "./lib/publication-safety.mjs";

export async function main(args = process.argv.slice(2)) {
  const [kind, reportPath] = args;
  if (args.length > 2) throw Error("Usage: validate-publication.mjs market|research [report-path]");
  const report = await validatePublication(kind, { read: path => readFile(new URL(`../${path}`, import.meta.url), "utf8") });
  const json = JSON.stringify(report, null, 2) + "\n";
  if (reportPath) await writeFile(reportPath, json, { mode: 0o600 });
  console.log(json);
  return report.ok ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(`Publication held: ${error.message}`); process.exitCode = 1; });
}
