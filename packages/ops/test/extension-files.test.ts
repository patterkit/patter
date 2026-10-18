// ---------------------------------------------------------------------------
// A project's Patter extension files as the loader and the file tools find them: the manifests in
// `extensions/<id>.extension.json`, the data shards under `layout.extensions`
// (`<extension id>/<scene stem>.patterextension`), a broken one said rather than thrown, the landing load
// leaving them for later, and the manifest a merge reads from the working tree.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { loadProject, loadProjectLanding } from "../src/load.js";
import { orphanShards } from "../src/validate.js";
import { runFormat } from "../src/format.js";
import { SHARD_EXTENSIONS } from "../src/pack.js";
import { manifestPath, projectManifests, readProjectManifest, soundManifest } from "../src/extensions.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

const MANIFEST = {
  schema: "wildwinter/extension@0", id: "probe", name: "Probe", version: "1.0.0",
  targets: { patter: { line: { fields: [{ name: "note", type: "text" }, { name: "beats", type: "list", id: "id", of: { type: "record", fields: [{ name: "id", type: "text" }, { name: "at", type: "number" }] } }] } } },
};

function scratch(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-ext-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  return dir;
}

function put(dir: string, rel: string, text: string): string {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const shard = (scene: string, entries: Record<string, unknown> = {}) =>
  canonicalStringify({ schema: "patter/extension@0", extension: "probe", scene, entries });

describe("loading a project's extensions", () => {
  it("reads the manifests and the data shards, in path order", () => {
    const dir = scratch();
    put(dir, "extensions/probe.extension.json", JSON.stringify(MANIFEST, null, 2));
    const tavern = put(dir, "extensions/probe/tavern.patterextension", shard("tavern", { line: { L1: { note: "hi" } } }));
    const project = put(dir, "extensions/probe/_project.patterextension", shard("@project", { project: { p: { studio: "x" } } }));
    const loaded = loadProject(dir);
    expect(loaded.manifests.map((m) => ({ path: m.path, id: m.id }))).toEqual([{ path: join(dir, "extensions/probe.extension.json"), id: "probe" }]);
    expect((loaded.manifests[0]!.manifest as { version: string }).version).toBe("1.0.0");
    expect(loaded.extensionShardFiles).toEqual([project, tavern]);
    expect(loaded.extensionShards.map((s) => s.scene)).toEqual(["@project", "tavern"]);
    expect(loaded.extensionIssues).toEqual([]);
  });

  it("reads manifests one level deep only, and the data from the project's own layout folder", () => {
    const dir = scratch();
    put(dir, "extensions/deeper/other.extension.json", JSON.stringify(MANIFEST));
    put(dir, "data/probe/tavern.patterextension", shard("tavern"));
    const project = parseSource(readFileSync(join(dir, "tavern.patterproj"), "utf8")) as Record<string, unknown>;
    writeFileSync(join(dir, "tavern.patterproj"), canonicalStringify({ ...project, layout: { extensions: "data/" } }));
    const loaded = loadProject(dir);
    expect(loaded.manifests).toEqual([]);
    expect(loaded.extensionShardFiles).toEqual([join(dir, "data/probe/tavern.patterextension")]);
  });

  it("says a broken file rather than refusing the project", () => {
    const dir = scratch();
    const badManifest = put(dir, "extensions/bad.extension.json", "{ not json");
    const unparsed = put(dir, "extensions/probe/a.patterextension", "{ nope");
    const wrong = put(dir, "extensions/probe/b.patterextension", canonicalStringify({ schema: "patter/flow@0", scene: "x", entries: {} }));
    const noEntries = put(dir, "extensions/probe/c.patterextension", canonicalStringify({ schema: "patter/extension@0", extension: "probe", scene: "x" }));
    const loaded = loadProject(dir);
    expect(loaded.scenes.length).toBeGreaterThan(0);
    expect(loaded.extensionShards).toEqual([]);
    expect(loaded.extensionIssues.map((i) => i.file)).toEqual([badManifest, unparsed, wrong, noEntries]);
  });

  it("leaves them for later on a landing load", () => {
    const dir = scratch();
    put(dir, "extensions/probe.extension.json", JSON.stringify(MANIFEST));
    put(dir, "extensions/probe/tavern.patterextension", shard("tavern"));
    const landing = loadProjectLanding(dir);
    expect([landing.manifests, landing.extensionShards, landing.extensionShardFiles, landing.extensionIssues]).toEqual([[], [], [], []]);
  });
});

describe("extension data shards as Patter source", () => {
  it("are shards: packed, formatted, and merged like the rest", () => {
    expect(SHARD_EXTENSIONS).toContain(".patterextension");
    const dir = scratch();
    const file = put(dir, "extensions/probe/tavern.patterextension", JSON.stringify({ schema: "patter/extension@0", extension: "probe", scene: "tavern", entries: {} }));
    const [result] = runFormat([file]);
    expect(result!.changed).toBe(true);
    expect(result!.write!.content).toBe(shard("tavern"));
  });

  it("outside the project's extensions folder are orphans", () => {
    const dir = scratch();
    const stray = put(dir, "scenes/stray.patterextension", shard("tavern"));
    put(dir, "extensions/probe/tavern.patterextension", shard("tavern"));
    const orphans = orphanShards(loadProject(dir));
    expect(orphans.map((o) => o.file)).toEqual([stray]);
    expect(orphans[0]!.message).toContain("extensions/");
  });
});

describe("the manifest a merge reads", () => {
  it("is the project's copy, when it is sound", () => {
    const dir = scratch();
    expect(readProjectManifest(dir, "probe")).toBeUndefined();
    put(dir, "extensions/probe.extension.json", JSON.stringify(MANIFEST));
    expect(manifestPath(dir, "probe")).toBe(join(dir, "extensions/probe.extension.json"));
    expect(readProjectManifest(dir, "probe")?.version).toBe("1.0.0");
    expect(projectManifests(dir)("probe")?.id).toBe("probe");
    expect(readProjectManifest(dir, "../probe")).toBeUndefined();
  });

  it("is not used mid-conflict, broken, or with errors", () => {
    const text = JSON.stringify(MANIFEST, null, 2);
    expect(soundManifest(text)?.id).toBe("probe");
    expect(soundManifest(`<<<<<<< ours\n${text}\n=======\n${text}\n>>>>>>> theirs\n`)).toBeUndefined();
    expect(soundManifest("{ nope")).toBeUndefined();
    expect(soundManifest(JSON.stringify({ ...MANIFEST, version: "" }))).toBeUndefined();
  });
});

describe("the canonical form", () => {
  it("never reorders a list under `entries`: an extension's lists are in the extension's order", () => {
    const value = { schema: "patter/extension@0", extension: "probe", scene: "tavern", entries: { line: { L1: {
      beats: [{ id: "b2", at: 3 }, { id: "b1", at: 1 }], words: ["salt", "rope", "anchor"], marks: ["rain", "night"],
    } } } };
    const back = parseSource(canonicalStringify(value)) as typeof value;
    expect(back.entries.line.L1.beats.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(back.entries.line.L1.words).toEqual(["salt", "rope", "anchor"]);
    expect(back.entries.line.L1.marks).toEqual(["rain", "night"]);
  });
});
