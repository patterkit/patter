// ---------------------------------------------------------------------------
// Reading an editable script back (patterkit/design/proposals/editable-script-handoff.md §6).
//
// The editor's tool is Word, Google Docs, OnlyOffice, or Pages; what comes back is a `.docx`. This reads
// it in document order, and for each editable box (a one-row table whose last cell holds a marker) and
// each ordinary paragraph gives two views of the text (§6.1):
//   proposed  every tracked change accepted: insertions in, deletions out (what the editor proposes)
//   original  every tracked change rejected: deletions in, insertions out (what was there before)
// so the import can tell a tracked edit from an untracked one. Bold and italic come back as Patter's
// <b> / <i> / <bi>; other formatting is dropped. Also the comments, with their authors and replies, and the
// handoff id from the page header.
//
// Pure: bytes in, a description out. Deciding what any of it means is the import's job (editable-import.ts).
// ---------------------------------------------------------------------------

import JSZip from "jszip";
import { DOMParser } from "@xmldom/xmldom";
import { readMarker } from "./handoff.js";
import { TOKENS, CHAR_PALETTE } from "./script-doc.js";
import { BOX_FILL, MARKER_INK } from "./editable-docx.js";
import type { ReadMarker } from "./handoff.js";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// xmldom 0.8 types its nodes as the standard DOM's.
type XNode = Node;
type XElement = Element;

/** One tracked change, as found. */
export interface TrackedChange {
  kind: "insert" | "delete" | "moveFrom" | "moveTo";
  author: string;
  date?: string;
  text: string;
}

/** Text in both views, with what changed and which comments start inside it. */
export interface ReadText {
  /** Every tracked change accepted, with Patter markup for bold / italic. */
  proposed: string;
  /** Every tracked change rejected, with the same markup. */
  original: string;
  changes: TrackedChange[];
  /** Ids of comments whose range starts here (or that point here). */
  comments: string[];
  /** Formatting other than bold and italic that was dropped (colour, highlight, size, ...), counted. */
  droppedFormatting: number;
}

/** One editable box, read back. */
export interface ReadBox {
  kind: "box";
  /** The marker read from the margin cell; `recovered` when it was only found inside a tracked deletion. */
  marker?: ReadMarker & { recovered?: boolean };
  /** The words: the text cell, its paragraphs joined by a single space. */
  text: ReadText;
  /** How many paragraphs the text cell held (more than one: an Enter inside the box). */
  paragraphs: number;
  /** The lead cell (cue, direction, or ◇) and the margin cell (tag, status, marker), as plain text. */
  lead: ReadText;
  margin: ReadText;
  /** The whole row was deleted with tracking on. */
  rowDeleted: boolean;
  /** The table's left indent in twips (Google writes it as "360.0"), when given. */
  indent?: number;
}

/** An ordinary paragraph, or a table that isn't a box (its text flattened). */
export interface ReadParagraph {
  kind: "paragraph" | "table";
  text: ReadText;
  /** The paragraph style (Heading1, ...), when one is set. */
  style?: string;
}

export type ReadItem = ReadBox | ReadParagraph;

export interface ReadComment {
  id: string;
  author: string;
  date?: string;
  text: string;
  replies: Array<{ author: string; date?: string; text: string }>;
}

export interface ReturnedDoc {
  /** The handoff id from the page header (or, failing that, the front page). */
  handoffId?: string;
  /** Body content in document order. */
  items: ReadItem[];
  /** Top-level comments; replies hang off their parent. */
  comments: ReadComment[];
}

// ---------------------------------------------------------------------------

