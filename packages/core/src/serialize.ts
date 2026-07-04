// ---------------------------------------------------------------------------
// (De)serialisation (spec §10).
//
// Read: parse source as JSON5 (comments, trailing commas, unquoted keys), BOM
// tolerated on the way in but never emitted. Write: a deterministic canonical
// form - sorted keys, 2-space indent, LF endings, final newline, UTF-8, no BOM
// - so the same model always writes the same bytes.
//
// The canonical SOURCE form emits a **trailing comma** after every array item
// and object entry (spec §10 / patter-merge.md F1): valid JSON5, round-tripping
// through `parseSource`, and the reason an append touches only its own line
// instead of the previous last item's - which kills false append-vs-append
// merge conflicts. The compiled bundle is the exception: it must stay STRICT
// JSON (runtime ports parse it with stock JSON parsers), so its emitter passes
// `{ trailingComma: false }`.
//
// (Comment preservation on canonical rewrite is a later refinement; the editor
// is the canonical writer and hand-edit comments are the unprivileged path.)
// ---------------------------------------------------------------------------

import JSON5 from "json5";

/** Parse JSON5 source text (a leading BOM is tolerated). Throws on malformed input. */
export function parseSource(text: string): unknown {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return JSON5.parse(body);
}

/** Options for {@link canonicalStringify}. */
export interface StringifyOptions {
  /** Emit a trailing comma after the last item/entry (the canonical SOURCE form).
   *  Defaults to `true`; the compiled bundle passes `false` to stay strict JSON. */
  trailingComma?: boolean;
}

/** Serialise a value to the canonical form (UTF-8, LF, sorted keys, final newline). */
export function canonicalStringify(value: unknown, opts?: StringifyOptions): string {
  return write(value, "", opts?.trailingComma ?? true) + "\n";
}

function write(v: unknown, indent: string, tc: boolean): string {
  if (v === null || typeof v === "boolean" || typeof v === "number") return JSON.stringify(v);
  if (typeof v === "string") return JSON.stringify(v);
  const tail = tc ? "," : "";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const next = indent + "  ";
    const items = v.map((x) => next + write(x, next, tc));
    return `[\n${items.join(",\n")}${tail}\n${indent}]`;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    if (keys.length === 0) return "{}";
    const next = indent + "  ";
    const entries = keys.map((k) => `${next}${JSON.stringify(k)}: ${write(obj[k], next, tc)}`);
    return `{\n${entries.join(",\n")}${tail}\n${indent}}`;
  }
  // undefined / function / symbol are not representable; drop to null defensively.
  return "null";
}
