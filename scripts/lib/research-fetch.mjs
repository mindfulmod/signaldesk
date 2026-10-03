export async function boundedJson(url, { fetchImpl = fetch, headers = {}, maxBytes = 12000000, timeoutMs = 15000 } = {}) {
  const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) { await r.body?.cancel(); throw new Error(`HTTP ${r.status}`); }
  if (!/json/i.test(r.headers.get("content-type") || "")) { await r.body?.cancel(); throw new Error("Expected JSON response"); }
  if (Number(r.headers.get("content-length")) > maxBytes) { await r.body?.cancel(); throw new Error("Response size limit"); }
  const parts = []; let size = 0;
  for await (const part of r.body) { size += part.byteLength; if (size > maxBytes) throw new Error("Response size limit"); parts.push(part); }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
