// Moving a flow drops everything waiting to be delivered. With replayPromptOnChoose, choose() leaves the
// chosen option's prompt waiting to be spoken back by the next advance(). A reset (start) between the two
// used to clear only the choice, so the abandoned run's prompt played as the restarted run's first beat.
// goto and close already cleared both; all now share one clearPending, as on the other three runtimes.
import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = { schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] } };
const scene: Scene = { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
  { id: "sn_open", type: "snippet", beats: [{ id: "OPEN", kind: "text" }] },
  { id: "g", type: "group", selector: "choice", children: [
    { id: "o", type: "group", prompt: { id: "P", kind: "line", character: "PC" }, children: [
      { id: "sn_ans", type: "snippet", beats: [{ id: "ANS", kind: "text" }], jump: { to: "END" } },
    ] },
  ] },
] }] };
const en: LocaleFile = { schema: "patter/strings@0", scene: "s", locale: "en", strings: { OPEN: "opening", P: "Ask", ANS: "answer" } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const toChosen = () => {
  const engine = new Engine(bundle, { replayPromptOnChoose: true });
  const flow = engine.openFlow("f", { scene: "s" });
  expect(flow.advance()).toMatchObject({ id: "OPEN" });
  expect(flow.advance()).toMatchObject({ type: "choice" });
  flow.choose("o");
  return flow;
};

describe("a prompt waiting to be replayed", () => {
  it("is spoken back by the next advance, as before", () => {
    expect(toChosen().advance()).toMatchObject({ type: "line", id: "P" });
  });

  it("is dropped by a reset, so the restarted run begins at its start", () => {
    const flow = toChosen();
    flow.reset();
    expect(flow.advance()).toMatchObject({ type: "text", id: "OPEN" });
  });

  it("is dropped by a goto too", () => {
    const flow = toChosen();
    flow.goto("s");
    expect(flow.advance()).toMatchObject({ type: "text", id: "OPEN" });
  });
});
