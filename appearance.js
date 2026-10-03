// Run synchronously in <head>: resolve the palette before styles/content paint.
// Appearance never depends on market data, a network request or writable storage.
(() => {
  const key = "signaldesk-theme-v1";
  const valid = value => ["light", "dark", "system"].includes(value) ? value : "system";
  let preference = "system", saved = true, control, revision = 0;
  let media;
  try { media = window.matchMedia("(prefers-color-scheme: dark)"); } catch { /* light fallback */ }
  try { preference = valid(localStorage.getItem(key)); } catch { saved = false; }

  function apply(announce = false) {
    const theme = preference === "system" ? (media?.matches ? "dark" : "light") : preference;
    // Switch text and surfaces together; hover color transitions otherwise
    // briefly leave dark text on the dark background (or pale text on white).
    if (document.documentElement.dataset.theme && document.documentElement.dataset.theme !== theme && window.requestAnimationFrame) {
      const current = ++revision;
      document.documentElement.dataset.themeChanging = "";
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        if (current === revision) delete document.documentElement.dataset.themeChanging;
      }));
    }
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    // Commit the no-transition style before restoring hover transitions, even
    // when the browser skips painting a background tab between animation frames.
    if ("themeChanging" in document.documentElement.dataset) void document.documentElement.offsetWidth;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f4f6f3" : "#1b242c");
    if (control) {
      control.value = preference;
      control.title = `${preference === "system" ? `System (${theme})` : theme === "light" ? "Light" : "Dark"} appearance${saved ? "" : " · this visit only"}`;
    }
    if (announce) {
      const status = document.getElementById("themeStatus");
      if (status) status.textContent = `${theme === "light" ? "Light" : "Dark"} theme${preference === "system" ? ", following your device" : ""}.${saved ? "" : " Browser storage is unavailable; your choice applies to this visit only."}`;
    }
  }
  apply();
  const systemChanged = () => { if (preference === "system") apply(true); };
  if (media?.addEventListener) media.addEventListener("change", systemChanged);
  else if (media?.addListener) media.addListener(systemChanged);
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue); apply(true);
  });
  function connect() {
    control = document.getElementById("themeSelect");
    if (!control) return;
    apply();
    control.addEventListener("change", () => {
      preference = valid(control.value);
      try { localStorage.setItem(key, preference); saved = true; } catch { saved = false; }
      apply(true);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", connect, { once: true });
  else connect();
})();
