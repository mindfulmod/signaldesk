import { test } from "node:test";
import assert from "node:assert/strict";
import { textBetween, attrBetween, countWord, escapeRegExp } from "../lib/xml.mjs";

// These exist because both regex helpers were built from template literals with
// single backslashes, which JS collapses before RegExp sees them. The functions
// returned "" / 0 for every real input, so no RSS or Atom feed ever produced a
// headline. Assert on the behaviour AND on the compiled pattern.

test("textBetween: extracts simple tag text", () => {
  assert.equal(textBetween("<title>Ford raises 2026 outlook</title>", "title"), "Ford raises 2026 outlook");
});

test("textBetween: matches content spanning newlines (the [\\s\\S] regression)", () => {
  assert.equal(textBetween("<title>line one\nline two</title>", "title"), "line one\nline two");
});

test("textBetween: tolerates attributes on the opening tag", () => {
  assert.equal(textBetween('<title type="text">Hello</title>', "title"), "Hello");
});

test("textBetween: takes the first item only, and is lazy across siblings", () => {
  const xml = "<title>first</title><title>second</title>";
  assert.equal(textBetween(xml, "title"), "first");
});

test("textBetween: returns empty string when the tag is absent", () => {
  assert.equal(textBetween("<link>x</link>", "title"), "");
});

test("attrBetween: reads an Atom link href", () => {
  assert.equal(attrBetween('<link rel="alternate" href="https://e.com/a"/>', "link", "href"), "https://e.com/a");
});

test("countWord: counts whole words only (the \\b regression)", () => {
  assert.equal(countWord("surge and surge again", "surge"), 2);
  assert.equal(countWord("resurgence", "surge"), 0);
  assert.equal(countWord("", "surge"), 0);
});

test("countWord: does not treat the word as a pattern", () => {
  assert.equal(countWord("a+b and a+b", "a+b"), 2);
});

test("escapeRegExp: neutralises regex metacharacters", () => {
  assert.equal(escapeRegExp("a.b*c"), "a\\.b\\*c");
});
