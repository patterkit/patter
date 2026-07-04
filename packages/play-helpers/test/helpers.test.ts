// ---------------------------------------------------------------------------
// @patterkit/play-helpers - the game-integration helpers around the Engine.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { Bundle, ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import {
  SAVE_SCHEMA, saveState, loadState, serializeState, deserializeState,
  getProperty, setProperty, setProperties,
  snapshotState, diffState, createStateLogger,
} from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "h", name: "H" },
  locales: { default: "en", all: ["en", "fr"] },
  properties: [{ name: "hp", type: "number", default: 0 }],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "Hello" } };
const fr: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "fr", strings: { T: "Bonjour" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en, fr] });

describe("runtime properties", () => {
  it("set / get one and many", () => {
    const engine = new Engine(bundle);
    setProperty(engine, "@hp", 7);
    expect(getProperty(engine, "@hp")).toBe(7);
    setProperties(engine, { "@hp": 12 });
    expect(getProperty(engine, "@hp")).toBe(12);
  });
});

describe("save / load", () => {
  it("envelope round-trips into a fresh engine", () => {
    const engine = new Engine(bundle);
    setProperty(engine, "@hp", 42);
    const env = saveState(engine);
    expect(env.schema).toBe(SAVE_SCHEMA);

    const restored = new Engine(bundle);
    loadState(restored, env);
    expect(getProperty(restored, "@hp")).toBe(42);
  });

  it("serialize / deserialize through a JSON string", () => {
    const engine = new Engine(bundle);
    setProperty(engine, "@hp", 5);
    const json = serializeState(engine);
    expect(typeof json).toBe("string");

    const restored = new Engine(bundle);
    deserializeState(restored, json);
    expect(getProperty(restored, "@hp")).toBe(5);
  });

  it("rejects a foreign / blank envelope", () => {
    const engine = new Engine(bundle);
    expect(() => loadState(engine, { schema: "nope", save: {} } as never)).toThrow(SAVE_SCHEMA);
    expect(() => deserializeState(engine, "{}")).toThrow(SAVE_SCHEMA);
  });
});


describe("state logger", () => {
  it("snapshot + diff report a changed @patter global", () => {
    const engine = new Engine(bundle);
    const before = snapshotState(engine);
    expect(before["@patter.hp"]).toBe(0);
    setProperty(engine, "@hp", 3);
    const changes = diffState(before, snapshotState(engine));
    expect(changes).toEqual([{ path: "@patter.hp", from: 0, to: 3 }]);
  });

  it("logger captures mutations and traces steps to its sink", () => {
    const lines: string[] = [];
    const engine = new Engine(bundle);
    const log = createStateLogger(engine, { sink: (l) => lines.push(l), label: "t" });

    setProperty(engine, "@hp", 9);
    const changed = log.capture();
    expect(changed).toEqual([{ path: "@patter.hp", from: 0, to: 9 }]);
    expect(lines).toContain("[t] @patter.hp: 0 -> 9");

    log.logStep({ type: "text", id: "T", text: "Hello", gameData: { mood: "calm" } });
    expect(lines.some((l) => l.includes('text: "Hello"') && l.includes('gameData={"mood":"calm"}'))).toBe(true);

    // A second capture with no mutation yields nothing.
    expect(log.capture()).toEqual([]);
  });
});
