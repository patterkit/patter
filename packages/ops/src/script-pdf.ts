// ---------------------------------------------------------------------------
// Render a ScriptDoc to a .pdf screenplay, set like a printed paper script. A view over runScriptDoc, like
// script-docx. Pure: ScriptDoc in, Buffer out (collected from PDFKit's stream; no file I/O).
//
// The design's three type ROLES are embedded as real faces (script-fonts.ts, no font files to ship):
//   serif = Newsreader     - reading: dialogue, narration, headings
//   sans  = Inter          - chrome: character cues, group labels, option tags
//   mono  = IBM Plex Mono  - machine text: conditions, {@property} values, game events
// Those are Latin subsets, so any glyph they lack (the ◇ ↪ ⚙ marks, maths, arrows, Greek, Cyrillic) routes
// per-character to DejaVu Sans (symbol) and emoji to Noto Emoji - full coverage preserved, no tofu.
//
// Structure is carried by indent + space on a white page. Where snippets cluster inside a selector (a
// sequence's steps, a branch's rows, a choice's options) a LIGHT vertical edge brackets each snippet, so
// rows that would otherwise blur read as distinct beats; the gaps between edges show the delimitation.
// ---------------------------------------------------------------------------

import PDFDocument from "pdfkit";
import { TOKENS, characterColour, textRuns, type ScriptDoc, type ScriptElement, type TextRun } from "./script-doc.js";

const MARGIN = 64;
const INDENT_STEP = 20;      // points per structural nesting level
const EDGE_INSET = 12;       // points a snippet's content insets from its indent, leaving room for the edge
const EDGE_OFF = 3;          // points from the indent base to the snippet edge
const DIALOGUE_INDENT = 14;  // points a spoken line insets from prose (its cue column)
const HANG = 18;             // points the option marker out-dents (hanging indent)
const CUE_GAP = 7;           // points between the speaker cue and the dialogue body
const BODY = 11, CUE = 8.5;  // reading body / speaker-cue sizes (pt)
const LEAD = 3.5;            // extra points between wrapped body lines (~1.5 line-height)
const WITHIN = 4, BETWEEN = 10, BEAT = 6, TIGHT = 3; // vertical gaps: within a snippet / between snippets / top-level beats / condition-to-beat

const hex = (h: string): string => `#${h}`;
const INK = hex(TOKENS.ink), INK_READ = hex(TOKENS.inkRead), INK_SOFT = hex(TOKENS.inkSoft);
const MUTED = hex(TOKENS.muted), ACCENT = hex(TOKENS.accent), LINE = hex(TOKENS.line);
const EDGE = "#d7d0c3"; // the light per-snippet edge - a pale warm grey, quieter than a heading rule

const SERIF = (bold: boolean, italic: boolean): string =>
  bold && italic ? "Serif-BoldItalic" : bold ? "Serif-Bold" : italic ? "Serif-Italic" : "Serif";

/** A piece of text to draw in one font + colour. */
interface Piece { text: string; font: string; color: string }
const isEmoji = (cp: number): boolean => cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf);

