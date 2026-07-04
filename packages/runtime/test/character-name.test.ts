// ---------------------------------------------------------------------------
// Locale-aware character display names (spec §14). A line step carries both the
// canonical `character` token (for host logic) and a resolved `characterName`:
// the `cast:<NAME>` string in the active locale, else the default locale, else
// the authoring `displayName`; undefined when the character has no display name.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import { castStringKey } from "@patterkit/model";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [
        { id: "L_anna", kind: "line", character: "ANNA" }, // has a displayName
        { id: "L_bo", kind: "line", character: "BO" },     // no displayName -> no characterName
      ], jump: { to: "END" } },
    ] },
  ],
};

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "cn", name: "CN" },
  locales: { default: "en", all: ["en", "fr"] },
  cast: [{ name: "ANNA", displayName: "Anna" }, { name: "BO" }],
};

const locales: LocaleFile[] = [
  { schema: "patter/strings@0", scene: "s", locale: "en", strings: { L_anna: "Hi", L_bo: "Yo" } },
  { schema: "patter/strings@0", scene: "s", locale: "fr", strings: { L_anna: "Salut", L_bo: "Yo" } },
  // Project-level display-name strings (the @project shard): localised name in fr only.
  { schema: "patter/strings@0", scene: "@project", locale: "fr", strings: { [castStringKey("ANNA")]: "Annette" } },
];

const bundle = exportBundle({ project, scenes: [scene], locales });

const firstLine = (locale?: string) => {
  const flow = new Engine(bundle, locale ? { locale } : {}).openFlow("main", { scene: "s" });
  return flow.advance(); // L_anna
};

describe("character display-name resolution", () => {
  it("default locale: falls back to the authoring displayName", () => {
    const r = firstLine();
    expect(r).toMatchObject({ type: "line", character: "ANNA", characterName: "Anna" });
  });

  it("active locale: uses the localised cast string when present", () => {
    const r = firstLine("fr");
    expect(r).toMatchObject({ character: "ANNA", characterName: "Annette" }); // @project fr string wins
  });

  it("a character with no displayName has no characterName", () => {
    const flow = new Engine(bundle, {}).openFlow("main", { scene: "s" });
    flow.advance();                 // L_anna
    const bo = flow.advance();      // L_bo
    expect(bo).toMatchObject({ character: "BO" });
    expect((bo as { characterName?: string }).characterName).toBeUndefined();
  });
});
