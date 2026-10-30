// ---------------------------------------------------------------------------
// Live locale switching (Engine.setLocale): a real game's "language" setting can
// change mid-session. The active string table swaps WITHOUT rebuilding the engine,
// so the flow keeps its position / state and only subsequent beats re-render.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { PlayError } from "@patterkit/runtime";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

// One snippet, two text beats (T1 then T2) so a single flow yields them in order.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "n", type: "snippet", beats: [{ id: "T1", kind: "text" }, { id: "T2", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};
const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "loc", name: "Loc" },
  locales: { default: "en", all: ["en", "fr"] },
};
const locales: LocaleFile[] = [
  { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T1: "Hello", T2: "Goodbye" } },
  { schema: "patter/strings@0", scene: "s", locale: "fr", strings: { T1: "Bonjour", T2: "Au revoir" } },
];
const bundle = exportBundle({ project, scenes: [scene], locales });

describe("Engine.setLocale - live language switch", () => {
  it("swaps the language mid-flow: the SAME flow continues, new beats render in the new locale", () => {
    const engine = new Engine(bundle); // defaults to the source locale (en)
    const flow = engine.openFlow("main", { scene: "s" });

    expect(flow.advance()).toMatchObject({ type: "text", id: "T1", text: "Hello" });
    engine.setLocale("fr");
    // The flow CONTINUED to T2 (not restarted to T1), and T2 rendered in French.
    expect(flow.advance()).toMatchObject({ type: "text", id: "T2", text: "Au revoir" });
    expect(flow.advance()).toMatchObject({ type: "end", reason: "ended" });
  });

  it("reports the active locale and defaults to the source", () => {
    const engine = new Engine(bundle);
    expect(engine.locale).toBe("en");
    engine.setLocale("fr");
    expect(engine.locale).toBe("fr");
  });

  it("a locale the bundle doesn't have falls back to the default, flagged <Untranslated>, and says so", () => {
    const errors: PlayError[] = [];
    const engine = new Engine(bundle, { onError: (e) => errors.push(e) });
    const flow = engine.openFlow("main", { scene: "s" });
    flow.advance(); // T1 in en
    engine.setLocale("de"); // declared nowhere here
    expect(engine.locale).toBe("en"); // the locale in use
    expect(errors).toEqual([{ flow: "", kind: "setup", node: "de", message: expect.stringContaining('"de"') }]);
    expect(flow.advance()).toMatchObject({ id: "T2", text: "<Untranslated: T2> Goodbye" });
  });

  it("matches case and separators, then the language, never the other way", () => {
    const errors: string[] = [];
    const engine = new Engine(bundle, { locale: "FR", onError: (e) => errors.push(e.node) });
    expect(engine.locale).toBe("fr");
    engine.setLocale("fr_BE");
    expect(engine.locale).toBe("fr");
    engine.setLocale("fr");
    expect(errors).toEqual(["FR", "fr_BE"]); // the exact match says nothing
    expect(engine.locales).toEqual({ default: "en", included: ["en", "fr"] });
  });

  it("replaceStrings resolves again, reporting only a fallback that changed", () => {
    const errors: string[] = [];
    const engine = new Engine(bundle, { locale: "fr-CA", onError: (e) => errors.push(e.node) });
    engine.replaceStrings(bundle);                           // the same fallback: nothing new to say
    expect(errors).toEqual(["fr-CA"]);
    const enOnly = exportBundle({ project: { ...project, locales: { default: "en", all: ["en"] } }, scenes: [scene], locales: [locales[0]!] });
    engine.replaceStrings(enOnly);                           // fr has gone: now the default
    expect(errors).toEqual(["fr-CA", "fr-CA"]);
    expect(engine.locale).toBe("en");
  });
});
