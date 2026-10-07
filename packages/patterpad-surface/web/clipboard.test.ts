// @vitest-environment jsdom
// Reading the clipboard into paragraphs (review 2026-10, ruling E and the LOW Google Docs finding).
// The marks come from the schema's own parse rules, so a paste and the schema agree on what is bold.

import { describe, it, expect } from "vitest";
import type { Fragment } from "prosemirror-model";
import { clipboardParagraphs, htmlParagraphs } from "./clipboard.js";

/** A paragraph as "text" with [b]...[/b] / [i]...[/i] around marked runs, for readable assertions. */
const show = (f: Fragment): string => {
  let out = "";
  f.forEach((n) => {
    const b = n.marks.some((m) => m.type.name === "strong"), i = n.marks.some((m) => m.type.name === "em");
    let t = n.text ?? "";
    if (i) t = `[i]${t}[/i]`;
    if (b) t = `[b]${t}[/b]`;
    out += t;
  });
  return out;
};

describe("clipboard paragraphs", () => {
  it("a Google Docs copy is not all bold: its <b style=font-weight:normal> wrapper is not bold", () => {
    const html = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr"><span style="font-weight:400;">Plain words, then </span><span style="font-weight:700;">bold</span><span style="font-weight:400;">.</span></p><p dir="ltr"><span style="font-weight:400;font-style:italic;">Second</span></p></b>';
    expect(htmlParagraphs(html).map(show)).toEqual(["Plain words, then [b]bold[/b].", "[i]Second[/i]"]);
  });

  it("keeps block boundaries and <br> as paragraph breaks, and drops blank ones", () => {
    expect(htmlParagraphs("<div>One</div><div><br></div><p>Two<br>Three</p>").map(show)).toEqual(["One", "Two", "Three"]);
  });

  it("this editor's own HTML pastes as words: no speaker, no direction, no game event", () => {
    const html = '<div class="beat kind-line"><span class="zone cue">ANNA</span><span class="zone paren">softly</span><span class="zone say">Hello <strong>you</strong></span></div>'
      + '<div class="beat kind-gameEvent"><span class="atom-glyph"></span></div><div class="beat kind-prose"><span class="zone say">Narration</span></div>';
    expect(htmlParagraphs(html).map(show)).toEqual(["Hello [b]you[/b]", "Narration"]);
  });

  it("falls back to the plain text when there is no HTML", () => {
    expect(clipboardParagraphs("", "One\n\nTwo").map(show)).toEqual(["One", "Two"]);
  });
});
