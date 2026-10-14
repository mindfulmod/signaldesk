(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_DISCOVERY_NOTEBOOK = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const limits = { plans: 25, observations: 40 };
  const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const url = value => { try { const u = new URL(value); return typeof value === "string" && value.length <= 2048 && u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443"); } catch { return false; } };
  const text = (value, min, max) => typeof value === "string" && value.trim().length >= min && value.length <= max;
  const id = value => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
  function validateObservation(o, today = new Date().toISOString().slice(0, 10)) {
    if (!o || typeof o !== "object") return ["Observation must be an object"];
    const errors = [];
    if (!id(o.id)) errors.push("Observation ID is invalid");
    if (!["reported", "lower-bound", "target"].includes(o.qualifier)) errors.push("Choose reported, lower bound or target");
    if (!Number.isFinite(o.value) || o.value < 0) errors.push("Enter a nonnegative numeric value; zero is valid");
    if (!day(o.periodEnd) || (o.qualifier !== "target" && o.periodEnd > today)) errors.push("Reported period must be a valid date, not in the future");
    if (!day(o.publishedAt) || o.publishedAt > today) errors.push("Source publication date must be valid and not in the future");
    if (o.qualifier !== "target" && day(o.periodEnd) && o.periodEnd > o.publishedAt) errors.push("Reported period cannot end after the source publication");
    if (!url(o.url)) errors.push("Provide an HTTPS source URL without credentials");
    if (!text(o.owner, 1, 160)) errors.push("Name the reporting owner");
    if (!text(o.caveat, 10, 1200)) errors.push("Describe conditions or limitations (at least 10 characters)");
    if (!text(o.recordedAt, 1, 40) || !Number.isFinite(Date.parse(o.recordedAt)) || Date.parse(o.recordedAt) >= Date.parse(today) + 86400000) errors.push("Observation recording date is invalid");
    if (o.withdrawn !== undefined && typeof o.withdrawn !== "boolean") errors.push("Invalid withdrawal state");
    return errors;
  }
  function validatePlan(p, today = new Date().toISOString().slice(0, 10)) {
    if (!p || typeof p !== "object") return ["Investigation must be an object"];
    const errors = [];
    if (!id(p.id)) errors.push("Investigation ID is invalid");
    for (const [key, min, max] of [["title", 3, 220], ["hypothesis", 10, 1500], ["metric", 3, 160], ["unit", 1, 80], ["scope", 10, 1200], ["nextCheck", 10, 1200]]) if (!text(p[key], min, max)) errors.push(`${key} needs ${min}–${max} characters`);
    if (!["watching", "paused", "closed"].includes(p.status)) errors.push("Choose an investigation status");
    if (!day(p.reviewOn)) errors.push("Choose a valid next review date");
    for (const field of ["createdAt", "updatedAt"]) if (!text(p[field], 1, 40) || !Number.isFinite(Date.parse(p[field])) || Date.parse(p[field]) >= Date.parse(today) + 86400000) errors.push(`${field} is invalid`);
    if (Date.parse(p.createdAt) > Date.parse(p.updatedAt)) errors.push("Investigation update cannot predate creation");
    if (!Array.isArray(p.origins) || !p.origins.length || p.origins.length > 6 || p.origins.some(s => !s || !id(s.id) || !text(s.title, 1, 500) || !text(s.owner, 1, 160) || !url(s.url) || (s.publishedAt !== null && (!text(s.publishedAt, 1, 40) || !Number.isFinite(Date.parse(s.publishedAt)))))) errors.push("Investigation needs valid source-link metadata");
    if (!Array.isArray(p.observations) || p.observations.length > limits.observations) errors.push(`At most ${limits.observations} observations per investigation`);
    else {
      if (new Set(p.observations.map(o => o?.id)).size !== p.observations.length) errors.push("Observation IDs must be unique");
      for (const o of p.observations) {
        errors.push(...validateObservation(o, today));
        if (p.unit === "%" && o?.value > 100) errors.push("Percentage observations cannot exceed 100");
        if (o && Date.parse(o.recordedAt) > Date.parse(p.updatedAt)) errors.push("Investigation update must include the latest recorded observation");
      }
    }
    return [...new Set(errors)];
  }
  function seed(leadId, research, now = new Date().toISOString()) {
    const topic = [...(research?.discovery?.candidates || []), ...(research?.discovery?.archive || [])].find(c => c.id === leadId);
    const ids = leadId.startsWith("story:") ? [leadId.slice(6)] : topic?.documentIds || [];
    const origins = ids.map(id => research?.documents?.find(d => d.id === id)).filter(d => d && url(d.url)).slice(0, 6).map(d => ({ id: d.id, title: d.title, owner: d.owner, url: d.url, publishedAt: d.publishedAt || null }));
    if (!origins.length) return null;
    return { id: leadId, title: topic?.phrase || origins[0].title, hypothesis: "", metric: "", unit: "", scope: "", nextCheck: "", reviewOn: "", status: "watching", createdAt: now, updatedAt: now, origins, observations: [] };
  }
  function updatePlan(old, fields, now = new Date().toISOString()) {
    const next = { ...old, ...Object.fromEntries(["title", "hypothesis", "metric", "unit", "scope", "nextCheck", "reviewOn", "status"].map(k => [k, typeof fields[k] === "string" ? fields[k].trim() : old[k]])), updatedAt: now };
    if (old.observations.length && ["metric", "unit", "scope"].some(k => old[k] !== next[k])) throw new Error("Metric, unit and scope are fixed once observations exist. Start a separate investigation for a different series.");
    const errors = validatePlan(next, now.slice(0, 10));
    if (errors.length) throw new Error(errors.join(". "));
    return next;
  }
  function addObservation(plan, observation, now = new Date().toISOString()) {
    const next = { ...plan, updatedAt: now, observations: [...plan.observations, observation] };
    const errors = validatePlan(next, now.slice(0, 10));
    if (errors.length) throw new Error(errors.join(". "));
    return next;
  }
  function importBundle(raw, existing = [], today = new Date().toISOString().slice(0, 10)) {
    if (typeof raw !== "string" || raw.length > 8_000_000) throw new Error("Backup must be JSON under 8 MB");
    const data = JSON.parse(raw);
    if (data?.schemaVersion !== 1 || data?.kind !== "signaldesk-investigations" || !Array.isArray(data.plans)) throw new Error("Not a SignalDesk investigation backup");
    if (data.plans.length > limits.plans || new Set(data.plans.map(p => p?.id)).size !== data.plans.length) throw new Error("Too many investigations or duplicate IDs");
    const all = new Map(existing.map(p => [p.id, p]));
    for (const p of data.plans) {
      const errors = validatePlan(p, today); if (errors.length) throw new Error(errors.join(". "));
      const old = all.get(p.id);
      if (old && JSON.stringify(old) !== JSON.stringify(p)) throw new Error(`A different version of “${old.title}” already exists. No investigations were changed.`);
      all.set(p.id, p);
    }
    if (all.size > limits.plans) throw new Error(`At most ${limits.plans} investigations can be stored`);
    return [...all.values()];
  }
  const bundle = plans => ({ schemaVersion: 1, kind: "signaldesk-investigations", exportedAt: new Date().toISOString(), note: "Personal, manually entered research. Not published verification, automatic monitoring or investment advice.", plans });
  function createStorageSession(getStorage, today = new Date().toISOString().slice(0, 10)) {
    const key = "signaldesk-investigations-v1";
    let last = null, plans = [], issue = "", volatile = false;
    try { last = getStorage().getItem(key); if (last) plans = importBundle(last, [], today); }
    catch { issue = "The saved notebook could not be loaded and has been left untouched. New investigations work for this session only; export them before leaving."; }
    return {
      initialPlans: plans,
      get issue() { return issue; },
      get hasUnpersistedChanges() { return volatile; },
      shouldWarnBeforeUnload(pendingEdits = false) { return Boolean(pendingEdits || volatile); },
      save(next) {
        // Saving a form is not proof of durable storage. Keep this flag until an
        // actual write is read back; merely requesting an export cannot clear it.
        volatile = true;
        if (issue) return false;
        try {
          const storage = getStorage();
          if (storage.getItem(key) !== last) { issue = "Another tab changed this notebook. Its data has not been overwritten. Your changes are session-only; export them before reloading."; return false; }
          const raw = JSON.stringify(bundle(next));
          storage.setItem(key, raw);
          if (storage.getItem(key) !== raw) throw new Error("Notebook write could not be verified");
          last = raw; volatile = false; return true;
        } catch { issue = "Notebook storage is unavailable or full. These changes are session-only. Export your backup before leaving."; return false; }
      }
    };
  }
  const due = (p, today = new Date().toISOString().slice(0, 10)) => p.status === "watching" && day(p.reviewOn) && p.reviewOn <= today;
  return { limits, validatePlan, validateObservation, seed, updatePlan, addObservation, importBundle, bundle, createStorageSession, due };
});
