// ---------------------------------------------------------------------------
// The editable script (patterkit/design/proposals/editable-script-handoff.md §4): the readable script with
// every editable line's words in a shaded box, so a script editor outside the Patter world can change
// them in Word, Google Docs, or OnlyOffice and send the file back.
//
// Each editable line (dialogue, narration, a choice option's prompt) is a one-row, three-cell table:
//   lead cell    the cue and direction, or ◇ for an option (context, styled as the readable script)
//   text cell    the words, shaded with a hairline edge: the only thing meant to be edited
//   margin cell  the option tag, the optional writing status, and the marker `[#K7Q2M]`
// Everything else (headings, conditions, choice labels, jumps, game events, notes) is an ordinary
// paragraph built exactly as the readable script builds it (script-docx.ts).
//
// What the spike found shapes three details (§13): consecutive boxes get a 1 pt spacer paragraph between
// them, since Google Docs merges tables that touch; only headings a jump in the export points at carry a
// bookmark, since Google shows every bookmark as an icon; and bookmark ids are renumbered after packing,
// since `docx` gives every bookmark the same one.
//
// Returns the document and its handoff record (what was sent, line by line), plus the record's write.
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import {
  AlignmentType, BorderStyle, Bookmark, Document, Header, HeadingLevel, InternalHyperlink, Packer, PageBreak,
  Paragraph, ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, WidthType,
} from "docx";
import { HANDOFF_SCHEMA } from "@patterkit/model";
import type { HandoffFile, HandoffLine, HandoffRow } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import { runScriptDoc, characterColour, TOKENS } from "./script-doc.js";
import type { ScriptElement } from "./script-doc.js";
import { SERIF, SANS, MONO, S, bodyRuns, leftOf, paragraph } from "./script-docx.js";
import { mergeAuthoring, sourceStrings } from "./loaded-helpers.js";
import { formatMarker, handoffWrite, issueMarkerCodes, newHandoffId, readHandoffs } from "./handoff.js";
import type { Random } from "./handoff.js";

export interface EditableScriptOptions {
  /** Scene ids to export, in project order. The whole project when absent. */
  scenes?: string[];
  /** Who it's going to, shown on the front page and kept in the record. */
  recipient?: string;
  /** Notes shown under the node they're on: the `editor` channel's (default) or every classed note. */
  notes?: "editor" | "all";
  /** Show each line's writing status in the margin. */
  status?: boolean;
  /** A cast page before the script. */
  cast?: boolean;
  /** Who is exporting (the record's `createdBy`). */
  by: string;
  /** The export time (ISO); now by default. */
  now?: string;
  /** Randomness for markers and the handoff id; seeded in tests. */
  random?: Random;
}

export interface EditableScript {
  docx: Buffer;
  handoff: HandoffFile;
  /** The handoff record, for the caller to commit through VC with nothing else. */
  writes: PlannedWrite[];
}

// Layout, in twips. A4 with Word's default margins leaves 9020 across.
const FULL = 9020;
const LEAD = 1700;   // the cue column
const MARGIN = 1500; // the tag and marker column
const MIN_TEXT = 3000;
const BOX_FILL = "f7f2e8";
const BOX_EDGE = "d9cfbd";
const MARKER_INK = "a8a196";
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const HAIR = { style: BorderStyle.SINGLE, size: 4, color: BOX_EDGE } as const;

type Editable = Extract<ScriptElement, { kind: "line" | "narration" | "option" }>;
const isEditable = (el: ScriptElement): el is Editable => el.kind === "line" || el.kind === "narration" || el.kind === "option";

