// ---------------------------------------------------------------------------
// scriptToPdf pagination: a snippet edge must never be drawn across a page turn.
//
// The failure this pins (reported with a real project): an element that STARTED in the last sliver of
// a page had its body flowed onto the next page by PDFKit, after which everything placed from the
// element's remembered yTop - the snippet edge, a line's speaker cue - landed at that stale coordinate
// on the NEW page. The visible symptoms were a pale vertical line running most of the way down the
// following page and a speaker cue stranded at its foot, far from its body.
//
// The oracle is geometric, because a subset-font PDF's text is not greppable: every vertical stroke in
// the document must be drawn TOP-DOWN. PDFKit opens each page with a `1 0 0 -1` flip and writes
// y-DOWN coordinates into the stream, so a healthy stroke (yTop -> bottom) has its SMALLER y first;
// the buggy cross-page edge is the one written the other way round (a page-1 yTop, a page-2 bottom).
// Strokes are read by inflating the page content streams.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { inflateSync } from "node:zlib";
import { scriptToPdf } from "../src/index.js";
import { textRuns, type ScriptDoc, type ScriptElement } from "../src/script-doc.js";

/** Every `x0 y0 m x1 y1 l` path in the document's inflatable content streams. */
function strokes(buf: Buffer): Array<{ x0: number; y0: number; x1: number; y1: number }> {
  const out: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  const raw = buf.toString("latin1");
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    let text: string;
    try { text = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1"); } catch { continue; } // a font, an image
    const line = /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) m\n(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) l\n/g;
    for (let s = line.exec(text); s; s = line.exec(text)) {
      out.push({ x0: Number(s[1]), y0: Number(s[2]), x1: Number(s[3]), y1: Number(s[4]) });
    }
  }
  return out;
}

/** A document long enough to cross several page turns, with enough rhythm variety (a wrapping body
 *  every fifth line, a fresh snippet every eighth) that some element starts near a page's foot. */
function longDoc(): ScriptDoc {
  const elements: ScriptElement[] = [{ kind: "scene", text: "The Long Scene" }, { kind: "block", text: "The Long Block" }];
  for (let i = 0; i < 120; i++) {
    const snippet = Math.floor(i / 8);
    const text = i % 5 === 4
      ? `Line ${i}, the long one, which runs on and on for quite a while so that it wraps onto a second printed line and now and then a third, exactly the shape that crosses a page.`
      : `Line ${i}. Short.`;
    elements.push({ kind: "line", indent: 1, snippet, character: i % 2 ? "DAVE" : "MIRA", runs: textRuns(text) });
  }
  return { project: "Pagination", elements };
}

describe("scriptToPdf pagination", () => {
  it("draws every vertical stroke top-down (no snippet edge crosses a page turn)", async () => {
    const buf = await scriptToPdf(longDoc());
    const vertical = strokes(buf).filter((s) => Math.abs(s.x0 - s.x1) < 0.01);
    expect(vertical.length).toBeGreaterThan(20); // the fixture genuinely draws snippet edges
    for (const s of vertical) {
      // Stream space is y-down (PDFKit's page flip), so yTop -> bottom means y0 <= y1.
      expect(s.y0, `stroke at x=${s.x0} drawn bottom-up: an edge crossed a page turn`).toBeLessThanOrEqual(s.y1 + 0.01);
    }
  });

  it("keeps every stroke within one page's content height", async () => {
    const buf = await scriptToPdf(longDoc());
    for (const s of strokes(buf).filter((v) => Math.abs(v.x0 - v.x1) < 0.01)) {
      expect(Math.abs(s.y0 - s.y1)).toBeLessThanOrEqual(842 - 64 * 2 + 1); // A4 minus margins
    }
  });
});
