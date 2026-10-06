// Content errors play through, and are reported. Content can fail at run time in ways the compiler cannot
// see (a division by zero, a host value of the wrong type, a story write to a read-only @world value). The
// story never stops for one: a failing condition counts as false, a failing effect is skipped and the rest
// of its list still runs. The corpus pins that play outcome on all four runtimes; this pins the REPORT,
// which it cannot see: EngineOptions.onError, a "diagnostic" log entry, and console.warn when unset.
// (JS threw out of advance() until 2026-10.)
import { describe, it, expect, vi, afterEach } from "vitest";
import { Engine } from "@patterkit/runtime";
import type { PlayError } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "p", name: "P" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "zero", type: "number", default: 0 },
    { name: "a", type: "number", default: 0 },
    { name: "c", type: "number", default: 0 },
  ],
};
const scene: Scene = {
  id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
    { id: "sn_fx", type: "snippet",
      onEnter: [
        { kind: "set", target: "@a", value: "1" },
        { kind: "set", target: "@c", value: "10 / @zero" },
      ],
      beats: [{ id: "T", kind: "text" }] },
    { id: "g", type: "group", selector: "branch", children: [
      { id: "sn_bad", type: "snippet", condition: "10 / @zero > 1", beats: [{ id: "BAD", kind: "text" }] },
      { id: "sn_ok", type: "snippet", beats: [{ id: "OK", kind: "text" }] },
    ] },
    { id: "sn_end", type: "snippet", jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { T: "a={@a} c={@c}", BAD: "bad", OK: "ok" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const play = (engine: Engine) => {
  const flow = engine.openFlow("main", { scene: "s" });
  const texts: string[] = [];
  for (let i = 0; i < 10; i++) { const r = flow.advance(); if (r.type === "end") break; if ("text" in r) texts.push(r.text); }
  return texts;
};

afterEach(() => vi.restoreAllMocks());

describe("a content error", () => {
  it("never stops the story, and each one reaches onError", () => {
    const errors: PlayError[] = [];
    const texts = play(new Engine(bundle, { onError: (e) => errors.push(e) }));
    expect(texts).toEqual(["a=1 c=0", "ok"]);
    expect(errors).toEqual([
      { flow: "main", kind: "effect", node: "sn_fx", source: "10 / @zero", message: expect.any(String) },
      { flow: "main", kind: "condition", node: "sn_bad", source: "10 / @zero > 1", message: expect.any(String) },
    ]);
    expect(errors[0]!.message).toMatch(/zero/i);
  });

  it("is a diagnostic entry in the decision log, and a skipped effect logs no write", () => {
    const engine = new Engine(bundle, { log: true, onError: () => {} });
    play(engine);
    const log = engine.log();
    expect(log.filter((e) => e.type === "diagnostic").map((e) => (e as { kind: string; node: string }))).toMatchObject([
      { kind: "effect", node: "sn_fx" }, { kind: "condition", node: "sn_bad" },
    ]);
    const writes = log.filter((e) => e.type === "write").map((e) => (e as { target: string }).target);
    expect(writes).toEqual(["@a"]); // the failing @c write is not logged as one that landed
  });

  it("goes to console.warn when the game sets no onError, so it is never silent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    play(new Engine(bundle));
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toContain("sn_fx");
  });
});

describe("loading a malformed save", () => {
  it("refuses it before changing anything", () => {
    const engine = new Engine(bundle, { onError: () => {} });
    const flow = engine.openFlow("main", { scene: "s" });
    flow.advance();
    const before = JSON.stringify(engine.saveGame());
    const broken = { ...engine.saveGame(), flows: undefined } as never;
    expect(() => engine.loadGame(broken)).toThrow("malformed save: no flows");
    expect(engine.getFlow("main")).toBe(flow);
    expect(JSON.stringify(engine.saveGame())).toBe(before);
  });
});
