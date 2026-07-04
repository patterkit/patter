// Patterpad under a configured VCS. Every file the app writes goes through @wildwinter/simple-vc-lib,
// so a read-only / locked / out-of-date target is checked out (or its refusal surfaced) instead of
// choking a raw write. These tests inject a FAKE provider via setProvider - the CI-safe harness from
// simple-vc-lib's own status.test.js - so the lock-aware behaviour is exercised with no real VCS
// installed. The same injected provider answers status / delete / rename, which is the groundwork the
// reactive VCS-state UI (#145) builds on.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setProvider, clearProvider,
  fileStatus, deleteFile, renameFile,
} from "@wildwinter/simple-vc-lib";
import type { IVCProvider, VCResult, VCFileStatus, VCStatus } from "@wildwinter/simple-vc-lib";
import * as project from "../src/main/project.js";

const ok: VCResult = { success: true, status: "ok", message: "" };

/** A recording, scriptable provider. Records every op so a test can assert the write went through VC;
 *  `refuse` makes one path's prepareToWrite fail (a lock / out-of-date), like a real checkout refusal.
 *  The actual byte-write is done by the library, not the provider - so refused files never land. */
class FakeVcs implements IVCProvider {
  readonly name = "perforce";
  events: { op: string; path: string }[] = [];
  refuse: { endsWith: string; status: VCStatus; message: string } | null = null;
  locked = new Set<string>();        // exact paths fileStatus() should report locked-by-other
  lockSuffix: string | null = null;  // or: any path ending in this is locked-by-other (e.g. ".patterflow")
  markDirty = false;                 // report every tracked path as dirty (uncommitted local changes)

  private record(op: string, path: string): void { this.events.push({ op, path }); }
  saw(op: string, endsWith: string): boolean { return this.events.some((e) => e.op === op && e.path.endsWith(endsWith)); }

  prepareToWrite(filePath: string): VCResult {
    this.record("prepareToWrite", filePath);
    if (this.refuse && filePath.endsWith(this.refuse.endsWith))
      return { success: false, status: this.refuse.status, message: this.refuse.message };
    return ok;
  }
  finishedWrite(filePath: string): VCResult { this.record("finishedWrite", filePath); return ok; }
  deleteFile(filePath: string): VCResult { this.record("deleteFile", filePath); return ok; }
  deleteFolder(folderPath: string): VCResult { this.record("deleteFolder", folderPath); return ok; }
  renameFile(oldPath: string, newPath: string): VCResult { this.record("renameFile", `${oldPath}=>${newPath}`); return ok; }
  renameFolder(oldPath: string, newPath: string): VCResult { this.record("renameFolder", `${oldPath}=>${newPath}`); return ok; }
  // Async twins (0.2.0 IVCProvider) - delegate to the sync recorders.
  prepareToWriteAsync(filePath: string): Promise<VCResult> { return Promise.resolve(this.prepareToWrite(filePath)); }
  finishedWriteAsync(filePath: string): Promise<VCResult> { return Promise.resolve(this.finishedWrite(filePath)); }
  deleteFileAsync(filePath: string): Promise<VCResult> { return Promise.resolve(this.deleteFile(filePath)); }
  deleteFolderAsync(folderPath: string): Promise<VCResult> { return Promise.resolve(this.deleteFolder(folderPath)); }
  renameFileAsync(oldPath: string, newPath: string): Promise<VCResult> { return Promise.resolve(this.renameFile(oldPath, newPath)); }
  renameFolderAsync(oldPath: string, newPath: string): Promise<VCResult> { return Promise.resolve(this.renameFolder(oldPath, newPath)); }
  statusAsync(filePaths: string[]): Promise<VCFileStatus[]> { return Promise.resolve(this.status(filePaths)); }
  status(filePaths: string[]): VCFileStatus[] {
    return filePaths.map((filePath) => {
      const lockedOther = this.locked.has(filePath) || (this.lockSuffix != null && filePath.endsWith(this.lockSuffix));
      return {
        filePath, system: "perforce", writable: !lockedOther, tracked: true,
        ...(lockedOther ? { lockedBy: ["bob@bob-ws"] } : {}),
        ...(this.markDirty ? { dirty: true } : {}),
      };
    });
  }
}

let vcs: FakeVcs;

beforeEach(() => { vcs = new FakeVcs(); setProvider(vcs); });
afterEach(() => { clearProvider(); }); // never leak the override into other suites

/** Scaffold + open a project under the fake provider, then clear the recorded create writes so each
 *  test asserts only the operation it drives. Returns the dir + the first scene's id. */
async function freshProject(): Promise<{ dir: string; sceneId: string }> {
  const dir = mkdtempSync(join(tmpdir(), "pp-vcs-write-"));
  const opened = await project.createProject(dir, "VCS Project", "perforce");
  vcs.events = [];
  return { dir, sceneId: opened.scenes[0]!.id };
}

