import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { marketHealth } from "./market-health.mjs";
import { researchHealth } from "./research-health.mjs";

// Exactly the generated files each writer publishes. Null means no file-mode twin.
export const PUBLICATIONS = {
  market: {
    signals: "SIGNALDESK_DATA", history: "SIGNALDESK_HISTORY", ledger: "SIGNALDESK_LEDGER",
    "theme-registry": "SIGNALDESK_THEME_REGISTRY", springs: "SIGNALDESK_SPRINGS", themes: "SIGNALDESK_THEMES",
    "diffusion-map": "SIGNALDESK_DIFFUSION_MAP", "diffusion-state": null, "co-mention-history": null,
    clusters: "SIGNALDESK_CLUSTERS", leaders: "SIGNALDESK_LEADERS", "hot-monitor": "SIGNALDESK_HOT_MONITOR",
    "phrase-history": null, "phrase-radar": "SIGNALDESK_PHRASE_RADAR", "calibration-log": null,
    calibration: "SIGNALDESK_CALIBRATION", "alerts-log": "SIGNALDESK_ALERTS_LOG", "alerts-state": null,
  },
  research: {
    "technology-monitor-state": null, "technology-monitor": "SIGNALDESK_TECH_MONITOR",
    "company-intelligence": null, research: "SIGNALDESK_RESEARCH",
  },
};
export function publicationFiles(kind) {
  if (!PUBLICATIONS[kind]) throw Error("Unknown publication kind; use market or research");
  return Object.entries(PUBLICATIONS[kind]).flatMap(([name, binding]) =>
    [`data/${name}.json`, ...(binding ? [`data/${name}.js`] : [])]);
}
export function parseBundle(text, binding) {
  const match = String(text).match(/^\s*window\.([A-Z_]+)\s*=\s*([\s\S]*);\s*$/);
  if (!match || match[1] !== binding) throw Error("Unexpected file-mode assignment");
  // Never execute a generated JavaScript file to verify it.
  return JSON.parse(match[2]);
}
export async function validatePublication(kind, { read, now = Date.now(), scope } = {}) {
  publicationFiles(kind); // Refuse an unknown target before reading any file.
  const errors = [], files = [], inputs = {};
  async function inspectedRead(path) {
    const text = await read(path);
    files.push({ path, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") });
    return text;
  }
  for (const [name, binding] of Object.entries(PUBLICATIONS[kind])) {
    try {
      const json = JSON.parse(await inspectedRead(`data/${name}.json`));
      if (!json || typeof json !== "object" || Array.isArray(json)) throw Error("Expected a JSON object");
      if (["signals", "research", "technology-monitor"].includes(name)) inputs[name] = json;
      if (binding) {
        const bundle = parseBundle(await inspectedRead(`data/${name}.js`), binding);
        if (!isDeepStrictEqual(json, bundle)) throw Error("JSON and file-mode payloads disagree");
      }
    } catch (error) { errors.push(`${name}: ${error.message}`); }
  }
  let health;
  try {
    health = kind === "market" ? marketHealth(inputs.signals, now)
      : researchHealth(inputs.research, inputs["technology-monitor"], now, scope);
    errors.push(...health.errors);
  } catch (error) { errors.push(`Health validation failed: ${error.message}`); }
  return { schemaVersion: 1, kind, checkedAt: new Date(now).toISOString(), ok: errors.length === 0,
    decision: errors.length ? "hold-publication" : "eligible-for-publication", errors,
    warnings: health?.warnings || [], health: health || null, files,
    note: "Checks generated-file readability, file-mode parity and operational health contracts. Does not certify provider accuracy, source rights, adoption or investment returns. Failure must preserve the last published files and their original timestamps." };
}
