// ---------------------------------------------------------------------------
// Runner: the flow API turned from pull to push. Each delivered beat waits for
// next(), a choice for choose(), and the end raises `ended`; handlers that call
// next() themselves don't deepen the stack; stop() drops what was asked for and
// leaves the flow where it is; a later begin(scene) moves the same flow, keeping
// the playthrough; rebind() plays on after a hot swap.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { Runner } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "run", name: "Runner" },
  locales: { default: "en", all: ["en"] },
  cast: [{ name: "NPC" }],
};
const talk: Scene = {
  id: "talk", type: "scene", name: "Talk",
  blocks: [
    { id: "b1", type: "block", name: "B1", children: [
      { id: "sn1", type: "snippet", beats: [
        { id: "L1", kind: "line", character: "NPC" },
        { id: "T1", kind: "text" },
        { id: "E1", kind: "gameEvent" },
      ] },
      { id: "grp", type: "group", selector: "choice", children: [
        { id: "opt_a", type: "group", prompt: { id: "C_a", kind: "text" },
          children: [{ id: "sn_a", type: "snippet", beats: [{ id: "L_a", kind: "line", character: "NPC" }], jump: { to: "END" } }] },
        { id: "opt_b", type: "group", prompt: { id: "C_b", kind: "text" },
          children: [{ id: "sn_b", type: "snippet", beats: [{ id: "L_b", kind: "line", character: "NPC" }], jump: { to: "END" } }] },
      ] },
    ] },
  ],
};
const shop: Scene = {
  id: "shop", type: "scene", name: "Shop",
  blocks: [{ id: "b2", type: "block", name: "B2", children: [
    { id: "sn_s", type: "snippet", beats: [{ id: "L_s", kind: "line", character: "NPC" }], jump: { to: "END" } },
  ] }],
};
const strings = { L1: "Hello.", T1: "A door creaks.", C_a: "Ask.", C_b: "Leave.", L_a: "Asked.", L_b: "Bye.", L_s: "Welcome." };
const locale = (scene: string): LocaleFile => ({ schema: "patter/strings@0", scene, locale: "en", strings });
const bundle = exportBundle({ project, scenes: [talk, shop], locales: [locale("talk"), locale("shop")] });

/** A runner whose every event is written down as `kind:id`. */
function recorded(engine = new Engine(bundle)) {
  const runner = new Runner(engine);
  const seen: string[] = [];
  runner.on("line", (s) => seen.push(`line:${s.id}`));
  runner.on("text", (s) => seen.push(`text:${s.id}`));
  runner.on("gameEvent", (s) => seen.push(`gameEvent:${s.id}`));
  runner.on("choice", (c) => seen.push(`choice:${c.options.map((o) => o.id).join(",")}`));
  runner.on("ended", () => seen.push("ended"));
  return { runner, seen, engine };
}

describe("Runner", () => {
  it("delivers one beat per next(), a game event included, then the choice, then the end", () => {
    const { runner, seen } = recorded();
    runner.begin("talk");
    expect(seen).toEqual(["line:L1"]);
    runner.next();
    runner.next();
    expect(seen).toEqual(["line:L1", "text:T1", "gameEvent:E1"]);
    runner.next();
    expect(seen.at(-1)).toBe("choice:opt_a,opt_b");
    runner.choose("opt_b");
    expect(seen.at(-1)).toBe("line:L_b");
    runner.next();
    expect(seen.at(-1)).toBe("ended");
  });

  it("hands each event the step itself", () => {
    const runner = new Runner(new Engine(bundle));
    let text = "";
    runner.on("line", (s) => { text = `${s.speakerLabel}: ${s.text}`; });
    runner.begin("talk");
    expect(text).toBe("NPC: Hello.");
  });

  it("starts at the first scene with no address", () => {
    const { runner, seen } = recorded();
    runner.begin();
    expect(seen).toEqual(["line:L1"]);
  });

  it("plays a whole run from handlers that call next() themselves, without deepening the stack", () => {
    const runner = new Runner(new Engine(bundle));
    const seen: string[] = [];
    let depth = 0;
    let deepest = 0;
    const step = (id: string) => { depth++; deepest = Math.max(deepest, depth); seen.push(id); runner.next(); depth--; };
    runner.on("line", (s) => step(s.id));
    runner.on("text", (s) => step(s.id));
    runner.on("gameEvent", (s) => step(s.id));
    runner.on("choice", () => runner.choose("opt_a"));
    runner.on("ended", () => seen.push("ended"));
    runner.begin("talk");
    expect(seen).toEqual(["L1", "T1", "E1", "L_a", "ended"]);
    expect(deepest).toBe(1);
  });

  it("stop() drops a next() a handler asked for and leaves the flow where it is, unended", () => {
    const runner = new Runner(new Engine(bundle));
    const seen: string[] = [];
    runner.on("line", (s) => { seen.push(s.id); runner.next(); runner.stop(); });
    runner.on("text", (s) => seen.push(s.id));
    runner.on("ended", () => seen.push("ended"));
    runner.begin("talk");
    expect(seen).toEqual(["L1"]);
    expect(runner.flow!.isEnded()).toBe(false);
    runner.next();
    expect(seen).toEqual(["L1", "T1"]);
  });

  it("a later begin(scene) moves the same flow, keeping its visit counts", () => {
    const { runner, seen, engine } = recorded();
    runner.begin("talk");
    const flow = engine.getFlow("main");
    runner.begin("shop");
    expect(engine.getFlow("main")).toBe(flow);
    expect(seen.at(-1)).toBe("line:L_s");
    expect(flow!.getVisitCounts()["talk"]).toBe(1);
  });

  it("begin() on an open flow begins the story again", () => {
    const { runner, seen } = recorded();
    runner.begin("shop");
    runner.begin();
    expect(seen).toEqual(["line:L_s", "line:L1"]);
  });

  it("refuses an address that doesn't resolve, and leaves the flow as it was", () => {
    const { runner, seen } = recorded();
    runner.begin("talk");
    expect(() => runner.begin("nowhere")).toThrow(/address not found/);
    runner.next();
    expect(seen).toEqual(["line:L1", "text:T1"]);
  });

  it("refuses next() and choose() before begin()", () => {
    const runner = new Runner(new Engine(bundle));
    expect(() => runner.next()).toThrow(/begin\(\) first/);
    expect(() => runner.choose("opt_a")).toThrow(/begin\(\) first/);
  });

  it("carries on after a load with next(), and after a hot swap once rebound", () => {
    const { runner, seen, engine } = recorded();
    runner.begin("talk");
    runner.next();
    const save = engine.saveGame();
    runner.next();
    engine.loadGame(save);
    runner.next();
    expect(seen.at(-1)).toBe("gameEvent:E1");

    const swapped = engine.hotSwap(bundle);
    runner.rebind(swapped);
    runner.next();
    expect(seen.at(-1)).toBe("choice:opt_a,opt_b");
  });

  it("stops listening when asked", () => {
    const runner = new Runner(new Engine(bundle));
    const seen: string[] = [];
    const off = runner.on("line", (s) => seen.push(s.id));
    off();
    runner.begin("talk");
    expect(seen).toEqual([]);
  });
});
