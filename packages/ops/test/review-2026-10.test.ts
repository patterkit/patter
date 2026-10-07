// ---------------------------------------------------------------------------
// The CLI review of October 2026 (patterkit design/patter-cli-review-2026-10.md): each test names the
// trigger of one finding in ops, which the CLI and Patterpad share.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { dirname, join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { canonicalStringify } from "@patterkit/core";
import {
  loadProject, runExport, runExportHtml, runValidate, runFormat, applyWrites, bundleOutputPath, besideBundlePath, exportBlockers, planBuild, runInit, currentBundlePosture, runReport, runCoverage, runVoiceScript, loadProjectLanding,
} from "../src/index.js";

type Obj = Record<string, unknown>;

/** A small project: one scene of two lines and an end, with `extra` children appended to its block. */
function makeProject(opts: { extra?: Obj[]; strings?: Record<string, string>; project?: Obj } = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-review-")), "game.patter");
  for (const d of ["scenes", "loc/en"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), canonicalStringify(o));
  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "rev", name: "Review" },
    locales: { default: "en", all: ["en"] }, start: { scene: "s1" }, ...opts.project,
  });
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Start", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "text" }] },
        ...(opts.extra ?? []),
        { id: "nEnd", type: "snippet", jump: { to: "END" } },
      ] },
    ] } });
  w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "Hello.", ...opts.strings } });
  return dir;
}

describe("export refuses content validate calls broken (ruling A)", () => {
  it("refuses a dangling jump, naming it, and builds it with allowInvalid", () => {
    const loaded = loadProject(makeProject({ extra: [{ id: "nJump", type: "snippet", jump: { to: "nowhere" } }] }));
    expect(() => runExport(loaded)).toThrow(/problem\(s\) to fix before this project builds:\n {2}\[dangling-jump\]/);
    expect(() => runExportHtml(loaded)).toThrow(/dangling-jump/);
    expect(runExport(loaded, { allowInvalid: true }).schema).toBe("patter/bundle@0");
  });

  it("builds a project with only warnings", () => {
    expect(exportBlockers(loadProject(makeProject()))).toEqual([]);
  });
});

describe("a choice that can run dry is a warning (ruling B)", () => {
  const dry = { id: "c1", type: "group", selector: "choice", children: [
    { id: "o1", type: "snippet", condition: "false", prompt: { id: "P1", kind: "line", say: "" }, beats: [{ id: "L2", kind: "text" }] },
  ] };
  it("passes validate, and leaves reachability on", () => {
    const loaded = loadProject(makeProject({ extra: [dry], strings: { P1: "Go", L2: "Gone." } }));
    const r = runValidate(loaded);
    expect(r.structural.map((i) => [i.code, i.severity])).toContainEqual(["choice-can-empty", "warning"]);
    expect(r.structural.filter((i) => i.severity !== "warning")).toEqual([]);
    expect(r.ok).toBe(true);
    expect(() => runExport(loaded)).not.toThrow();
  });
});

describe("a fresh bundle is fresh (item 9)", () => {
  it("does not read as stale because the project has an empty beat", () => {
    // Export strips a beat with no text before compiling; the staleness check compiled without stripping.
    const dir = makeProject({ extra: [{ id: "nEmpty", type: "snippet", beats: [{ id: "L9", kind: "text" }] }] });
    const loaded = loadProject(dir);
    applyWrites([{ path: bundleOutputPath(loaded), content: canonicalStringify(runExport(loaded), { trailingComma: false }) }]);
    expect(runValidate(loadProject(dir)).staleBundles).toEqual([]);
  });

  it("reads a bundle no stock JSON parser can as not fresh (item 6)", () => {
    const dir = makeProject();
    const loaded = loadProject(dir);
    applyWrites([{ path: bundleOutputPath(loaded), content: canonicalStringify(runExport(loaded)) }]); // JSON5: trailing commas
    expect(runValidate(loadProject(dir)).staleBundles[0]?.message).toMatch(/not strict JSON/);
  });

  it("checks the bundle where the project writes it, outside the project folder", () => {
    const dir = makeProject();
    const loaded = loadProject(dir);
    expect(dirname(bundleOutputPath(loaded))).toBe(join(dirname(dir), "patter-dist"));
    applyWrites([{ path: bundleOutputPath(loaded), content: '{"content":{"hash":"old"}}' }]);
    expect(runValidate(loadProject(dir)).staleBundles.map((i) => i.file)).toEqual([bundleOutputPath(loaded)]);
  });
});

