// The session store (open-where-you-left-off / recents / identity). Pure over a file path, so it's
// fully testable without Electron.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../src/main/store.js";

const tmpFile = (): string => join(mkdtempSync(join(tmpdir(), "pp-store-")), "session.json");

describe("session store", () => {
  it("starts empty and tolerates a missing file", () => {
    expect(createStore(tmpFile()).read()).toEqual({ lastScene: {}, lastCaret: {}, recents: [], panes: { nav: false, inspector: false }, theme: { colour: "system", font: "newsreader" }, play: { pinned: true }, search: { pinned: true }, coverage: { pinned: true } });
  });

  it("remembers the side-pane (slide/pin) state", () => {
    const s = createStore(tmpFile());
    expect(s.read().panes).toEqual({ nav: false, inspector: false }); // first-run default: both sides closed (full-bleed)
    s.setPanes({ nav: false, inspector: true });
    expect(s.read().panes).toEqual({ nav: false, inspector: true });
    s.setIdentity({ name: "Ian" }); // an unrelated write keeps the panes
    expect(s.read().panes).toEqual({ nav: false, inspector: true });
  });

  it("remembers the reading palette / font theme", () => {
    const s = createStore(tmpFile());
    expect(s.read().theme).toEqual({ colour: "system", font: "newsreader" }); // first-run default
    s.setTheme({ colour: "slate", font: "literata" });
    expect(s.read().theme).toEqual({ colour: "slate", font: "literata" });
    s.setPanes({ nav: true, inspector: true }); // an unrelated write keeps the theme
    expect(s.read().theme).toEqual({ colour: "slate", font: "literata" });
  });

  it("migrates an older session's light/dark colour to the curated palettes (#173)", () => {
    const file = tmpFile();
    // Hand-write a pre-palette session (the old raw light/dark choice).
    writeFileSync(file, JSON.stringify({ theme: { colour: "dark", font: "literata" } }), "utf8");
    expect(createStore(file).read().theme).toEqual({ colour: "night", font: "literata" }); // dark -> Night

    writeFileSync(file, JSON.stringify({ theme: { colour: "light", font: "source" } }), "utf8");
    expect(createStore(file).read().theme).toEqual({ colour: "paper", font: "source" }); // light -> Paper

    writeFileSync(file, JSON.stringify({ theme: { colour: "sepia", font: "literata" } }), "utf8");
    expect(createStore(file).read().theme).toEqual({ colour: "mist", font: "literata" }); // retired sepia -> Mist
  });

  it("records opens most-recent-first, dedups, and tracks the last project", () => {
    let t = 0;
    const s = createStore(tmpFile(), () => ++t);
    s.recordOpen("/a", "A"); s.recordOpen("/b", "B"); s.recordOpen("/a", "A");
    const st = s.read();
    expect(st.lastProject).toBe("/a");
    expect(st.recents.map((r) => r.path)).toEqual(["/a", "/b"]);
  });

  it("remembers the last scene per project and the identity", () => {
    const s = createStore(tmpFile());
    s.recordScene("/a", "scn1");
    s.setIdentity({ name: "Ian" });
    const st = s.read();
    expect(st.lastScene["/a"]).toBe("scn1");
    expect(st.identity).toEqual({ name: "Ian" });
  });

  it("pairs the remembered caret with the remembered scene, and clears it when none is given", () => {
    const s = createStore(tmpFile());
    s.recordScene("/a", "scn1", "beat_42");
    expect(s.read().lastScene["/a"]).toBe("scn1");
    expect(s.read().lastCaret["/a"]).toBe("beat_42");
    // Moving on with no caret (top of scene) drops the stale entry rather than keeping it.
    s.recordScene("/a", "scn2");
    expect(s.read().lastScene["/a"]).toBe("scn2");
    expect(s.read().lastCaret["/a"]).toBeUndefined();
  });

  it("caps recents at 8", () => {
    let t = 0;
    const s = createStore(tmpFile(), () => ++t);
    for (let i = 0; i < 12; i++) s.recordOpen(`/p${i}`, `P${i}`);
    expect(s.read().recents.length).toBe(8);
    expect(s.read().recents[0]!.path).toBe("/p11");
  });

  it("forget drops a project from recents + last-session", () => {
    const s = createStore(tmpFile());
    s.recordOpen("/a", "A"); s.recordOpen("/b", "B");
    s.forget("/b");
    const st = s.read();
    expect(st.recents.map((r) => r.path)).toEqual(["/a"]);
    expect(st.lastProject).toBeUndefined();
  });
});