const isEl = (n: XNode | null | undefined): n is XElement => !!n && n.nodeType === 1;
const kids = (n: XNode): XElement[] => {
  const out: XElement[] = [];
  for (let c = n.firstChild; c; c = c.nextSibling) if (isEl(c)) out.push(c);
  return out;
};
const local = (e: XElement): string => e.localName ?? e.nodeName.replace(/^.*:/, "");
const attr = (e: XElement | undefined, name: string): string | undefined => {
  if (!e) return undefined;
  return e.getAttributeNS(W, name) || e.getAttribute(`w:${name}`) || undefined;
};
const child = (e: XElement, name: string): XElement | undefined => kids(e).find((c) => local(c) === name);
/** A boolean run property (`<w:b/>`, `<w:b w:val="false"/>`). */
const on = (rPr: XElement | undefined, name: string): boolean => {
  const p = rPr ? child(rPr, name) : undefined;
  if (!p) return false;
  const v = attr(p, "val");
  return v === undefined || !["false", "0", "off", "none"].includes(v);
};
/** Run properties that ARE formatting the import drops (anything beyond bold, italic, and the font). */
const DROPPED = new Set(["color", "highlight", "u", "strike", "dstrike", "shd", "caps", "smallCaps", "vertAlign"]);
/** Colours and fills the exporter itself writes (the script's inks, the box's fill). Google Docs copies them
 *  onto every run it saves, so they're no sign of an editor's formatting. Lower-case hex. */
const OWN_COLOURS = new Set([...Object.values(TOKENS), ...CHAR_PALETTE, MARKER_INK, BOX_FILL, "000000", "auto"].map((c) => c.toLowerCase()));
/** Is this run property formatting an editor added (not "off", not one of the exporter's own colours)? */
function addedFormatting(p: XElement): boolean {
  const name = local(p);
  if (!DROPPED.has(name)) return false;
  const val = (attr(p, "val") ?? "").toLowerCase();
  if (val === "none" || val === "false" || val === "0") return false;
  // Pages gives every run an underline colour with no underline (`<w:u w:color="…"/>`); a real one has a value.
  if (name === "u" && !val) return false;
  if (name === "color") return !OWN_COLOURS.has(val || "auto");
  if (name === "shd") return !OWN_COLOURS.has((attr(p, "fill") ?? "auto").toLowerCase());
  if (name === "smallCaps" || name === "caps") return false; // the exporter's tags and cues use them
  return true;
}

/** Which view a stretch of the document belongs to. */
type View = "both" | "proposed" | "original";

interface Piece { text: string; bold: boolean; italic: boolean; view: View }

/** Walks a paragraph-ish subtree, collecting pieces of text by view, changes, and comment starts. */
class Collector {
  readonly pieces: Piece[] = [];
  readonly changes: TrackedChange[] = [];
  readonly comments: string[] = [];
  dropped = 0;

  walk(node: XElement, view: View, change?: TrackedChange): void {
    for (const e of kids(node)) {
      switch (local(e)) {
        case "r": this.run(e, view, change); break;
        case "ins": this.tracked(e, "insert", "proposed"); break;
        case "del": this.tracked(e, "delete", "original"); break;
        case "moveTo": this.tracked(e, "moveTo", "proposed"); break;
        case "moveFrom": this.tracked(e, "moveFrom", "original"); break;
        case "commentRangeStart": { const id = attr(e, "id"); if (id !== undefined) this.comment(id); break; }
        case "pPr": case "rPr": case "bookmarkStart": case "bookmarkEnd": case "commentRangeEnd": case "proofErr": break;
        default: this.walk(e, view, change); // hyperlink, smartTag, sdt / sdtContent, fldSimple, ...
      }
    }
  }

  private tracked(e: XElement, kind: TrackedChange["kind"], view: View): void {
    const change: TrackedChange = { kind, author: attr(e, "author") ?? "", ...(attr(e, "date") ? { date: attr(e, "date")! } : {}), text: "" };
    this.changes.push(change);
    this.walk(e, view, change);
  }

  private run(r: XElement, view: View, change?: TrackedChange): void {
    const rPr = child(r, "rPr");
    const bold = on(rPr, "b"), italic = on(rPr, "i");
    if (rPr && kids(rPr).some(addedFormatting)) this.dropped++;
    for (const e of kids(r)) {
      const name = local(e);
      let text: string | undefined;
      if (name === "t" || name === "delText") text = e.textContent ?? "";
      else if (name === "tab") text = "\t";
      else if (name === "br" || name === "cr") text = "\n";
      else if (name === "commentReference") { const id = attr(e, "id"); if (id !== undefined) this.comment(id); }
      if (text === undefined) continue;
      this.pieces.push({ text, bold, italic, view });
      if (change) change.text += text;
    }
  }

