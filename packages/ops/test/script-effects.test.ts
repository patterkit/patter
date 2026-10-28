// ---------------------------------------------------------------------------
// Effects in the script exports (hands-on review Q13): a snippet's onEnter / onExit and a scene's onEntry
// show as a quiet line of plain words, "On begin: sets gold to gold + 1", in the readable script (Word and
// PDF) and the editable script. Literal, never paraphrased; a Patter property is named bare, any other
// scope's in full.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { patterDialect } from "@patterkit/dialect";
import { loadProject, runScriptDoc, scriptToDocx, scriptToPdf, effectDescriber } from "../src/index.js";
import type { ScriptElement } from "../src/index.js";

const describeEffect = effectDescriber(patterDialect, (id) => (id === "b1" ? "Entrance" : id));
const set = (target: string, value: string) => describeEffect({ kind: "set", target, value });

describe("effects in plain words", () => {
  it("a Patter property is named bare, however it's written; the value is kept literally", () => {
    expect(set("@gold", "@gold + 1")).toBe("Sets gold to gold + 1");
    expect(set("@patter.gold", "@patter.gold - 2")).toBe("Sets gold to gold - 2");
    expect(set("@brave", "true")).toBe("Sets brave to true");
    expect(set("@count", "0")).toBe("Sets count to 0");
  });

  it("any other scope's property is named in full, declared or not", () => {
    expect(set("@world.threat", "3")).toBe("Sets @world.threat to 3");
    expect(set("@scene.mood", "@scene.mood")).toBe("Sets @scene.mood to @scene.mood");
    expect(set("@story.trust", "@gold * 2")).toBe("Sets @story.trust to gold * 2");
  });

  it("an enum value or named stage reads without its quotes; a ref inside a string is left alone", () => {
    expect(set("@mood", "\"angry\"")).toBe("Sets mood to angry");
    expect(set("@note", "\"@gold\"")).toBe("Sets note to @gold");
    expect(set("@seen_entrance", "visits(\"b1\") > 0")).toBe("Sets seen_entrance to visits(Entrance) > 0");
  });

  it("a quality advancing itself reads as the app's row does", () => {
    expect(set("@debt", "advance(@debt)")).toBe("Advances debt");
    expect(set("@patter.debt", "advance(@debt)")).toBe("Advances debt");
    expect(set("@debt", "advance(@other)")).toBe("Sets debt to advance(other)");
  });

  it("a flags change on its own property says what it adds and removes", () => {
    expect(set("@mood", "set_flags(@mood, +calm)")).toBe("Adds calm to mood");
    expect(set("@mood", "set_flags(@mood, -armed)")).toBe("Removes armed from mood");
    expect(set("@mood", "set_flags(@mood, +calm, +lit, -armed)")).toBe("Adds calm and lit to mood and removes armed");
    expect(set("@mood", "set_flags(@mood, +a, +b, +c)")).toBe("Adds a, b, and c to mood");
  });

  it("an expression that won't parse is still shown, literally", () => {
    expect(set("@gold", "@gold +")).toBe("Sets gold to gold +");
  });
});

/** A scene with entry effects, a snippet with both phases and a jump, and an option with an end effect. */
function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "patter-effects-"));
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "s", name: "The Tavern" },
    locales: { default: "en", all: ["en"] }, voiced: true, cast: [{ name: "BARKEEP" }],
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "The Tavern", onEntry: [{ kind: "set", target: "@scene.mood", value: "\"tense\"" }], blocks: [
      { id: "b1", type: "block", name: "Entrance", children: [
        { id: "n1", type: "snippet", condition: "@gold > 1",
          onEnter: [{ kind: "set", target: "@gold", value: "@gold + 1" }],
          onExit: [{ kind: "set", target: "@brave", value: "true" }, { kind: "set", target: "@mood", value: "set_flags(@mood, +calm)" }],
          beats: [{ id: "L1", kind: "line", character: "BARKEEP" }], jump: { to: "END" } },
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "snippet", onExit: [{ kind: "set", target: "@paid", value: "true" }],
            beats: [{ id: "P1", kind: "text" }, { id: "L2", kind: "line", character: "BARKEEP" }] },
        ] },
      ] },
    ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { L1: "What'll it be?", P1: "Pay up", L2: "Thank you kindly." } });
  return dir;
}

describe("runScriptDoc: effect lines", () => {
  const doc = runScriptDoc(loadProject(makeProject()));
  const effects = doc.elements.filter((e): e is Extract<ScriptElement, { kind: "effect" }> => e.kind === "effect");

  it("one line per phase, labelled as the app labels it, several effects joined", () => {
    expect(effects.map((e) => [e.id, e.phase, e.text])).toEqual([
      ["s1", "begin", "On begin: sets @scene.mood to tense"],
      ["n1", "begin", "On begin: sets gold to gold + 1"],
      ["n1", "end", "On end: sets brave to true; adds calm to mood"],
      ["o1", "end", "On end: sets paid to true"],
    ]);
  });

  it("a begin line comes after the condition and before the beats; an end line after them, before the jump", () => {
    const at = (pred: (e: ScriptElement) => boolean) => doc.elements.findIndex(pred);
    const cond = at((e) => e.kind === "condition" && e.id === "n1");
    const begin = at((e) => e.kind === "effect" && e.id === "n1" && e.phase === "begin");
    const line = at((e) => e.kind === "line" && e.id === "L1");
    const end = at((e) => e.kind === "effect" && e.id === "n1" && e.phase === "end");
    const jump = at((e) => e.kind === "jump" && e.id === "n1");
    expect([cond < begin, begin < line, line < end, end < jump]).toEqual([true, true, true, true]);
    // The scene's entry effects sit under its heading.
    expect(doc.elements[1]).toMatchObject({ kind: "effect", id: "s1" });
  });

  it("an option's effects sit with its content, indented under it", () => {
    const opt = doc.elements.find((e) => e.kind === "option")!;
    const end = effects.find((e) => e.id === "o1")!;
    expect(end.indent).toBe((opt as { indent: number }).indent + 1);
    expect(end.snippet).toBe((opt as { snippet?: number }).snippet);
  });

  it("the Word script sets each effect line quietly, in its own paragraph style", async () => {
    const zip = await JSZip.loadAsync(await scriptToDocx(doc));
    const xml = await zip.file("word/document.xml")!.async("string");
    const paras = xml.split("<w:p>").filter((p) => p.includes("PatterEffect"));
    expect(paras).toHaveLength(4);
    expect(paras[2]).toContain("sets brave to true; adds calm to mood");
    expect(await zip.file("word/styles.xml")!.async("string")).toContain("w:styleId=\"PatterEffect\"");
  });

  it("the PDF renders with effect lines", async () => {
    const buf = await scriptToPdf(doc);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
