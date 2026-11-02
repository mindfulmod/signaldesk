(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SIGNALDESK_HISTORY_LOADER = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function valid(data) {
    return data?.dataMode === "real-public-no-key-history" && typeof data.updatedAt === "string"
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(data.updatedAt)
      && Number.isFinite(Date.parse(data.updatedAt)) && new Date(data.updatedAt).toISOString().slice(0, 10) === data.updatedAt.slice(0, 10)
      && Array.isArray(data.snapshots) && data.snapshots.every(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date)
        && Number.isFinite(Date.parse(row.date)) && new Date(row.date).toISOString().slice(0, 10) === row.date
        && Array.isArray(row.signals) && row.signals.every(item => item && typeof item.ticker === "string"));
  }
  function create({ read, onChange = () => {}, timeoutMs = 30000 }) {
    let state = { status: "idle", data: null, error: "" }, pending = null;
    function load(force = false) {
      if (pending) return pending;
      if (!force && state.status === "ready") return Promise.resolve({ ...state });
      const controller = new AbortController();
      let timer;
      state = { ...state, status: "loading", error: "" };
      pending = Promise.resolve().then(async () => {
        try {
          const data = await Promise.race([
            Promise.resolve().then(() => read(controller.signal)),
            new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error("History download timed out.")); }, timeoutMs); }),
          ]);
          if (!valid(data)) throw Error("The saved history file is incomplete or invalid.");
          if (state.data && Date.parse(data.updatedAt) < Date.parse(state.data.updatedAt)) throw Error("The server returned older history; the loaded archive was retained.");
          state = { status: "ready", data, error: "" };
        } catch (error) {
          state = { ...state, status: "error", error: error.message || "History could not be loaded." };
        } finally { clearTimeout(timer); }
        onChange({ ...state });
        return { ...state };
      }).finally(() => { pending = null; });
      onChange({ ...state });
      return pending;
    }
    return { load, get state() { return { ...state }; } };
  }
  return { create, valid };
});
