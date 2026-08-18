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
    // JSZip's own API normalises `..` away, so this predicate is the screen runUnpack applies to every
    // entry name - against zips from any other tool. It is only half the guard: see the two below.
    expect(isUnsafeEntry("../escape.patterflow")).toBe(true);
    expect(isUnsafeEntry("a/../../b.patterflow")).toBe(true);
    expect(isUnsafeEntry("/etc/passwd")).toBe(true);
    expect(isUnsafeEntry("C:\\windows\\x")).toBe(true);
    expect(isUnsafeEntry("scenes/start.patterflow")).toBe(false);
    expect(isUnsafeEntry("loc/en/x.patterloc")).toBe(false);
  });

  it("JSZip collapses a traversal name on the way IN, so neither guard can be reached through it", async () => {
    // Worth pinning, because it says what the two guards are actually for. A `..` entry does not
    // survive being read: JSZip normalises it away, so `isUnsafeEntry` never sees one and neither does
    // the containment check. Both are there for a different reader or a future JSZip, not for a hole
    // that is open today. If this test ever fails, they stop being belt-and-braces and start earning
    // their keep, and the refusal path below them needs a test of its own.
    const zip = new JSZip();
    zip.file("../escape.patterflow", "{}");
    const bytes = await zip.generateAsync({ type: "nodebuffer" });
    const target = scaffold();
    const writes = await runUnpack(bytes, target);
    expect(writes.map((w) => w.path)).toEqual([join(target, "escape.patterflow")]);
  });

  it("every path runUnpack plans lands inside the target directory", async () => {
    // The property that has to hold whatever an entry is called. `isUnsafeEntry` judges a NAME, which
    // cannot know where that name resolves to once joined; containment of the resolved path can, and is
    // what the op now checks at the point each write path is formed.
    const src = scaffold();
    const target = scaffold();
    const writes = await runUnpack(await runPack(src), target);
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w.path.startsWith(target + "/")).toBe(true);
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

  it("notices when the two packs and the project are not the same project", async () => {
    // The weak half of provenance (brief section 7). It cannot tell you that you picked the wrong
    // REVISION of the right project - nothing in a pack records what it descends from - but it does
    // catch the wrong project entirely, which otherwise merges by id, matches almost nothing, and hands
    // back a mountain of conflicts reading as though the other author had rewritten the lot.
    const oursDir = mkProject({ A: "a" });
    const baseDoc = await runPack(oursDir);

    const stranger = mkProject({ A: "a" });                        // mkProject stamps project id "p"...
    const projFile = join(stranger, "game.patterproj");
    const pf = JSON.parse(readFileSync(projFile, "utf8"));
    pf.project.id = "someone_elses_project";                        // ...so make this one a different project
    writeFileSync(projFile, JSON.stringify(pf));
    const returnedDoc = await runPack(stranger);

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.provenance.ok).toBe(false);
    expect(res.provenance.returned).toBe("someone_elses_project");
    expect(res.provenance.base).toBe("p");
    expect(res.provenance.target).toBe("p");
    // A WARNING, not a refusal: the merge still produced its writes for the author to accept or decline.
    expect(res.writes.length).toBeGreaterThan(0);
  });

  it("is quiet when the three agree, and when there is nothing to compare", async () => {
    const oursDir = mkProject({ A: "a" });
    const baseDoc = await runPack(oursDir);
    const returnedDoc = await runPack(mkProject({ A: "a2" }));
    expect((await runUnpackMerge(returnedDoc, baseDoc, oursDir)).provenance.ok).toBe(true);

    // A document with no manifest cannot disagree with anything. Some other tool's zip, or a hand-made
    // one, must not be turned away by a check that exists to catch a slip of the file picker.
    const bare = new JSZip();
    bare.file("loc/en/s.patterloc", readFileSync(join(oursDir, "loc/en/s.patterloc"), "utf8"));
    const bareDoc = await bare.generateAsync({ type: "nodebuffer" });
    const res = await runUnpackMerge(bareDoc, baseDoc, oursDir);
    expect(res.provenance.ok).toBe(true);
    expect(res.provenance.returned).toBeUndefined();
  });

  it("is PURE: planning a merge touches nothing on disk", async () => {
    // The editor shows a confirmation between the plan and the commit, and the CLI can fail part way
    // through argument handling. Both rely on this: a merge that is not committed must be a merge that
    // did not happen, or a cancelled dialog would leave the project half-rewritten.
    const baseDoc = await runPack(mkProject({ A: "a" }));
    const returnedDoc = await runPack(mkProject({ A: "theirs" }));
    const oursDir = mkProject({ A: "ours" });
    const before = readFileSync(join(oursDir, "loc/en/s.patterloc"), "utf8");

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir); // conflicting, so it has plenty to say
    expect(res.conflicts).toBe(1);
    expect(readFileSync(join(oursDir, "loc/en/s.patterloc"), "utf8")).toBe(before);
    expect(existsSync(join(oursDir, "loc/en/s.patterloc.patterconflict"))).toBe(false);
  });

  it("leaves a shard the author DELETED alone", async () => {
    // Deliberate, and the safe direction: not propagating a delete cannot destroy work, where honouring
    // one would remove content on the strength of a file's ABSENCE from a zip - which can happen because
    // somebody's tool skipped an entry. The sender can always delete it themselves.
    const withExtra = mkProject({ A: "a" });
    writeFileSync(join(withExtra, "loc", "en", "extra.patterloc"), JSON.stringify({ schema: "patter/strings@0", scene: "s2", locale: "en", strings: { C: "c" } }));
    const baseDoc = await runPack(withExtra);                    // what we sent: both shards
    const returnedDoc = await runPack(mkProject({ A: "a2" }));   // what came back: extra.patterloc is gone
    const oursDir = mkProject({ A: "a" });
    writeFileSync(join(oursDir, "loc", "en", "extra.patterloc"), JSON.stringify({ schema: "patter/strings@0", scene: "s2", locale: "en", strings: { C: "c" } }));

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.writes.some((w) => w.path.endsWith("extra.patterloc"))).toBe(false); // not rewritten
    applyWrites([...res.writes, ...res.sidecars]);
    expect(existsSync(join(oursDir, "loc/en/extra.patterloc"))).toBe(true);         // and not removed
    expect(stringsOf(oursDir).A).toBe("a2");                                        // their edit still landed
  });

  it("leaves a real project still validating after a merge", async () => {
    // The per-shard tests use a hand-built two-file project. This one goes through a full scaffolded
    // project so the merged result is checked as a PROJECT (ids resolving, shards agreeing) rather than
    // as a bag of files that happened to parse.
    const oursDir = scaffold();
    const baseDoc = await runPack(oursDir);

    // Their copy comes from the pack we sent, so every id matches by construction.
    const theirsDir = join(mkdtempSync(join(tmpdir(), "patter-ret-")), "proj");
    applyWrites(await runUnpack(baseDoc, theirsDir));
    const locPath = join(theirsDir, "loc", "en", "start.patterloc");
    const locFile = parseSource(readFileSync(locPath, "utf8")) as { strings: Record<string, string> };
    const firstKey = Object.keys(locFile.strings)[0]!;
    expect(firstKey).toBeDefined(); // the scaffold ships a line to edit; without one this proves nothing
    locFile.strings[firstKey] = "their rewrite";
    writeFileSync(locPath, canonicalStringify(locFile));
    const returnedDoc = await runPack(theirsDir);

    const res = await runUnpackMerge(returnedDoc, baseDoc, oursDir);
    expect(res.conflicts).toBe(0);
    applyWrites([...res.writes, ...res.sidecars]);
    // Their edit must actually be IN there. Without this the test passes just as well when the merge
    // found nothing to do, which is the way a validate-still-passes check quietly goes vacuous.
    const oursLoc = parseSource(readFileSync(join(oursDir, "loc", "en", "start.patterloc"), "utf8")) as { strings: Record<string, string> };
    expect(oursLoc.strings[firstKey]).toBe("their rewrite");
    expect(runValidate(loadProject(oursDir)).ok).toBe(true);
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
