// ---------------------------------------------------------------------------
// Readable screenplay export: the written script + flow as a human-readable document, set like a PRINTED
// PAPER SCRIPT - the artifact a writer hands a director or actor. Dialogue with coloured speaker cues,
// prose narration, choices and branches as real structure, and the mechanical beats (game events, jumps)
// set apart in the margin. Pure data out; the .docx (script-docx.ts) and .pdf (script-pdf.ts) renderers
// are views, like the voice-script / report / loc exports.
//
// This builds ONE structural model and both formats emit it, so PDF and DocX read as the same document.
// It is a SOURCE-LANGUAGE reading artifact (default locale), not a recording deliverable (that's the voice
// script) and not an editable handoff (that's the .patterpack). Cut nodes are omitted.
// ---------------------------------------------------------------------------

import type { Block, GameEventBeat, Group, Scene, Snippet } from "@patterkit/model";
import { sourceStrings, mergeAuthoring } from "./loaded-helpers.js";
import type { LoadedProject } from "./load.js";

// ---------------------------------------------------------------------------
// Design tokens (from the Claude Design handoff + patterpad-surface). A printed script earns its structure
// from typography, colour and space - warm ink on a white page, never the editor's tinted bubble cards.
// Hex without the leading '#' (that form suits Word run colours; the PDF renderer prefixes it).
// ---------------------------------------------------------------------------
export const TOKENS = {
  ink: "26221c",        // near-black warm ink (headings)
  inkRead: "3a352d",    // dialogue body (ink ~84% + muted)
  inkSoft: "5c554b",    // narration (ink ~68% + muted) - a step softer than dialogue
  muted: "8c8479",      // labels, quiet tags
  accent: "8a5a34",     // structural marks: conditions, options, jumps, game events
  line: "e4dfd5",       // hairlines / rules / the group rail
} as const;

/** The 12 curated character-cue colours (patterpad-surface). A speaker's slot is a hash of its name. */
export const CHAR_PALETTE = [
  "b23b3b", "b5642b", "927524", "6b7a31", "3f7d49", "2c7d6e",
  "2d7791", "3a6aa8", "5a5ba6", "7e4e9c", "9c4486", "a83e5c",
] as const;

/** Hash a speaker name into 0..11 (FNV-1a + fmix32), so a cue's colour is storage-free, recomputed, and
 *  stable across the project - the same mapping the editor surface uses (patterpad-surface/src/colour.ts). */
export function colourIndex(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) % 12;
}
/** The cue colour for a speaker name, as a bare hex (no '#'). */
export function characterColour(name: string): string {
  return CHAR_PALETTE[colourIndex(name)]!;
}