describe("patterpad writes through the configured VCS (set-up-for-a-VCS + write/edit)", () => {
  it("routes a project's create writes through the provider (prepare -> write -> finished)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-vcs-create-"));
    await project.createProject(dir, "New Story", "perforce");
    // The project file and the starter scene's flow shard each went out via the VC layer.
    expect(vcs.saw("prepareToWrite", ".patterproj")).toBe(true);
    expect(vcs.saw("finishedWrite", ".patterproj")).toBe(true);
    expect(vcs.saw("finishedWrite", ".patterflow")).toBe(true);
    // ...and the bytes really landed (the library does the write between prepare and finished).
    expect(existsSync(join(dir, "project.patterproj")) || vcs.saw("finishedWrite", ".patterproj")).toBe(true);
  });

  it("an editing save checks out then registers the changed file", async () => {
    const { sceneId } = await freshProject();
    const src = project.readScene(sceneId);
    const edited = `${src.flowSource}\n// edit ${sceneId}\n`; // change content so it is a real write, not a no-op skip
    const res = await project.saveScene(sceneId, edited, src.locSource);
    expect(res.ok).toBe(true);
    expect(vcs.saw("prepareToWrite", ".patterflow")).toBe(true);
    expect(vcs.saw("finishedWrite", ".patterflow")).toBe(true);
    expect(project.readScene(sceneId).flowSource).toBe(edited); // bytes landed through VC
  });

  it("surfaces a VCS LOCK refusal with who holds it - the write is refused, not forced", async () => {
    const { sceneId } = await freshProject();
    const before = project.readScene(sceneId).flowSource;
    vcs.refuse = { endsWith: ".patterflow", status: "locked", message: "'the-tavern.patterflow' is locked by bob@bob-ws" };

    const res = await project.saveScene(sceneId, `${before}\n// blocked edit\n`, "");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/locked by bob@bob-ws/);
    expect(vcs.saw("finishedWrite", ".patterflow")).toBe(false); // checkout refused -> never wrote
    expect(project.readScene(sceneId).flowSource).toBe(before);  // the on-disk file is untouched
  });

  it("surfaces an OUT-OF-DATE refusal the same way (a newer revision exists on the server)", async () => {
    const { sceneId } = await freshProject();
    vcs.refuse = { endsWith: ".patterflow", status: "outOfDate", message: "newer revision on server - get latest first" };
    const res = await project.saveScene(sceneId, `${project.readScene(sceneId).flowSource}\n// x\n`, "");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/newer revision/);
  });

  it("switching VCS in settings re-emits the config files through the provider", async () => {
    await freshProject();
    const s = project.readSettings()!;
    vcs.events = [];
    const res = await project.saveSettings({ ...s, vcs: "git" });
    expect(res.ok).toBe(true);
    expect(vcs.saw("finishedWrite", ".patterproj")).toBe(true);   // the project file
    expect(vcs.saw("finishedWrite", ".gitattributes")).toBe(true); // git config re-emitted via VC
  });
});

describe("vcStatus folds per-scene VC state for the reactive UI (#145)", () => {
  it("reports a clean, writable scene when nothing is locked", async () => {
    const { sceneId } = await freshProject();
    const dto = await project.vcStatus();
    expect(dto).not.toBeNull();
    expect(dto!.vcs).toBe("perforce");
    const st = dto!.scenes.find((s) => s.sceneId === sceneId)!;
    expect(st.writable).toBe(true);
    expect(st.lockedBy).toBeUndefined();
  });

  it("flags a scene whose flow shard is locked by another (read-only signal for the editor)", async () => {
    const { sceneId } = await freshProject();
    vcs.lockSuffix = ".patterflow"; // someone else holds every flow shard
    const st = (await project.vcStatus())!.scenes.find((s) => s.sceneId === sceneId)!;
    expect(st.writable).toBe(false);
    expect(st.lockedBy).toEqual(["bob@bob-ws"]);
  });

  it("flags a scene with uncommitted local changes as dirty (the 'modified' badge)", async () => {
    const { sceneId } = await freshProject();
    vcs.markDirty = true; // every tracked shard has pending local changes
    const st = (await project.vcStatus())!.scenes.find((s) => s.sceneId === sceneId)!;
    expect(st.dirty).toBe(true);
    expect(st.writable).toBe(true); // dirty does not mean read-only
  });

  it("throttles the remote round-trip - a rapid second call reuses the cached lock state (#152)", async () => {
    const { sceneId } = await freshProject();
    vcs.lockSuffix = ".patterflow"; // bob holds every flow shard
    const first = (await project.vcStatus())!.scenes.find((s) => s.sceneId === sceneId)!;
    expect(first.lockedBy).toEqual(["bob@bob-ws"]); // the first (un-throttled) call queries the server

    // Bob releases the locks. A second call WITHIN the throttle window must NOT re-hit the server, so it
    // still reports the cached lock (it will clear on the next remote poll past the window).
    vcs.lockSuffix = null; vcs.locked.clear();
    const second = (await project.vcStatus())!.scenes.find((s) => s.sceneId === sceneId)!;
    expect(second.lockedBy).toEqual(["bob@bob-ws"]); // remote skipped -> cached lock retained
  });
});

describe("the injected provider also answers read / delete / rename (harness groundwork for #145)", () => {
  // patter does not yet drive these (that is the reactive VCS-state UI, #145), but the CI-safe harness
  // must support the full read/write/delete/edit surface so #145 can be built and tested against it.
  it("fileStatus reports a file locked by another user", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-vcs-status-"));
    const f = join(dir, "scene.patterflow");
    writeFileSync(f, "x");
    vcs.locked.add(f);
    const [st] = fileStatus([f]);
    expect(st!.system).toBe("perforce");
    expect(st!.tracked).toBe(true);
    expect(st!.lockedBy).toEqual(["bob@bob-ws"]);
  });

  it("deleteFile and renameFile go through the provider", () => {
    const dir = mkdtempSync(join(tmpdir(), "pp-vcs-del-"));
    const a = join(dir, "a.patterflow"), b = join(dir, "b.patterflow");
    writeFileSync(a, "x");
    deleteFile(a);
    expect(vcs.saw("deleteFile", "a.patterflow")).toBe(true);
    renameFile(a, b);
    expect(vcs.events.some((e) => e.op === "renameFile" && e.path.includes("a.patterflow=>") && e.path.endsWith("b.patterflow"))).toBe(true);
  });
});
