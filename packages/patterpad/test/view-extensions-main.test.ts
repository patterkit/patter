// Tier 2 view extensions in Patterpad's main process (patterkit design/view-extensions.md): File ▸ Add
// Extension… takes a package's manifest into the project as ONE step of the project history (the manifest
// and the pin together, or, for another version of one the project takes, `patter format`'s upgrade with its
// stage renames), a package that can't be taken is refused with sentences, and the Window menu offers each
// view with whether it's installed here.

import { describe, it, expect, vi } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@patterkit/core";
import { parseManifest } from "@wildwinter/toolkit/extensions";

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir(), isPackaged: true },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: class {}, MessageChannelMain: class {}, session: { fromPartition: () => ({}) },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }) },
}));

const project = await import("../src/main/project.js");
const { packageRefusal, manifestText, viewOffers, problemSentence } = await import("../src/main/views.js");
const { installExtensionPackage, packageFromFiles } = await import("@wildwinter/app-shell/view-host");

const PROBE = fileURLToPath(new URL("../../ops/test/fixtures/probe-extension.patter", import.meta.url));
type Obj = Record<string, unknown>;
const read = (path: string): Obj => parseSource(readFileSync(path, "utf8")) as Obj;

function openProbe(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-add-ext-")), "probe.patter");
  cpSync(PROBE, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
  return dir;
}

/** A package as Add Extension reads one: its files by path. */
function pkgOf(manifest: Obj, extra: Record<string, string> = {}) {
  const enc = new TextEncoder();
  const files = new Map<string, Uint8Array>([[`${String(manifest["id"])}.extension.json`, enc.encode(JSON.stringify(manifest, null, 2))]]);
  for (const [p, text] of Object.entries(extra)) files.set(p, enc.encode(text));
  const r = packageFromFiles(files);
  if (!r.ok) throw new Error(r.why);
  return r;
}

const SHOT = {
  schema: "wildwinter/extension@0", id: "shot", name: "Shot", version: "0.3.0",
  targets: { patter: { line: { fields: [{ name: "camera", type: "text" }] } } },
  views: [{ id: "sheet", name: "Performance sheet", entry: "view/sheet.js", element: "shot-sheet" }],
};

describe("Add Extension's project write", () => {
  it("writes the manifest and the pin as one step, which one undo takes back", async () => {
    const dir = openProbe();
    const pkg = pkgOf(SHOT);
    const before = readFileSync(join(dir, "probe.patterproj"), "utf8");
    const r = await project.takeExtension(manifestText(pkg), pkg.manifest);
    expect(r.ok).toBe(true);
    expect(r.was).toBeUndefined();
    expect(r.step?.label).toBe("Add Shot");
    // The manifest byte for byte, and the pin beside the probe's (its settings kept).
    expect(readFileSync(join(dir, "extensions/shot.extension.json"), "utf8")).toBe(manifestText(pkg));
    expect((read(join(dir, "probe.patterproj"))["extensions"] as Obj)).toEqual({
      probe: { settings: { deliveryField: "delivery" }, version: "1.1.0" }, shot: { version: "0.3.0" },
    });
    expect(r.project?.extensions?.map((x) => x.id)).toEqual(["probe", "shot"]);
    expect(r.project?.extensions?.find((x) => x.id === "shot")?.views).toEqual([{ id: "sheet", name: "Performance sheet" }]);
    expect(project.takenExtensions().map((x) => [x.id, x.pin])).toEqual([["probe", "1.1.0"], ["shot", "0.3.0"]]);

    const undone = await project.stepProjectHistory("undo", r.step!.id);
    expect(undone.ok).toBe(true);
    expect(existsSync(join(dir, "extensions/shot.extension.json"))).toBe(false);
    expect(readFileSync(join(dir, "probe.patterproj"), "utf8")).toBe(before);
  });

  it("takes another version of an extension the project takes as format's upgrade: renamed stages and the pin, in one step", async () => {
    const dir = openProbe();
    const shard = join(dir, "extensions/probe/harbour.patterextension");
    const lineOf = (): Obj => ((read(shard)["entries"] as Obj)["line"] as Record<string, Obj>)["L_bell"]!;
    expect(lineOf()["act"]).toBe("opening"); // a stage the manifest says it renamed to "setup"
    const manifest = { ...JSON.parse(readFileSync(join(dir, "extensions/probe.extension.json"), "utf8")) as Obj, version: "1.2.0" };
    const pkg = pkgOf(manifest);
    const r = await project.takeExtension(manifestText(pkg), pkg.manifest);
    expect(r.ok).toBe(true);
    expect(r.was).toBe("1.1.0");
    expect(r.step?.label).toBe("Update Probe");
    expect(r.reload).toBe(true);
    expect(lineOf()["act"]).toBe("setup");
    expect((read(join(dir, "probe.patterproj"))["extensions"] as Obj)["probe"]).toEqual({ settings: { deliveryField: "delivery" }, version: "1.2.0" });
    expect((read(join(dir, "extensions/probe.extension.json")))["version"]).toBe("1.2.0");

    expect((await project.stepProjectHistory("undo", r.step!.id)).ok).toBe(true);
    expect(lineOf()["act"]).toBe("opening");
    expect((read(join(dir, "probe.patterproj"))["extensions"] as Obj)["probe"]).toMatchObject({ version: "1.1.0" });
    expect((read(join(dir, "extensions/probe.extension.json")))["version"]).toBe("1.1.0");
  });

  it("writes a view's change to the project's own values as one labelled step", async () => {
    const dir = openProbe();
    const r = await project.saveProjectExtensionValues("probe", { studio: "Harbourside" }, "Set studio");
    expect(r.ok).toBe(true);
    expect(r.step?.label).toBe("Set studio");
    expect(r.project?.extensions?.[0]?.projectValues).toEqual({ studio: "Harbourside" });
    const entries = read(join(dir, "extensions/probe/_project.patterextension"))["entries"] as Record<string, Obj>;
    expect(entries["project"]!["proj_probe"]).toEqual({ studio: "Harbourside" });
  });
});

describe("a package Add Extension refuses", () => {
  it("says a manifest's faults as sentences, and refuses one that extends nothing in Patter", () => {
    expect(packageRefusal(pkgOf(SHOT))).toBeNull();
    const storylets = pkgOf({ ...SHOT, targets: { storylets: { card: { fields: [{ name: "x", type: "text" }] } } }, views: [] });
    expect(packageRefusal(storylets)).toEqual({ title: "Shot can't be added", sub: "Shot doesn't extend Patter: its manifest targets storylets only." });
    const broken = pkgOf({ ...SHOT, targets: { patter: { line: { fields: [{ name: "camera", type: "colour" }] } } } });
    const refused = packageRefusal(broken)!;
    expect(refused.title).toBe("Shot can't be added");
    expect(refused.body?.length).toBeGreaterThan(0);
    expect(refused.body).toEqual([expect.stringMatching(/^"colour" is not a type; .* \(at targets.patter.line.fields\[0\].type\)\.$/)]);
    expect(problemSentence({ severity: "warning", code: "x", path: "views[0]", message: "an odd view" })).toBe("An odd view (at views[0]).");
  });
});

describe("the views a project offers", () => {
  it("offers each view, disabled with why until its package is installed here", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-views-"));
    const taken = [{ id: "shot", pin: "0.3.0", manifest: parseManifest(JSON.stringify(SHOT)) }];
    expect(await viewOffers(dir, taken)).toEqual([{
      extension: "shot", view: "sheet", name: "Performance sheet", extensionName: "Shot", installed: false,
      why: "Shot isn't installed on this machine.",
    }]);
    const installed = await installExtensionPackage(pkgOf({ ...SHOT, version: "0.3.2" }, { "view/sheet.js": "customElements.define('shot-sheet', class extends HTMLElement {});" }), dir);
    expect(installed.ok).toBe(true);
    expect(await viewOffers(dir, taken)).toEqual([{ extension: "shot", view: "sheet", name: "Performance sheet", extensionName: "Shot", installed: true }]);
    expect(await viewOffers(dir, [{ ...taken[0]!, pin: "1.0.0" }])).toMatchObject([{ installed: false, why: expect.stringContaining("different major version") }]);
  });
});
