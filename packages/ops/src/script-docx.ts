// ---------------------------------------------------------------------------
// Render a ScriptDoc to a .docx (Word) screenplay, set like a printed paper script. A view over
// runScriptDoc, like voice-script-xlsx. Pure: ScriptDoc in, Buffer out (no I/O). Full Unicode (Word embeds
// its own fonts), so any source language and emoji render.
//
// Word can't carry custom faces, so the design's three type roles map to faces present on every machine:
// reading serif -> Georgia, UI sans (cues / labels / tags) -> Calibri, mono (conditions / {@property} /
// game events) -> Consolas. Structure is carried by colour, case, indent and space (this is paper, not the
// editor UI). Word can't draw the PDF's per-snippet edge cheaply, so a snippet's rows are delimited by a
// wider space BEFORE each snippet's first line, tight within - each beat is its own paragraph either way.
// ---------------------------------------------------------------------------

import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, TabStopType, TextRun } from "docx";
import { TOKENS, characterColour, textRuns, type ScriptDoc, type ScriptElement, type TextRun as Run } from "./script-doc.js";

const SERIF = "Georgia";     // reading: dialogue, narration, headings
const SANS = "Calibri";      // chrome: character cues, group labels, option tags
const MONO = "Consolas";     // machine text: conditions, {@property} values, game events

const STEP = 360;            // twips (~0.25") per structural nesting level
const SNIPPET_INSET = 220;   // twips a snippet's rows inset under their selector label
const DIALOGUE_INDENT = 300; // twips a spoken line insets from prose (its cue column)
const HANG = 340;            // twips the cue / option marker out-dents (hanging indent)
const RIGHT_TAB = 9020;      // twips - the usable text width (A4, default margins); option-tag right edge
const SNIP_GAP = 170;        // twips before a snippet's FIRST row (delimits snippets); tight within
const WITHIN = 30;           // twips before a within-snippet row

const S = { h1: 32, h2: 26, body: 22, cue: 18, label: 16, tag: 15, mech: 18 }; // half-points

/** Body runs (dialogue / narration / option) as Word runs. `color` sets the prose ink; `{@property}` runs
 *  switch to accent mono; `<b>/<i>/<bi>` markup rides each run. `base` forces bold/italic over the whole. */
function bodyRuns(runs: Run[], color: string, base: { bold?: boolean; italic?: boolean } = {}): TextRun[] {
  return runs.map((r) => r.code
    ? new TextRun({ text: r.text, font: MONO, color: TOKENS.accent, size: S.body - 2 })
    : new TextRun({ text: r.text, font: SERIF, color, size: S.body, bold: base.bold || r.bold || undefined, italics: base.italic || r.italic || undefined }));
}

/** Left indent (twips) for an element: its nesting depth, plus a small inset for a snippet's rows. */
const leftOf = (el: ScriptElement): number => ("indent" in el ? el.indent * STEP : 0) + ("snippet" in el && el.snippet !== undefined ? SNIPPET_INSET : 0);