/** Render the readable screenplay as a PDF. Resolves once PDFKit has flushed the whole document. */
export async function scriptToPdf(doc: ScriptDoc): Promise<Buffer> {
  const { scriptFont } = await import("./script-fonts.js"); // lazy: only a PDF export pays the font decode
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: "A4", margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN }, info: { Title: doc.project, Author: "Patter" } });
    pdf.registerFont("Serif", scriptFont("serif"));
    pdf.registerFont("Serif-Bold", scriptFont("serifBold"));
    pdf.registerFont("Serif-Italic", scriptFont("serifItalic"));
    pdf.registerFont("Serif-BoldItalic", scriptFont("serifBoldItalic"));
    pdf.registerFont("Sans", scriptFont("sans"));
    pdf.registerFont("Sans-Bold", scriptFont("sansBold"));
    pdf.registerFont("Mono", scriptFont("mono"));
    pdf.registerFont("Symbol", scriptFont("symbol"));
    pdf.registerFont("Emoji", scriptFont("emoji"));

    // Per-primary glyph coverage + ascent (both via PDFKit's underlying fontkit font): coverage routes a
    // char the primary lacks to the Symbol / Emoji fallback; ascent lets us baseline-align a small cue
    // beside larger body text (PDFKit's `continued` chaining mis-aligns baselines across fonts).
    const coverage: Record<string, (cp: number) => boolean> = {};
    const ascender: Record<string, number> = {};
    for (const name of ["Serif", "Serif-Bold", "Serif-Italic", "Serif-BoldItalic", "Sans", "Sans-Bold", "Mono"]) {
      pdf.font(name);
      const f = (pdf as unknown as { _font: { font: { hasGlyphForCodePoint(cp: number): boolean }; ascender: number } })._font;
      coverage[name] = (cp: number): boolean => f.font.hasGlyphForCodePoint(cp);
      ascender[name] = f.ascender; // per 1000 em units
    }
    const ascentPt = (name: string, size: number): number => (ascender[name]! / 1000) * size;

    /** Split a run so each char draws in a font that has its glyph: emoji -> Emoji; else the primary face if
     *  it covers the char; else the Symbol (DejaVu) fallback. */
    const split = (text: string, primary: string, color: string): Piece[] => {
      const cov = coverage[primary]!;
      const out: Piece[] = []; let buf = ""; let cur = primary;
      for (const ch of text) {
        const cp = ch.codePointAt(0)!;
        const f = isEmoji(cp) ? "Emoji" : cov(cp) ? primary : "Symbol";
        if (f !== cur) { if (buf) out.push({ text: buf, font: cur, color }); buf = ""; cur = f; }
        buf += ch;
      }
      if (buf) out.push({ text: buf, font: cur, color });
      return out;
    };
    /** Body runs (dialogue / narration / option) as pieces: prose in the serif, `{@property}` runs in accent
     *  mono; `<b>/<i>/<bi>` markup rides each run. `base` forces bold/italic. */
    const bodyPieces = (runs: TextRun[], color: string, base: { bold?: boolean; italic?: boolean } = {}): Piece[] =>
      runs.flatMap((r) => r.code ? split(r.text, "Mono", ACCENT) : split(r.text, SERIF(base.bold || r.bold, base.italic || r.italic), color));

    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const pageRight = pdf.page.width - MARGIN;
    const pageBottom = pdf.page.height - MARGIN;
    const contentW = pdf.page.width - MARGIN * 2;
    const ensure = (space: number): void => { if (pdf.y > pageBottom - space) pdf.addPage(); };

    // Draw font+colour-tagged pieces as one flowing paragraph (PDFKit `continued` chaining).
    const draw = (pieces: Piece[], x: number, opts: PDFKit.Mixins.TextOptions): void => {
      pieces.forEach((p, i) => {
        pdf.font(p.font).fillColor(p.color);
        const cont = i < pieces.length - 1;
        if (i === 0) pdf.text(p.text, x, pdf.y, { ...opts, continued: cont });
        else pdf.text(p.text, { continued: cont });
      });
    };
    // Draw pieces right-aligned on their own line (measure, place flush right; the last piece advances a line).
    const drawRight = (pieces: Piece[], size: number): void => {
      let total = 0;
      for (const p of pieces) { pdf.font(p.font).fontSize(size); total += pdf.widthOfString(p.text); }
      const x = Math.max(MARGIN, pageRight - total);
      pieces.forEach((p, i) => {
        pdf.font(p.font).fillColor(p.color).fontSize(size);
        const cont = i < pieces.length - 1;
        if (i === 0) pdf.text(p.text, x, pdf.y, { continued: cont }); else pdf.text(p.text, { continued: cont });
      });
    };

    // Cover.
    pdf.fontSize(9); draw(split("READABLE SCRIPT", "Sans-Bold", ACCENT), MARGIN, { characterSpacing: 2 });
    pdf.moveDown(0.4).fontSize(26); draw(split(doc.project, "Serif-Bold", INK), MARGIN, { width: contentW });
    pdf.strokeColor(ACCENT).lineWidth(2).moveTo(MARGIN, pdf.y + 10).lineTo(MARGIN + 40, pdf.y + 10).stroke();
    pdf.y += 28;

    // Draw one element's CONTENT (no vertical spacing - the caller owns leads / trails and the snippet edge).
    const drawContent = (el: ScriptElement, cx: number): void => {
      const w = pageRight - cx;
      switch (el.kind) {
        case "scene":
          pdf.fontSize(17); draw(split(el.text, "Serif-Bold", INK), MARGIN, { width: contentW });
          pdf.strokeColor(ACCENT).lineWidth(1.5).moveTo(MARGIN, pdf.y + 4).lineTo(MARGIN + 34, pdf.y + 4).stroke();
          break;
        case "block":
          pdf.fontSize(13); draw(split(el.text, "Serif-Bold", INK), MARGIN, { width: contentW });
          pdf.strokeColor(LINE).lineWidth(0.75).moveTo(MARGIN, pdf.y + 3).lineTo(pageRight, pdf.y + 3).stroke();
          break;
        case "line": {
          // Two columns: the dialogue body wraps in its own block; the coloured uppercase cue sits to its
          // left, baseline-aligned to the body's first line (colour + case carry it, no colon).
          const cueX = cx + DIALOGUE_INDENT;
          let bodyX = cueX;
          if (el.character) { pdf.font("Sans-Bold").fontSize(CUE); bodyX = cueX + pdf.widthOfString(el.character.toUpperCase()) + CUE_GAP; }
          const yTop = pdf.y;
          pdf.fontSize(BODY);
          draw([...(el.direction ? split(`(${el.direction})  `, "Serif-Italic", MUTED) : []), ...bodyPieces(el.runs, INK_READ)], bodyX, { width: Math.max(120, pageRight - bodyX), lineGap: LEAD });
          const yEnd = pdf.y;
          if (el.character) { pdf.font("Sans-Bold").fontSize(CUE).fillColor(hex(characterColour(el.character))).text(el.character.toUpperCase(), cueX, yTop + ascentPt("Serif", BODY) - ascentPt("Sans-Bold", CUE), { lineBreak: false }); }
          pdf.y = yEnd;
          break;
        }
        case "narration":
          pdf.fontSize(BODY); draw(bodyPieces(el.runs, INK_SOFT), cx, { width: w, lineGap: LEAD });
          break;
        case "condition":
          pdf.fontSize(9.5); draw(split(`‹ ${el.text} ›`, "Mono", ACCENT), cx, { width: w });
          break;
        case "group":
          pdf.fontSize(8); draw(split(el.label.toUpperCase(), "Sans-Bold", ACCENT), cx, { width: w, characterSpacing: 1.2 });
          break;
        case "else":
          pdf.fontSize(8); draw(split("ELSE · CATCH-ALL", "Sans", MUTED), cx, { width: w, characterSpacing: 1 });
          break;
        case "option": {
          // ◇ marker out-dented (hanging); a quiet uppercase flag tag right-aligned on the first line.
          const ox = cx + HANG;
          const tag = el.tag ? el.tag.toUpperCase() : "";
          const tagW = tag ? pdf.font("Sans").fontSize(7.5).widthOfString(tag) + 8 : 0;
          const yStart = pdf.y;
          pdf.fontSize(BODY);
          draw([...split("◇  ", "Serif", ACCENT), ...bodyPieces(el.runs, INK)], ox, { width: Math.max(80, pageRight - ox - tagW), indent: -HANG, lineGap: LEAD });
          const yEnd = pdf.y;
          if (tag && yEnd >= yStart) { pdf.font("Sans").fontSize(7.5).fillColor(MUTED).text(tag, pageRight - tagW, yStart, { width: tagW, align: "right", lineBreak: false }); pdf.y = yEnd; }
          break;
        }
        case "jump":
          drawRight(split(`↪  ${el.text}`, "Sans-Bold", ACCENT), 9.5);
          break;
        case "gameEvent":
          drawRight(split(`⚙  ${el.text}`, "Mono", ACCENT), 9);
          break;
      }
    };

    // Structural lead (space BEFORE the element); snippet beats carry none (their spacing is the prior trail).
    const leadOf = (k: ScriptElement["kind"]): number => k === "scene" ? 24 : k === "block" ? 16 : k === "group" ? 13 : k === "else" ? 9 : 0;

    const els = doc.elements;
    let curSid: number | undefined; // the snippet id + its base indent for the edge currently being drawn
    let curBase = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i]!;
      const next = els[i + 1];
      const sid = "snippet" in el ? el.snippet : undefined;
      const sameNext = sid !== undefined && next !== undefined && "snippet" in next && next.snippet === sid;

      if (el.kind === "scene") ensure(90); else if (el.kind === "block") ensure(70);
      pdf.y += leadOf(el.kind);

      const base = "indent" in el ? MARGIN + el.indent * INDENT_STEP : MARGIN;
      const cx = base + (sid !== undefined ? EDGE_INSET : 0);
      const yTop = pdf.y;
      drawContent(el, cx);
      const bottom = pdf.y;

      // Trailing space: tight condition->beat; within vs between snippets inside a selector; a moderate gap
      // for top-level beats; a little air after headings / labels.
      const trail = el.kind === "condition" ? TIGHT
        : el.kind === "scene" ? 12 : el.kind === "block" ? 11 : el.kind === "group" ? 7 : el.kind === "else" ? 4
        : sid !== undefined ? (sameNext ? WITHIN : BETWEEN) : BEAT;

      // The light per-snippet edge: one straight line at the snippet's base indent, spanning the snippet's
      // elements. It bridges the within-snippet gap but stops at the last element, so the between-snippet gap
      // leaves a clear break.
      if (sid !== undefined) {
        if (sid !== curSid) { curSid = sid; curBase = "indent" in el ? el.indent : 0; }
        const ex = MARGIN + curBase * INDENT_STEP + EDGE_OFF;
        pdf.strokeColor(EDGE).lineWidth(0.75).moveTo(ex, yTop).lineTo(ex, bottom + (sameNext ? trail : 0)).stroke();
      }

      pdf.y = bottom + trail;
    }
    pdf.end();
  });
}
