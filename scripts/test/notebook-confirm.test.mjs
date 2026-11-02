import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import confirmation from "../../notebook-confirm.js";

function fixture() {
  const listeners = {}, focus = [];
  const dialog = {
    open: false,
    addEventListener(name, fn) { listeners[name] = fn; },
    showModal() { this.open = true; },
    close() { this.open = false; listeners.close(); },
    querySelector() { return { focus: () => focus.push("keep") }; },
  };
  const origin = { isConnected: true, focus: () => focus.push("origin") };
  const choose = value => listeners.click({ target: { closest: () => ({ dataset: { notebookChoice: value } }) } });
  return { dialog, origin, focus, listeners, choose, controller: confirmation.create(dialog) };
}

test("draft confirmation defaults to Keep, cancels safely and restores origin", async () => {
  const f = fixture(), choice = f.controller.request(f.origin);
  assert.equal(f.dialog.open, true); assert.deepEqual(f.focus, ["keep"]);
  f.choose("keep");
  assert.equal(await choice, false); assert.equal(f.dialog.open, false);
  assert.deepEqual(f.focus, ["keep", "origin"]);
});

test("Escape and external close never authorize discarding", async () => {
  for (const action of ["escape", "close"]) {
    const f = fixture(), choice = f.controller.request(f.origin);
    if (action === "escape") { let prevented = false; f.listeners.cancel({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true); }
    else f.dialog.close();
    assert.equal(await choice, false); assert.equal(f.controller.pending, false);
  }
});

test("one explicit discard authorizes only one action, and rapid reopen is safe", async () => {
  const f = fixture(), first = f.controller.request(f.origin);
  assert.equal(await f.controller.request(f.origin), false);
  f.choose("discard"); assert.equal(await first, true);
  const next = f.controller.request(f.origin);
  f.listeners.close(); // delayed close event from the previous modal
  assert.equal(f.controller.pending, true);
  f.choose("keep"); assert.equal(await next, false);
});

test("unavailable or failing modal fails closed without throwing away edits", async () => {
  assert.equal(await confirmation.create(null).request(), false);
  const f = fixture(); f.dialog.showModal = () => { throw new Error("unsupported"); };
  assert.equal(await f.controller.request(f.origin), false);
  assert.equal(f.controller.pending, false);
});

test("all notebook-replacing routes share the confirmation gate before mutation", () => {
  const source = readFileSync(new URL("../../adoption.js", import.meta.url), "utf8");
  assert.ok(!source.includes("window.confirm"));
  assert.match(source, /notebookEditing\?\.id !== button\.dataset\.notebookOpen/);
  assert.match(source, /\["data-notebook-shelf", "data-notebook-back", "data-notebook-series", "data-open-discovery-scan"\]/);
  assert.ok(source.indexOf("await notebookConfirmation.request(button)") < source.indexOf('if (button.dataset.notebookOpen)'));
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.indexOf('src="notebook-confirm.js') < html.indexOf('src="adoption.js'));
  assert.match(html, /<dialog[^>]+aria-labelledby="notebookDiscardTitle"[^>]+aria-describedby="notebookDiscardDescription"/);
});
