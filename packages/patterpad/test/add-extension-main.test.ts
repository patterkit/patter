// The Extensions window's Remove from Project and Uninstall (patterkit design/extensions-window.md, D2 to D5), and
// Add Extension…, the one way in (patterkit design/view-extensions.md, Y3 and Y4): a new extension taken
// with what it requires as one step, an older pin offered the package's version, the same or a newer pin left
// alone while the views install here, and a view's "(not installed)…" taking only its own extension's package.
// Over real packages in folders, the shell's real reading, planning and installing, and a fake project.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import type { Manifest } from "@wildwinter/toolkit/extensions";

const picks = vi.hoisted(() => ({ paths: [] as string[], cleared: [] as string[] }));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir(), isPackaged: true },
  dialog: { showOpenDialog: vi.fn(async () => { const p = picks.paths.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; }) },
  BrowserWindow: class {}, MessageChannelMain: class {},
  session: { fromPartition: (p: string) => ({ clearStorageData: async () => { picks.cleared.push(p); }, clearCache: async () => {} }) },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}));

const { createViewExtensions } = await import("../src/main/views.js");

const SHOT = {
  schema: "wildwinter/extension@0", id: "shot", name: "Shot", version: "0.3.0",
  targets: { patter: { line: { fields: [{ name: "camera", type: "text" }] } } },
  views: [{ id: "sheet", name: "Performance sheet", entry: "view/sheet.js", element: "shot-sheet" }],
};
const STAGE = {
  schema: "wildwinter/extension@0", id: "stage", name: "Stage", version: "1.0.0",
  targets: { patter: { line: { fields: [{ name: "mark", type: "text" }] } } },
};

/** A package folder holding the manifest (and a view script when it has views); its path, for the picker. */
function packageDir(manifest: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "pp-pkg-"));
  writeFileSync(join(dir, `${String(manifest["id"])}.extension.json`), JSON.stringify(manifest, null, 2));
  if (manifest["views"]) {
    mkdirSync(join(dir, "view"));
    writeFileSync(join(dir, "view/sheet.js"), "customElements.define('shot-sheet', class extends HTMLElement {});");
  }
  return dir;
}

type Taken = { id: string; pin?: string; manifest: Manifest };
function make(taken: Taken[], answers: number[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "pp-views-"));
  const told: string[] = [];
  const asked: string[] = [];
  const take = vi.fn(async (_items: { text: string; manifest: Manifest }[]) => ({ ok: true }));
  const untake = vi.fn(async (_id: string) => ({ ok: true }));
  const details: string[] = [];
  const views = createViewExtensions({
    dir, editor: () => ({}) as never, root: () => "/p", taken: () => taken,
    slice: () => ({ bounds: () => undefined, remember: vi.fn(), pinned: () => true, setPinned: vi.fn() }) as never,
    tell: async (title, sub) => { told.push(title); details.push(sub); }, flushEditor: async () => {}, take, untake,
    dataCount: () => 12, refreshMenu: vi.fn(),
    ask: async (message, detail) => { asked.push(message); details.push(detail); return answers.shift() ?? 1; },
  });
  const installed = (): string[] => readdirSync(dir).flatMap((id) => readdirSync(join(dir, id)).map((v) => `${id}@${v}`)).sort();
  const takenIds = (): string[][] => take.mock.calls.map((c) => c[0].map((i) => i.manifest.id));
  return { views, take, untake, told, asked, details, installed, takenIds, dir };
}
const shotAt = (pin: string): Taken[] => [{ id: "shot", pin, manifest: parseManifest(JSON.stringify(SHOT)) }];

describe("Add Extension, the one way in", () => {
  beforeEach(() => { picks.paths.length = 0; });

  it("takes an extension the project lacks, and installs its views", async () => {
    const t = make([]);
    picks.paths.push(packageDir(SHOT));
    const r = await t.views.add();
    expect(t.takenIds()).toEqual([["shot"]]);
    expect(t.installed()).toEqual(["shot@0.3.0"]);
    expect(r).toMatchObject({ ok: true, name: "Shot", version: "0.3.0" });
    expect(r?.installedOnly).toBeUndefined();
  });

  it("installs only, for the version the project pins", async () => {
    const t = make(shotAt("0.3.0"));
    picks.paths.push(packageDir(SHOT));
    expect(await t.views.add()).toMatchObject({ ok: true, installedOnly: true });
    expect(t.take).not.toHaveBeenCalled();
    expect(t.asked).toEqual([]);
    expect(t.installed()).toEqual(["shot@0.3.0"]);
  });

  it("offers a newer version, taking it when the writer says so and installing either way", async () => {
    const yes = make(shotAt("0.3.0"), [0]);
    picks.paths.push(packageDir({ ...SHOT, version: "0.4.0" }));
    expect(await yes.views.add()).toMatchObject({ ok: true, version: "0.4.0" });
    expect(yes.asked).toEqual(["Update Shot in this project?"]);
    expect(yes.takenIds()).toEqual([["shot"]]);
    expect(yes.installed()).toEqual(["shot@0.4.0"]);

    const no = make(shotAt("0.3.0"), [1]);
    picks.paths.push(packageDir({ ...SHOT, version: "0.4.0" }));
    expect(await no.views.add()).toMatchObject({ ok: true, installedOnly: true });
    expect(no.take).not.toHaveBeenCalled();
    expect(no.installed()).toEqual(["shot@0.4.0"]);
  });

  it("never takes an older version back, and says the project keeps its own", async () => {
    const t = make(shotAt("0.3.0"));
    picks.paths.push(packageDir({ ...SHOT, version: "0.2.0" }));
    expect(await t.views.add()).toMatchObject({ installedOnly: true, note: expect.stringContaining("so it keeps 0.3.0") });
    expect(t.take).not.toHaveBeenCalled();
  });

  it("takes only the package of the view not installed here", async () => {
    const t = make(shotAt("0.3.0"));
    picks.paths.push(packageDir(STAGE));
    expect(await t.views.add("shot")).toBeNull();
    expect(t.told).toEqual(["That isn't Shot"]);
    expect(t.installed()).toEqual([]);
  });

  it("adds what an extension requires first, in the same step", async () => {
    const t = make([], [0]);
    picks.paths.push(packageDir({ ...SHOT, requires: ["stage"] }), packageDir(STAGE));
    expect(await t.views.add()).toMatchObject({ ok: true, also: [{ name: "Stage", version: "1.0.0" }] });
    expect(t.asked).toEqual(["Shot needs “stage”"]);
    expect(t.takenIds()).toEqual([["stage", "shot"]]);
    expect(t.installed()).toEqual(["shot@0.3.0"]); // Stage has no views to install
  });

  it("adds nothing when the writer cancels, or picks another package for a requirement", async () => {
    const cancelled = make([], [1]);
    picks.paths.push(packageDir({ ...SHOT, requires: ["stage"] }));
    expect(await cancelled.views.add()).toBeNull();
    expect(cancelled.take).not.toHaveBeenCalled();
    expect(cancelled.installed()).toEqual([]);

    const wrong = make([], [0]);
    picks.paths.push(packageDir({ ...SHOT, requires: ["stage"] }), packageDir({ ...STAGE, id: "lights", name: "Lights" }));
    expect(await wrong.views.add()).toBeNull();
    expect(wrong.told).toEqual(["That isn't “stage”"]);
    expect(wrong.take).not.toHaveBeenCalled();
    expect(wrong.installed()).toEqual([]);
  });
});

