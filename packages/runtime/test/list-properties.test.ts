// ---------------------------------------------------------------------------
// engine.listProperties(): the shared @patter properties for a live inspector,
// each with ref, type, current value, declared default, and enum values.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "h", name: "H" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "gold", type: "number", default: 5 },
    { name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" },
    { name: "flags", type: "flags" },                       // no default -> type default []
    { name: "local", type: "string", shared: false },       // per-flow: excluded from listProperties
  ],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn", type: "snippet", beats: [{ id: "T", kind: "text" }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "Hi" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

describe("engine.listProperties", () => {
  it("lists shared @patter properties with type, value, default, and enum values", () => {
    const engine = new Engine(bundle);
    const rows = engine.listProperties();
    expect(rows.map((r) => r.ref)).toEqual(["@gold", "@mood", "@flags"]); // @local is per-flow, not shared

    const gold = rows.find((r) => r.ref === "@gold")!;
    expect(gold.type).toBe("number");
    expect(gold.value).toBe(5);
    expect(gold.default).toBe(5);

    const mood = rows.find((r) => r.ref === "@mood")!;
    expect(mood.values).toEqual(["calm", "tense"]);
    expect(mood.value).toBe("calm");

    const flags = rows.find((r) => r.ref === "@flags")!;
    expect(flags.default).toEqual([]); // no declared default -> type default
  });

  it("reflects a live setProperty in the row's value (fresh read each call)", () => {
    const engine = new Engine(bundle);
    engine.setProperty("@gold", 42);
    expect(engine.listProperties().find((r) => r.ref === "@gold")!.value).toBe(42);
  });
});
