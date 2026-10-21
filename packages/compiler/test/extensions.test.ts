// The extension pass and what exportBundle does with it (patterkit design/proposals/patter-storylet-extensions.md).
// The delivery contract is the corpus's; this pins the report and the compile.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { exportBundle, extensionNodes, extensionPass } from "@patterkit/compiler";
import type { ExtensionPassInput } from "@patterkit/compiler";
import type { ExtensionShard, ProjectFile, Scene } from "@patterkit/model";

const probe: unknown = JSON.parse(readFileSync(new URL("../../conformance/fixtures/probe.extension.json", import.meta.url), "utf8"));
const manifests = [{ path: "extensions/probe.extension.json", id: "probe", manifest: probe }];

const project = (over: Partial<ProjectFile> = {}): ProjectFile => ({
  schema: "patter/project@0",
  project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "ANNA" }],
  gameDataFields: { line: [{ name: "delivery", type: "enum", values: ["calm", "tense"] }] },
  extensions: { probe: { version: "1.1.0" } },
  ...over,
});
const scenes: Scene[] = [
  { id: "s1", type: "scene", name: "One", blocks: [{ id: "b1", type: "block", name: "B", children: [
    { id: "sn1", type: "snippet", beats: [
      { id: "L1", kind: "line", character: "ANNA", gameData: { delivery: "tense" } },
      { id: "L2", kind: "line", character: "ANNA", gameData: { delivery: "shouty" } },
      { id: "E1", kind: "gameEvent" },
    ] },
    { id: "g1", type: "group", selector: "choice", children: [
      { id: "o1", type: "group", prompt: { id: "P1", kind: "text" }, children: [{ id: "sn_o1", type: "snippet", jump: { to: "END" } }] },
      { id: "o_bare", type: "snippet", beats: [{ id: "L_bare", kind: "line", character: "ANNA" }] },
    ] },
  ] }] },
  { id: "s2", type: "scene", name: "Two", blocks: [{ id: "b2", type: "block", name: "B", children: [
    { id: "sn2", type: "snippet", beats: [{ id: "T2", kind: "text" }] },
  ] }] },
];
const shard = (scene: string, entries: ExtensionShard["entries"], extension = "probe"): { path: string; shard: ExtensionShard } => ({
  path: `extensions/${extension}/${scene === "@project" ? "_project" : scene}.patterextension`,
  shard: { schema: "patter/extension@0", extension, scene, entries },
});
const pass = (over: Partial<ExtensionPassInput> = {}) =>
  extensionPass({ project: project(), scenes, manifests, shards: [], projectPath: "p.patterproj", ...over });
const messages = (issues: { severity: string; message: string }[]) => issues.map((i) => `${i.severity}: ${i.message}`);

describe("extensionNodes", () => {
  it("lists every node an extension can attach to, by kind and scene", () => {
    const nodes = extensionNodes(project(), scenes);
    expect(Object.fromEntries([...nodes].map(([id, n]) => [id, `${n.kind}@${n.scene ?? "-"}`]))).toEqual({
      p: "project@-", s1: "scene@s1", b1: "block@s1", sn1: "snippet@s1", L1: "line@s1", L2: "line@s1", E1: "gameEvent@s1",
      o1: "option@s1", P1: "text@s1", sn_o1: "snippet@s1", o_bare: "snippet@s1", L_bare: "line@s1",
      s2: "scene@s2", b2: "block@s2", sn2: "snippet@s2", T2: "text@s2",
    });
  });
});