/** A heading's bookmark name: Word wants a letter first, letters, digits, and underscores, at most 40. */
const bookmarkName = (id: string): string => `pk_${id.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 40);

/** Export the editable script and plan its handoff record. */
export async function exportEditableScript(loaded: LoadedProject, opts: EditableScriptOptions): Promise<EditableScript> {
  const now = opts.now ?? new Date().toISOString();
  const random = opts.random ?? Math.random;
  const notes = opts.notes ?? "editor";
  const doc = runScriptDoc(loaded, { ...(opts.scenes ? { scenes: opts.scenes } : {}), notes: notes === "all" ? "all" : { channel: "editor" } });
  const { writing } = mergeAuthoring(loaded);
  const source = sourceStrings(loaded);

  // Markers, one per editable line, and the handoff record built alongside the document.
  const editable = doc.elements.filter(isEditable);
  const codes = issueMarkerCodes(editable.length, random);
  const markerOf = new Map<Editable, string>(editable.map((el, i) => [el, codes[i]!]));
  const id = newHandoffId(readHandoffs(loaded.root).handoffs.map((h) => h.id), random);

  const lines: Record<string, HandoffLine> = {};
  const skeleton: HandoffRow[] = [];
  for (const el of doc.elements) {
    if (isEditable(el)) {
      const code = markerOf.get(el)!;
      // The line's text exactly as the project stores it (markup and placeholders included): what a
      // returned box is compared against.
      const baseline = source[el.id] ?? "";
      lines[code] = el.kind === "line"
        ? { id: el.id, kind: "line", character: el.character, ...(el.direction ? { direction: el.direction } : {}), baseline }
        : { id: el.id, kind: el.kind === "option" ? "option" : "narration", baseline };
      skeleton.push({ kind: "box", marker: code });
    } else {
      skeleton.push({ kind: el.kind, node: el.id, text: contextText(el) });
    }
  }

  const scenes = [...new Set(doc.elements.filter((e) => e.kind === "scene").map((e) => e.id))];
  const handoff: HandoffFile = {
    schema: HANDOFF_SCHEMA, id, createdAt: now, createdBy: opts.by, format: "docx",
    ...(opts.recipient ? { recipient: opts.recipient } : {}),
    range: { scenes },
    options: { notes, status: opts.status === true, cast: opts.cast === true },
    lines, skeleton,
  };

  // Headings worth a bookmark: those a jump in THIS export points at.
  const inExport = new Set(doc.elements.filter((e) => e.kind === "scene" || e.kind === "block").map((e) => e.id));
  const targets = new Set(doc.elements.filter((e): e is Extract<ScriptElement, { kind: "jump" }> => e.kind === "jump").map((e) => e.to).filter((t) => inExport.has(t)));

  const body: Array<Paragraph | Table> = [...frontPage(loaded, handoff, opts, now), ...(opts.cast ? castPage(loaded, doc.elements) : [])];
  doc.elements.forEach((el, i) => {
    const prev = doc.elements[i - 1];
    if (isEditable(el)) {
      if (prev && isEditable(prev)) body.push(spacer());
      body.push(box(el, markerOf.get(el)!, opts.status ? writing.get(el.id) : undefined));
    } else if ((el.kind === "scene" || el.kind === "block") && targets.has(el.id)) {
      body.push(heading(el, true));
    } else if (el.kind === "scene" || el.kind === "block") {
      body.push(heading(el, false));
    } else if (el.kind === "jump") {
      body.push(jump(el, targets.has(el.to)));
    } else {
      body.push(paragraph(el, prev));
    }
  });

  const date = new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const document = new Document({
    creator: "Patter", title: `${loaded.project.project.name} (editable script)`,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 } } },
      headers: { default: new Header({ children: [new Paragraph({ children: [
        new TextRun({ text: `${loaded.project.project.name} · Editable script · Handoff ${id} · exported ${date} · Please keep the grey [#…] markers`, font: SANS, size: 15, color: TOKENS.muted }),
      ] })] }) },
      children: body,
    }],
  });

  const docx = await renumberBookmarks(await Packer.toBuffer(document));
  return { docx, handoff, writes: [handoffWrite(loaded.root, handoff)] };
}

/** The words a context row shows, as the skeleton records them. */
function contextText(el: Exclude<ScriptElement, Editable>): string {
  switch (el.kind) {
    case "group": return el.label;
    case "else": return "else · catch-all";
    default: return el.text;
  }
}