/** One ScriptElement -> one Word paragraph. `prev` sets the space before: a wider gap starts a new snippet. */
function paragraph(el: ScriptElement, prev: ScriptElement | undefined): Paragraph {
  const sid = "snippet" in el ? el.snippet : undefined;
  const startsSnippet = sid !== undefined && (!prev || !("snippet" in prev) || prev.snippet !== sid);
  const before = sid !== undefined ? (startsSnippet ? SNIP_GAP : WITHIN) : 100; // snippet rows vs top-level beats
  switch (el.kind) {
    case "scene":
      return new Paragraph({
        heading: HeadingLevel.HEADING_1, keepNext: true, spacing: { before: 480, after: 200 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: TOKENS.accent, space: 6 } },
        children: [new TextRun({ text: el.text, font: SERIF, bold: true, color: TOKENS.ink, size: S.h1 })],
      });
    case "block":
      return new Paragraph({
        heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 360, after: 160 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: TOKENS.line, space: 4 } },
        children: [new TextRun({ text: el.text, font: SERIF, bold: true, color: TOKENS.ink, size: S.h2 })],
      });
    case "line": {
      // The spoken line insets by DIALOGUE_INDENT; the cue then out-dents by HANG (hanging indent) so the
      // coloured speaker name sticks out left of the wrapped dialogue. Colour + case carry it (no colon).
      const kids: TextRun[] = [];
      if (el.character) kids.push(new TextRun({ text: el.character.toUpperCase(), font: SANS, bold: true, allCaps: true, color: characterColour(el.character), size: S.cue }), new TextRun({ text: "  ", font: SANS, size: S.cue }));
      if (el.direction) kids.push(new TextRun({ text: `(${el.direction})  `, font: SERIF, italics: true, color: TOKENS.muted, size: S.body }));
      kids.push(...bodyRuns(el.runs, TOKENS.inkRead));
      return new Paragraph({ keepLines: true, spacing: { before, after: 20 }, indent: { left: leftOf(el) + DIALOGUE_INDENT + HANG, hanging: HANG }, children: kids });
    }
    case "narration":
      return new Paragraph({ keepLines: true, spacing: { before, after: 20 }, indent: { left: leftOf(el) }, children: bodyRuns(el.runs, TOKENS.inkSoft) });
    case "condition":
      return new Paragraph({ keepNext: true, spacing: { before, after: 20 }, indent: { left: leftOf(el) }, children: [new TextRun({ text: `‹ ${el.text} ›`, font: MONO, color: TOKENS.accent, size: S.mech - 1 })] });
    case "group":
      return new Paragraph({ keepNext: true, spacing: { before: 260, after: 60 }, indent: { left: el.indent * STEP }, children: [new TextRun({ text: el.label.toUpperCase(), font: SANS, bold: true, allCaps: true, color: TOKENS.accent, size: S.label, characterSpacing: 14 })] });
    case "else":
      return new Paragraph({ keepNext: true, spacing: { before: 140, after: 20 }, indent: { left: el.indent * STEP }, children: [new TextRun({ text: "else · catch-all", font: SANS, allCaps: true, color: TOKENS.muted, size: S.label, characterSpacing: 12 })] });
    case "option": {
      const kids: TextRun[] = [new TextRun({ text: "◇  ", color: TOKENS.accent, size: S.body }), ...bodyRuns(el.runs, TOKENS.ink)];
      if (el.tag) kids.push(new TextRun({ text: "\t", size: S.body }), new TextRun({ text: el.tag, font: SANS, smallCaps: true, color: TOKENS.muted, size: S.tag }));
      return new Paragraph({ keepLines: true, spacing: { before, after: 20 }, indent: { left: leftOf(el) + HANG, hanging: HANG }, tabStops: el.tag ? [{ type: TabStopType.RIGHT, position: RIGHT_TAB }] : undefined, children: kids });
    }
    case "jump":
      return new Paragraph({ keepLines: true, alignment: AlignmentType.RIGHT, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: `↪  ${el.text}`, font: SANS, bold: true, color: TOKENS.accent, size: S.mech })] });
    case "gameEvent":
      return new Paragraph({ keepLines: true, alignment: AlignmentType.RIGHT, spacing: { before: 40, after: 40 }, children: [new TextRun({ text: `⚙  ${el.text}`, font: MONO, color: TOKENS.accent, size: S.mech - 2 })] });
  }
}

/** Render the readable screenplay as a Word document. */
export async function scriptToDocx(doc: ScriptDoc): Promise<Buffer> {
  const body: Paragraph[] = [
    new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: "Readable script", font: SANS, bold: true, allCaps: true, color: TOKENS.accent, size: 16, characterSpacing: 30 })] }),
    new Paragraph({ spacing: { after: 560 }, children: [new TextRun({ text: doc.project, font: SERIF, bold: true, color: TOKENS.ink, size: 52 })] }),
    ...doc.elements.map((el, i) => paragraph(el, doc.elements[i - 1])),
  ];
  const document = new Document({ creator: "Patter", title: doc.project, sections: [{ children: body }] });
  return Packer.toBuffer(document);
}
