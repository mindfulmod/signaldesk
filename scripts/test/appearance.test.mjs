import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../appearance.js", import.meta.url), "utf8");
const css = await readFile(new URL("../../appearance.css", import.meta.url), "utf8");
const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const key = "signaldesk-theme-v1";

function boot({ stored = null, dark = false, storageFails = false, mediaFails = false } = {}) {
  const root = { dataset: {}, style: {} }, control = { value: "", title: "" }, status = { textContent: "" }, meta = {};
  const domEvents = {}, windowEvents = {}, controlEvents = {}, mediaEvents = {}, frames = [];
  const store = new Map(stored === null ? [] : [[key, stored]]);
  const media = { matches: dark, addEventListener: (event, fn) => { mediaEvents[event] = fn; } };
  control.addEventListener = (event, fn) => { controlEvents[event] = fn; };
  const context = {
    document: { documentElement: root, readyState: "loading", querySelector: () => ({ setAttribute: (k, v) => { meta[k] = v; } }), getElementById: id => id === "themeSelect" ? control : id === "themeStatus" ? status : null, addEventListener: (event, fn) => { domEvents[event] = fn; } },
    localStorage: { getItem: k => { if (storageFails) throw new Error("blocked"); return store.get(k); }, setItem: (k, v) => { if (storageFails) throw new Error("blocked"); store.set(k, v); } },
    window: { matchMedia: () => { if (mediaFails) throw new Error("unsupported"); return media; }, addEventListener: (event, fn) => { windowEvents[event] = fn; }, requestAnimationFrame: fn => { frames.push(fn); } },
  };
  vm.runInNewContext(source, context);
  return { root, control, status, meta, store, frame: () => { frames.splice(0).forEach(fn => fn()); }, connect: () => domEvents.DOMContentLoaded(), choose: value => { control.value = value; controlEvents.change(); }, system: value => { media.matches = value; mediaEvents.change(); }, storage: event => windowEvents.storage(event) };
}

test("appearance is resolved before DOM readiness and follows the device by default", () => {
  for (const dark of [true, false]) {
    const app = boot({ dark });
    assert.equal(app.root.dataset.theme, dark ? "dark" : "light");
    assert.equal(app.root.style.colorScheme, app.root.dataset.theme);
    app.connect(); assert.equal(app.control.value, "system");
    assert.equal(app.meta.content, dark ? "#1b242c" : "#f4f6f3");
  }
});

test("an explicit theme persists and overrides device changes until System is selected", () => {
  const app = boot({ dark: true }); app.connect(); app.choose("light");
  assert.equal(app.store.get(key), "light");
  app.system(true); assert.equal(app.root.dataset.theme, "light");
  assert.equal(boot({ stored: app.store.get(key), dark: true }).root.dataset.theme, "light");
  app.choose("dark"); assert.equal(app.root.dataset.theme, "dark");
  app.choose("system"); app.system(false);
  assert.equal(app.root.dataset.theme, "light");
  assert.equal(app.control.value, "system");
  assert.match(app.status.textContent, /following your device/);
});

test("invalid preferences and unavailable optional APIs do not break appearance", () => {
  const invalid = boot({ stored: "unexpected", dark: true }); invalid.connect();
  assert.equal(invalid.control.value, "system");
  assert.equal(invalid.root.dataset.theme, "dark");
  const blocked = boot({ storageFails: true, mediaFails: true }); blocked.connect(); blocked.choose("dark");
  assert.equal(blocked.root.dataset.theme, "dark");
  assert.match(blocked.status.textContent, /this visit only/);
  assert.equal(blocked.store.size, 0);
});

test("rapid theme changes suppress only the transitional paint and restore hover behavior", () => {
  const app = boot(); app.connect(); app.choose("dark"); app.frame(); app.choose("light");
  assert.ok("themeChanging" in app.root.dataset);
  app.frame(); assert.ok("themeChanging" in app.root.dataset, "an older frame must not end the new switch");
  app.frame(); assert.ok(!("themeChanging" in app.root.dataset));
  assert.equal(app.root.dataset.theme, "light");
});

