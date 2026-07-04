// The project session (project.ts) headless: create a brand-new project (runInit), open it, read a
// scene's source, save it back through the lock-aware write path, and play it. This is the M0
// create / read / save / play spine minus Electron.

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, cpSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProject } from "@patterkit/ops";
import { walkNodes } from "@patterkit/model";
import { parseSource, canonicalStringify } from "@patterkit/core";
import * as project from "../src/main/project.js";

// The PINNED tavern fixture (frozen), not the live examples/tavern editable scratch.
const TAVERN = resolve(dirname(fileURLToPath(import.meta.url)), "../../../test-fixtures/tavern-example.patter");

describe("project session: create -> open -> read -> save -> play", () => {
  it("scaffolds a new project and round-trips a scene through it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-proj-"));
    const opened = await project.createProject(dir, "Test Project");
    expect(opened.name).toBe("Test Project");
    expect(opened.scenes.length).toBeGreaterThanOrEqual(1);

    const sceneId = opened.scenes[0]!.id;
    const src = project.readScene(sceneId);
    expect(src.flowSource.length).toBeGreaterThan(0);

    // Save the source straight back: the lock-aware write path lands bytes (a plain write outside VCS).
    const res = await project.saveScene(sceneId, src.flowSource, src.locSource);
    expect(res.ok).toBe(true);
    expect(project.readScene(sceneId).flowSource).toBe(src.flowSource);

    project.startPlay(sceneId);
    expect(["choice", "end"]).toContain(project.playToStop().stop); // a fresh scene plays (no error)
  });

  it("gates Audio Folders on the project's Voiced flag, keeping the stored config (#206)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-voiced-"));
    await project.createProject(dir, "Voiced Project");

    // Voiced + audio-status tracking + folder mode -> audio is active. (trackAudioStatus is opt-in, default
    // off, even for a voiced project - #206.)
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, voiced: true, trackAudioStatus: true, audioFolders: true })).ok).toBe(true);
    expect(project.audioFoldersEnabled()).toBe(true);

    // Untick Track Audio Status (Voiced still on): folder mode is forced off, but the config is preserved.
    const sT = project.readSettings()!;
    expect((await project.saveSettings({ ...sT, trackAudioStatus: false })).ok).toBe(true);
    expect(project.audioFoldersEnabled()).toBe(false);
    expect(project.readSettings()?.audioFolders).toBe(true);

    // Turn Voiced off: folder mode is forced off (an un-voiced story tracks no recording status)...
    const s2 = project.readSettings()!;
    expect((await project.saveSettings({ ...s2, voiced: false, trackAudioStatus: true })).ok).toBe(true);
    expect(project.audioFoldersEnabled()).toBe(false);
    // ...but the stored audioFolders flag is preserved so flipping Voiced back on restores the setup.
    expect(project.readSettings()?.audioFolders).toBe(true);
  });

  it("persists the Estimating config, and drops it back to undefined when returned to the default (#estimating)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-est-"));
    await project.createProject(dir, "Estimating Project");

    // A fresh project reads a disabled default and stores nothing for it.
    const s = project.readSettings()!;
    expect(s.estimating).toEqual({ enabled: false, defaultLines: 20 });

    // Turn it on with a threshold, a non-default number, and a tag override (blank tags pruned).
    expect((await project.saveSettings({
      ...s, estimating: { enabled: true, thresholdStatus: "draft 1", defaultLines: 35, tagEstimates: [{ tag: "cutscene", lines: 40 }, { tag: "", lines: 5 }] },
    })).ok).toBe(true);
    expect(project.readSettings()!.estimating).toEqual({ enabled: true, thresholdStatus: "draft 1", defaultLines: 35, tagEstimates: [{ tag: "cutscene", lines: 40 }] });

    // Back to the untouched default -> the field is dropped from the file (a clean project stays clean).
    expect((await project.saveSettings({ ...s, estimating: { enabled: false, defaultLines: 20 } })).ok).toBe(true);
    expect(project.readSettings()!.estimating).toEqual({ enabled: false, defaultLines: 20 });
  });

  it("Save As (duplicateTo) copies the authoring source but skips audio + build output", async () => {
    const root = mkdtempSync(join(tmpdir(), "pp-saveas-"));
    await project.createProject(root, "SaveAs Source");
    // Point the config at an audio root folder + a build bundle pinned INSIDE the project.
    const s = project.readSettings()!;
    expect((await project.saveSettings({
      ...s, voiced: true, audioFolders: true, audioRoot: "audio",
      buildBundle: "dist/game.patterc",
    })).ok).toBe(true);
    // Drop derived files where that config says they live (audio takes + the compiled bundle).
    mkdirSync(join(root, "audio"), { recursive: true }); writeFileSync(join(root, "audio", "L1.wav"), "wav");
    mkdirSync(join(root, "dist"), { recursive: true }); writeFileSync(join(root, "dist", "game.patterc"), "bundle");

    const dest = join(dirname(root), "SaveAs Copy.patter");
    project.duplicateTo(dest);

    // Derived output is skipped...
    expect(existsSync(join(dest, "audio"))).toBe(false);
    expect(existsSync(join(dest, "dist"))).toBe(false);
    // ...but the authoring source travels: the copy is a valid, openable project.
    const copy = project.openProject(dest);
    expect(copy.scenes.length).toBeGreaterThan(0);
  });

  it("persists the spell-check ignore list + dictionary toggle/language, distinctly from the word list (#177)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-spell-"));
    await project.createProject(dir, "Spell Project");

    // "Add to dictionary" and "Ignore" land in SEPARATE lists.
    expect((await project.addDictionaryWord("Eldoria")).words).toEqual(["Eldoria"]);
    const ig = await project.addIgnoreWord("teh");
    expect(ig.ignore).toEqual(["teh"]);
    expect((await project.addIgnoreWord("teh")).ignore).toEqual(["teh"]); // idempotent

    // Review ▸ Spelling: flip off + switch language; both persist.
    const set = await project.setDictionary({ enabled: false, language: "en-GB" });
    expect(set.dictionary).toMatchObject({ enabled: false, language: "en-GB", words: ["Eldoria"], ignore: ["teh"] });

    // Reopen from disk: the settings DTO carries the word list, the ignore list, and the off/language state.
    project.openProject(dir);
    const s = project.readSettings()!;
    expect(s.dictionaryWords).toEqual(["Eldoria"]);
    expect(s.dictionaryIgnore).toEqual(["teh"]);
    expect(s.dictionaryEnabled).toBe(false);
    expect(s.dictionaryLanguage).toBe("en-GB");

    // A settings save preserves the ignore list (it round-trips through the DTO, not dropped).
    expect((await project.saveSettings(s)).ok).toBe(true);
    project.openProject(dir);
    expect(project.readSettings()?.dictionaryIgnore).toEqual(["teh"]);
  });

  it("Build Bundle compiles to the sibling patter-dist/ default; Build settings can repoint it (#178/#179)", async () => {
    const base = mkdtempSync(join(tmpdir(), "pp-build-"));
    const dir = join(base, "Build Me.patter"); // a .patter PACKAGE; the build must land OUTSIDE it
    await project.createProject(dir, "Build Me");

    // The Build tab shows where the bundle lands - the sibling patter-dist/ default until repointed.
    expect(project.readSettings()?.buildBundle).toBe("../patter-dist/build_me.patterc");

    // Build Bundle writes the compiled .patterc to a SIBLING folder (not inside the package).
    const res = await project.buildBundle();
    expect(res.ok).toBe(true);
    expect(res.path).toBe(join(base, "patter-dist", "build_me.patterc"));
    expect(existsSync(res.path!)).toBe(true);
    expect(readFileSync(res.path!, "utf8")).toContain("patter/bundle"); // a real compiled bundle

    // Repoint the output via Project Settings -> Build, then rebuild there.
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, buildBundle: "out/game.patterc" })).ok).toBe(true);
    expect(project.readSettings()?.buildBundle).toBe("out/game.patterc");
    const res2 = await project.buildBundle();
    expect(res2.path).toBe(join(dir, "out", "game.patterc"));
    expect(existsSync(join(dir, "out", "game.patterc"))).toBe(true);

    // Switch to IDs-only localisation: the bundle ships NO strings (the game localises beat IDs) and the
    // single .patterc is self-contained - no sibling JSON files (#183/#194).
    const s2 = project.readSettings()!;
    expect((await project.saveSettings({ ...s2, buildLocalisation: "ids" })).ok).toBe(true);
    expect(project.readSettings()?.buildLocalisation).toBe("ids");
    const res3 = await project.buildBundle();
    const built = JSON.parse(readFileSync(res3.path!, "utf8")) as { localisation?: { mode: string }; strings: object };
    expect(built.localisation?.mode).toBe("ids");
    expect(built.strings).toEqual({});                               // no strings in the .patterc
    expect(existsSync(join(dir, "out", "game.en.json"))).toBe(false); // no sibling locale files
  });

  it("validates the tavern example (problems panel feed)", () => {
    project.openProject(TAVERN);
    const dto = project.validate();
    expect(dto.ok).toBe(true);          // the curated example is clean
    expect(Array.isArray(dto.problems)).toBe(true);
  });

  it("records the chosen VCS at create, and switching it in settings re-emits the config", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-vcs-"));
    await project.createProject(dir, "VCS Project", "perforce");
    expect(project.readSettings()?.vcs).toBe("perforce");
    expect(existsSync(join(dir, ".gitattributes"))).toBe(false); // perforce gets no .gitattributes

    const s = project.readSettings()!;
    const res = await project.saveSettings({ ...s, vcs: "git" });
    expect(res.ok).toBe(true);
    expect(project.readSettings()?.vcs).toBe("git");
    expect(existsSync(join(dir, ".gitattributes"))).toBe(true); // switching to git re-emits its config
  });

  it("switching VCS removes the previous system's now-orphaned config files (#153)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-vcs-orphan-"));
    await project.createProject(dir, "Orphans", "git");
    expect(existsSync(join(dir, ".gitattributes"))).toBe(true);
    expect(existsSync(join(dir, ".gitignore"))).toBe(true);

    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, vcs: "perforce" })).ok).toBe(true);
    expect(existsSync(join(dir, ".gitattributes"))).toBe(false); // git-only hygiene cleaned up on switch
    expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    expect(existsSync(join(dir, ".p4ignore"))).toBe(true);       // the new system's ignore is emitted
    expect(existsSync(join(dir, "vcs-setup.md"))).toBe(true);    // the shared doc is kept, not orphaned

    // And switching to "none" clears the remaining VCS-specific files too.
    const s2 = project.readSettings()!;
    expect((await project.saveSettings({ ...s2, vcs: "none" })).ok).toBe(true);
    expect(existsSync(join(dir, ".p4ignore"))).toBe(false);
    expect(existsSync(join(dir, "vcs-setup.md"))).toBe(true);    // doc still kept
  });

  it("computes the production report (spec §13) for the Production Information view", () => {
    project.openProject(TAVERN);
    const data = project.report();
    expect(data).not.toBeNull();
    expect(data!.project.name).toBe("The Tavern");
    expect(data!.scenes.length).toBeGreaterThanOrEqual(1);
    // The ladders default when the project declares none, so a view always has rungs to render.
    expect(data!.writingLadder.length).toBeGreaterThan(0);
    expect(typeof data!.totals.projectedWritten).toBe("number");
  });

  it("content search spans EVERY scene's dialogue, not just the landing one", () => {
    project.openProject(TAVERN);
    // "stranger" is dialogue in scn_tavern (L_greet = "What'll it be, stranger?"). The index used to read
    // only the FIRST loc shard, so a non-landing scene's text never matched - this guards that.
    const hits = project.searchProject("stranger");
    expect(hits.some((e) => e.kind === "beat" && e.id === "L_greet" && (e.text ?? "").includes("stranger"))).toBe(true);
    // and the other scene still matches (the merge didn't drop the first shard)
    expect(project.searchProject("thuds").some((e) => e.id === "T_street")).toBe(true);
  });

  it("search floats the caret's scene above other scenes (focus)", () => {
    project.openProject(TAVERN);
    const here = project.searchProject("stranger").find((e) => e.id === "L_greet")?.sceneId; // L_greet's scene
    expect(here).toBeTruthy();
    // "tavern" matches in both scenes; with focus on L_greet's scene, its hits must all precede the other's.
    const hits = project.searchProject("tavern", { sceneId: here! });
    const firstOther = hits.findIndex((e) => e.sceneId !== here);
    const lastHere = hits.map((e) => e.sceneId).lastIndexOf(here!);
    expect(hits.some((e) => e.sceneId !== here)).toBe(true); // other scenes still appear
    expect(lastHere).toBeLessThan(firstOther);               // ...after every current-scene hit
  });

  it("creates a new scene: fresh shards, de-collided filename, immediately editable and playable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-newscene-"));
    await project.createProject(dir, "Grows");

    const res = await project.createScene("The Docks");
    expect(res.ok).toBe(true);
    expect(res.project!.scenes.some((s) => s.id === res.sceneId && s.name === "The Docks")).toBe(true);
    expect(project.readScene(res.sceneId!).flowSource.length).toBeGreaterThan(0); // shards readable at once
    project.startPlay(res.sceneId!);
    expect(["choice", "end"]).toContain(project.playToStop().stop); // the scaffold plays

    // A name that slugs onto an existing file must NOT overwrite it: the stem de-collides.
    const dup = await project.createScene("Start"); // the scaffold scene is scenes/start.patterflow
    expect(dup.ok).toBe(true);
    expect(existsSync(join(dir, "scenes", "start-2.patterflow"))).toBe(true);
    expect(readFileSync(join(dir, "scenes", "start.patterflow"), "utf8")).not.toContain(dup.sceneId!);

    // A blank name is refused.
    expect((await project.createScene("   ")).ok).toBe(false);
  });

  it("publish-for-web keeps the writer's harness across republishes, refreshing only the story", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-webpub-"));
    await project.createProject(dir, "Webby");
    const site = join(dir, "site");

    const first = project.publishWebTo(site);
    expect(first.ok).toBe(true);
    expect(first.kept).toEqual([]); // fresh folder: everything written
    for (const f of ["index.html", "style.css", "patterplay.js", "story.js"]) expect(existsSync(join(site, f))).toBe(true);

    // The writer customises the harness; a republish must leave it alone but refresh the story.
    writeFileSync(join(site, "index.html"), "<!-- mine now -->");
    writeFileSync(join(site, "story.js"), "stale");
    const again = project.publishWebTo(site);
    expect(again.ok).toBe(true);
    expect(again.kept).toEqual(["index.html", "style.css"]);
    expect(readFileSync(join(site, "index.html"), "utf8")).toBe("<!-- mine now -->");
    expect(readFileSync(join(site, "story.js"), "utf8").startsWith("window.PATTER_BUNDLE=")).toBe(true);
  });

  it("deletes a scene: every shard gone, start/sceneOrder cleaned, the last scene refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-delscene-"));
    await project.createProject(dir, "Shrinks");
    const created = await project.createScene("Doomed");
    const id = created.sceneId!;

    // A hand-added second-locale shard must go with the scene (delete covers EVERY locale).
    mkdirSync(join(dir, "loc", "fr"), { recursive: true });
    writeFileSync(join(dir, "loc", "fr", "doomed.patterloc"), canonicalStringify({ schema: "patter/strings@0", scene: id, locale: "fr", strings: {} }));
    // Point start + the authored order at it, so the cleanup paths are exercised.
    await project.setStart({ scene: id });
    await project.reorderScenes([id, ...loadProject(dir).scenes.map((s) => s.id).filter((x) => x !== id)]);
    project.openProject(dir); project.hydrate(); // re-open so the hand-added shard is in the model

    const res = await project.deleteScene(id);
    expect(res.ok).toBe(true);
    expect(res.project!.scenes.some((s) => s.id === id)).toBe(false);
    expect(existsSync(join(dir, "scenes", "doomed.patterflow"))).toBe(false);
    expect(existsSync(join(dir, "loc", "en", "doomed.patterloc"))).toBe(false);
    expect(existsSync(join(dir, "loc", "fr", "doomed.patterloc"))).toBe(false);
    const proj = loadProject(dir).project;
    expect(proj.start).toBeUndefined();                       // pointed at the deleted scene -> cleared
    expect(proj.sceneOrder ?? []).not.toContain(id);          // dropped from the authored order

    // One scene left now: deletion is refused.
    const last = loadProject(dir).scenes[0]!.id;
    expect((await project.deleteScene(last)).ok).toBe(false);
  });

  it("sceneDeleteInfo names the scenes that refer to the doomed one", () => {
    project.openProject(TAVERN); project.hydrate();
    const street = loadProject(TAVERN).scenes.find((s) => s.id === "scn_street")!;
    const info = project.sceneDeleteInfo(street.id)!;
    expect(info.lastScene).toBe(false);
    // The tavern jumps into the street (fixture fact), so it must be listed by name.
    const tavern = info.referrers.find((r) => r.sceneId === "scn_tavern");
    expect(tavern).toBeTruthy();
    expect(tavern!.jumps).toBeGreaterThanOrEqual(1);
    // The street is literally scaffold-shaped (one text beat), so it reads as untouched - the
    // renderer still confirms because it IS referenced. The tavern, with real content, does not.
    expect(info.untouched).toBe(true);
    expect(project.sceneDeleteInfo("scn_tavern")!.untouched).toBe(false);
  });

  it("persists the nav's scene order and re-applies it on reopen", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-order-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    project.openProject(dir); project.hydrate();
    const all = loadProject(dir).scenes.map((s) => s.id);
    expect(all.length).toBeGreaterThan(1);

    // A stale list (wrong ids) is refused rather than silently dropping scenes.
    const bad = await project.reorderScenes(["not-a-scene", ...all.slice(1)]);
    expect(bad.ok).toBe(false);

    // A real permutation persists to the .patterproj and reorders the summary immediately...
    const flipped = [...all].reverse();
    const res = await project.reorderScenes(flipped);
    expect(res.ok).toBe(true);
    expect(res.project!.sceneIds).toEqual(flipped);
    // ...and a cold load applies it again (unlisted-scene fallback covered by the ops unit tests).
    expect(loadProject(dir).scenes.map((s) => s.id)).toEqual(flipped);
  });

  it("status browse lists line/text beats at a status; unset reads as the lowest rung (#205)", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pp-statusbrowse-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    project.openProject(dir); project.hydrate();
    const greet = project.searchProject("stranger").find((e) => e.id === "L_greet"); // a dialogue line
    expect(greet).toBeTruthy();
    const lowest = project.report()!.writingLadder[0]!;
    const target = project.report()!.writingLadder.find((n) => n !== lowest)!;

    // unset -> reads as the lowest rung. A choice prompt (C_*) is a real line/text beat (the choice text),
    // so its status is tracked and browsable like any other line; only game events are never listed.
    expect(project.linesByStatus(lowest, "writing").some((e) => e.id === "L_greet")).toBe(true);
    expect(project.linesByStatus(lowest, "writing").some((e) => e.id === "C_secret")).toBe(true); // a choice prompt
    // set a non-lowest rung -> it leaves the lowest browse for that one (model stays current after save)
    expect((await project.saveSceneWriting(greet!.sceneId, { L_greet: target })).ok).toBe(true);
    expect(project.linesByStatus(lowest, "writing").some((e) => e.id === "L_greet")).toBe(false);
    expect(project.linesByStatus(target, "writing").some((e) => e.id === "L_greet")).toBe(true);
  });

  it("the production report reflects a writing-status edit without a reopen (in-memory model stays current)", async () => {
    // A WRITABLE copy of the frozen fixture (this test saves into it).
    const dir = join(mkdtempSync(join(tmpdir(), "pp-wstat-")), "tavern.patter");
    cpSync(TAVERN, dir, { recursive: true });
    const opened = project.openProject(dir);
    project.hydrate(); // fully hydrate, so report()'s ensureHydrated is a no-op (the path the bug hid in)

    // A real line / text beat id (the unit the report tallies by) + the scene it lives in.
    const lp = loadProject(dir);
    let beatId: string | undefined;
    let sceneId: string | undefined;
    for (const sc of lp.scenes) for (const blk of sc.blocks)
      walkNodes(blk.children, (n) => {
        const node = n as { type: string; beats?: { id: string; kind: string }[] };
        if (!beatId && node.type === "snippet")
          for (const b of node.beats ?? []) if (!beatId && (b.kind === "line" || b.kind === "text")) { beatId = b.id; sceneId = sc.id; }
      });
    expect(beatId).toBeTruthy();
    expect(sceneId).toBeTruthy();

    const before = project.report()!;
    const stub = before.writingLadder[0]!;
    const target = before.writingLadder.find((n) => n !== stub)!; // any non-lowest rung
    const beforeTarget = before.totals.written.byWriting[target] ?? 0;

    expect((await project.saveSceneWriting(sceneId!, { [beatId!]: target })).ok).toBe(true);

    // Pre-fix this read a stale cached model and still showed the OLD (stub) count.
    const after = project.report()!;
    expect(after.totals.written.byWriting[target] ?? 0).toBe(beforeTarget + 1);
  });

  it("renders the production report to an xlsx buffer with a suggested filename", async () => {
    project.openProject(TAVERN);
    const out = await project.reportXlsx();
    expect(out).not.toBeNull();
    expect(out!.defaultName).toBe("The Tavern - production.xlsx");
    expect(out!.buffer.length).toBeGreaterThan(0);            // real xlsx bytes
    expect(out!.buffer.subarray(0, 2).toString("latin1")).toBe("PK"); // zip (xlsx) magic
  });

  it("interactive play: Step one beat, then advance-to-stop past a choice", () => {
    const opened = project.openProject(TAVERN);
    const sceneId = opened.scenes.find((s) => s.name === "The Tavern")?.id ?? opened.scenes[0]!.id;
    project.startPlay(sceneId);

    const first = project.playStep();                  // one beat
    expect(first.stop).not.toBe("error");
    expect(first.steps.length).toBeLessThanOrEqual(1);

    const batch = project.playToStop();                // collect the rest to the next stop
    expect(batch.stop).not.toBe("error");
    expect(batch.steps.every((s) => typeof s.id === "string")).toBe(true); // ids feed the step marker
    if (batch.stop === "choice") {
      const opt = batch.options?.find((o) => o.eligible);
      expect(opt).toBeTruthy();
      project.playChoose(opt!.id);                      // choose, then play the chosen branch
      expect(project.playToStop().stop).not.toBe("error");
    }
  });

  it("live bundle refresh: a text edit swaps strings in place, a structural edit hot-swaps, garbage goes stale", () => {
    const opened = project.openProject(TAVERN);
    const sceneId = opened.scenes.find((s) => s.name === "The Tavern")?.id ?? opened.scenes[0]!.id;
    project.startPlay(sceneId);
    expect(project.playStep().stop).not.toBe("error"); // the run is mid-flight

    const src = project.readScene(sceneId);

    // The unchanged source compiles to the identical bundle: nothing to refresh.
    project.setPlaySource({ sceneId, flow: src.flowSource, loc: src.locSource });
    expect(project.refreshPlay().kind).toBe("none");

    // A text-only edit (reword one line) swaps the string tables in place: tier 1.
    const loc = parseSource(src.locSource) as { strings: Record<string, string> };
    const key = Object.keys(loc.strings)[0]!;
    loc.strings[key] = "Reworded, live.";
    project.setPlaySource({ sceneId, flow: src.flowSource, loc: canonicalStringify(loc) });
    expect(project.refreshPlay().kind).toBe("text");

    // A structural edit (a new snippet) hot-swaps the run: tier 2, and stepping keeps working.
    const flowDoc = parseSource(src.flowSource) as { scene: { blocks: Array<{ children: unknown[] }> } };
    flowDoc.scene.blocks[0]!.children.push({ id: "sn_live", type: "snippet", beats: [{ id: "L_live", kind: "text" }] });
    project.setPlaySource({ sceneId, flow: canonicalStringify(flowDoc), loc: canonicalStringify(loc) });
    const structural = project.refreshPlay();
    expect(structural.kind).toBe("structure");
    expect(structural.options).toEqual([]); // not at a choice: the tray has nothing to re-sync
    expect(project.playToStop().stop).not.toBe("error");

    // A malformed in-flight edit can't compile: the caller falls back to the freeze-until-restart path.
    project.setPlaySource({ sceneId, flow: "{ not valid", loc: canonicalStringify(loc) });
    expect(project.refreshPlay().kind).toBe("stale");
  });

  it("play locale (#195): exposes the declared locales, and a stray locale falls back to source", () => {
    const opened = project.openProject(TAVERN);
    const sceneId = opened.scenes.find((s) => s.name === "The Tavern")?.id ?? opened.scenes[0]!.id;

    const info = project.playLocaleInfo();
    expect(info.locales).toContain(info.defaultLocale); // the source language is always offered
    expect(info.locale).toBe(info.defaultLocale);       // a freshly opened project plays in its source language

    // A locale that isn't declared is ignored: the run still plays (falls back to source), never errors,
    // and the stray code never becomes the "active" one the switcher would show.
    project.setPlayLocale("zz-not-a-locale");
    project.startPlay(sceneId);
    expect(project.playToStop().stop).not.toBe("error");
    expect(project.playLocaleInfo().locale).toBe(info.defaultLocale);
  });

  it("lazy open (#171): paints the landing scene first, then hydrate() streams in the rest", () => {
    // No preferred landing -> the first scene file (scn_street) is the only one parsed in phase 1...
    const opened = project.openProject(TAVERN);
    expect(opened.scenes.map((s) => s.id)).toEqual(["scn_street"]);
    expect(project.readScene("scn_street").flowSource.length).toBeGreaterThan(0); // the landing reads without hydrating

    // ...and hydrate() finishes the parse, returning the FULL scene list (both scenes, in file order).
    const full = project.hydrate();
    expect(full?.scenes.map((s) => s.id).sort()).toEqual(["scn_street", "scn_tavern"]);
  });

  it("lazy open honours the remembered landing scene (parses it, not the first file)", () => {
    const opened = project.openProject(TAVERN, "scn_tavern");
    expect(opened.scenes.map((s) => s.id)).toEqual(["scn_tavern"]); // the remembered scene is the one painted
    expect(project.readScene("scn_tavern").flowSource.length).toBeGreaterThan(0);
  });

  it("reading a scene other than the landing one forces hydration transparently", () => {
    project.openProject(TAVERN); // lands on scn_street only
    // scn_tavern isn't in the landing shard set; readScene must hydrate the rest before serving it.
    expect(project.readScene("scn_tavern").sceneName).toBe("The Tavern");
  });

  it("sceneForPath resolves a shard to its scene id without depending on hydration state (#171)", () => {
    const loaded = loadProject(TAVERN);
    project.openProject(TAVERN); // landing-only (scn_street); scn_tavern not yet in the shard map
    // Still resolves the un-hydrated scene's flow + loc shards straight from disk.
    expect(project.sceneForPath(loaded.sceneFiles["scn_tavern"]!)).toBe("scn_tavern");
    const tavernLoc = loaded.localeFiles[loaded.locales.findIndex((l) => l.scene === "scn_tavern")];
    if (tavernLoc) expect(project.sceneForPath(tavernLoc)).toBe("scn_tavern");
    expect(project.sceneForPath(TAVERN)).toBeUndefined(); // the package root resolves to no specific scene
  });

  it("stamps the author into the .patterx edit-trail on save", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-trail-"));
    const opened = await project.createProject(dir, "Trail");
    const id = opened.scenes[0]!.id;
    const src = project.readScene(id);
    await project.saveScene(id, src.flowSource + "\n// edited\n", src.locSource, "Ian Writer"); // a real change
    // Re-load: the new authoring shard is discovered and its edit record merges in.
    const reloaded = loadProject(dir);
    const rec = reloaded.authoring.map((a) => a.edits?.[id]).find(Boolean);
    expect(rec?.by).toBe("Ian Writer");
    expect(typeof rec?.modifiedAt).toBe("string");
  });

  it("an unchanged saveScene is a no-op - shards and the .patterx edit-trail are left untouched", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-nosave-"));
    const opened = await project.createProject(dir, "NoSave");
    const id = opened.scenes[0]!.id;
    const src = project.readScene(id);

    // A first CHANGED save lays down the edit-trail stamp.
    const edited = src.flowSource + "\n// edited\n";
    expect((await project.saveScene(id, edited, src.locSource, "Ian")).ok).toBe(true);
    const stamp1 = loadProject(dir).authoring.map((a) => a.edits?.[id]).find(Boolean)!.modifiedAt;

    // Saving the SAME content again (now matching disk) must be a no-op: still ok, but no second stamp.
    expect((await project.saveScene(id, edited, src.locSource, "Ian")).ok).toBe(true);
    const stamp2 = loadProject(dir).authoring.map((a) => a.edits?.[id]).find(Boolean)!.modifiedAt;
    expect(stamp2).toBe(stamp1); // modifiedAt NOT bumped by the unchanged save

    // And a save that DOES change the content stamps a fresh trail again.
    expect((await project.saveScene(id, edited + "// more\n", src.locSource, "Ian")).ok).toBe(true);
    expect(project.readScene(id).flowSource).toContain("// more");
  });

  it("round-trips threaded comments through the authoring shard, prunes empties, keeps docs (#148)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-cmt-"));
    const opened = await project.createProject(dir, "Comments");
    const id = opened.scenes[0]!.id;

    // A documentation note first, so we can prove comments MERGE over (don't clobber) the rest.
    await project.saveSceneDocs(id, { beat1: [{ type: "writing", text: "tighten" }] });

    const save = await project.saveSceneComments(id, [
      { id: "c1", anchor: "beat1", range: { from: 4, to: 9, quote: "warm" }, messages: [{ author: "Ian", ts: "2026-06-16T09:00:00.000Z", body: "Warmer here?" }] },
      { id: "c2", anchor: "beat2", resolved: true, messages: [{ author: "Bo", ts: "2026-06-16T10:00:00.000Z", body: "done" }] },
    ]);
    expect(save.ok).toBe(true);

    const back = project.readSceneComments(id);
    expect(back.length).toBe(2);
    expect(back.find((c) => c.id === "c2")?.resolved).toBe(true);
    expect(back.find((c) => c.id === "c1")?.messages[0]?.author).toBe("Ian");
    expect(back.find((c) => c.id === "c1")?.range).toEqual({ from: 4, to: 9, quote: "warm" }); // sub-text range survives
    expect(project.readSceneDocs(id)["beat1"]?.length).toBe(1); // docs survived the comment write

    // A thread whose only message is blank is pruned, so a cancelled "add comment" leaves no trace.
    await project.saveSceneComments(id, [{ id: "c3", anchor: "b", messages: [{ author: "Ian", ts: "t", body: "   " }] }]);
    expect(project.readSceneComments(id).length).toBe(0);
  });

  it("round-trips rewrite suggestions through the authoring shard, prunes empties, keeps comments", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-sg-"));
    const opened = await project.createProject(dir, "Suggestions");
    const id = opened.scenes[0]!.id;

    // A comment first, so we can prove suggestions MERGE over (don't clobber) the rest of the shard.
    await project.saveSceneComments(id, [{ id: "c1", anchor: "beat1", messages: [{ author: "Ian", ts: "t", body: "hi" }] }]);

    const save = await project.saveSceneSuggestions(id, [
      { id: "s1", anchor: "beat1", baseline: "Old line", proposed: "New line", author: "Bo", ts: "2026-06-17T09:00:00.000Z" },
      { id: "s2", anchor: "beat2", baseline: "x", proposed: "y", author: "Ian", ts: "2026-06-17T10:00:00.000Z", resolved: true, outcome: "accepted" },
    ]);
    expect(save.ok).toBe(true);

    const back = project.readSceneSuggestions(id);
    expect(back.length).toBe(2);
    expect(back.find((s) => s.id === "s1")?.proposed).toBe("New line");
    expect(back.find((s) => s.id === "s1")?.baseline).toBe("Old line");
    expect(back.find((s) => s.id === "s2")?.outcome).toBe("accepted");
    expect(project.readSceneComments(id).length).toBe(1); // comments survived the suggestion write

    // A proposal with no proposed text is pruned, so a cancelled "Suggest rewrite" leaves no trace.
    await project.saveSceneSuggestions(id, [{ id: "s3", anchor: "b", baseline: "a", proposed: "  ", author: "Ian", ts: "t" }]);
    expect(project.readSceneSuggestions(id).length).toBe(0);
  });

  it("round-trips per-beat writing status through the authoring shard, merges, drops when empty (#196)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-ws-"));
    const opened = await project.createProject(dir, "WritingStatus");
    const id = opened.scenes[0]!.id;

    // A comment first, so we can prove the writing map MERGES over (doesn't clobber) the rest of the shard.
    await project.saveSceneComments(id, [{ id: "c1", anchor: "beat1", messages: [{ author: "Ian", ts: "t", body: "hi" }] }]);

    const save = await project.saveSceneWriting(id, { beat1: "draft 1", beat2: "final" });
    expect(save.ok).toBe(true);

    const back = project.readSceneWriting(id);
    expect(back).toEqual({ beat1: "draft 1", beat2: "final" });
    expect(project.readSceneComments(id).length).toBe(1); // comments survived the writing write

    // Clearing every beat (an empty / blank map) drops the field, leaving no trace.
    await project.saveSceneWriting(id, { beat1: "" });
    expect(project.readSceneWriting(id)).toEqual({});
  });

  it("reviewFeedback gathers ACTIVE comments + suggestions across the script, excluding resolved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-rev-"));
    const opened = await project.createProject(dir, "Review");
    const id = opened.scenes[0]!.id;

    await project.saveSceneComments(id, [
      { id: "c-active", anchor: "beat1", messages: [{ author: "Ian", ts: "t", body: "Active comment" }] },
      { id: "c-done", anchor: "beat2", resolved: true, messages: [{ author: "Bo", ts: "t", body: "Resolved comment" }] },
    ]);
    await project.saveSceneSuggestions(id, [
      { id: "s-active", anchor: "beat3", baseline: "x", proposed: "Active rewrite", author: "Bo", ts: "t" },
      { id: "s-done", anchor: "beat4", baseline: "y", proposed: "Done rewrite", author: "Ian", ts: "t", resolved: true, outcome: "accepted" },
    ]);

    const items = project.reviewFeedback();
    // Both kinds present; resolved of EACH kind excluded.
    expect(items.map((i) => i.refId).sort()).toEqual(["c-active", "s-active"]);
    expect(items.find((i) => i.kind === "comment")?.refId).toBe("c-active");
    expect(items.find((i) => i.kind === "suggestion")?.refId).toBe("s-active");
    // The comment write and the suggestion write coexist in the one shard (neither clobbers the other).
    expect(project.readSceneComments(id).length).toBe(2);
    expect(project.readSceneSuggestions(id).length).toBe(2);

    // The "Show Resolved" scope pulls each kind's archived items into the walk, marked resolved, INDEPENDENTLY.
    const withComments = project.reviewFeedback({ resolvedComments: true });
    expect(withComments.map((i) => i.refId).sort()).toEqual(["c-active", "c-done", "s-active"]);
    expect(withComments.find((i) => i.refId === "c-done")?.resolved).toBe(true);
    expect(withComments.find((i) => i.refId === "s-done")).toBeUndefined(); // suggestions NOT pulled in

    const withSuggestions = project.reviewFeedback({ resolvedSuggestions: true });
    expect(withSuggestions.map((i) => i.refId).sort()).toEqual(["c-active", "s-active", "s-done"]);
    expect(withSuggestions.find((i) => i.refId === "s-done")?.resolved).toBe(true);

    const withBoth = project.reviewFeedback({ resolvedComments: true, resolvedSuggestions: true });
    expect(withBoth.map((i) => i.refId).sort()).toEqual(["c-active", "c-done", "s-active", "s-done"]);
  });

  it("sceneForPath resolves a scene shard to its scene id (file-association launch), else undefined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-launch-"));
    const opened = await project.createProject(dir, "Launch");
    const id = opened.scenes[0]!.id;
    const loaded = loadProject(dir);

    // The scene's own shards (flow / loc) each resolve back to that scene - argv may carry any of them.
    expect(project.sceneForPath(loaded.sceneFiles[id]!)).toBe(id);
    if (loaded.localeFiles[0]) expect(project.sceneForPath(loaded.localeFiles[0])).toBe(id);
    expect(project.sceneForPath(join(dir, "scenes", "start.patterflow"))).toBe(id); // un-normalised path too

    // The project root / the .patterproj itself / an unrelated path -> no specific scene (land on last).
    expect(project.sceneForPath(dir)).toBeUndefined();
    expect(project.sceneForPath(loaded.projectFile)).toBeUndefined();
    expect(project.sceneForPath(join(dir, "nope.patterflow"))).toBeUndefined();
  });

  // The condition quick-fixes parse the @wildwinter/expr validator's human messages by regex, so a reword
  // (e.g. an expr-lib bump) would silently disable them. This pins both message formats end-to-end: if the
  // wording drifts, the `fix` stops attaching and this fails - turning a silent break into a red test.
  it("derives condition quick-fixes from the expr-validator messages (pins the format - audit #5)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-cfix-"));
    const opened = await project.createProject(dir, "CondFix");
    const id = opened.scenes[0]!.id;
    const flowWith = (cond: string): string => JSON.stringify({
      schema: "patter/flow@0",
      scene: { id, type: "scene", name: "S", blocks: [
        { id: "blk", type: "block", name: "Main", children: [
          { id: "sn", type: "snippet", condition: cond, beats: [{ id: "b", kind: "text" }], jump: { to: "END" } },
        ] },
      ] },
    });

    // Declare an enum property first - this closes the property namespace, so an undeclared @ref is then a
    // hard "unresolved property reference" (and gives us an enum to mis-compare against).
    const s = project.readSettings()!;
    expect((await project.saveSettings({ ...s, properties: [{ name: "mood", type: "enum", values: ["calm", "angry"] }] })).ok).toBe(true);

    // (a) An undeclared @property -> "declare-property" fix, its name pulled from the message.
    const undeclared = project.validate({ sceneId: id, flow: flowWith("@nope > 0"), loc: "" });
    expect(undeclared.problems.find((p) => p.fix?.kind === "declare-property")?.fix)
      .toMatchObject({ kind: "declare-property", name: "nope" });

    // (b) An enum compared to a value outside its set -> "pick-enum-value" fix (bad value + options parsed).
    const pick = project.validate({ sceneId: id, flow: flowWith('@mood == "furious"'), loc: "" }).problems.find((p) => p.fix?.kind === "pick-enum-value")?.fix;
    expect(pick).toMatchObject({ kind: "pick-enum-value", bad: "furious" });
    expect((pick as { options: string[] }).options).toEqual(expect.arrayContaining(["calm", "angry"]));
  });
});