describe("loc shards that disagree (items 10 and 29)", () => {
  it("are reported against both files, and validate does not throw", () => {
    const dir = makeProject();
    writeFileSync(join(dir, "loc/en/again.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "Goodbye." } }));
    const r = runValidate(loadProject(dir));
    const clash = r.localisation.find((i) => i.severity === "error");
    expect(clash?.message).toMatch(/'L1' has different 'en' text here and in .*\.patterloc/);
    expect(r.localisation.some((i) => i.severity === "warning" && /a second file of 'en' strings/.test(i.message))).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("warn of a shard for a scene the project lacks, or in a language it does not declare", () => {
    const dir = makeProject();
    mkdirSync(join(dir, "loc/fr"), { recursive: true });
    writeFileSync(join(dir, "loc/fr/one.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "s1", locale: "fr", strings: { L1: "Bonjour." } }));
    writeFileSync(join(dir, "loc/en/ghost.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "s_gone", locale: "en", strings: {} }));
    const messages = runValidate(loadProject(dir)).localisation.map((i) => i.message);
    expect(messages.some((m) => /'fr', which is not one of the project's languages/.test(m))).toBe(true);
    expect(messages.some((m) => /scene 's_gone', which the project does not have/.test(m))).toBe(true);
  });
});

describe("format leaves anything that is not a shard alone (item 6)", () => {
  it("skips the bundle and a scopes file, and formats a project folder's shards", () => {
    const dir = makeProject();
    const loaded = loadProject(dir);
    const bundle = bundleOutputPath(loaded);
    applyWrites([{ path: bundle, content: JSON.stringify(runExport(loaded)) }]);
    const scopes = join(dir, "game.scopes.json");
    writeFileSync(scopes, '{"a":1}');
    expect(runFormat([bundle, scopes]).every((r) => r.skipped && !r.changed)).toBe(true);
    expect(readFileSync(bundle, "utf8")).toBe(JSON.stringify(runExport(loaded)));
    expect(runFormat([dir]).map((r) => r.file.slice(dir.length + 1)).sort()).toEqual(["game.patterproj", "loc/en/strings.patterloc", "scenes/one.patterflow"]);
  });
});

describe("files exported beside the bundle (item 5)", () => {
  it("swap any extension, and never land on the bundle", () => {
    const loaded = loadProject(makeProject({ project: { export: { bundle: "build/game.json" } } }));
    expect(besideBundlePath(loaded, ".html")).toBe(join(loaded.root, "build", "game.html"));
    const same = loadProject(makeProject({ project: { export: { bundle: "build/game.html" } } }));
    expect(() => besideBundlePath(same, ".html")).toThrow(/would replace the bundle/);
  });
});

describe("one build plan for every front end (items 22 and 23)", () => {
  it("writes the audio manifest under Audio Folders, which only Patterpad used to", () => {
    const dir = makeProject({ project: {
      voiced: true, trackAudioStatus: true, audioFolders: true, audioRoot: "audio",
      recordingStatuses: [{ name: "missing" }, { name: "final" }],
    } });
    mkdirSync(join(dir, "audio", "final"), { recursive: true });
    writeFileSync(join(dir, "audio", "final", "L1.wav"), "");
    writeFileSync(join(dir, "audio", "final", "L1.mp3"), "");
    const loaded = loadProject(dir);
    const plan = planBuild(loaded);
    expect(plan.writes[0]!.path).toBe(bundleOutputPath(loaded));
    const manifest = plan.writes.find((w) => w.path === join(dir, "audio", "patteraudio.json"));
    expect(JSON.parse(manifest!.content).clips).toEqual({ L1: { file: "final/L1.wav", status: "final" } });
  });

  it("writes only the bundle for a project with no scopes folder or audio", () => {
    const loaded = loadProject(makeProject());
    expect(planBuild(loaded).writes.map((w) => w.path)).toEqual([bundleOutputPath(loaded)]);
  });
});

describe("init and the VCS files (items 38 and 40)", () => {
  it("plans the project file last, so a scaffold that half landed can be run again", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "patter-review-init-")), "g.patter");
    const { writes, projectFile } = runInit({ dir, name: "G", vcs: "git" });
    expect(writes.at(-1)!.path).toBe(projectFile);
  });

  it("reads the bundle posture back, for every system", () => {
    for (const vcs of ["git", "perforce", "plastic", "svn"] as const) {
      for (const bundle of ["commit", "ignore"] as const) {
        const dir = join(mkdtempSync(join(tmpdir(), "patter-review-posture-")), "g.patter");
        applyWrites(runInit({ dir, name: "G", vcs, bundle }).writes);
        expect(currentBundlePosture(dir, vcs)).toBe(bundle);
      }
    }
  });
});

describe("a writing status off the ladder (item 43)", () => {
  it("counts as the lowest rung in the totals, as it does for scene status", () => {
    const dir = makeProject();
    mkdirSync(join(dir, "authoring"), { recursive: true });
    writeFileSync(join(dir, "authoring/one.patterx"), canonicalStringify({ schema: "patter/authoring@0", writing: { L1: "polished-ish" } }));
    const scene = runReport(loadProject(dir)).scenes[0]!;
    expect(scene.writtenRemaining).toBe(1);
    expect(scene.writtenDone).toBe(0);
  });
});

describe("another engine's scope with no folder to stand it in from (item 28)", () => {
  it("is a validate warning, naming the scope", () => {
    const loaded = loadProject(makeProject({ extra: [{ id: "nStory", type: "snippet", condition: "@story.met", beats: [{ id: "L3", kind: "text" }] }], strings: { L3: "Met." } }));
    const r = runValidate(loaded);
    expect(r.gameScopes.find((i) => /names @story, another engine's scope/.test(i.message))?.severity).toBe("warning");
    expect(r.ok).toBe(true);
  });
});

describe("coverage counts what ships (item 25)", () => {
  it("leaves out an empty beat export strips, rather than calling it never reached", () => {
    const loaded = loadProject(makeProject({ extra: [{ id: "nEmpty", type: "snippet", beats: [{ id: "L9", kind: "text" }] }] }));
    const report = runCoverage(loaded, { runs: 5, seed: 1 });
    expect(report.beats.map((b) => b.id)).not.toContain("L9");
    expect(report.totals.neverHit).toBe(0);
  });
});

describe("a beat of a kind the runtime does not know", () => {
  it("is a structural error, since it would never play", () => {
    const loaded = loadProject(makeProject({ extra: [{ id: "nOdd", type: "snippet", beats: [{ id: "L4", kind: "narration" }] }], strings: { L4: "Odd." } }));
    expect(runValidate(loaded).structural.map((i) => i.message)).toContain("beat 'L4' has an unknown kind 'narration' (line, text, or gameEvent)");
  });
});

describe("a cut branch, in the report and the voice script alike", () => {
  it("cuts the lines inside a cut snippet in the report, as the voice script leaves them out", () => {
    const dir = makeProject({
      project: { voiced: true },
      extra: [{ id: "nCut", type: "snippet", beats: [{ id: "L5", kind: "line", character: "A" }] }],
      strings: { L5: "Gone." },
    });
    mkdirSync(join(dir, "authoring"), { recursive: true });
    writeFileSync(join(dir, "authoring/one.patterx"), canonicalStringify({ schema: "patter/authoring@0", cut: { nCut: true } }));
    const loaded = loadProject(dir);
    const report = runReport(loaded);
    expect(report.scenes[0]!.voiced.count).toBe(0);
    expect(report.cut.voicedLines).toBe(1);
    expect(runVoiceScript(loaded, { everything: true }).lines).toEqual([]);
  });
});

describe("the landing load (item 46)", () => {
  it("takes only the source language's strings for the landing scene", () => {
    const dir = makeProject({ project: { locales: { default: "en", all: ["en", "fr"] } } });
    // Off the conventional name, so the load has to scan: French first, then English.
    rmSync(join(dir, "loc/en/strings.patterloc"));
    mkdirSync(join(dir, "loc/aa"), { recursive: true });
    writeFileSync(join(dir, "loc/aa/fr.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "s1", locale: "fr", strings: { L1: "Bonjour." } }));
    writeFileSync(join(dir, "loc/en/zz.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L1: "Hello." } }));
    expect(loadProjectLanding(dir).locales.map((l) => l.locale)).toEqual(["en"]);
  });
});
