// ---------------------------------------------------------------------------
// Packs and the game's shared scopes (patterkit/design/shared-scopes.md, "Packs"): a pack carries a
// read-only snapshot of the game's `game-scopes/` folder, unpacking puts it where the new project finds
// it first, and merging a returned pack never writes it back, but does take the recipient's World edit
// to `game.scopes.json`. A project with no folder packs exactly as it did, and an old pack unpacks as it
// did.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { ARCHIVE_ENTRY_OPTS } from "@wildwinter/toolkit/archive";
import { parseSource, canonicalStringify } from "@patterkit/core";
import type { FlowFile, HostScopeRegistry, ProjectFile } from "@patterkit/model";
import {
  runInit, applyWrites, loadProject, runValidate, runPack, runUnpack, runUnpackMerge, planWorldSave,
  SHARD_EXTENSIONS,
} from "../src/index.js";
import { walkFiles } from "../src/load.js";

const storylets = {
  version: 1, owner: "Storylet Engine",
  scopes: [{ token: "story", declarations: [{ name: "act", type: "number", default: 2 }] }],
};
const world = { token: "world", declarations: [{ name: "threat", type: "number" as const, default: 3 }] };
const game = {
  version: 1, owner: "Game",
  scopes: [world, { token: "player", declarations: [{ name: "name", type: "string" as const, default: "Ash" }] }],
};
// Hand-written (two-space JSON, not the canonical text) so a test can tell the text on disk travelled.
const FILES = {
  "storylets.scopes.json": JSON.stringify(storylets, null, 2),
  "game.scopes.json": JSON.stringify(game, null, 2),
};

/** A game folder with a Patter project (`story.patter`) whose synced copy of `@world` matches the
 *  game's, and, unless told otherwise, a `game-scopes/` folder beside it. */
function gameWith(files: Record<string, string> = FILES): { gameDir: string; root: string; scopesDir: string } {
  const gameDir = mkdtempSync(join(tmpdir(), "patter-packgame-"));
  mkdirSync(join(gameDir, ".git")); // the walk-up stops here, whatever the temp folder sits in
  const root = join(gameDir, "story.patter");
  applyWrites(runInit({ dir: root, name: "Story" }).writes);
  editProject(root, (p) => ({ ...p, scopeRegistry: { version: 1, scopes: [world] } }));
  const scopesDir = join(gameDir, "game-scopes");
  if (Object.keys(files).length) mkdirSync(scopesDir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(scopesDir, name), text);
  return { gameDir, root, scopesDir };
}

/** Edit the project file in place. */
function editProject(root: string, edit: (p: ProjectFile) => ProjectFile): void {
  const loaded = loadProject(root);
  writeFileSync(loaded.projectFile, canonicalStringify(edit(loaded.project)));
}

/** Put a condition on the starter scene's first snippet. */
function withCondition(root: string, condition: string): void {
  const path = join(root, "scenes", "start.patterflow");
  const flow = parseSource(readFileSync(path, "utf8")) as FlowFile;
  (flow.scene.blocks[0]!.children[0] as { condition?: string }).condition = condition;
  writeFileSync(path, canonicalStringify(flow));
}

/** Unpack a pack into a fresh folder of its own (no game scopes folder anywhere above it). */
async function unpackFresh(bytes: Buffer): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "patter-packrecv-"));
  mkdirSync(join(dir, ".git"));
  const root = join(dir, "story.patter");
  const { shards, scopes } = await runUnpack(bytes, root);
  applyWrites([...shards, ...scopes]);
  return root;
}

/** The recipient edits World properties as Patterpad's settings save does: the unpacked snapshot's
 *  `game.scopes.json` first, then the project's synced copy. */
function editWorld(root: string, next: HostScopeRegistry): void {
  const loaded = loadProject(root);
  const plan = planWorldSave(loaded.project, loaded.gameScopes!, next);
  expect(plan.error).toBeUndefined();
  if (plan.write) applyWrites([plan.write]);
  editProject(root, (p) => ({ ...p, scopeRegistry: plan.scopeRegistry }));
}

