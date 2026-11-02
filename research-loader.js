(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_RESEARCH_LOADER = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  const records = value => Array.isArray(value) && value.every(object);
  function validatePair(research, monitor, now = Date.now()) {
    if (!object(research) || research.schemaVersion !== 1 || !records(research.documents) || !records(research.reviews) || !object(research.companies)) return "The research file is incomplete or invalid.";
    if (!object(monitor) || monitor.schemaVersion !== 1 || !records(monitor.events) || !object(monitor.sources) || !Object.values(monitor.sources).every(object)) return "The source-check file is incomplete or invalid.";
    const times = [research.generatedAt, research.sourceCheckedAt, monitor.generatedAt];
    if (times.some(value => typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10) || Date.parse(value) > now + 300000)) return "The saved publication dates are missing or invalid.";
    if (Date.parse(research.sourceCheckedAt) !== Date.parse(monitor.generatedAt) || Date.parse(research.generatedAt) < Date.parse(research.sourceCheckedAt)) return "Research and source checks belong to different updates. Publication may still be in progress.";
    return "";
  }
  function create({ read, onChange = () => {}, now = () => Date.now() }) {
    let state = { status: "idle", research: null, monitor: null, error: "", loadedAt: null }, inFlight = null;
    const notify = () => onChange({ ...state });
    function load() {
      if (inFlight) return inFlight;
      state = { ...state, status: "loading", error: "" };
      inFlight = Promise.resolve().then(async () => {
        const results = await Promise.allSettled(["research", "technology-monitor"].map(name => Promise.resolve().then(() => read(name))));
        const failed = results.map((r, i) => r.status === "rejected" ? (i ? "Source checks" : "Research") : null).filter(Boolean);
        const research = results[0].value, monitor = results[1].value;
        let error = failed.length ? `${failed.join(" and ")} could not be loaded.` : validatePair(research, monitor, now());
        if (!error && state.research && (Date.parse(research.generatedAt) < Date.parse(state.research.generatedAt) || Date.parse(monitor.generatedAt) < Date.parse(state.monitor.generatedAt))) error = "The server returned an older publication. The newer retained snapshot was kept.";
        // Commit the pair together. Never mix a newly published file with retained data.
        state = error ? { ...state, status: "error", error } : { status: "ready", research, monitor, error: "", loadedAt: new Date(now()).toISOString() };
        notify();
        return { ...state };
      }).finally(() => { inFlight = null; });
      notify();
      return inFlight;
    }
    return { load, get state() { return { ...state }; } };
  }
  return { create, validatePair };
});
