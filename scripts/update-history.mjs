import { readFile, writeFile, mkdir } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);
const SIGNALS = new URL("data/signals.json", ROOT);
const HISTORY = new URL("data/history.json", ROOT);
const HISTORY_JS = new URL("data/history.js", ROOT);
const RETENTION_DAYS = 120;

async function readJson(url, fallback) {
  try {
    return JSON.parse(await readFile(url, "utf8"));
  } catch {
    return fallback;
  }
}

async function main() {
  const current = await readJson(SIGNALS, null);
  if (!current?.signals?.length || current.dataMode !== "real-public-no-key") {
    console.warn("No usable current signal snapshot found; history unchanged.");
    return;
  }

  const previous = await readJson(HISTORY, { snapshots: [] });
  const existing = Array.isArray(previous.snapshots) ? previous.snapshots : [];
  const date = String(current.generatedAt || new Date().toISOString()).slice(0, 10);
  const daily = {
    date,
    generatedAt: current.generatedAt || new Date().toISOString(),
    signals: current.signals,
    events: current.events || [],
    failures: current.failures || [],
  };

  const snapshots = existing
    .filter((item) => item?.date && item.date !== date)
    .concat(daily)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-RETENTION_DAYS);

  const history = {
    dataMode: "real-public-no-key-history",
    updatedAt: daily.generatedAt,
    retentionDays: RETENTION_DAYS,
    sourceNote: "Daily real public no-key snapshots retained for range aggregation. Longer ranges become more complete as scheduled refreshes accumulate.",
    snapshots,
  };

  await mkdir(new URL("data/", ROOT), { recursive: true });
  const json = JSON.stringify(history, null, 2);
  await writeFile(HISTORY, `${json}\n`);
  await writeFile(HISTORY_JS, `window.SIGNALDESK_HISTORY = ${json};\n`);
  console.log(`History now contains ${snapshots.length} daily snapshots.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