/** A project packed as `runPack` packed it before packs carried game scopes: the manifest (with no
 *  `gameScopes` key) and the shards, nothing else. */
async function packAsBefore(root: string): Promise<Buffer> {
  const files = SHARD_EXTENSIONS.flatMap((ext) => walkFiles(root, ext))
    .map((abs) => ({ abs, rel: abs.slice(root.length + 1) }))
    .sort((a, b) => a.rel.localeCompare(b.rel));
  const project = loadProject(root).project;
  const zip = new JSZip();
  zip.file("patter.manifest.json", JSON.stringify({
    schema: "patter/document@0",
    project: { id: project.project.id, name: project.project.name },
    files: files.map((f) => f.rel),
  }, null, 2) + "\n", ARCHIVE_ENTRY_OPTS);
  for (const f of files) zip.file(f.rel, readFileSync(f.abs, "utf8"), ARCHIVE_ENTRY_OPTS);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", streamFiles: false });
}

const threat = (n: number): HostScopeRegistry => ({ version: 1, scopes: [{ token: "world", declarations: [{ name: "threat", type: "number", default: n }] }] });

describe("packing a project with a game scopes folder", () => {
  it("carries every scopes file as game-scopes/<name>, as on disk, and names them in the manifest", async () => {
    const { root } = gameWith();
    const zip = await JSZip.loadAsync(await runPack(root));
    expect(await zip.file("game-scopes/game.scopes.json")!.async("string")).toBe(FILES["game.scopes.json"]);
    expect(await zip.file("game-scopes/storylets.scopes.json")!.async("string")).toBe(FILES["storylets.scopes.json"]);
    const manifest = JSON.parse(await zip.file("patter.manifest.json")!.async("string"));
    expect(manifest.gameScopes).toEqual(["game.scopes.json", "storylets.scopes.json"]);
    expect(manifest.files.some((f: string) => f.startsWith("game-scopes/"))).toBe(false); // not shards
  });

  it("stays byte-reproducible", async () => {
    const { root } = gameWith();
    expect(Buffer.compare(await runPack(root), await runPack(root))).toBe(0);
  });

  it("finds the folder as the loader does, through a gameScopes override", async () => {
    const { gameDir, root } = gameWith({});
    const elsewhere = join(gameDir, "shared", "game-scopes");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "game.scopes.json"), FILES["game.scopes.json"]);
    editProject(root, (p) => ({ ...p, gameScopes: join("..", "shared", "game-scopes") }));
    const manifest = JSON.parse(await (await JSZip.loadAsync(await runPack(root))).file("patter.manifest.json")!.async("string"));
    expect(manifest.gameScopes).toEqual(["game.scopes.json"]);
  });
});

describe("packing a project with no game scopes folder", () => {
  it("makes exactly the bytes it made before packs carried one", async () => {
    const { root } = gameWith({});
    expect(Buffer.compare(await runPack(root), await packAsBefore(root))).toBe(0);
  });
});