describe("extensionPass", () => {
  it("is quiet for sound data, and compiles it", () => {
    const { issues, compiled } = pass({ shards: [shard("s1", { line: { L1: { note: "hi", perf: { ANNA: { expression: "smile" } } } } })],
      scenes: scenes.map((s) => JSON.parse(JSON.stringify(s).replace('"shouty"', '"calm"')) as Scene) });
    expect(issues).toEqual([]);
    expect(compiled.nodes.get("L1")).toEqual({ probe: { note: "hi", perf: { ANNA: { expression: "smile" } } } });
  });

  it("checks a pick against the cast, its words and the extension's project lists, and reports a name two hold once", () => {
    const shot = {
      schema: "wildwinter/extension@0", id: "shot", name: "Shot", version: "1.0.0",
      targets: { patter: {
        line: { fields: [
          { name: "to", type: "pick", from: [{ words: ["all"] }, { to: "cast" }, { list: "pointsOfInterest" }] },
          { name: "look", type: "pick", from: [{ to: "cast" }, { list: "pointsOfInterest" }, { words: ["away"] }] },
        ] },
        project: { fields: [{ name: "pointsOfInterest", type: "list", of: { type: "text" } }] },
      } },
    };
    const run = (poi: string[], to: Record<string, string>) => pass({
      project: project({ cast: [{ name: "ANNA" }, { name: "Gate" }], extensions: { shot: { version: "1.0.0" } } }),
      manifests: [{ path: "extensions/shot.extension.json", id: "shot", manifest: shot }],
      // The scene's shard first: the project's lists are read wherever its entry sits.
      shards: [shard("s1", { line: Object.fromEntries(Object.entries(to).map(([id, v]) => [id, { to: v }])) }, "shot"),
        shard("@project", { project: { p: { pointsOfInterest: poi } } }, "shot")],
    });
    const quiet = run(["Well"], { L1: "all", L2: "ANNA", L_bare: "Well" });
    expect(quiet.issues).toEqual([]);
    expect(quiet.compiled.nodes.get("L_bare")).toEqual({ shot: { to: "Well" } });

    const { issues } = run(["Well", "Gate"], { L1: "Gaet", L2: "Gate" });
    expect(messages(issues)).toEqual([
      `warning: the Patter extension "shot": "Gate" is a cast member and an entry of the list "pointsOfInterest", so a value naming it is ambiguous`,
      `error: entries.line.L1.to: "to" is "Gaet", which is not one of its choices`,
      `warning: entries.line.L2.to: "to" is "Gate", which is a cast member and an entry of the list "pointsOfInterest"`,
    ]);
    expect(issues[0]).toMatchObject({ file: "p.patterproj", node: "p", code: "pick-clash" });
  });

  it("warns of a taken extension with no manifest, and leaves its data out", () => {
    const { issues, compiled } = pass({ manifests: [], shards: [shard("s1", { line: { L1: { note: "hi" } } })] });
    expect(messages(issues).join("\n")).toContain(`warning: the project takes the Patter extension "probe", but has no manifest`);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(compiled.nodes.size).toBe(0);
    expect(compiled.bundle).toEqual({});
  });

  it("warns of a version mismatch", () => {
    const { issues } = pass({ project: project({ extensions: { probe: { version: "1.0.0" } } }) });
    expect(messages(issues)).toEqual([
      `warning: the project takes "probe" at version 1.0.0, but its manifest is version 1.1.0; run \`patter format\` to take it (renamed stages are renamed in the data as it does)`,
    ]);
  });

  it("ignores a pin's settings, and a manifest's settings and claims, which the spec no longer has", () => {
    // An old manifest still carrying settings and a claim: the toolkit warns of each removed key, and the pass
    // compiles the rest as before, with nothing of either in the bundle.
    const old = JSON.parse(JSON.stringify(probe)) as { settings?: unknown; targets: { patter: { line: { claims?: unknown } } } };
    old.settings = [{ name: "deliveryField", label: "Delivery field", default: "delivery" }];
    old.targets.patter.line.claims = [{ setting: "deliveryField", type: "enum", values: ["calm", "tense"] }];
    const { issues, compiled } = pass({
      manifests: [{ path: "extensions/probe.extension.json", id: "probe", manifest: old }],
      project: project({ extensions: { probe: { version: "1.1.0", settings: { deliveryField: "not a name" } } as never } }),
    });
    expect(issues.map((i) => i.code)).toEqual(["removed-key", "removed-key"]);
    expect(issues.every((i) => i.severity === "warning")).toBe(true);
    expect(Object.keys(compiled.bundle["probe"]!).sort()).toEqual(["fields", "version"]);
    // gameData is the project's own: a value its declaration doesn't allow isn't the extension pass's to report.
    expect(pass().issues).toEqual([]);
  });

  it("reports orphans, a wrong-scene entry, an unknown kind, and a bad value, per entry", () => {
    const { issues, compiled } = pass({
      project: project({ gameDataFields: { line: [{ name: "delivery", type: "enum", values: ["calm", "tense", "shouty"] }] } }),
      shards: [shard("s1", {
        line: { L1: { weight: 99 }, gone: { note: "x" }, L_bare: { act: "opening" } },
        text: { T2: { style: "far" } },
        tag: { L1: {} },
        project: { p: { studio: "W" } },
      })],
    });
    const text = messages(issues).join("\n");
    expect(text).toMatch(/warning: .*gone/);
    expect(text).toContain(`warning: entries.text.T2 belongs in scene "s2"'s shard; it's compiled from here all the same`);
    expect(text).toContain(`warning: entries.project.p belongs in the project's own shard`);
    expect(text).toContain(`warning: entries.tag: "tag" isn't a Patter node kind`);
    expect(text).toMatch(/error: entries\.line\.L1\.weight/);
    expect(text).toMatch(/warning: entries\.line\.L_bare\.act: .*renamed "setup"/);
    // The bad entry is left out; the rest compile, a renamed stage under its new name.
    expect(compiled.nodes.has("L1")).toBe(false);
    expect(compiled.nodes.get("T2")).toEqual({ probe: { style: "far" } });
    expect(compiled.nodes.get("L_bare")).toEqual({ probe: { act: "setup" } });
    expect(compiled.bundle["probe"]!.project).toEqual({ studio: "W" });
  });

  it("refuses a shard in another extension's folder, and warns of data for an extension not taken", () => {
    const wrong = { path: "extensions/other/s1.patterextension", shard: shard("s1", { line: { L1: { note: "x" } } }).shard };
    const untaken = shard("s1", { line: { L1: { note: "x" } } }, "ghost");
    const text = messages(pass({ shards: [wrong, untaken] }).issues).join("\n");
    expect(text).toContain(`error: this shard says it holds "probe", but it sits in the folder for "other"`);
    expect(text).toContain(`warning: data for the Patter extension "ghost", which the project doesn't take`);
  });

  it("checks references, a cast member's by name", () => {
    const text = messages(pass({ shards: [shard("s1", { line: { L1: { next: "nowhere", perf: { NOBODY: { look: "x" } } } } })] }).issues).join("\n");
    expect(text).toMatch(/error: entries\.line\.L1\.next/);
    expect(text).toMatch(/error: entries\.line\.L1\.perf/);
  });
});

