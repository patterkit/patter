// ---------------------------------------------------------------------------
// Editable-script handoff records, the file side (patterkit/design/proposals/editable-script-handoff.md §5).
//
// One record per export, at `handoffs/<id>.json` in the project, written through VC with everything else:
// what was sent, to whom, when, and each editable line's text AS SENT. Reimport compares against it.
//
// Also the markers that tie a returned document's lines back to the record: `[#K7Q2M]`, a short code from
// the Crockford base32 alphabet plus one check character, issued at random per export (so they don't leak
// beat ids, and a typo is unlikely to land on another line's code), and read leniently on the way back.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { HANDOFF_SCHEMA } from "@patterkit/model";
import type { HandoffFile } from "@patterkit/model";
import { walkFiles } from "./load.js";
import type { PlannedWrite } from "./write.js";

/** The project folder handoff records live in. */
export const HANDOFF_DIR = "handoffs";
const HANDOFF_EXT = ".json";

/** Where a handoff's record lives in the project at `root`. */
export function handoffPath(root: string, id: string): string {
  return join(root, HANDOFF_DIR, `${id}${HANDOFF_EXT}`);
}

/** A record as it is written: stable key order is the caller's (the record is built in one place), two-space
 *  JSON with a trailing newline, like the other JSON a project keeps. */
export function serialiseHandoff(handoff: HandoffFile): string {
  return JSON.stringify(handoff, null, 2) + "\n";
}

/** The planned write for a record. */
export function handoffWrite(root: string, handoff: HandoffFile): PlannedWrite {
  return { path: handoffPath(root, handoff.id), content: serialiseHandoff(handoff) };
}

/** Parse a record, or say why it isn't one. */
export function parseHandoff(text: string): HandoffFile {
  const h = JSON.parse(text) as Partial<HandoffFile>;
  if (h.schema !== HANDOFF_SCHEMA) throw new Error(`not a handoff record (schema ${JSON.stringify(h.schema)})`);
  if (typeof h.id !== "string" || !h.lines || !Array.isArray(h.skeleton)) throw new Error("handoff record is missing its id, lines, or skeleton");
  return h as HandoffFile;
}

/** A record that couldn't be read, naming its file. */
export interface HandoffIssue { file: string; message: string }

/** Every handoff record in the project at `root`, sorted by creation time, plus any that wouldn't parse.
 *  No folder means no handoffs: every project before this feature. */
export function readHandoffs(root: string): { handoffs: HandoffFile[]; issues: HandoffIssue[] } {
  const handoffs: HandoffFile[] = [];
  const issues: HandoffIssue[] = [];
  for (const file of walkFiles(join(root, HANDOFF_DIR), HANDOFF_EXT)) {
    try { handoffs.push(parseHandoff(readFileSync(file, "utf8"))); }
    catch (e) { issues.push({ file, message: `${basename(file)}: ${e instanceof Error ? e.message : String(e)}` }); }
  }
  handoffs.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return { handoffs, issues };
}

/** One handoff record by id, or undefined when the project has none by that id. Throws if it exists but
 *  won't parse: a damaged record is a problem to report, not a missing one. */
export function readHandoff(root: string, id: string): HandoffFile | undefined {
  const path = handoffPath(root, id);
  if (!existsSync(path)) return undefined;
  return parseHandoff(readFileSync(path, "utf8"));
}

// ---------------------------------------------------------------------------
// Codes and markers
// ---------------------------------------------------------------------------

/** Crockford base32: no I, L, O, or U, so nothing reads as another symbol. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** The check character for a code body: a position-weighted sum mod 31. Catches every single-character
 *  error and every swap of two neighbours, except where the two values differ by exactly 31 (0 and Z). */
function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += (i + 1) * ALPHABET.indexOf(body[i]!);
  return ALPHABET[sum % 31]!;
}

/** A source of randomness in [0, 1): `Math.random` by default, seeded in tests. */
export type Random = () => number;

function randomBody(length: number, random: Random): string {
  let s = "";
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length)]!;
  return s;
}

/** How many body characters codes for `count` lines need: enough that the codes in use fill at most one
 *  in a thousand of the space, so a mistyped code almost never lands on another line's. At least 3. */
export function markerLength(count: number): number {
  let length = 3;
  while (ALPHABET.length ** length < Math.max(1, count) * 1000) length++;
  return length;
}

/** Issue `count` distinct marker codes (body plus check character), in a random order. */
export function issueMarkerCodes(count: number, random: Random = Math.random): string[] {
  const length = markerLength(count);
  const codes = new Set<string>();
  while (codes.size < count) {
    const body = randomBody(length, random);
    codes.add(body + checkChar(body));
  }
  return [...codes];
}

/** A marker as it is printed beside a box. */
export function formatMarker(code: string): string {
  return `[#${code}]`;
}

/** A handoff id ("H-7Q2K") that `taken` doesn't already use. */
export function newHandoffId(taken: Iterable<string> = [], random: Random = Math.random): string {
  const used = new Set(taken);
  for (;;) {
    const id = `H-${randomBody(4, random)}`;
    if (!used.has(id)) return id;
  }
}

/** A marker read back from a returned document. */
export interface ReadMarker {
  /** The normalised code (upper case, Crockford substitutions applied). */
  code: string;
  /** Whether its check character is right. A wrong one means the marker was damaged. */
  valid: boolean;
}

/** Read a marker from a margin cell's text, leniently: `[#K7Q2M]`, `[ # k7q2m ]`, `[K7Q2M]` all read the
 *  same, and the Crockford look-alikes (O for 0, I or L for 1) are taken as the digits they resemble.
 *  Undefined when the text holds no marker at all. */
export function readMarker(text: string): ReadMarker | undefined {
  const m = /\[\s*#?\s*([0-9A-Za-z]{2,9})\s*\]/.exec(text);
  if (!m) return undefined;
  const code = m[1]!.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
  if ([...code].some((c) => !ALPHABET.includes(c))) return { code, valid: false };
  const body = code.slice(0, -1);
  return { code, valid: body.length >= 2 && checkChar(body) === code.slice(-1) };
}