describe("unpacking a pack that carries the game's scopes", () => {
  it("writes the snapshot into the new project folder, where the project finds and checks against it", async () => {
    const { root } = gameWith();
    withCondition(root, "@story.acts >= 2"); // a name the Storylet Engine's file doesn't declare
    const bytes = await runPack(root);
    const target = join(mkdtempSync(join(tmpdir(), "patter-packrecv-")), "story.patter");
    const { shards, scopes } = await runUnpack(bytes, target);
    expect(scopes.map((w) => w.path)).toEqual([join(target, "game-scopes", "game.scopes.json"), join(target, "game-scopes", "storylets.scopes.json")]);
    expect(scopes[0]!.content).toBe(FILES["game.scopes.json"]);
    expect(shards.some((w) => w.path.includes("game-scopes"))).toBe(false);

    const unpacked = await unpackFresh(bytes);
    const loaded = loadProject(unpacked);
    expect(loaded.gameScopes?.dir).toBe(join(unpacked, "game-scopes"));
    const v = runValidate(loaded);
    expect(v.conditions).toEqual([expect.objectContaining({ severity: "warning", message: expect.stringContaining("@story.acts is not declared by Storylet Engine") })]);
  });

  it("unpacks a pack from before packs carried a snapshot exactly as before", async () => {
    const { root } = gameWith(); // the sender has a folder now; the pack is from before
    const target = join(mkdtempSync(join(tmpdir(), "patter-packrecv-")), "story.patter");
    const { shards, scopes } = await runUnpack(await packAsBefore(root), target);
    expect(scopes).toEqual([]);
    for (const w of shards) expect(w.content).toBe(readFileSync(join(root, w.path.slice(target.length + 1)), "utf8"));
    expect(shards).toHaveLength(SHARD_EXTENSIONS.flatMap((ext) => walkFiles(root, ext)).length);
    applyWrites(shards);
    expect(existsSync(join(target, "game-scopes"))).toBe(false);
    expect(loadProject(target).project.project.name).toBe("Story");
  });

  it("keeps anything else under game-scopes/ a shard, as it always was", async () => {
    const zip = new JSZip();
    zip.file("game-scopes/notes.patterx", "{}");
    zip.file("game-scopes/deeper/x.scopes.json", "{}");
    zip.file("game-scopes/game.scopes.json", "{}");
    const target = mkdtempSync(join(tmpdir(), "patter-packrecv-"));
    const { shards, scopes } = await runUnpack(await zip.generateAsync({ type: "nodebuffer" }), target);
    expect(shards.map((w) => w.path)).toEqual([join(target, "game-scopes/deeper/x.scopes.json"), join(target, "game-scopes/notes.patterx")]);
    expect(scopes.map((w) => w.path)).toEqual([join(target, "game-scopes/game.scopes.json")]);
  });
});

