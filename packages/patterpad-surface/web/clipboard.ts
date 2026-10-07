// Reading the clipboard into PARAGRAPHS for src/paste.ts (review 2026-10, ruling E). HTML wins over
// plain text when both are there, because it carries bold and italic; the marks are read by the
// schema's own parse rules (ProseMirror's DOMParser into a lone say zone), so a paste and the schema
// can never disagree about what counts as bold - including Google Docs' `<b style="font-weight:normal">`
// wrapper, which made every pasted run bold before.
//
// The paragraph boundaries are what ProseMirror's parser cannot give us here (no node has a parse
// rule), so a separator character is planted at the end of every block-level element and at every
// <br> before parsing, and the parsed run is cut at it afterwards. A copy from this editor arrives as
// its own schema HTML: the speaker and direction zones and the game-event atom are removed first, so
// a copied dialogue line pastes as its words alone.

import { DOMParser as PMDOMParser, Fragment, type Node as PMNode } from "prosemirror-model";
import { patterSchema as S } from "../src/schema.js";
import { textParagraphs } from "../src/paste.js";

const SEP = "\u2029"; // PARAGRAPH SEPARATOR: never collapsed as whitespace by the parser
const BLOCK = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "TR", "DT", "DD", "SECTION", "ARTICLE"]);
const DROP = "style, script, head, meta, title, .zone.cue, .zone.paren, .kind-gameEvent, svg";

/** Trim a run of text nodes at both ends, keeping each node's marks, and drop any left empty. */
function trimRun(nodes: PMNode[]): Fragment {
  const texts = nodes.map((n) => ({ text: n.text ?? "", marks: n.marks }));
  if (texts.length) {
    texts[0]!.text = texts[0]!.text.replace(/^\s+/, "");
    texts[texts.length - 1]!.text = texts[texts.length - 1]!.text.replace(/\s+$/, "");
  }
  return Fragment.fromArray(texts.filter((t) => t.text.length > 0).map((t) => S.text(t.text, t.marks)));
}

/** Split parsed inline content at the separator into paragraphs, trimming each and dropping blanks. */
function splitAtSeparator(content: Fragment): Fragment[] {
  const paras: PMNode[][] = [[]];
  content.forEach((n) => {
    (n.text ?? "").split(SEP).forEach((part, i) => {
      if (i > 0) paras.push([]);
      if (part) paras[paras.length - 1]!.push(S.text(part, n.marks));
    });
  });
  return paras.map(trimRun).filter((f) => f.size > 0 && f.textBetween(0, f.size).trim().length > 0);
}

/** Clipboard HTML to paragraphs of marked inline text. */
export function htmlParagraphs(html: string): Fragment[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  body.querySelectorAll(DROP).forEach((el) => el.remove());
  body.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode(SEP)));
  const blocks: Element[] = [];
  body.querySelectorAll("*").forEach((el) => { if (BLOCK.has(el.tagName)) blocks.push(el); });
  for (const el of blocks) el.append(doc.createTextNode(SEP));
  const say = PMDOMParser.fromSchema(S).parse(body, { topNode: S.nodes.say!.create() });
  return splitAtSeparator(say.content);
}

/** The paragraphs a paste carries: from its HTML when it has any text, else its plain text. */
export function clipboardParagraphs(html: string | null | undefined, text: string | null | undefined): Fragment[] {
  if (html && html.trim()) {
    const paras = htmlParagraphs(html);
    if (paras.length) return paras;
  }
  return textParagraphs(text ?? "");
}