/** One editable line: the three-cell, one-row table. */
function box(el: Editable, code: string, status: string | undefined): Table {
  const ind = leftOf(el);
  const textW = Math.max(MIN_TEXT, FULL - ind - LEAD - MARGIN);
  const cell = (children: Paragraph[], width: number, extra: Partial<ConstructorParameters<typeof TableCell>[0]> = {}): TableCell =>
    new TableCell({ width: { size: width, type: WidthType.DXA }, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE }, margins: { top: 60, bottom: 60, left: 100, right: 100 }, children, ...extra });

  const lead: TextRun[] = [];
  if (el.kind === "line" && el.character) lead.push(new TextRun({ text: el.character.toUpperCase(), font: SANS, bold: true, allCaps: true, size: S.cue, color: characterColour(el.character) }));
  if (el.kind === "line" && el.direction) lead.push(new TextRun({ text: `(${el.direction})`, font: SERIF, italics: true, size: S.cue, color: TOKENS.muted, break: el.character ? 1 : 0 }));
  if (el.kind === "option") lead.push(new TextRun({ text: "◇", color: TOKENS.accent, size: S.body }));

  const ink = el.kind === "narration" ? TOKENS.inkSoft : el.kind === "option" ? TOKENS.ink : TOKENS.inkRead;
  const margin: TextRun[] = [];
  if (el.kind === "option" && el.tag) margin.push(new TextRun({ text: `${el.tag}  `, font: SANS, smallCaps: true, size: S.tag, color: TOKENS.muted }));
  if (status) margin.push(new TextRun({ text: `${status}  `, font: SANS, smallCaps: true, size: S.tag, color: TOKENS.muted }));
  margin.push(new TextRun({ text: formatMarker(code), font: MONO, size: 14, color: MARKER_INK }));

  return new Table({
    layout: TableLayoutType.FIXED, indent: { size: ind, type: WidthType.DXA }, width: { size: LEAD + textW + MARGIN, type: WidthType.DXA },
    columnWidths: [LEAD, textW, MARGIN],
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({ cantSplit: true, children: [
      cell([new Paragraph({ children: lead })], LEAD),
      cell([new Paragraph({ children: bodyRuns(el.runs, ink) })], textW,
        { shading: { type: ShadingType.CLEAR, fill: BOX_FILL, color: "auto" }, borders: { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR } }),
      cell([new Paragraph({ alignment: AlignmentType.RIGHT, children: margin })], MARGIN),
    ] })],
  });
}

/** The 1 pt paragraph between two boxes, so Google Docs keeps them as separate tables. */
function spacer(): Paragraph {
  return new Paragraph({ spacing: { before: 0, after: 0, line: 20, lineRule: "exact" }, children: [new TextRun({ text: "", size: 2 })] });
}

/** A scene or block heading, bookmarked when a jump points at it. */
function heading(el: Extract<ScriptElement, { kind: "scene" | "block" }>, bookmarked: boolean): Paragraph {
  const scene = el.kind === "scene";
  const text = new TextRun({ text: el.text, font: SERIF, bold: true, color: TOKENS.ink, size: scene ? S.h1 : S.h2 });
  return new Paragraph({
    heading: scene ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, keepNext: true,
    spacing: scene ? { before: 480, after: 200 } : { before: 360, after: 160 },
    border: { bottom: scene ? { style: BorderStyle.SINGLE, size: 14, color: TOKENS.accent, space: 6 } : { style: BorderStyle.SINGLE, size: 4, color: TOKENS.line, space: 4 } },
    children: [bookmarked ? new Bookmark({ id: bookmarkName(el.id), children: [text] }) : text],
  });
}

/** A jump: a link to its target's heading when that heading is in the export, else says it isn't. */
function jump(el: Extract<ScriptElement, { kind: "jump" }>, linked: boolean): Paragraph {
  const run = (text: string): TextRun => new TextRun({ text, font: SANS, bold: true, color: TOKENS.accent, size: S.mech });
  const label = `↪  ${el.text}`;
  return new Paragraph({
    keepLines: true, alignment: AlignmentType.RIGHT, spacing: { before: 40, after: 40 },
    children: linked
      ? [new InternalHyperlink({ anchor: bookmarkName(el.to), children: [run(label)] })]
      : [run(el.to === "END" ? label : `${label} (not in this document)`)],
  });
}