describe("the Extensions window", () => {
  beforeEach(() => { picks.paths.length = 0; picks.cleared.length = 0; });
  const stageTaken = (): Taken => ({ id: "stage", pin: "1.0.0", manifest: parseManifest(JSON.stringify(STAGE)) });
  const shotNeedingStage = (): Taken => ({ id: "shot", pin: "0.3.0", manifest: parseManifest(JSON.stringify({ ...SHOT, requires: ["stage"] })) });

  it("lists what the project takes and what's installed here", async () => {
    const t = make([shotNeedingStage(), stageTaken()], [1]);
    picks.paths.push(packageDir(SHOT));
    await t.views.add();
    expect((await t.views.rows()).map((r) => [r.name, r.installed, r.requiredBy])).toEqual([
      ["Shot", ["0.3.0"], []], ["Stage", [], ["Shot"]],
    ]);
  });

  it("won't remove an extension another one needs, and says which", async () => {
    const t = make([shotNeedingStage(), stageTaken()]);
    expect(await t.views.remove("stage")).toBeNull();
    expect(t.told).toEqual(["This extension can't be removed yet"]);
    expect(t.details).toEqual(["Shot needs Stage, so remove Shot first."]);
    expect(t.untake).not.toHaveBeenCalled();
  });

  it("asks before removing, saying the data stays, and removes it as one step", async () => {
    const no = make(shotAt("0.3.0"), [1]);
    expect(await no.views.remove("shot")).toBeNull();
    expect(no.untake).not.toHaveBeenCalled();
    const yes = make(shotAt("0.3.0"), [0]);
    expect(await yes.views.remove("shot")).toMatchObject({ ok: true, name: "Shot" });
    expect(yes.asked).toEqual(["Remove Shot from this project?"]);
    expect(yes.details[0]).toBe("Shot has data in 12 places in this project. It stays, unused, and comes back into use if you add Shot again. Its views stay installed on this machine. You can undo this.");
    expect(yes.untake).toHaveBeenCalledWith("shot");
  });

  it("uninstalls one version at a time, asked first, and clears the views' settings only with the last", async () => {
    const t = make(shotAt("0.3.0"), [1, 0, 0]); // the update question (not now), then both uninstalls
    picks.paths.push(packageDir(SHOT), packageDir({ ...SHOT, version: "0.4.0" }));
    await t.views.add();
    await t.views.add(); // 0.4.0: the project keeps 0.3.0 (answer: not now), the views install
    expect(t.installed()).toEqual(["shot@0.3.0", "shot@0.4.0"]);
    t.asked.length = 0; t.details.length = 0;
    expect(await t.views.uninstall("shot", "0.4.0")).toBe(true);
    expect(t.installed()).toEqual(["shot@0.3.0"]);
    expect(picks.cleared).toEqual([]);
    expect(t.details[0]).toBe("This project takes Shot. Other projects on this machine that use this version lose its views too. The other installed versions keep their views' settings.");
    expect(await t.views.uninstall("shot", "0.3.0")).toBe(true);
    expect(t.installed()).toEqual([]);
    expect(picks.cleared).toEqual(["persist:view-shot"]);
    expect(t.asked).toEqual(["Uninstall Shot 0.4.0 from this machine?", "Uninstall Shot 0.3.0 from this machine?"]);
    expect(t.details[1]).toContain("so its views will show as not installed until you install them again.");
    expect(t.details[1]).toContain("and those go too.");
    expect(await t.views.uninstall("shot", "9.9.9")).toBe(false);
  });

  it("keeps a version when the writer cancels", async () => {
    const t = make([], [1]);
    picks.paths.push(packageDir(SHOT));
    await t.views.add();
    expect(await t.views.uninstall("shot", "0.3.0")).toBe(false);
    expect(t.installed()).toEqual(["shot@0.3.0"]);
  });
});