  private comment(id: string): void { if (!this.comments.includes(id)) this.comments.push(id); }

  /** One view's text, adjacent same-format pieces merged, bold / italic as Patter markup. */
  text(view: "proposed" | "original"): string {
    let out = "", open = "";
    for (const p of this.pieces) {
      if (p.view !== "both" && p.view !== view) continue;
      const tag = p.bold && p.italic ? "bi" : p.bold ? "b" : p.italic ? "i" : "";
      if (tag !== open) { if (open) out += `</${open}>`; if (tag) out += `<${tag}>`; open = tag; }
      out += p.text;
    }
    if (open) out += `</${open}>`;
    return out;
  }

  read(): ReadText {
    return { proposed: this.text("proposed"), original: this.text("original"), changes: this.changes, comments: this.comments, droppedFormatting: this.dropped };
  }
}

/** Read a list of paragraphs (a cell, a table) as one text, paragraphs joined by `joiner`. */
function readParagraphs(ps: XElement[], joiner: string): { text: ReadText; paragraphs: number } {
  const parts = ps.map((p) => { const c = new Collector(); c.walk(p, "both"); return c; });
  // A paragraph whose mark itself was inserted or deleted is a tracked Enter; its text is in the pieces
  // already, so it only matters as a join, and joining with a space is right for both views.
  const join = (view: "proposed" | "original"): string => parts.map((c) => c.text(view)).filter((t) => t !== "").join(joiner);
  return {
    text: {
      proposed: join("proposed"), original: join("original"),
      changes: parts.flatMap((c) => c.changes), comments: [...new Set(parts.flatMap((c) => c.comments))],
      droppedFormatting: parts.reduce((n, c) => n + c.dropped, 0),
    },
    paragraphs: ps.length,
  };
}

/** Every `w:p` under a node, in order (a cell's content may nest them in sdt or other wrappers). */
function paragraphsIn(node: XElement): XElement[] {
  const out: XElement[] = [];
  const visit = (n: XElement): void => { for (const c of kids(n)) { if (local(c) === "p") out.push(c); else if (local(c) !== "tbl") visit(c); } };
  visit(node);
  return out;
}

/** Context text with its formatting dropped: in the lead and margin cells, bold is the design (the
 *  cue), not something anyone said. Only a box's words carry markup. */
function plain(t: ReadText): ReadText {
  const strip = (s: string): string => s.replace(/<\/?(?:b|i|bi)>/g, "");
  return { ...t, proposed: strip(t.proposed), original: strip(t.original) };
}

function readRow(tr: XElement, indent: number | undefined): ReadItem {
  const cells = kids(tr).filter((c) => local(c) === "tc");
  const cellText = (tc: XElement | undefined, joiner = " ") => readParagraphs(tc ? paragraphsIn(tc) : [], joiner);
  const last = cellText(cells[cells.length - 1]);
  const found = readMarker(last.text.proposed);
  const recovered = found ? undefined : readMarker(last.text.original);
  const marker = found ?? (recovered ? { ...recovered, recovered: true } : undefined);
  if (cells.length < 2 || !marker) {
    return { kind: "table", text: readParagraphs(cells.flatMap(paragraphsIn), " ").text };
  }
  const words = cellText(cells.length >= 3 ? cells[1] : cells[0]);
  const trPr = child(tr, "trPr");
  return {
    kind: "box",
    marker,
    text: words.text,
    paragraphs: words.paragraphs,
    lead: plain(cells.length >= 3 ? cellText(cells[0], "\n").text : readParagraphs([], " ").text),
    margin: plain(last.text),
    rowDeleted: !!(trPr && child(trPr, "del")),
    ...(indent !== undefined ? { indent } : {}),
  };
}