describe("merging a returned pack", () => {
  it("never writes the returned pack's snapshot, even one the recipient changed", async () => {
    const { root, scopesDir } = gameWith();
    const sent = await runPack(root);
    const theirs = await unpackFresh(sent);
    writeFileSync(join(theirs, "game-scopes", "storylets.scopes.json"), JSON.stringify({ ...storylets, owner: "Someone Else" }));
    writeFileSync(join(theirs, "game-scopes", "extra.scopes.json"), JSON.stringify({ version: 1, owner: "X", scopes: [] }));
    const returned = await runPack(theirs);
    expect(JSON.parse(await (await JSZip.loadAsync(returned)).file("patter.manifest.json")!.async("string")).gameScopes).toContain("extra.scopes.json");

    const res = await runUnpackMerge(returned, sent, root);
    expect(res.gameScopes).toBeUndefined();
    expect([...res.writes, ...res.sidecars].filter((w) => w.path.includes("game-scopes"))).toEqual([]);
    expect(res.shards.some((s) => s.path.includes("game-scopes"))).toBe(false);
    applyWrites([...res.writes, ...res.sidecars]);
    expect(existsSync(join(root, "game-scopes"))).toBe(false);
    expect(readdirSync(scopesDir).sort()).toEqual(["game.scopes.json", "storylets.scopes.json"]);
    expect(readFileSync(join(scopesDir, "storylets.scopes.json"), "utf8")).toBe(FILES["storylets.scopes.json"]);
  });

  it("takes the recipient's World edit to game.scopes.json, keeping the file's other scopes, and reports it", async () => {
    const { root, scopesDir } = gameWith();
    const sent = await runPack(root);
    const theirs = await unpackFresh(sent);
    editWorld(theirs, threat(7));
    const returned = await runPack(theirs);

    const res = await runUnpackMerge(returned, sent, root);
    const path = join(scopesDir, "game.scopes.json");
    expect(res.gameScopes).toEqual({ path });
    expect(res.writes.filter((w) => w.path === path)).toHaveLength(1);
    applyWrites(res.writes);
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.scopes.map((s: { token: string }) => s.token)).toEqual(["world", "player"]); // @player untouched
    expect(written.scopes[0].declarations[0].default).toBe(7);
    expect(readFileSync(join(scopesDir, "storylets.scopes.json"), "utf8")).toBe(FILES["storylets.scopes.json"]);
    // The project's synced copy has it too, so the two agree and validate has nothing to say about it.
    const after = loadProject(root);
    expect(after.project.scopeRegistry).toEqual(threat(7));
    expect(runValidate(after).gameScopes.filter((i) => /world/i.test(i.message))).toEqual([]);
  });

  it("takes only the scopes the recipient changed, so an edit to the shared file since sending stays", async () => {
    const { root, scopesDir } = gameWith();
    editProject(root, (p) => ({ ...p, scopeRegistry: { version: 1, scopes: game.scopes } })); // copies of both
    const sent = await runPack(root);
    // Since sending, another tool changed @player in the shared file.
    const later = { ...game, scopes: [world, { token: "player", declarations: [{ name: "name", type: "string", default: "Bo" }] }] };
    writeFileSync(join(scopesDir, "game.scopes.json"), JSON.stringify(later, null, 2));
    const theirs = await unpackFresh(sent);
    editWorld(theirs, { version: 1, scopes: [...threat(9).scopes, game.scopes[1]!] }); // @player as it was

    const res = await runUnpackMerge(await runPack(theirs), sent, root);
    applyWrites(res.writes);
    const written = JSON.parse(readFileSync(join(scopesDir, "game.scopes.json"), "utf8"));
    expect(written.scopes[0].declarations[0].default).toBe(9);
    expect(written.scopes[1].declarations[0].default).toBe("Bo");
  });

  it("writes nothing to game.scopes.json when the recipient left World alone", async () => {
    const { root, scopesDir } = gameWith();
    const sent = await runPack(root);
    const theirs = await unpackFresh(sent);
    withCondition(theirs, "@world.threat > 1"); // a real edit, just not to World properties
    const res = await runUnpackMerge(await runPack(theirs), sent, root);
    expect(res.shards.length).toBeGreaterThan(0);
    expect(res.gameScopes).toBeUndefined();
    expect(res.writes.some((w) => w.path.startsWith(scopesDir))).toBe(false);
    applyWrites(res.writes);
    expect(readFileSync(join(scopesDir, "game.scopes.json"), "utf8")).toBe(FILES["game.scopes.json"]);
  });

  it("reports a game.scopes.json that won't parse, and leaves it alone", async () => {
    const { root, scopesDir } = gameWith();
    const sent = await runPack(root);
    const theirs = await unpackFresh(sent);
    editWorld(theirs, threat(7));
    writeFileSync(join(scopesDir, "game.scopes.json"), "{ broken");
    const res = await runUnpackMerge(await runPack(theirs), sent, root);
    expect(res.gameScopes).toEqual({ path: join(scopesDir, "game.scopes.json"), error: expect.stringMatching(/won't parse/) });
    expect(res.writes.some((w) => w.path.startsWith(scopesDir))).toBe(false);
  });

  it("writes nothing to any shared file where the project has no game scopes folder", async () => {
    const { root } = gameWith({});
    const sent = await runPack(root);
    const theirs = await unpackFresh(sent);
    editProject(theirs, (p) => ({ ...p, scopeRegistry: threat(7) }));
    const res = await runUnpackMerge(await runPack(theirs), sent, root);
    expect(res.gameScopes).toBeUndefined();
    applyWrites(res.writes);
    expect(loadProject(root).project.scopeRegistry).toEqual(threat(7)); // the project's own copy merges as ever
  });
});
