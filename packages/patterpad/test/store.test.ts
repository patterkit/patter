// The session store (open-where-you-left-off / recents / identity / theme / helper windows). Now an
// adapter over the shell's app-store, so these tests are the contract that says the 37 call sites in
// index.ts cannot tell the difference. Pure over a directory, so it's fully testable without Electron.

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/main/store.js";

const tmpDir = (): string => mkdtempSync(join(tmpdir(), "pp-store-"));
/** Hand-write a pre-shell session file, the way the old store left it. */
const legacy = (dir: string, session: object): string => {
  const file = join(dir, "patterpad-session.json");
  writeFileSync(file, JSON.stringify(session, null, 2), "utf8");
  return file;
};

describe("session store", () => {
  it("starts empty and tolerates a missing file", () => {
    expect(createStore(tmpDir()).read()).toEqual({ lastScene: {}, lastCaret: {}, recents: [], panes: { nav: false, inspector: false }, theme: { colour: "system", font: "newsreader" }, playFollow: false, play: { pinned: true }, search: { pinned: true }, coverage: { pinned: true } });
  });

  it("remembers the side-pane (slide/pin) state", () => {
    const s = createStore(tmpDir());
    expect(s.read().panes).toEqual({ nav: false, inspector: false }); // first-run default: both sides closed (full-bleed)
    s.setPanes({ nav: false, inspector: true });
    expect(s.read().panes).toEqual({ nav: false, inspector: true });
    s.setIdentity({ name: "Ian" }); // an unrelated write keeps the panes
    expect(s.read().panes).toEqual({ nav: false, inspector: true });
  });

  it("round-trips the pane fields the shell's own PaneState does not know about", () => {
    // Patterpad's PaneState is a superset (the review-session toggles, docHidden, lineStatusShown).
    // The shell merges and serialises whatever it is handed, so the extras must survive a write, an
    // unrelated write, and a reload from disk.
    const dir = tmpDir();
    const s = createStore(dir);
    s.setPanes({ nav: true, inspector: false, docHidden: ["vo"], lineStatusShown: ["draft"], reviewFeedback: true });
    s.setTheme({ colour: "slate", font: "literata" });
    expect(createStore(dir).read().panes).toEqual({ nav: true, inspector: false, docHidden: ["vo"], lineStatusShown: ["draft"], reviewFeedback: true });
  });

  it("remembers Follow in the editor, and defaults it OFF", () => {
    // Marking is the default behaviour and following is the author asking for it, so a fresh install
    // must not arrive with the editor jumping under them.
    const dir = tmpDir();
    expect(createStore(dir).read().playFollow).toBe(false);
    const s = createStore(dir);
    s.setPlayFollow(true);
    expect(s.read().playFollow).toBe(true);
    s.setTheme({ colour: "slate", font: "literata" }); // an unrelated write keeps it
    expect(createStore(dir).read().playFollow).toBe(true); // and it survives a reload
  });

  it("a settings file written before playFollow existed reads it as OFF", () => {
    // The real forward-migration case, and the one every existing author hits: an `app` slice holding
    // only `theme`, written by a build that had never heard of this key. The shell merges the app slice
    // field by field precisely so a key added later arrives with its default rather than `undefined`.
    const dir = tmpDir();
    writeFileSync(join(dir, "app-settings.json"), JSON.stringify({
      recents: [], places: {}, panes: {}, windows: {},
      app: { theme: { colour: "night", font: "literata" } },
    }), "utf8");
    const st = createStore(dir).read();
    expect(st.playFollow).toBe(false);
    expect(st.theme).toEqual({ colour: "night", font: "literata" }); // and the slice it DID have survives
  });

  it("remembers the colour theme / font theme", () => {
    const s = createStore(tmpDir());
    expect(s.read().theme).toEqual({ colour: "system", font: "newsreader" }); // first-run default
    s.setTheme({ colour: "slate", font: "literata" });
    expect(s.read().theme).toEqual({ colour: "slate", font: "literata" });
    s.setPanes({ nav: true, inspector: true }); // an unrelated write keeps the theme
    expect(s.read().theme).toEqual({ colour: "slate", font: "literata" });
  });

  it("migrates an older session's light/dark colour to the curated palettes (#173)", () => {
    // The remap belongs to Patterpad, not the shell, so it must survive the fold-in of an old file.
    let dir = tmpDir();
    legacy(dir, { theme: { colour: "dark", font: "literata" } });
    expect(createStore(dir).read().theme).toEqual({ colour: "night", font: "literata" }); // dark -> Night

    dir = tmpDir();
    legacy(dir, { theme: { colour: "light", font: "source" } });
    expect(createStore(dir).read().theme).toEqual({ colour: "paper", font: "source" }); // light -> Paper

    dir = tmpDir();
    legacy(dir, { theme: { colour: "sepia", font: "literata" } });
    expect(createStore(dir).read().theme).toEqual({ colour: "mist", font: "literata" }); // retired sepia -> Mist
  });

  it("records opens most-recent-first, dedups, and tracks the last project", () => {
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A"); s.recordOpen("/b", "B"); s.recordOpen("/a", "A");
    const st = s.read();
    expect(st.lastProject).toBe("/a");
    expect(st.recents.map((r) => r.path)).toEqual(["/a", "/b"]);
    expect(st.recents.map((r) => r.name)).toEqual(["A", "B"]); // the menu renders these
  });

  it("remembers the last scene per project and the identity", () => {
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A");
    s.recordScene("/a", "scn1");
    s.setIdentity({ name: "Ian" });
    const st = s.read();
    expect(st.lastScene["/a"]).toBe("scn1");
    expect(st.identity).toEqual({ name: "Ian" });
  });

  it("keeps a place per project, so glancing at another and coming back still lands where you were", () => {
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A"); s.recordScene("/a", "scn1", "beat_1");
    s.recordOpen("/b", "B"); s.recordScene("/b", "scn9");
    s.recordOpen("/a", "A");
    expect(s.read().lastScene).toEqual({ "/a": "scn1", "/b": "scn9" });
    expect(s.read().lastCaret).toEqual({ "/a": "beat_1" });
  });

  it("pairs the remembered caret with the remembered scene, and clears it when none is given", () => {
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A");
    s.recordScene("/a", "scn1", "beat_42");
    expect(s.read().lastScene["/a"]).toBe("scn1");
    expect(s.read().lastCaret["/a"]).toBe("beat_42");
    // Moving on with no caret (top of scene) drops the stale entry rather than keeping it.
    s.recordScene("/a", "scn2");
    expect(s.read().lastScene["/a"]).toBe("scn2");
    expect(s.read().lastCaret["/a"]).toBeUndefined();
  });

  it("ignores a place recorded against a project that is not the open one", () => {
    // `scene:remember` carries a renderer-supplied path. A mismatch would file one project's caret
    // under another's key, so it is dropped rather than trusted.
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A");
    s.recordScene("/b", "scn1", "beat_1");
    expect(s.read().lastScene).toEqual({});
  });

  it("caps recents at 8", () => {
    const s = createStore(tmpDir());
    for (let i = 0; i < 12; i++) s.recordOpen(`/p${i}`, `P${i}`);
    expect(s.read().recents.length).toBe(8);
    expect(s.read().recents[0]!.path).toBe("/p11");
  });

  it("forget drops a project from recents + last-session", () => {
    const s = createStore(tmpDir());
    s.recordOpen("/a", "A"); s.recordOpen("/b", "B");
    s.forget("/b");
    const st = s.read();
    expect(st.recents.map((r) => r.path)).toEqual(["/a"]);
    expect(st.lastProject).toBeUndefined();
  });

  it("defaults the three helper windows to pinned, and remembers bounds and unpinning", () => {
    const dir = tmpDir();
    const s = createStore(dir);
    expect(s.read().play).toEqual({ pinned: true });
    s.setPlay({ ...s.read().play, bounds: { x: 10, y: 20, width: 400, height: 300 } });
    s.setSearch({ ...s.read().search, pinned: false });
    const reloaded = createStore(dir).read();
    expect(reloaded.play).toEqual({ pinned: true, bounds: { x: 10, y: 20, width: 400, height: 300 } });
    expect(reloaded.search).toEqual({ pinned: false });
    expect(reloaded.coverage).toEqual({ pinned: true }); // untouched, still pinned
  });

  it("a rescue clears remembered bounds rather than merging over them", () => {
    // rescueWindows() calls setPlay({ pinned: true }) to strand-proof a window that is off-screen.
    // Merging would keep the bad rectangle and put it straight back there on the next launch.
    const dir = tmpDir();
    const s = createStore(dir);
    s.setPlay({ pinned: false, bounds: { x: -9000, y: -9000, width: 400, height: 300 } });
    s.setPlay({ pinned: true });
    expect(s.read().play).toEqual({ pinned: true });
    expect(createStore(dir).read().play).toEqual({ pinned: true });
  });

  describe("folding in the pre-shell patterpad-session.json", () => {
    const OLD = {
      lastProject: "/a",
      lastScene: { "/a": "scn1", "/b": "scn9" },
      lastCaret: { "/a": "beat_7" },
      recents: [{ path: "/a", name: "A", openedAt: 111 }, { path: "/b", name: "B", openedAt: 222 }],
      identity: { name: "Ian", email: "ian@example.com" },
      panes: { nav: true, inspector: false, docHidden: ["vo"] },
      theme: { colour: "dark", font: "literata" },
      play: { pinned: false, bounds: { x: 1, y: 2, width: 300, height: 400 } },
      search: { pinned: true },
      coverage: { pinned: false },
    };

    it("carries every key across on the first run", () => {
      const dir = tmpDir();
      legacy(dir, OLD);
      const st = createStore(dir).read();
      expect(st.lastProject).toBe("/a");
      expect(st.lastScene).toEqual({ "/a": "scn1", "/b": "scn9" });
      expect(st.lastCaret).toEqual({ "/a": "beat_7" });
      expect(st.recents).toEqual([{ path: "/a", name: "A" }, { path: "/b", name: "B" }]); // openedAt was never read
      expect(st.identity).toEqual({ name: "Ian", email: "ian@example.com" });
      expect(st.panes).toEqual({ nav: true, inspector: false, docHidden: ["vo"] });
      expect(st.theme).toEqual({ colour: "night", font: "literata" }); // remapped on the way through
      expect(st.play).toEqual({ pinned: false, bounds: { x: 1, y: 2, width: 300, height: 400 } });
      expect(st.search).toEqual({ pinned: true });
      expect(st.coverage).toEqual({ pinned: false });
    });

    it("leaves the old file untouched, as a rollback", () => {
      const dir = tmpDir();
      const file = legacy(dir, OLD);
      const before = readFileSync(file, "utf8");
      const s = createStore(dir);
      s.recordOpen("/c", "C");
      s.setTheme({ colour: "paper", font: "source" });
      expect(readFileSync(file, "utf8")).toBe(before);
      expect(existsSync(join(dir, "app-settings.json"))).toBe(true);
    });

    it("runs once: the shell's file wins from then on", () => {
      const dir = tmpDir();
      const file = legacy(dir, OLD);
      createStore(dir).setTheme({ colour: "paper", font: "source" });
      // The author rolls the old file back to something else; it must be ignored now.
      writeFileSync(file, JSON.stringify({ theme: { colour: "mist", font: "newsreader" } }), "utf8");
      expect(createStore(dir).read().theme).toEqual({ colour: "paper", font: "source" });
    });

    it("treats an unreadable old file as a plain first run", () => {
      const dir = tmpDir();
      writeFileSync(join(dir, "patterpad-session.json"), "{ this is not json", "utf8");
      expect(createStore(dir).read().theme).toEqual({ colour: "system", font: "newsreader" });
      expect(createStore(dir).read().recents).toEqual([]);
    });
  });
});