/** Read the body: paragraphs and table rows, in order. */
function readBody(body: XElement): ReadItem[] {
  const items: ReadItem[] = [];
  for (const e of kids(body)) {
    const name = local(e);
    if (name === "p") {
      const c = new Collector(); c.walk(e, "both");
      const style = attr(child(child(e, "pPr") ?? e, "pStyle"), "val");
      items.push({ kind: "paragraph", text: c.read(), ...(style ? { style } : {}) });
    } else if (name === "tbl") {
      const tblPr = child(e, "tblPr");
      const ind = tblPr ? attr(child(tblPr, "tblInd"), "w") : undefined;
      const indent = ind !== undefined && ind !== "" && Number.isFinite(Number(ind)) ? Number(ind) : undefined;
      for (const tr of kids(e).filter((c) => local(c) === "tr")) items.push(readRow(tr, indent));
    } else if (name === "sdt") {
      const content = child(e, "sdtContent");
      if (content) items.push(...readBody(content));
    }
  }
  return items;
}

/** Comments with their replies (Word links a reply to its parent through commentsExtended.xml). */
function readComments(commentsXml: string | undefined, extendedXml: string | undefined): ReadComment[] {
  if (!commentsXml) return [];
  const doc = new DOMParser().parseFromString(commentsXml, "text/xml");
  const all: Array<ReadComment & { paraIds: string[] }> = [];
  for (const c of kids(doc.documentElement as unknown as XElement).filter((e) => local(e) === "comment")) {
    const ps = paragraphsIn(c);
    all.push({
      id: attr(c, "id") ?? "", author: attr(c, "author") ?? "", ...(attr(c, "date") ? { date: attr(c, "date")! } : {}),
      text: readParagraphs(ps, "\n").text.proposed.replace(/<\/?(b|i|bi)>/g, ""), replies: [],
      paraIds: ps.map((p) => p.getAttribute("w14:paraId") ?? "").filter(Boolean),
    });
  }
  const parentOf = new Map<string, string>(); // paraId -> parent paraId
  if (extendedXml) {
    const ext = new DOMParser().parseFromString(extendedXml, "text/xml");
    for (const e of kids(ext.documentElement as unknown as XElement)) {
      const id = e.getAttribute("w15:paraId"), parent = e.getAttribute("w15:paraIdParent");
      if (id && parent) parentOf.set(id, parent);
    }
  }
  const byPara = new Map<string, ReadComment & { paraIds: string[] }>();
  for (const c of all) for (const p of c.paraIds) byPara.set(p, c);
  const top: Array<ReadComment & { paraIds: string[] }> = [];
  for (const c of all) {
    const parentPara = c.paraIds.map((p) => parentOf.get(p)).find(Boolean);
    const parent = parentPara ? byPara.get(parentPara) : undefined;
    if (parent && parent !== c) parent.replies.push({ author: c.author, ...(c.date ? { date: c.date } : {}), text: c.text });
    else top.push(c);
  }
  return top.map(({ paraIds: _p, ...c }) => c);
}

const HANDOFF_ID = /Handoff (H-[0-9A-Z]{4})\b/;

/** Read a returned editable script. Throws only when the bytes aren't a .docx at all. */
export async function readEditableDocx(bytes: Buffer | Uint8Array): Promise<ReturnedDoc> {
  const zip = await JSZip.loadAsync(bytes);
  const text = async (path: string): Promise<string | undefined> => zip.file(path)?.async("string");
  const documentXml = await text("word/document.xml");
  if (!documentXml) throw new Error("not a Word document (no word/document.xml)");

  const doc = new DOMParser().parseFromString(documentXml, "text/xml");
  const body = kids(doc.documentElement as unknown as XElement).find((e) => local(e) === "body");
  const items = body ? readBody(body) : [];

  // The handoff id: from any header, else the front page (a tool that dropped the header).
  let handoffId: string | undefined;
  for (const name of Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).sort()) {
    const h = new DOMParser().parseFromString((await text(name))!, "text/xml");
    const m = HANDOFF_ID.exec(h.documentElement?.textContent ?? "");
    if (m) { handoffId = m[1]; break; }
  }
  if (!handoffId) {
    for (const it of items.slice(0, 12)) { const m = HANDOFF_ID.exec(it.text.proposed); if (m) { handoffId = m[1]; break; } }
  }

  const comments = readComments(await text("word/comments.xml"), await text("word/commentsExtended.xml"));
  return { ...(handoffId ? { handoffId } : {}), items, comments };
}
