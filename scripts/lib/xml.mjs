// Feed-parsing and word-matching primitives, extracted from update-data.mjs so
// they can be unit-tested. They were untested for a long time and both regex
// helpers here were silently broken (see the warning below), which is why every
// RSS/Atom feed in the pipeline appeared to return no headlines.
//
// WARNING — the doubled backslashes in this file are load-bearing.
// `new RegExp` built from a TEMPLATE LITERAL is escaped twice: the string
// escape runs first, so a lone `\b` becomes the backspace character U+0008 and
// `[\s\S]` collapses to `[sS]` (the literal letters s and S). Both bugs existed
// here and made these functions return nothing for every real input. Prefer a
// regex literal when you can; when you cannot, assert on `regex.source`.

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Inner text of the first <tag>…</tag> in an XML/RSS/Atom fragment.
// Tolerates attributes on the opening tag and content spanning newlines.
export function textBetween(xml, tag) {
  return xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "";
}

// Value of `attr` on the first <tag …> — used for Atom's <link href="…"/>,
// which carries its URL in an attribute rather than as text.
export function attrBetween(xml, tag, attr) {
  return xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["'][^>]*>`, "i"))?.[1] || "";
}

// Whole-word occurrences of `word` in `text`. Word-bounded so "surge" does not
// match inside "resurgence".
export function countWord(text, word) {
  return (text.match(new RegExp(`\\b${escapeRegExp(word)}\\b`, "g")) || []).length;
}
