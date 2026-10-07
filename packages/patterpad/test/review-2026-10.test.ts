// ---------------------------------------------------------------------------
// The Patterpad review of October 2026 (patterkit design/patterpad-review-2026-10.md): each test names
// the trigger of one main-process finding. The session below is the one index.ts builds, close hook
// included, so "Close Project afterwards" is asked of the same contract the app runs.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, readFileSync, rmSync, chmodSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject } from "@patterkit/ops";
import * as project from "../src/main/project.js";
import { createProjectSession } from "@wildwinter/app-shell/session";
import type { OpenedProject } from "../src/shared/api.js";

const mkSession = () => createProjectSession<OpenedProject, { root: string }>({
  store: { get: () => ({ recents: [] }), touchProject: () => {}, forgetProject: () => {}, clearLastProject: () => {} },
  close: (ending) => { if (project.isCurrent(ending)) project.closeProject(); },
  open: (path) => { const p = project.openProject(path); return { session: p, root: p.root, name: p.name, reply: { root: p.root } }; },
});
const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `pp-review-${name}-`));

describe("the project lifecycle goes through the session (HIGH 1 and 2)", () => {
  it("New Project, opened as the dialog now opens it, closes with Close Project", async () => {
    const session = mkSession();
    session.openAt(await project.scaffoldProject(tmp("a"), "A"));
    session.openAt(await project.scaffoldProject(tmp("c"), "C")); // New Project over an open one
    expect(project.hydrate()?.name).toBe("C");
    session.closeCurrent();
    expect(project.hydrate()).toBeNull();
    expect(project.currentRoot()).toBeNull();
  });

  it("New Project pins the chosen build output in the project file it writes", async () => {
    const dir = await project.scaffoldProject(tmp("pin"), "Pinned", undefined, "build/game.patterc");
    expect(loadProject(dir).project.export?.bundle).toBe("build/game.patterc");
  });

  it("a merged pack reloads the project in place, so Close Project still closes it", async () => {
    const session = mkSession();
    const dir = await project.scaffoldProject(tmp("m"), "M");
    session.openAt(dir);
    const flow = Object.values(loadProject(dir).sceneFiles)[0]!;
    const res = await project.commitPackMerge({ writes: [{ path: flow, content: readFileSync(flow, "utf8") }], sidecars: [], summary: {} as never });
    expect(res.ok).toBe(true);
    session.closeCurrent();
    expect(project.hydrate()).toBeNull();
  });
});

describe("deleting a scene (HIGH 3)", () => {
  it("reports a refused delete, and leaves a scene that still exists rather than half of one", async () => {
    const dir = await project.scaffoldProject(tmp("del"), "Del");
    project.openProject(dir);
    const id = (await project.createScene("Doomed")).sceneId!;
    const locDir = join(dir, "loc", "en");
    chmodSync(locDir, 0o555); // the strings file cannot be unlinked
    let res;
    try { res = await project.deleteScene(id); } finally { chmodSync(locDir, 0o755); }
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Couldn't delete doomed\.patterloc/);
    expect(existsSync(join(dir, "scenes", "doomed.patterflow"))).toBe(true); // the flow goes last
    expect(loadProject(dir).scenes.some((s) => s.id === id)).toBe(true);
    expect(project.hydrate()?.sceneIds).toContain(id);
  });
});

describe("a scene with no source-language strings file (MEDIUM 11)", () => {
  it("gets one on its first save, rather than a save that writes nothing and says ok", async () => {
    const dir = await project.scaffoldProject(tmp("noloc"), "NoLoc");
    project.openProject(dir);
    const id = (await project.createScene("Bare")).sceneId!;
    rmSync(join(dir, "loc", "en", "bare.patterloc"));
    project.openProject(dir);
    project.hydrate();
    const src = project.readScene(id);
    expect(src.locSource).toBe("");
    const loc = JSON.stringify({ schema: "patter/strings@0", scene: id, locale: "en", default: true, strings: { T_new: "A line I typed" } });
    expect((await project.saveScene(id, src.flowSource, loc)).ok).toBe(true);
    expect(readdirSync(join(dir, "loc", "en"))).toContain("bare.patterloc");
    expect(loadProject(dir).locales.find((l) => l.scene === id)?.strings.T_new).toBe("A line I typed");
  });
});