describe("exportBundle with extensions", () => {
  const plain: ProjectFile = { schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, cast: [{ name: "ANNA" }] };

  it("compiles a project with none exactly as before, hashes included", () => {
    const before = exportBundle({ project: plain, scenes });
    expect(exportBundle({ project: plain, scenes, extensions: { manifests: [], shards: [] } })).toEqual(before);
    expect(JSON.stringify(exportBundle({ project: plain, scenes, extensions: { manifests: [], shards: [] } }))).toBe(JSON.stringify(before));
  });

  it("never lets a hand-written extensions key on a source beat through", () => {
    const sneaky: Scene[] = [{ id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "line", character: "ANNA", extensions: { probe: { note: "x" } } }] },
    ] }] }];
    const beat = (exportBundle({ project: plain, scenes: sneaky }).scenes["s"]!.blocks[0]!.children[0] as { beats: object[] }).beats[0]!;
    expect(beat).not.toHaveProperty("extensions");
  });

  it("puts values on the nodes and declarations in the section, and both in the hashes", () => {
    const shards = [shard("s1", { scene: { s1: { theme: "t" } }, option: { o1: { icon: "i" } }, text: { P1: { style: "p" } } })];
    const withValues = exportBundle({ project: project(), scenes, extensions: { manifests, shards } });
    const without = exportBundle({ project: project(), scenes, extensions: { manifests, shards: [] } });
    expect(withValues.scenes["s1"]!.extensions).toEqual({ probe: { theme: "t" } });
    const choice = withValues.scenes["s1"]!.blocks[0]!.children[1] as { children: Array<{ extensions?: unknown; prompt?: { extensions?: unknown } }> };
    expect(choice.children[0]!.extensions).toEqual({ probe: { icon: "i" } });
    expect(choice.children[0]!.prompt!.extensions).toEqual({ probe: { style: "p" } });
    expect(Object.keys(withValues.extensions!["probe"]!.fields).sort()).toEqual(["block", "gameEvent", "line", "option", "project", "scene", "snippet", "text"]);
    expect(withValues.extensions!["probe"]!.fields["line"]!.map((f) => f.name)).not.toContain("draft");
    expect(withValues.content.hash).not.toBe(without.content.hash);
    expect(withValues.content.structureHash).not.toBe(without.content.structureHash);
    const none = exportBundle({ project: { ...project(), extensions: undefined }, scenes });
    expect(without.content.hash).not.toBe(none.content.hash);   // the section alone counts
    expect(none).not.toHaveProperty("extensions");
  });
});