/** The front page: what this is, how to edit it, and how to read the structure. */
function frontPage(loaded: LoadedProject, handoff: HandoffFile, opts: EditableScriptOptions, now: string): Paragraph[] {
  const p = (text: string, o: { bold?: boolean; size?: number; color?: string; before?: number; after?: number } = {}): Paragraph =>
    new Paragraph({ spacing: { before: o.before ?? 0, after: o.after ?? 100 }, children: [new TextRun({ text, font: SERIF, size: o.size ?? 21, bold: o.bold, color: o.color ?? TOKENS.inkRead })] });
  const item = (lead: string, text: string): Paragraph => new Paragraph({ spacing: { after: 80 }, indent: { left: 360, hanging: 360 }, children: [
    new TextRun({ text: `${lead}\t`, font: SERIF, size: 21, color: TOKENS.accent }), new TextRun({ text, font: SERIF, size: 21, color: TOKENS.inkRead }),
  ] });
  const date = new Date(now).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const sentTo = handoff.recipient ? ` for ${handoff.recipient}` : "";

  return [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Editable script", font: SANS, bold: true, allCaps: true, color: TOKENS.accent, size: 16, characterSpacing: 30 })] }),
    new Paragraph({ spacing: { after: 240 }, children: [new TextRun({ text: loaded.project.project.name, font: SERIF, bold: true, color: TOKENS.ink, size: 52 })] }),
    p(`Exported${sentTo} by ${opts.by} on ${date}. Handoff ${handoff.id}.`, { color: TOKENS.muted, after: 360 }),

    p("How to edit this script", { bold: true, size: 24, color: TOKENS.ink, after: 120 }),
    item("1.", "Change the words inside the shaded boxes. That's all that can be edited."),
    item("2.", "Don't delete, copy, or move the boxes, or change the grey markers like [#K7Q2M] beside them. If you want a line cut, delete its words but leave the box, or leave a comment."),
    item("3.", "Everything outside the boxes (scene and block headings, speaker names, conditions, choices, jumps, and game events) is there to show you how the story flows. Comment on it rather than editing it."),
    item("4.", "Please turn on Track Changes (Word) or Suggesting mode (Google Docs). Apple Pages can't track changes inside these boxes; if you use Pages, edit as normal, or use Google Docs or OnlyOffice (both free) to track your changes."),
    item("5.", "Use comments freely. You can also type a note inside a box like [[this]]."),

    p("How to read the structure", { bold: true, size: 24, color: TOKENS.ink, before: 280, after: 120 }),
    item("CHOOSE", "The player picks one of the options marked ◇."),
    item("ONE OF", "The first row whose condition holds is the one used."),
    item("IN SEQUENCE", "A different row each time the story reaches this point."),
    item("‹ if … ›", "This only happens when the condition holds."),
    item("↪", "The story carries on somewhere else."),
    item("⚙", "Something happens in the game here."),
    item("once only", "An option that disappears once it has been picked; repeatable ones stay."),
    p("Words like {@name} in a different typeface are filled in by the game. Keep them exactly as they are, braces included, though they can move within a line.", { before: 160 }),

    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** The cast page: everyone who speaks in the export, with their production notes. */
function castPage(loaded: LoadedProject, elements: ScriptElement[]): Paragraph[] {
  const speaking = new Set(elements.filter((e): e is Extract<ScriptElement, { kind: "line" }> => e.kind === "line").map((e) => e.character).filter(Boolean));
  const cast = (loaded.project.cast ?? []).filter((c) => speaking.has(c.name));
  if (!cast.length) return [];
  return [
    new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Cast", font: SERIF, bold: true, size: S.h1, color: TOKENS.ink })] }),
    ...cast.map((c) => new Paragraph({ spacing: { after: 100 }, children: [
      new TextRun({ text: c.name.toUpperCase(), font: SANS, bold: true, size: S.cue, color: characterColour(c.name) }),
      ...(c.notes ? [new TextRun({ text: `   ${c.notes}`, font: SERIF, size: S.body, color: TOKENS.inkRead })] : []),
    ] })),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

/** `docx` gives every bookmark `w:id="1"`; give each start/end pair its own (ours never nest). */
async function renumberBookmarks(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) return buffer;
  let next = 0, open = 0;
  const xml = (await file.async("string")).replace(/<w:bookmarkStart\b([^>]*?)w:id="\d+"([^>]*)\/>|<w:bookmarkEnd w:id="\d+"\/>/g, (m, a?: string, b?: string) => {
    if (m.startsWith("<w:bookmarkStart")) { open = ++next; return `<w:bookmarkStart${a}w:id="${open}"${b}/>`; }
    return `<w:bookmarkEnd w:id="${open}"/>`;
  });
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