// `visits("blk_x")` / `seen("scn_y")` in a written condition carries an opaque node id - meaningless in a
// reading script. Swap the id for the scene / block TITLE (the same courtesy the editor's condition tags do).
const VISIT_FN_RE = /\b(patter_visits|patter_seen|visits|seen)\s*\(\s*(['"])(.*?)\2\s*\)/g;
function humanizeCondition(cond: string, label: (id: string) => string): string {
  return cond.replace(VISIT_FN_RE, (_m, fn: string, _q: string, id: string) => `${fn}(${label(id)})`);
}

/** A formatting run of body text. `code` marks an inline `{@property}` interpolation (rendered as accent
 *  mono); `bold`/`italic` carry Patter's closed `<b>/<i>/<bi>` markup. Renderers turn these into Word runs
 *  or PDF font/colour switches. */
export interface TextRun { text: string; bold: boolean; italic: boolean; code: boolean }
const MARKUP_RE = /<(b|i|bi)>([\s\S]*?)<\/\1>/g;
const INTERP_RE = /\{@[^}]*\}/g; // {@property} interpolation - shown verbatim (braces kept), set in accent mono
/** Split a body string into formatting runs: first by `<b>/<i>/<bi>` markup, then by `{@property}`
 *  interpolation within each piece. Literal text (a bare `<`, `>`, `&`) passes through verbatim. */
export function textRuns(text: string): TextRun[] {
  const marked: Array<{ text: string; bold: boolean; italic: boolean }> = [];
  let last = 0; let m: RegExpExecArray | null; MARKUP_RE.lastIndex = 0;
  while ((m = MARKUP_RE.exec(text)) !== null) {
    if (m.index > last) marked.push({ text: text.slice(last, m.index), bold: false, italic: false });
    const tag = m[1]!;
    marked.push({ text: m[2]!, bold: tag === "b" || tag === "bi", italic: tag === "i" || tag === "bi" });
    last = MARKUP_RE.lastIndex;
  }
  if (last < text.length) marked.push({ text: text.slice(last), bold: false, italic: false });
  if (!marked.length) marked.push({ text, bold: false, italic: false });

  const out: TextRun[] = [];
  for (const r of marked) {
    let li = 0; let im: RegExpExecArray | null; INTERP_RE.lastIndex = 0;
    while ((im = INTERP_RE.exec(r.text)) !== null) {
      if (im.index > li) out.push({ text: r.text.slice(li, im.index), bold: r.bold, italic: r.italic, code: false });
      out.push({ text: im[0], bold: r.bold, italic: r.italic, code: true });
      li = INTERP_RE.lastIndex;
    }
    if (li < r.text.length) out.push({ text: r.text.slice(li), bold: r.bold, italic: r.italic, code: false });
  }
  return out.length ? out : [{ text, bold: false, italic: false, code: false }];
}

/** One renderable item in reading order. `indent` is the structural nesting depth (0 = block-level) - the
 *  reader's structure cue. `snippet` is an id shared by every element of one snippet WHEN that snippet sits
 *  inside a selector (branch / sequence / choice); the renderers draw a light left edge spanning each such
 *  snippet, so rows that would otherwise blur (a sequence's steps) read as distinct beats. Absent = a
 *  top-level snippet (delimited by space alone). Headings carry no indent (they reset it). */
export type ScriptElement =
  | { kind: "scene"; text: string }
  | { kind: "block"; text: string }
  /** A spoken line: SPEAKER cue (coloured, uppercase), an optional (direction), and the body runs. */
  | { kind: "line"; indent: number; snippet?: number; character: string; direction?: string; runs: TextRun[] }
  /** Prose narration / on-screen text (speaker-less), upright in a soft ink, flush left. */
  | { kind: "narration"; indent: number; snippet?: number; runs: TextRun[] }
  /** A gating condition, set in accent mono above the beat it controls: `‹ if @brave ›`. */
  | { kind: "condition"; indent: number; snippet?: number; text: string }
  /** A selector group's label ("Choose", "One of · first match wins", "In sequence"). */
  | { kind: "group"; indent: number; label: string }
  /** A branch's catch-all row header ("else · catch-all"). */
  | { kind: "else"; indent: number }
  /** A choice option: a ◇-led prompt, plus a quiet small-caps flag tag (once only / repeatable). */
  | { kind: "option"; indent: number; snippet?: number; runs: TextRun[]; tag?: string }
  /** A jump, set apart right-aligned in accent: `↪ The Crossroads` (readable target, never the id). */
  | { kind: "jump"; indent: number; snippet?: number; text: string }
  /** A game event, set apart right-aligned in accent mono: `⚙ game event · door.open`. */
  | { kind: "gameEvent"; indent: number; snippet?: number; text: string };

export interface ScriptDoc {
  /** Project display name - the document title. */
  project: string;
  elements: ScriptElement[];
}

/** A readable destination for a jump: the target scene / block by name (`Scene › Block`), or END. */
function targetLabel(to: string, sceneOf: Map<string, string>, blockTrail: Map<string, string>): string {
  if (to === "END") return "END";
  return blockTrail.get(to) ?? sceneOf.get(to) ?? to; // fall back to the raw id if somehow unresolved
}

/** A game event's readable name: a compact summary of its `gameData` (the author's host cue), or just
 *  "game event" when it carries none. */
function gameEventLabel(beat: GameEventBeat): string {
  const gd = beat.gameData;
  if (gd && typeof gd === "object") {
    const parts = Object.entries(gd).slice(0, 3).map(([k, v]) => {
      const val = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return val === "" ? k : `${k}: ${val}`;
    });
    if (parts.length) return `game event · ${parts.join(", ")}`;
  }
  return "game event";
}

/** The quiet small-caps flag tag for a choice option (once only / repeatable, plus fallback / hidden when
 *  set). The option's condition is emitted separately as a `condition` line above it. */
function optionTag(node: Group | Snippet): string {
  const parts: string[] = [];
  if (node.fallback) parts.push("fallback");
  parts.push(node.sticky ? "repeatable" : "once only");
  if (node.secretUntilEligible) parts.push("hidden");
  return parts.join(" · ");
}

/** A readable label for a sequence selector: "In sequence", with a qualifier only when non-default. */
function sequenceLabel(node: Group): string {
  const o = node.options ?? {};
  const bits: string[] = [];
  if ((o.order ?? "sequential") === "shuffle") bits.push("shuffled");
  const ex = o.exhaust ?? "once";
  if (ex === "repeat") bits.push("repeating"); else if (ex === "stick") bits.push("holds on the last");
  return bits.length ? `In sequence · ${bits.join(", ")}` : "In sequence";
}

/** Compute the readable script document. Pure: data out, no I/O. */
export function runScriptDoc(loaded: LoadedProject): ScriptDoc {
  const { project } = loaded;
  const source = sourceStrings(loaded);
  const { cut } = mergeAuthoring(loaded);

  // Build readable labels for every jump destination (scenes + blocks), so a jump reads by name.
  const sceneOf = new Map<string, string>();   // scene id -> scene name
  const blockTrail = new Map<string, string>(); // block id -> "Scene › Block" (jump destinations)
  const blockName = new Map<string, string>();  // block id -> bare block name (condition tags)
  for (const scene of loaded.scenes) {
    sceneOf.set(scene.id, scene.name);
    for (const block of scene.blocks as Block[]) { blockTrail.set(block.id, `${scene.name} › ${block.name}`); blockName.set(block.id, block.name); }
  }
  // visits()/seen() in a condition reads better with the bare scene / block NAME than the full trail.
  const humanize = (cond: string): string => humanizeCondition(cond, (id) => blockName.get(id) ?? sceneOf.get(id) ?? id);

  const els: ScriptElement[] = [];
  const textOf = (id: string): string => source[id] ?? "";
  const jumpText = (j: { to: string; mode?: string }): string => {
    const dest = targetLabel(j.to, sceneOf, blockTrail);
    return j.mode === "call" ? `${dest} (and return)` : dest;
  };

  // A snippet id, unique per snippet, is assigned ONLY to snippets that sit inside a selector (so the
  // renderers can draw a per-snippet edge there); top-level snippets pass `undefined` and rely on space.
  let snippetSeq = 0;
  const nextSid = (): number => ++snippetSeq;

  // Emit a snippet's beats (dialogue / narration / game events) and any trailing jump, at `indent`/`sid`.
  const emitBeats = (node: Snippet, indent: number, sid: number | undefined): void => {
    for (const beat of node.beats ?? []) {
      if (cut.has(beat.id)) continue;
      if (beat.kind === "line") els.push({ kind: "line", indent, snippet: sid, character: beat.character ?? "", direction: beat.direction, runs: textRuns(textOf(beat.id)) });
      else if (beat.kind === "text") els.push({ kind: "narration", indent, snippet: sid, runs: textRuns(textOf(beat.id)) });
      else if (beat.kind === "gameEvent") els.push({ kind: "gameEvent", indent, snippet: sid, text: gameEventLabel(beat) });
    }
    if (node.jump) els.push({ kind: "jump", indent, snippet: sid, text: jumpText(node.jump) });
  };

  // `sid` is the snippet id this node's elements belong to (a selector hands each child a fresh one; a
  // nested selector's own children get their own). A plain snippet tags its condition + beats + jump with it.
  const walk = (node: Group | Snippet, indent: number, sid: number | undefined): void => {
    if (cut.has(node.id)) return; // a cut node (and its subtree) is excluded wholesale

    if (node.type === "snippet") {
      if (node.condition) els.push({ kind: "condition", indent, snippet: sid, text: `if ${humanize(node.condition)}` });
      emitBeats(node, indent, sid);
      return;
    }

    // group
    if (node.condition) els.push({ kind: "condition", indent, snippet: sid, text: `if ${humanize(node.condition)}` });

    if (node.selector === "choice") {
      els.push({ kind: "group", indent, label: "Choose" });
      for (const child of node.children ?? []) {
        if (cut.has(child.id)) continue;
        const cid = nextSid(); // each option (with its consequence) is one edged snippet
        // An authored option is a group carrying `prompt`; tolerate the degenerate snippet-option (its
        // first line is the prompt, the rest is content).
        if (child.type === "group" && child.prompt) {
          if (child.condition) els.push({ kind: "condition", indent, snippet: cid, text: `if ${humanize(child.condition)}` });
          els.push({ kind: "option", indent, snippet: cid, runs: textRuns(textOf(child.prompt.id) || "(option)"), tag: optionTag(child) });
          for (const c of child.children ?? []) walk(c, indent + 1, cid);
        } else if (child.type === "snippet") {
          const beats = child.beats ?? [];
          const first = beats.find((b) => b.kind === "line" || b.kind === "text");
          if (child.condition) els.push({ kind: "condition", indent, snippet: cid, text: `if ${humanize(child.condition)}` });
          els.push({ kind: "option", indent, snippet: cid, runs: textRuns(first ? textOf(first.id) || "(option)" : "(option)"), tag: optionTag(child) });
          // content = the snippet minus its prompt beat, plus any jump (indented a level under the option)
          let seenPrompt = false;
          for (const beat of beats) {
            if (!seenPrompt && beat === first) { seenPrompt = true; continue; }
            if (cut.has(beat.id)) continue;
            if (beat.kind === "line") els.push({ kind: "line", indent: indent + 1, snippet: cid, character: beat.character ?? "", direction: beat.direction, runs: textRuns(textOf(beat.id)) });
            else if (beat.kind === "text") els.push({ kind: "narration", indent: indent + 1, snippet: cid, runs: textRuns(textOf(beat.id)) });
            else if (beat.kind === "gameEvent") els.push({ kind: "gameEvent", indent: indent + 1, snippet: cid, text: gameEventLabel(beat) });
          }
          if (child.jump) els.push({ kind: "jump", indent: indent + 1, snippet: cid, text: jumpText(child.jump) });
        } else {
          // a non-option group nested directly under a choice (unusual) - render its content
          walk(child, indent + 1, cid);
        }
      }
      return;
    }

    if (node.selector === "branch") {
      els.push({ kind: "group", indent, label: "One of · first match wins" });
      const kids = (node.children ?? []).filter((c) => !cut.has(c.id));
      kids.forEach((child, i) => {
        const isCatchAll = i === kids.length - 1 && kids.length > 1 && !("condition" in child && child.condition);
        if (isCatchAll) els.push({ kind: "else", indent });
        walk(child, indent, nextSid()); // each row is its own edged snippet
      });
      return;
    }

    if (node.selector === "sequence") {
      els.push({ kind: "group", indent, label: sequenceLabel(node) });
      for (const child of node.children ?? []) walk(child, indent, nextSid()); // each step is its own edged snippet
      return;
    }

    // run (default): transparent - its children read in order at the same depth, keeping the current id.
    for (const child of node.children ?? []) walk(child, indent, sid);
  };

  for (const scene of loaded.scenes as Scene[]) {
    if (cut.has(scene.id)) continue;
    els.push({ kind: "scene", text: scene.name });
    for (const block of scene.blocks as Block[]) {
      if (cut.has(block.id)) continue;
      els.push({ kind: "block", text: block.name });
      for (const child of block.children ?? []) walk(child, 0, undefined); // top-level snippets: no edge
    }
  }

  return { project: project.project.name, elements: els };
}
