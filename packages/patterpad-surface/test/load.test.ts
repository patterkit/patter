// ---------------------------------------------------------------------------
// The decisive S0/S1 proof at the file layer: a REAL on-disk Patter shard - the
// examples/tavern flow + loc envelopes (FlowFile / LocaleFile), hand-authored
// JSON5 with comments and trailing commas - loads into an editor document and
// serializes back to canonical source, losslessly and idempotently, through
// @patterkit/core. The render half is web/view.test.ts.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Scene } from "@patterkit/model";
import {
  openScene, saveScene, flowFromSource, localeFromSource, serializeFlow, serializeLocale,
} from "../src/load.js";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

const flowSrc = read("tavern.patterflow");
const locSrc = read("tavern.patterloc");

const allIds = (s: Scene): string[] => {
  const ids: string[] = [];
  const walk = (n: { id?: string; blocks?: unknown[]; children?: unknown[]; beats?: unknown[] }) => {
    if (n.id) ids.push(n.id);
    [...(n.blocks ?? []), ...(n.children ?? []), ...(n.beats ?? [])].forEach((c) => walk(c as typeof n));
  };
  walk(s);
  return ids.sort();
};

describe("real shard <-> editor document", () => {
  it("loads JSON5 envelopes and serializes back to canonical bytes, losslessly", () => {
    const flow0 = flowFromSource(flowSrc);
    const locale0 = localeFromSource(locSrc);

    const saved = saveScene(openScene(flowSrc, locSrc));

    // The editor reproduces both envelopes as canonical source, byte-for-byte.
    expect(saved.flow).toBe(serializeFlow(flow0));
    expect(saved.loc).toBe(serializeLocale(locale0));
    // Every id survived the round-trip through the document.
    expect(allIds(flowFromSource(saved.flow).scene)).toEqual(allIds(flow0.scene));
  });

  it("preserves locale keys the surface does not manage (choice labels)", () => {
    const saved = saveScene(openScene(flowSrc, locSrc));
    const strings = localeFromSource(saved.loc).strings;
    // Choice-option labels live inside the opaque group, not in any beat - they
    // must still survive the save.
    expect(strings.C_work).toBe("Ask about work");
    expect(strings.C_secret).toBe("Mention the cellar");
    // And the envelope metadata rode through:
    expect(localeFromSource(saved.loc).default).toBe(true);
    expect(localeFromSource(saved.loc).locale).toBe("en");
  });

  it("normalizes hand-edited JSON5 to clean canonical source", () => {
    const saved = saveScene(openScene(flowSrc, locSrc));
    expect(saved.flow).not.toContain("//");        // comments dropped
    expect(saved.flow.endsWith("}\n")).toBe(true); // sorted keys, single final newline
    expect(saved.loc.endsWith("}\n")).toBe(true);
  });

  it("is idempotent: re-opening canonical output yields the same bytes", () => {
    const once = saveScene(openScene(flowSrc, locSrc));
    const twice = saveScene(openScene(once.flow, once.loc));
    expect(twice).toEqual(once);
  });

  it("prunes stray blank text lines on save (lone / trailing), keeps a deliberate separator, and only when asked", () => {
    const flow = `{ schema: "patter/flow@1", scene: { id: "s", type: "scene", name: "S", blocks: [
      { id: "b", type: "block", name: "B", children: [
        { id: "sn1", type: "snippet", beats: [{ id: "x1", kind: "text" }] },
        { id: "sn2", type: "snippet", beats: [{ id: "t1", kind: "text" }, { id: "x2", kind: "text" }, { id: "t2", kind: "text" }] },
        { id: "sn3", type: "snippet", beats: [{ id: "t3", kind: "text" }, { id: "x3", kind: "text" }] },
        { id: "sn4", type: "snippet", beats: [{ id: "d1", kind: "line", character: "ANNA" }, { id: "ld", kind: "line", character: "BO" }] }
      ] }
    ] } }`;
    const loc = `{ schema: "patter/strings@1", scene: "s", locale: "en", default: true, strings: { t1: "one", t2: "two", t3: "three", d1: "hello" } }`;
    const beatsOf = (src: string, snId: string): string[] =>
      ((flowFromSource(src).scene.blocks[0]!.children.find((c) => c.id === snId) as { beats?: { id: string }[] }).beats ?? []).map((b) => b.id);

    const pruned = saveScene(openScene(flow, loc), { prune: true });
    expect(beatsOf(pruned.flow, "sn1")).toEqual([]);                 // lone blank text removed
    expect(beatsOf(pruned.flow, "sn2")).toEqual(["t1", "x2", "t2"]); // blank text between two real lines kept
    expect(beatsOf(pruned.flow, "sn3")).toEqual(["t3"]);            // trailing blank text removed
    expect(beatsOf(pruned.flow, "sn4")).toEqual(["d1"]);           // empty-content dialogue line (ld) removed; the real one stays

    const unpruned = saveScene(openScene(flow, loc)); // default (live mirror): no pruning
    expect(beatsOf(unpruned.flow, "sn1")).toEqual(["x1"]);          // untouched while editing
    expect(beatsOf(unpruned.flow, "sn4")).toEqual(["d1", "ld"]);    // ...and the empty dialogue line too
  });
});
