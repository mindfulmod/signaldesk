// Search saved research only. Ranking is text relevance, never investment merit.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_RESEARCH_SEARCH = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const normalize = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = value => { try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") ? u.href : ""; } catch { return ""; } };
  const publicationDate = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return "";
    const day = value.slice(0, 10), parsed = new Date(day);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : "";
  };
  function index({ themes = [], companies = [], sources = [], research = null } = {}) {
    const rows = [];
    const add = row => rows.push({ ...row, terms: normalize(`${row.title} ${row.keywords || ""}`).split(/\s+/) });
    themes.forEach(t => add({ type: "Technology", id: t.id, title: t.name, meta: "Open technology profile", keywords: [t.sector, ...(t.aliases || [])].join(" ") }));
    companies.forEach(c => add({ type: "Company", id: c.ticker, title: `${c.name} · ${c.ticker}`, exact: c.ticker, meta: "Open permanent company coverage", keywords: c.role }));
    sources.forEach(s => { const url = safeUrl(s.documentationUrl || s.url); if (url) add({ type: "Source", id: s.id, title: s.name, url, meta: `${s.owner} · ${s.accessStatus === "permission-required" ? "Automatic collection paused" : "Source website"}`, keywords: `${s.owner} ${s.purpose || ""}` }); });
    const latest = new Map();
    for (const d of research?.documents || []) {
      const url = safeUrl(d.url); if (!url || !d.title) continue;
      const key = `${d.sourceId}|${url}`, old = latest.get(key);
      if (!old || String(d.detectedAt || "") > String(old.detectedAt || "")) latest.set(key, d);
    }
    for (const d of latest.values()) {
      const published = publicationDate(d.publishedAt);
      const url = safeUrl(d.url), location = new URL(url);
      add({ type: "Document", id: d.id, title: d.title, url, published, location: `${location.hostname}${location.pathname}${location.search}`, meta: `${d.owner || "Source owner unknown"} · ${published ? `Published ${published}` : "Publication date unknown"}`, keywords: `${d.owner || ""} ${d.sourceId || ""} ${location.pathname}` });
    }
    return rows;
  }
  function search(rows, query) {
    const q = normalize(String(query || "").slice(0, 120)), tokens = q.split(/\s+/).filter(Boolean);
    if (!tokens.length) return { groups: [{ type: "Technology", total: rows.filter(r => r.type === "Technology").length, rows: rows.filter(r => r.type === "Technology").slice(0, 5) }], total: 0, suggested: true };
    const matches = rows.filter(r => tokens.every(t => r.terms.some(word => t.length < 3 ? word === t : word.startsWith(t))));
    const score = r => normalize(r.exact) === q ? 100 : normalize(r.title) === q ? 80 : normalize(r.title).startsWith(q) ? 40 : 0;
    const groups = ["Technology", "Company", "Document", "Source"].map(type => {
      const found = matches.filter(r => r.type === type).sort((a, b) => (type === "Document" ? b.published.localeCompare(a.published) : 0) || score(b) - score(a) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
      return { type, total: found.length, rows: found.slice(0, type === "Document" ? 6 : 4) };
    }).filter(g => g.total);
    return { groups, total: matches.length, suggested: false };
  }
  function markup(result, { canNavigate = true } = {}) {
    const plural = { Technology: "Technologies", Company: "Companies", Document: "Documents", Source: "Sources" };
    return result.groups.map(group => `<section><h3>${result.suggested ? "Explore technologies" : `${esc(group.total === 1 ? group.type : plural[group.type])} · ${group.total}`}${group.type === "Document" ? " · newest published first; undated last" : ""}</h3>${group.rows.map(r => {
      const inner = `<strong>${esc(r.title)}</strong><span>${esc(r.meta)}${r.url ? " · opens a new tab ↗" : ""}</span>${r.location ? `<span class="intel-find-location">${esc(r.location)}</span>` : ""}`;
      if (r.url) return `<a class="intel-find-result" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
      return `<button type="button" class="intel-find-result" data-${r.type === "Company" ? "open-company" : "open-tech"}="${esc(r.id)}"${canNavigate ? "" : " disabled"}>${inner}</button>`;
    }).join("")}${group.total > group.rows.length ? `<p class="tech-meta">Showing ${group.rows.length} of ${group.total}. Add another word to narrow the search.</p>` : ""}</section>`).join("") || '<p class="intel-find-empty">No matches in the loaded research. Try a company name, ticker or fewer words. This is not a search of the whole market.</p>';
  }
  function create({ dialog, trigger, snapshot, canNavigate = () => true, notice = () => {} }) {
    if (!dialog || !trigger) return null;
    const input = dialog.querySelector("input"), results = dialog.querySelector("[data-find-results]"), status = dialog.querySelector("[data-find-status]"), context = dialog.querySelector("[data-find-context]");
    let rows = [], origin = null;
    function restore() { const target = origin; origin = null; if (target?.isConnected) target.focus({ preventScroll: true }); }
    function close(restoreFocus = true) { if (!restoreFocus) origin = null; if (dialog.open) dialog.close(); if (restoreFocus) restore(); }
    function render() {
      const result = search(rows, input.value);
      results.innerHTML = markup(result, { canNavigate: canNavigate() });
      status.textContent = result.suggested ? "Type to find a technology, company or source document." : `${result.total} matching ${result.total === 1 ? "record" : "records"}. Results are text matches, not recommendations.`;
    }
    function open() {
      if (dialog.open) { input.focus(); return; }
      if (!dialog.showModal) { notice("Research search is unavailable in this browser. Use the section tabs and their filters."); return; }
      const data = snapshot(); rows = index(data); origin = trigger; input.value = "";
      context.textContent = `${data.research ? "Searches loaded profiles, source names and document titles—not the live web." : "Documents have not loaded. Profiles and sources are available; reopen after research loads."}${canNavigate() ? "" : " Save or cancel your open review before switching profiles. Source links open separately."}`;
      render();
      try { dialog.showModal(); input.focus(); } catch { restore(); notice("Search could not open. Use the section tabs and filters."); }
    }
    trigger.addEventListener("click", open);
    input.addEventListener("input", render);
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    dialog.addEventListener("close", () => { if (!dialog.open) restore(); });
    dialog.addEventListener("click", event => { if (event.target.closest("[data-find-close]")) close(); });
    dialog.addEventListener("keydown", event => {
      // Search inputs consume Escape to clear text in some browsers. The modal
      // has one consistent cancel action regardless of whether a query exists.
      if (event.key === "Escape" && !event.isComposing) { event.preventDefault(); close(); return; }
      if (event.key === "Tab") {
        const controls = [...dialog.querySelectorAll("button:not(:disabled), input, a[href]")];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && event.target === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && event.target === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.isComposing || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
      const items = [...results.querySelectorAll("a, button:not(:disabled)")]; if (!items.length) return;
      if (event.target !== input && !items.includes(event.target)) return;
      event.preventDefault();
      const i = items.indexOf(event.target), next = event.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
      items[next].focus();
    });
    return { close, open };
  }
  return { index, search, markup, create };
});
