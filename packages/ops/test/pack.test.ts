// ---------------------------------------------------------------------------
// The packed `.patterpack` document round-trip (pack -> unpack), its safety guard
// against malicious entry paths, and the validate bundle-staleness gate.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { canonicalStringify, parseSource } from "@patterkit/core";
import {
  runInit, applyWrites, loadProject, runValidate, runExport,
  runPack, runUnpack, runUnpackMerge, isUnsafeEntry,
} from "../src/index.js";

function scaffold(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-pack-")), "game");
  applyWrites(runInit({ dir, name: "Pack Game" }).writes);
  return dir;
}

/** A minimal valid project with one locale shard of the given strings. */
function mkProject(strings: Record<string, string>): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-um-")), "proj");
  mkdirSync(join(dir, "loc", "en"), { recursive: true });
  writeFileSync(join(dir, "game.patterproj"), JSON.stringify({ schema: "patter/project@0", project: { id: "p", name: "G" }, locales: { default: "en", all: ["en"] } }));
  writeFileSync(join(dir, "loc", "en", "s.patterloc"), JSON.stringify({ schema: "patter/strings@0", scene: "s1", locale: "en", strings }));
  return dir;
}
const stringsOf = (dir: string) => (parseSource(readFileSync(join(dir, "loc/en/s.patterloc"), "utf8")) as { strings: Record<string, string> }).strings;

describe("pack / unpack round-trip", () => {
  it("packs source shards into a .patterpack document and explodes them back", async () => {
    const dir = scaffold();
    const buffer = await runPack(dir);

    // It is a real zip carrying a manifest + the shards (not re-serialised JSON).
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter((n) => !zip.files[n]!.dir).sort();
    expect(names).toContain("patter.manifest.json");
    expect(names).toContain("scenes/start.patterflow");
    expect(names).toContain("pack_game.patterproj");
    const manifest = JSON.parse(await zip.file("patter.manifest.json")!.async("string"));
    expect(manifest.schema).toBe("patter/document@0");
    expect(manifest.project.name).toBe("Pack Game");

    // Unpack into a fresh dir: the manifest is dropped, the shards are restored
    // byte-for-byte, and the result loads as the same project.
    const out = join(mkdtempSync(join(tmpdir(), "patter-unpack-")), "restored");
    const writes = await runUnpack(buffer, out);
    expect(writes.map((w) => w.path).some((p) => p.endsWith("patter.manifest.json"))).toBe(false);
    applyWrites(writes);
    expect(readFileSync(join(out, "scenes/start.patterflow"), "utf8"))
      .toBe(readFileSync(join(dir, "scenes/start.patterflow"), "utf8")); // lossless
    expect(loadProject(out).project.project.name).toBe("Pack Game");
  });

  it("is byte-reproducible: re-packing unchanged source yields identical bytes", async () => {
    const dir = scaffold();
    const a = await runPack(dir);
    const b = await runPack(dir);
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("guards against entries that escape the target directory", () => {
    // JSZip's own API normalises `..` away, so the real defence is the predicate
    // runUnpack applies to every entry name - against zips from any other tool.
    expect(isUnsafeEntry("../escape.patterflow")).toBe(true);
    expect(isUnsafeEntry("a/../../b.patterflow")).toBe(true);
    expect(isUnsafeEntry("/etc/passwd")).toBe(true);
    expect(isUnsafeEntry("C:\\windows\\x")).toBe(true);
    expect(isUnsafeEntry("scenes/start.patterflow")).toBe(false);
    expect(isUnsafeEntry("loc/en/x.patterloc")).toBe(false);
  });
});

describe("validate: bundle staleness gate", () => {
  it("passes when a committed .patterc matches source, fails once source drifts", async () => {
    const dir = scaffold();
    // Export and commit a bundle next to the project (strict JSON, like the CLI).
    const bundle = runExport(loadProject(dir));
    applyWrites([{ path: join(dir, "dist", "game.patterc"), content: canonicalStringify(bundle, { trailingComma: false }) }]);
    expect(runValidate(loadProject(dir)).staleBundles).toEqual([]); // fresh

    // Drift the source: a new scene the committed bundle doesn't know about.
    applyWrites([{ path: join(dir, "scenes", "extra.patterflow"), content: canonicalStringify({
      schema: "patter/flow@0",
      scene: { id: "scn_extra", type: "scene", name: "Extra", blocks: [
        { id: "blk_x", type: "block", name: "Main", children: [
          { id: "sn_x", type: "snippet", beats: [{ id: "T_x", kind: "text" }], jump: { to: "END" } },
        ] },
      ] },
    }) }]);
    const stale = runValidate(loadProject(dir)).staleBundles;
    expect(stale).toHaveLength(1);
    expect(stale[0]!.message).toMatch(/stale/);
    expect(runValidate(loadProject(dir)).ok).toBe(false);
  });

  it("ignores projects with no committed bundle (no cost, no issue)", async () => {
    expect(runValidate(loadProject(scaffold())).staleBundles).toEqual([]);
  });
});

describe("validate: unresolved-merge gate", () => {
  it("a lingering .patterconflict sidecar fails validation", () => {
    const dir = scaffold();
    expect(runValidate(loadProject(dir)).unresolvedMerges).toEqual([]);
    applyWrites([{ path: join(dir, "scenes", "start.patterflow.patterconflict"), content: "{}" }]);
    const r = runValidate(loadProject(dir));
    expect(r.unresolvedMerges).toHaveLength(1);
    expect(r.ok).toBe(false);
  });
});

describe("runUnpackMerge (fold a returned document into existing shards)", () => {
  it("merges disjoint edits cleanly (BASE = the sent document)", async () => {
    const baseDoc = await runPack(mkProject({ A: "a", B: "b" }));      // what we sent
    const returnedDoc = await runPack(mkProject({ A: "a", B: "b2" })); // author edited B
    const oursDir = mkProject({ A: "a2", B: "b" });                    // we edited A meanwhile

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.conflicts).toBe(0);
    expect(res.sidecars).toEqual([]);
    applyWrites([...res.writes, ...res.sidecars]);
    expect(stringsOf(oursDir)).toEqual({ A: "a2", B: "b2" }); // both edits land
  });

  it("conflicting edits keep provisional OURS and write a sidecar", async () => {
    const baseDoc = await runPack(mkProject({ A: "a" }));
    const returnedDoc = await runPack(mkProject({ A: "theirs" }));
    const oursDir = mkProject({ A: "ours" });

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.conflicts).toBe(1);
    expect(res.sidecars).toHaveLength(1);
    applyWrites([...res.writes, ...res.sidecars]);
    expect(stringsOf(oursDir).A).toBe("ours"); // provisional OURS
    expect(existsSync(join(oursDir, "loc/en/s.patterloc.patterconflict"))).toBe(true);
  });

  it("a file only in the returned document is added verbatim", async () => {
    const baseDoc = await runPack(mkProject({ A: "a" }));
    const theirsDir = mkProject({ A: "a" });
    writeFileSync(join(theirsDir, "loc", "en", "extra.patterloc"), JSON.stringify({ schema: "patter/strings@0", scene: "s2", locale: "en", strings: { C: "c" } }));
    const returnedDoc = await runPack(theirsDir);
    const oursDir = mkProject({ A: "a" });

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.shards.find((s) => s.path.endsWith("extra.patterloc"))?.added).toBe(true);
    applyWrites(res.writes);
    expect(existsSync(join(oursDir, "loc/en/extra.patterloc"))).toBe(true);
  });
});
