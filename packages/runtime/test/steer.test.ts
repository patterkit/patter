// Steering (patterkit design/proposals/patterplay-steering.md): a tool's steerer answers every gate and pick.
// The corpus pins what each answer does on all four runtimes; this pins what it can't: an answer that isn't
// one, a steerer of the wrong shape, a steerer that left a method out, and a hot swap keeping the steerer.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { PlayError, Steerer } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "met", type: "boolean", default: false }],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn_a", type: "snippet", condition: "@met", beats: [{ id: "A", kind: "text" }] },
    { id: "g", type: "group", selector: "branch", children: [
      { id: "sn_yes", type: "snippet", condition: "@met", beats: [{ id: "YES", kind: "text" }] },
      { id: "sn_no", type: "snippet", beats: [{ id: "NO", kind: "text" }] },
    ] },
    { id: "sn_end", type: "snippet", jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { A: "a", YES: "yes", NO: "no" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const texts = (engine: Engine): string[] => {
  const flow = engine.openFlow("main");
  const out: string[] = [];
  for (let r = flow.advance(); r.type !== "end"; r = flow.advance()) if (r.type === "text") out.push(r.text);
  return out;
};

describe("steer", () => {
  it("a pick naming a child the group doesn't have throws, as choose() with an unknown id does", () => {
    const engine = new Engine(bundle, { steer: { pick: () => "sn_nowhere" } });
    expect(() => texts(engine)).toThrow(/sn_nowhere.*isn't one of its children/);
  });

  it("an answer of the wrong type throws", () => {
    const gate = new Engine(bundle, { steer: { gate: () => "yes" as unknown as boolean } });
    expect(() => texts(gate)).toThrow(/gate for sn_a answered yes/);
    const pick = new Engine(bundle, { steer: { pick: () => true as unknown as string } });
    expect(() => texts(pick)).toThrow(/pick for g answered true/);
  });

  it("a steerer of the wrong shape is reported as a set-up problem and ignored", () => {
    for (const steer of [42, { gate: "always" }, { pick: 1 }]) {
      const errors: PlayError[] = [];
      const engine = new Engine(bundle, { steer: steer as unknown as Steerer, onError: (e) => errors.push(e) });
      expect(errors).toEqual([expect.objectContaining({ kind: "setup", node: "steer" })]);
      expect(texts(engine)).toEqual(["no"]);
    }
  });

  it("a method left out answers the default for its kind", () => {
    expect(texts(new Engine(bundle, { steer: { gate: () => true } }))).toEqual(["a", "no"]);
    expect(texts(new Engine(bundle, { steer: { pick: () => "sn_yes" } }))).toEqual(["yes"]);
  });

  it("a hot swap keeps the steerer", () => {
    const engine = new Engine(bundle, { steer: { gate: () => true, pick: () => "sn_yes" } });
    expect(texts(engine.hotSwap(bundle))).toEqual(["a", "yes"]);
  });

  it("setSteer steers an engine that's already made, and null clears it", () => {
    const engine = new Engine(bundle);
    expect(texts(engine)).toEqual(["no"]);
    engine.setSteer({ gate: () => true, pick: () => "sn_yes" });
    expect(texts(engine)).toEqual(["a", "yes"]);
    engine.setSteer(null);
    expect(texts(engine)).toEqual(["no"]);
  });

  it("setSteer replaces a steerer the option gave, and a hot swap keeps the one set last", () => {
    const engine = new Engine(bundle, { steer: { gate: () => true } });
    engine.setSteer({ pick: () => "sn_yes" });
    expect(texts(engine)).toEqual(["yes"]);
    engine.setSteer(null);
    expect(texts(engine.hotSwap(bundle))).toEqual(["no"]);
    const steered = new Engine(bundle);
    steered.setSteer({ gate: () => true, pick: () => "sn_yes" });
    expect(texts(steered.hotSwap(bundle))).toEqual(["a", "yes"]);
  });

  it("setSteer given something that isn't a steerer reports it and leaves the engine unsteered", () => {
    for (const steer of [42, { gate: "always" }, { pick: 1 }]) {
      const errors: PlayError[] = [];
      const engine = new Engine(bundle, { steer: { gate: () => true }, onError: (e) => errors.push(e) });
      engine.setSteer(steer as unknown as Steerer);
      expect(errors).toEqual([expect.objectContaining({ kind: "setup", node: "steer" })]);
      expect(texts(engine)).toEqual(["no"]);
    }
  });
});
