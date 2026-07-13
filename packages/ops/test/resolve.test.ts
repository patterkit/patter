// ---------------------------------------------------------------------------
// The resolve op: id / Game ID / name lookup + where it lives + what it says (spec §6/§13).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, runResolve, runSearch, runStatusBrowse } from "../src/index.js";
import { DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES } from "@patterkit/model";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const loaded = loadProject(fixtureDir);
const writingLowest = (loaded.project.writingStatuses ?? DEFAULT_WRITING_STATUSES)[0]!.name;
const recordingLowest = (loaded.project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES)[0]!.name;

describe("runResolve", () => {
  it("resolves an opaque id to its kind, location, owning scene, and file", () => {
    const [hit] = runResolve(loaded, "sn_hello");
    expect(hit).toMatchObject({ id: "sn_hello", kind: "snippet", location: ["Tavern", "Intro"] });
    expect(hit!.file).toMatch(/tavern\.patterflow$/);
    expect(typeof hit!.sceneId).toBe("string"); // the scene to jump to (resolve → editor)
    expect(hit!.sceneId.length).toBeGreaterThan(0);
  });

  it("resolves a beat id to the line it names (its text), so a loc/audio/log id finds its line", () => {
    const [hit] = runResolve(loaded, "L_1");
    expect(hit).toMatchObject({ id: "L_1", kind: "beat", text: "Welcome." });
  });

  it("resolves a Game ID (address) to its node", () => {
    const hits = runResolve(loaded, "tavern"); // the scene's effective Game ID (slug of "Tavern")
    expect(hits.some((e) => e.id === "scn_tavern" && e.kind === "scene")).toBe(true);
  });

  it("resolves an author name (case-insensitive) to the named node", () => {
    const hits = runResolve(loaded, "Intro");
    expect(hits.some((e) => e.id === "blk_intro" && e.kind === "block" && e.name === "Intro")).toBe(true);
  });

  it("falls back to substring matching (here, of the opaque id) when nothing matches exactly", () => {
    const ids = runResolve(loaded, "hello").map((e) => e.id); // "hello" is a substring of "sn_hello"
    expect(ids).toContain("sn_hello");
  });

  it("an exact id hit never drowns in fuzzy matches", () => {
    const hits = runResolve(loaded, "scn_tavern");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: "scn_tavern", kind: "scene", name: "Tavern" });
  });

  it("returns empty for an unknown query", () => {
    expect(runResolve(loaded, "no_such_thing_xyz")).toEqual([]);
  });
});

describe("runStatusBrowse (status filter #205/#206)", () => {
  it("the recording dimension lists dialogue lines at the lowest rung (unset), a subset of the writing browse", () => {
    const rec = runStatusBrowse(loaded, recordingLowest, "recording").map((e) => e.id);
    const writ = runStatusBrowse(loaded, writingLowest, "writing").map((e) => e.id);
    expect(rec.length).toBeGreaterThan(0);
    // recording is dialogue-only; writing covers line + text, so every recording hit is also a writing hit.
    expect(rec.every((id) => writ.includes(id))).toBe(true);
    expect(writ.length).toBeGreaterThanOrEqual(rec.length);
  });

  it("a recording rung nobody is set to returns nothing", () => {
    expect(runStatusBrowse(loaded, "recorded", "recording")).toEqual([]);
  });

  it("browsing by 'rerecord' finds flagged lines, and their on-disk rung no longer does (#227)", () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-browse-rerec-"));
    for (const d of ["scenes", "loc/en", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "b", name: "B" }, locales: { default: "en", all: ["en"] }, voiced: true, cast: [{ name: "ANNA" }] });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [{ id: "b1", type: "block", name: "M", children: [
      { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "L2", kind: "line", character: "ANNA" }], jump: { to: "END" } },
    ] }] } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "one", L2: "two" } });
    w("authoring/a.patterx", { schema: "patter/authoring@0", recording: { L1: "recorded", L2: "recorded" }, rerecord: { L1: true } });
    const loc = loadProject(dir);

    expect(runStatusBrowse(loc, "rerecord", "recording").map((e) => e.id)).toEqual(["L1"]);
    expect(runStatusBrowse(loc, "recorded", "recording").map((e) => e.id)).toEqual(["L2"]); // L1 masked out
  });
});

describe("runSearch (the content / title / Game ID search)", () => {
  it("matches a scene by title (and its Game ID address)", () => {
    const hits = runSearch(loaded, "tavern");
    expect(hits.some((e) => e.id === "scn_tavern" && e.kind === "scene")).toBe(true);
  });

  it("matches a block by its Game ID", () => {
    expect(runSearch(loaded, "intro").some((e) => e.id === "blk_intro")).toBe(true);
  });

  it("matches a beat by its dialogue / narration text", () => {
    const hits = runSearch(loaded, "welcome"); // L_1's string is "Welcome."
    expect(hits.some((e) => e.id === "L_1" && e.kind === "beat")).toBe(true);
  });

  it("also matches the opaque internal id (the folded-in 'Go to ID': paste an id, find its line)", () => {
    expect(runSearch(loaded, "sn_hello").some((e) => e.id === "sn_hello")).toBe(true);
    expect(runSearch(loaded, "L_1").some((e) => e.id === "L_1" && e.kind === "beat")).toBe(true);
  });

  it("ranks title / Game-ID hits above content-only hits", () => {
    // "intro" hits the block (Game ID) AND any beat whose text contains it; the block comes first.
    const hits = runSearch(loaded, "intro");
    expect(hits[0]!.kind).not.toBe("beat");
  });
});
