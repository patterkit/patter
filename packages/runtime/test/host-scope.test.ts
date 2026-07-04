// ---------------------------------------------------------------------------
// First-class host scopes (#159 / design/scope-registry.md §6): a standalone
// project that DECLARES a host scope (`@world`) gets a live, self-backed scope -
// the story reads its declared defaults, writes to it, and gates on it - with no
// host wiring. When the embedder DOES bind a resolver for the token, that wins
// (the self-backed bag is skipped), proving the scope is genuinely foreign.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { StepResult } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "hs", name: "HS" },
  locales: { default: "en", all: ["en"] },
  scopeRegistry: {
    version: 1,
    scopes: [{
      token: "world",
      declarations: [
        { name: "gold", type: "number", default: 0 },
        { name: "phase", type: "enum", values: ["a1", "a2"], default: "a1" },
      ],
    }],
  },
};

// On entry, top up @world.gold from its current value (default 0). The gate then
// reads it back: if the self-backed scope works, gold is 5 and we report it.
const scene: Scene = {
  id: "s", type: "scene", name: "S",
  onEntry: [{ kind: "set", target: "@world.gold", value: "@world.gold + 5" }],
  blocks: [
    { id: "b", type: "block", name: "B", children: [
      { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};
const en: LocaleFile = {
  schema: "patter/strings@0", scene: "s", locale: "en",
  strings: { L: "gold {@world.gold} phase {@world.phase}" },
};
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const firstLine = (flow: { advance(): StepResult }): string => {
  for (let i = 0; i < 10; i++) {
    const r = flow.advance();
    if (r.type === "text" || r.type === "line") return r.text;
    if (r.type === "end") break;
  }
  throw new Error("no line produced");
};

describe("first-class host scopes", () => {
  it("bakes the declared scope into the bundle", () => {
    expect(bundle.scopeRegistry?.scopes[0]?.token).toBe("world");
  });

  it("self-backs @world from declared defaults; the story reads + writes it", () => {
    const flow = new Engine(bundle).openFlow("f", { scene: "s" });
    // gold defaulted to 0, onEntry added 5; phase reads its declared default.
    expect(firstLine(flow)).toBe("gold 5 phase a1");
  });

  it("a host-bound resolver wins over the self-backed bag", () => {
    const bag = new Map<string, number>([["gold", 100]]);
    const flow = new Engine(bundle, {
      world: { get: (n) => (n === "phase" ? "a2" : bag.get(n)), set: (n, v) => { bag.set(n, v as number); } },
    }).openFlow("f", { scene: "s" });
    // onEntry read 100 from the host bag, wrote 105 back to it; phase comes from the host too.
    expect(firstLine(flow)).toBe("gold 105 phase a2");
    expect(bag.get("gold")).toBe(105);
  });
});
