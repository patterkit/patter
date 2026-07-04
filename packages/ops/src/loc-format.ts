// ---------------------------------------------------------------------------
// Localisation serialisers (spec §14): render a LocCatalog to / parse it from the
// portable handoff formats. Text formats live here (JSON + gettext PO/POT); the
// Excel form is in loc-xlsx.ts (exceljs, lazy). Every format is a view of the ONE
// catalog from localisation.ts - the CLI and Patterpad share these.
//
// PO mapping (the part worth spelling out): a stable Patter id is the `msgctxt`
// (so two identical source strings stay distinct entries and import matches by id,
// not by text); `msgid` = source, `msgstr` = translation; `#.` extracted comments
// carry the loc-channel notes + context; `#:` reference carries the scene (the
// import anchor); `#, fuzzy` is our `stale` flag. With no locale it's a POT
// template (empty msgstr). No plural-forms - narrative strings aren't keyed by count.
// ---------------------------------------------------------------------------

import type { LocCatalog, LocEntry } from "./localisation.js";

// --- JSON (lossless, one file, whole project) ------------------------------

/** The catalog IS the JSON shape: a stable, lossless, human-diffable envelope. */
export function catalogToJson(catalog: LocCatalog): string {
  return JSON.stringify(catalog, null, 2) + "\n";
}

/** Parse a JSON catalog; light validation so a hand-mangled file fails loudly, not deep in apply. */
export function jsonToCatalog(text: string): LocCatalog {
  const o = JSON.parse(text) as Partial<LocCatalog>;
  if (!o || typeof o !== "object" || !Array.isArray(o.entries)) throw new Error("not a localisation JSON file (no 'entries' array)");
  if (typeof o.defaultLocale !== "string") throw new Error("localisation JSON: missing 'defaultLocale'");
  return {
    project: typeof o.project === "string" ? o.project : "",
    defaultLocale: o.defaultLocale,
    locale: typeof o.locale === "string" ? o.locale : undefined,
    entries: o.entries.map((e): LocEntry => ({
      id: String(e.id), scene: String(e.scene),
      source: String(e.source ?? ""), translation: String(e.translation ?? ""),
      comments: Array.isArray(e.comments) ? e.comments.map(String) : [],
      context: e.context, stale: !!e.stale,
    })),
  };
}

// --- gettext PO / POT ------------------------------------------------------

const poEscape = (s: string): string => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\t/g, "\\t");
const poUnescape = (s: string): string => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
const poField = (key: string, value: string): string => `${key} "${poEscape(value)}"`;

/** Render the catalog as a PO file (or a POT template when `catalog.locale` is undefined). */
export function catalogToPo(catalog: LocCatalog): string {
  const out: string[] = [];
  // Header entry (gettext convention): metadata on an empty msgid.
  out.push('msgid ""', 'msgstr ""',
    `"Project-Id-Version: ${catalog.project}\\n"`,
    `"Language: ${catalog.locale ?? ""}\\n"`,
    '"MIME-Version: 1.0\\n"',
    '"Content-Type: text/plain; charset=UTF-8\\n"',
    '"Content-Transfer-Encoding: 8bit\\n"', "");

  for (const e of catalog.entries) {
    for (const c of e.comments) out.push(`#. ${c}`);
    if (e.context?.character || e.context?.kind) {
      out.push(`#. [${[e.context.kind, e.context.character].filter(Boolean).join(" ")}]`);
    }
    out.push(`#: ${e.scene}`);              // the machine anchor: which scene this id belongs to
    if (e.stale) out.push("#, fuzzy");
    out.push(poField("msgctxt", e.id), poField("msgid", e.source), poField("msgstr", e.translation), "");
  }
  return out.join("\n");
}

/** Pull the concatenated quoted-string value that follows a `key ` line (handles PO line continuation). */
function readQuoted(lines: string[], start: number): { value: string; next: number } {
  const first = lines[start]!;
  let value = poUnescape(first.slice(first.indexOf('"') + 1, first.lastIndexOf('"')));
  let i = start + 1;
  while (i < lines.length && lines[i]!.trimStart().startsWith('"')) {
    const l = lines[i]!.trim();
    value += poUnescape(l.slice(1, l.lastIndexOf('"')));
    i++;
  }
  return { value, next: i };
}

/** Parse a PO / POT file back into a catalog. `locale` (from the Language header) may be overridden by
 *  the caller's --locale. Entries without a msgctxt (the header) are skipped. */
export function poToCatalog(text: string): LocCatalog {
  const lines = text.split(/\r?\n/);
  const entries: LocEntry[] = [];
  let locale: string | undefined;
  let project = "";

  let comments: string[] = [];
  let scene = "";
  let stale = false;
  let ctxt: string | undefined;
  let msgid = "";
  let i = 0;

  const flush = (msgstr: string): void => {
    if (ctxt !== undefined) {
      entries.push({ id: ctxt, scene, source: msgid, translation: msgstr, comments, stale });
    } else if (msgid === "") {
      // Header block: read Language / Project-Id-Version out of the msgstr metadata.
      const lang = /Language:\s*([^\\\n]*)/.exec(msgstr);
      if (lang?.[1]?.trim()) locale = lang[1].trim();
      const pid = /Project-Id-Version:\s*([^\\\n]*)/.exec(msgstr);
      if (pid?.[1]?.trim()) project = pid[1].trim();
    }
    comments = []; scene = ""; stale = false; ctxt = undefined; msgid = "";
  };

  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === "") { i++; continue; }
    if (t.startsWith("#.")) { comments.push(t.slice(2).trim()); i++; continue; }
    if (t.startsWith("#:")) { scene = t.slice(2).trim().split(/\s+/)[0] ?? ""; i++; continue; }
    if (t.startsWith("#,")) { if (t.includes("fuzzy")) stale = true; i++; continue; }
    if (t.startsWith("#")) { i++; continue; } // translator / obsolete comment - ignore
    if (t.startsWith("msgctxt")) { const r = readQuoted(lines, i); ctxt = r.value; i = r.next; continue; }
    if (t.startsWith("msgid")) { const r = readQuoted(lines, i); msgid = r.value; i = r.next; continue; }
    if (t.startsWith("msgstr")) { const r = readQuoted(lines, i); flush(r.value); i = r.next; continue; }
    i++;
  }

  return { project, defaultLocale: locale ?? "", locale, entries };
}
