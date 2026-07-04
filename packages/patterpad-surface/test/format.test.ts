// Inline formatting: the markup <-> marks layer (format.ts) and its bridge round-trip.

import { describe, it, expect } from "vitest";
import type { Scene } from "@patterkit/model";
import { patterSchema as S } from "../src/schema.js";
import { parseMarkup, serializeMarkup } from "../src/format.js";
import { sceneToDoc, docToScene } from "../src/bridge.js";

/** Round-trip a stored markup string through parse -> a say zone -> serialize. */
const roundTrip = (s: string): string => serializeMarkup(S.node("say", null, parseMarkup(s)));

describe("format: markup <-> marks", () => {
  it("round-trips plain, bold, italic, bold+italic, and a mix", () => {
    for (const s of [
      "plain text",
      "a <b>bold</b> word",
      "an <i>italic</i> one",
      "all <bi>at once</bi> here",
      "mix <b>b</b> then <i>i</i> then <bi>both</bi> done",
    ]) expect(roundTrip(s)).toBe(s);
  });

  it("parses a bold run into a strong-marked text node", () => {
    const nodes = parseMarkup("hi <b>there</b>");
    expect(nodes).toHaveLength(2);
    expect(nodes[1]!.text).toBe("there");
    expect(nodes[1]!.marks.some((m) => m.type === S.marks.strong)).toBe(true);
  });

  it("stores literal & < > VERBATIM - no entity encoding (inside and outside tags)", () => {
    expect(roundTrip("less < more & on > end")).toBe("less < more & on > end");
    expect(roundTrip("<b>x & y</b> z")).toBe("<b>x & y</b> z"); // literal & inside a bold run survives
    expect(parseMarkup("rock & roll")[0]!.text).toBe("rock & roll");
  });

  it("decodes legacy entity-escaped strings to clean literals on read (back-compat, then writes clean)", () => {
    expect(roundTrip("less &lt; more &amp; on")).toBe("less < more & on");
    expect(parseMarkup("a &lt;b&gt; b")[0]!.text).toBe("a <b> b");
  });

  it("treats an unknown / malformed tag as literal text (degrades, never throws)", () => {
    const nodes = parseMarkup("a <x>y</x> z"); // not one of b/i/bi
    expect(nodes.map((n) => n.text).join("")).toBe("a <x>y</x> z");
    expect(nodes.every((n) => n.marks.length === 0)).toBe(true);
  });
});

describe("format: bridge round-trip", () => {
  const scene = (sid: string): Scene => ({
    id: "s", type: "scene", name: "S",
    blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "ANNA", direction: "<i>quietly</i>" }, // a direction is NOT formattable
        { id: sid, kind: "text" },
      ] },
    ] }],
  });

  it("with formatting ON, marked say + a literal ampersand survive a doc round-trip byte-identically", () => {
    const strings = { L1: "Take <b>five</b> gold & glory.", T1: "A <bi>newspaper</bi> headline." };
    const back = docToScene(sceneToDoc(scene("T1"), strings, true), true);
    expect(back.strings.T1).toBe(strings.T1);
    expect(back.strings.L1).toBe(strings.L1); // the literal "&" stays "&", never "&amp;"
    const line = back.scene.blocks[0]!.children[0] as { beats: Array<{ direction?: string; character?: string }> };
    expect(line.beats[0]!.direction).toBe("<i>quietly</i>");
    expect(line.beats[0]!.character).toBe("ANNA");
  });

  it("with formatting OFF, tag-looking text is byte-literal (no parse, no escape)", () => {
    const strings = { L1: "plain", T1: "a <b>literal</b> & < > kept" };
    const back = docToScene(sceneToDoc(scene("T1"), strings, false), false);
    expect(back.strings.T1).toBe(strings.T1);
  });
});
