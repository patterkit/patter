// Action text (patterkit design/proposals/action-text.md): what the compile does with a dialogue scene's text.
// The delivery contract is the corpus's; this pins the bundle.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { exportBundle } from "@patterkit/compiler";
import type { CompiledSnippet, LocaleFile, ProjectFile, Scene, TextBeat } from "@patterkit/model";

const probe: unknown = JSON.parse(readFileSync(new URL("../../conformance/fixtures/probe.extension.json", import.meta.url), "utf8"));
const manifests = [{ path: "extensions/probe.extension.json", id: "probe", manifest: probe }];

const project = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en", "fr"] },
  cast: [{ name: "MARA" }],
  extensions: { probe: { version: "1.1.0" } },
  ...over,
});
const scenes: Scene[] = [
  { id: "s1", type: "scene", name: "One", blocks: [{ id: "b1", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet", beats: [
      { id: "T1", kind: "text", padAfter: 2 },
      { id: "L1", kind: "line", character: "MARA" },
    ] },
    { id: "g1", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [{ id: "sn_o1", type: "snippet", jump: { to: "END" } }] },
    ] },
  ] }] },
  { id: "s2", type: "scene", name: "Two", blocks: [{ id: "b2", type: "block", name: "B", children: [
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
  ] }] },
];
const loc = (scene: string, locale: string, strings: Record<string, string>): LocaleFile => ({ schema: "patter/strings@0", scene, locale, strings });
const locales = [
  loc("s1", "en", { T1: "MARA turns away.", L1: "Go.", P1: "Follow" }),
  loc("s1", "fr", { T1: "MARA se détourne.", L1: "Va.", P1: "Suivre" }),
  loc("s2", "en", { T2: "A page." }),
  loc("s2", "fr", { T2: "Une page." }),
];
const shards = [{
  path: "extensions/probe/s1.patterextension",
  shard: { schema: "patter/extension@0" as const, extension: "probe", scene: "s1", entries: { text: { T1: { style: "beat" }, P1: { style: "ask" } } } },
}];
const beatsOf = (bundle: ReturnType<typeof exportBundle>, scene: string, snippet: string) => {
  let found: CompiledSnippet | undefined;
  const walk = (nodes: unknown[]): void => {
    for (const n of nodes as { id: string; type: string; children?: unknown[] }[]) {
      if (n.id === snippet) found = n as unknown as CompiledSnippet;
      if (n.children) walk(n.children);
    }
  };
  for (const b of bundle.scenes[scene]!.blocks) walk(b.children);
  return found!.beats!;
};

describe("action text in the bundle", () => {
  it("marks a dialogue scene's text action, keeps its pause and extension values, and holds it to the source in every locale", () => {
    const bundle = exportBundle({ project: project(), scenes, locales, extensions: { manifests, shards } });
    expect(beatsOf(bundle, "s1", "sn1")[0]).toEqual({ id: "T1", kind: "text", padAfter: 2, extensions: { probe: { style: "beat" } }, action: true });
    expect(bundle.strings.fr!.T1).toBe("MARA turns away.");
    expect(bundle.strings.fr!.L1).toBe("Va.");
  });

  it("never marks an option's prompt, or a text scene's text", () => {
    const bundle = exportBundle({ project: project(), scenes, locales, extensions: { manifests, shards } });
    const prompt = (bundle.scenes.s1!.blocks[0]!.children[1] as { children: { prompt: TextBeat }[] }).children[0]!.prompt;
    expect(prompt).toEqual({ id: "P1", kind: "text", extensions: { probe: { style: "ask" } } });
    expect(bundle.strings.fr!.P1).toBe("Suivre");
    expect(beatsOf(bundle, "s2", "sn2")[0]).toEqual({ id: "T2", kind: "text" });
    expect(bundle.strings.fr!.T2).toBe("Une page.");
  });

  it("with localiseDialogueText on, compiles exactly as a project without action text", () => {
    const bundle = exportBundle({ project: project({ localiseDialogueText: true }), scenes, locales });
    expect(beatsOf(bundle, "s1", "sn1")[0]).toEqual({ id: "T1", kind: "text", padAfter: 2 });
    expect(bundle.strings.fr!.T1).toBe("MARA se détourne.");
  });

  it("drops a hand-written action key from source", () => {
    const hand = JSON.parse(JSON.stringify(scenes).replace('"kind":"text"}', '"kind":"text","action":true}')) as Scene[];
    const bundle = exportBundle({ project: project(), scenes: hand, locales });
    expect(beatsOf(bundle, "s2", "sn2")[0]).toEqual({ id: "T2", kind: "text" });
  });

  it("leaves an action id out of a locale whose source lacks it", () => {
    const bundle = exportBundle({ project: project(), scenes, locales: locales.map((l) => l.locale === "en" && l.scene === "s1" ? loc("s1", "en", { L1: "Go." }) : l) });
    expect("T1" in bundle.strings.fr!).toBe(false);
  });
});