test("cross-tab preference changes and clearing storage update the control without loops", () => {
  const app = boot({ stored: "light", dark: true }); app.connect();
  app.storage({ key: "unrelated", newValue: "dark" }); assert.equal(app.root.dataset.theme, "light");
  app.storage({ key, newValue: "dark" }); assert.equal(app.control.value, "dark");
  app.storage({ key: null, newValue: null }); assert.equal(app.control.value, "system");
  assert.equal(app.root.dataset.theme, "dark");
  assert.equal(app.store.get(key), "light", "storage events must not write back");
});

test("theme bootstrap precedes styles and the native selector has all three choices", () => {
  const script = html.match(/<script src="appearance\.js[^>]*>/)?.[0];
  assert.ok(script); assert.doesNotMatch(script, /defer|async/);
  assert.ok(html.indexOf(script) < html.indexOf('rel="stylesheet"'));
  const select = html.match(/<select id="themeSelect"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.deepEqual([...select.matchAll(/value="([^"]+)"/g)].map(x => x[1]), ["system", "light", "dark"]);
  assert.match(html, /id="themeSelect" aria-label="Color theme"/);
});

function palette(selector) {
  const block = css.slice(css.indexOf(selector));
  return Object.fromEntries([...block.slice(block.indexOf("{"), block.indexOf("}")).matchAll(/--([\w-]+):\s*([^;]+);/g)].map(x => [x[1], x[2].trim()]));
}
function rgb(value) { return value.slice(1).match(/../g).map(x => parseInt(x, 16) / 255); }
function luminance(value) { return rgb(value).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0); }
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }

for (const [mode, selector] of [["dark", ":root {"], ["light", ':root[data-theme="light"]']]) {
  test(`${mode} palette has accessible small-text contrast on every primary surface`, () => {
    const p = palette(selector);
    for (const fg of ["ink", "muted", "faint", "accent", "up", "down", "blue", "teal", "amber", "purple", "orange", "olive", "cyan", "indigo", "rose"]) {
      for (const bg of ["bg", "panel", "panel-2", "panel-3", "selected"]) {
        assert.ok(contrast(p[fg], p[bg]) >= 4.5, `${mode} ${fg} on ${bg}: ${contrast(p[fg], p[bg]).toFixed(2)} must reach 4.5`);
      }
    }
    assert.ok(contrast(p["on-accent"], p.accent) >= 4.5);
  });
  test(`${mode} control borders are distinguishable from input surfaces`, () => {
    const p = palette(selector);
    for (const bg of ["panel", "panel-2", "panel-3"]) assert.ok(contrast(p["control-line"], p[bg]) >= 3, `${mode} control on ${bg}: ${contrast(p["control-line"], p[bg]).toFixed(2)}`);
  });
}

test("both palettes define the same tokens and component colors do not bypass them", async () => {
  assert.deepEqual(Object.keys(palette(":root {")).sort(), Object.keys(palette(':root[data-theme="light"]')).sort());
  const components = [];
  for (const file of ["styles.css", "tabs.css", "desk-cleanup.css", "technology.css", "script.js", "layout-fix.js", "enhancements.js", "themes.js", "springs.js", "phrase-radar.js", "alerts.js", "calibration.js", "clusters.js"]) {
    const text = await readFile(new URL(`../../${file}`, import.meta.url), "utf8");
    components.push(text);
    assert.doesNotMatch(text, /#[\da-f]{3,8}\b|rgba?\(/i, `${file} must use semantic colors`);
  }
  const combined = [css, ...components].join("\n");
  const defined = new Set([...combined.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  const referenced = new Set([...combined.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  assert.deepEqual([...referenced].filter(name => !defined.has(name)), [], "every referenced token must exist");
});
