import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { loadProject, runValidate, runExport, runExportFull, bundleOutputPath, runFormat, runPlay, renderPlay, applyWrites } from "../src/index.js";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
// The PINNED tavern (a frozen copy under test-fixtures/), not the live examples/tavern which is
// editable scratch - so authoring in the example never breaks these structure / play-path asserts.
const tavernDir = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

describe("loadProject", () => {
  it("discovers the project, scenes, and locales from the layout", () => {
    const loaded = loadProject(fixtureDir);
    expect(loaded.project.project.id).toBe("proj_fix");
    expect(loaded.scenes.map((s) => s.id)).toEqual(["scn_tavern"]);
    expect(loaded.locales.map((l) => l.locale)).toEqual(["en"]);
  });
  it("walks up from a nested start path to find the project file", () => {
    const loaded = loadProject(join(fixtureDir, "scenes"));
    expect(loaded.project.project.id).toBe("proj_fix");
  });
});

describe("runValidate", () => {
  it("passes the valid fixture project", () => {
    expect(runValidate(loadProject(fixtureDir)).ok).toBe(true);
  });
});

describe("runExport", () => {
  it("compiles conditions and assembles strings into a bundle", () => {
    const b = runExport(loadProject(fixtureDir));
    expect(b.schema).toBe("patter/bundle@0");
    const sn = b.scenes.scn_tavern!.blocks[0]!.children[0]!;
    expect(sn.condition).toEqual({ src: "@hp > 0", ast: ["bin", ">", ["sv", "patter", "hp"], ["n", 0]] });
    expect(b.voiced).toBe(true);
    expect(b.strings.en!.L_1).toBe("Welcome.");
  });

  it("IDs-only build strips strings + flags the bundle; keeps the staleness hash (#183/#194)", () => {
    const loaded = loadProject(fixtureDir);
    const full = runExportFull(loaded);
    loaded.project.export = { ...loaded.project.export, localisation: { mode: "ids" } };
    const ids = runExport(loaded);
    expect(ids.localisation).toEqual({ mode: "ids" });
    expect(ids.strings).toEqual({});                     // no strings in the .patterc - the game localises
    expect(ids.content.hash).toBe(full.content.hash);    // hash is over the FULL strings - staleness intact
    expect(ids.locales).toEqual(full.locales);           // still declares which locales exist
  });

  it("IDs-only + sourceDebug keeps ONLY the source locale, embedded for debug playback", () => {
    const loaded = loadProject(fixtureDir);
    loaded.project.export = { ...loaded.project.export, localisation: { mode: "ids", sourceDebug: true } };
    const dbg = runExport(loaded);
    expect(dbg.localisation).toEqual({ mode: "ids", sourceDebug: true });
    expect(Object.keys(dbg.strings)).toEqual([dbg.locales.default]); // source only
  });
});

describe("bundleOutputPath", () => {
  it("defaults to dist/<project-file-stem>.patterc", () => {
    const loaded = loadProject(fixtureDir);
    expect(bundleOutputPath(loaded)).toBe(join(loaded.root, "dist", "the-tavern.patterc"));
  });
  it("honours a project export.bundle override (relative resolved against the root)", () => {
    const loaded = loadProject(fixtureDir);
    loaded.project.export = { bundle: "build/game.patterc" };
    expect(bundleOutputPath(loaded)).toBe(join(loaded.root, "build", "game.patterc"));
    loaded.project.export = { bundle: "/abs/out.patterc" };
    expect(bundleOutputPath(loaded)).toBe("/abs/out.patterc");
  });
});

describe("the tavern sample (end-to-end)", () => {
  it("validates clean", () => {
    expect(runValidate(loadProject(tavernDir)).ok).toBe(true);
  });

  it("exports a bundle with both scenes and the project-wide voiced flag", () => {
    const b = runExport(loadProject(tavernDir));
    expect(Object.keys(b.scenes).sort()).toEqual(["scn_street", "scn_tavern"]);
    expect(b.voiced).toBe(false);
  });

  it("plays the work -> learn-secret -> cellar path across both scenes", () => {
    const t = renderPlay(runPlay(loadProject(tavernDir), { scene: "scn_tavern", choices: ["opt_work", "opt_secret"] })).join("\n");

    // One snippet, three beat kinds: narration, spoken line, engine cue.
    expect(t).toContain("The tavern is dim");
    expect(t).toContain("BARKEEP: What'll it be");
    expect(t).toContain("camera_focus");
    // Ineligible option is shown greyed (not hidden); the secret option is hidden on the first visit.
    expect(t).toContain("[x] Threaten him for coin");
    // Chose work -> learned the secret -> looped back to the menu where the secret now appears.
    expect(t).toContain("rats in the cellar");
    expect(t).toMatch(/\[ \] Mention the cellar/);
    expect(t).toContain("so you DO know");
    // Cross-scene jump into the street scene, then the flow ends.
    expect(t).toContain("Cold night air");
    expect(t).toContain("--- END ---");
  });

  it("plays the leave path straight into the street scene", () => {
    const t = renderPlay(runPlay(loadProject(tavernDir), { scene: "scn_tavern", choices: ["opt_leave"] })).join("\n");
    expect(t).toContain("Cold night air");
    expect(t).toContain("--- END ---");
  });
});

describe("runFormat (planned writes)", () => {
  it("is pure: returns the canonical content as a planned write, touching nothing", () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-fmt-"));
    const file = join(dir, "x.patterflow");
    writeFileSync(file, "{ b: 2, a: 1 }", "utf8"); // JSON5, unsorted, no final newline

    const [r] = runFormat([file]);
    expect(r!.changed).toBe(true);
    expect(readFileSync(file, "utf8")).toBe("{ b: 2, a: 1 }"); // the op wrote nothing

    applyWrites([r!.write!]);                                  // the caller commits
    expect(readFileSync(file, "utf8")).toBe('{\n  "a": 1,\n  "b": 2,\n}\n'); // source form: trailing comma (F1)

    const [again] = runFormat([file]);                         // idempotent: no write planned
    expect(again!.changed).toBe(false);
    expect(again!.write).toBeUndefined();
  });
});

describe("runExport: content-less beats are stripped from the bundle", () => {
  function mk(): string {
    const dir = mkdtempSync(join(tmpdir(), "patter-empty-beat-"));
    for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "g", name: "G" }, locales: { default: "en", all: ["en"] } });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "S", blocks: [
      { id: "b1", type: "block", name: "M", children: [
        { id: "g1", type: "group", selector: "choice", children: [
          { id: "o1", type: "group", prompt: { id: "CT1", kind: "text" }, children: [
            { id: "sn", type: "snippet", beats: [{ id: "T1", kind: "text" }], jump: { to: "END" } }, // empty beat, only there to carry the jump
          ] },
        ] },
      ] },
    ] } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { CT1: "Leave" } });
    return dir;
  }
  it("drops a jump-only snippet's empty beat in the compiled bundle; the jump survives", () => {
    const b = runExport(loadProject(mk()));
    const choice = b.scenes!.s1!.blocks[0]!.children[0] as { children: Array<{ children: Array<{ beats?: unknown; jump?: unknown }> }> };
    const snip = choice.children[0]!.children[0]!; // option -> the jump-only snippet
    expect(snip.beats).toBeUndefined();        // the empty text beat is gone
    expect(snip.jump).toEqual({ to: "END" });  // ...the jump it carried is preserved
  });
});
