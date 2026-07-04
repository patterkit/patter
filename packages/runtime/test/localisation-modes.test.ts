// ---------------------------------------------------------------------------
// The two localisation build modes (spec §11):
//   - "embedded": the .patterc carries every locale's strings; the runtime
//     resolves + interpolates them (and can switch locale live, setLocale).
//   - "ids": the .patterc carries NO strings; the runtime emits the beat ID
//     for each line/text and omits character names - the game localises it
//     itself, then calls flow.interpolate(...) for {@ref} property replacement.
//     A "sourceDebug" build embeds the source language for debug playback only.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { Bundle, ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [
        { id: "L", kind: "line", character: "GUIDE" },
        { id: "T", kind: "text" },
      ], jump: { to: "END" } },
    ] },
  ],
};
const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "loc", name: "Loc" },
  locales: { default: "en", all: ["en", "fr"] },
  cast: [{ name: "GUIDE" }],
  properties: [{ name: "name", type: "string", default: "Alice" }],
};
const locales: LocaleFile[] = [
  { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L: "Hi {@name}", T: "Bye", "cast:GUIDE": "Guide" } },
  { schema: "patter/strings@0", scene: "s", locale: "fr", strings: { L: "Salut {@name}", T: "Au revoir", "cast:GUIDE": "Guide" } },
];
const full = exportBundle({ project, scenes: [scene], locales });

const idsBundle: Bundle = { ...full, strings: {}, localisation: { mode: "ids" } };
const sourceDebugBundle: Bundle = { ...full, strings: { en: full.strings.en! }, localisation: { mode: "ids", sourceDebug: true } };

const play = (bundle: Bundle, opts = {}) => new Engine(bundle, opts).openFlow("main", { scene: "s" });

describe("embedded localisation (the default)", () => {
  it("resolves + interpolates strings per locale", () => {
    expect(play(full).advance()).toMatchObject({ type: "line", id: "L", text: "Hi Alice", character: "GUIDE", characterName: "Guide" });
    expect(play(full, { locale: "fr" }).advance()).toMatchObject({ text: "Salut Alice", characterName: "Guide" });
  });
});

describe("IDs-only build", () => {
  it("emits the beat ID as the text and omits the character name", () => {
    const flow = play(idsBundle);
    const line = flow.advance();
    expect(line).toMatchObject({ type: "line", id: "L", text: "L", character: "GUIDE" });
    expect((line as { characterName?: string }).characterName).toBeUndefined(); // game maps the token itself
    expect(flow.advance()).toMatchObject({ type: "text", id: "T", text: "T" });
  });

  it("exposes flow.interpolate so the game applies {@ref} to its own looked-up string", () => {
    const flow = play(idsBundle);
    flow.advance();
    expect(flow.interpolate("Hi {@name}")).toBe("Hi Alice"); // game fetched 'Hi {@name}' for id 'L' from its loc system
    flow.setProperty("@name", "Bo");
    expect(flow.interpolate("Hi {@name}")).toBe("Hi Bo");
  });

  it("a ship build is not flagged as source-debug", () => {
    expect(new Engine(idsBundle).isSourceDebug).toBe(false);
  });
});

describe("source-only debug build", () => {
  it("resolves the embedded source strings AND flags the build as debug", () => {
    const engine = new Engine(sourceDebugBundle);
    expect(engine.isSourceDebug).toBe(true);
    expect(engine.openFlow("main", { scene: "s" }).advance()).toMatchObject({ id: "L", text: "Hi Alice", characterName: "Guide" });
  });
});
