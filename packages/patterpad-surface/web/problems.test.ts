// @vitest-environment jsdom
// The inline problem squiggle plugin (problems.ts): pushing a mark set decorates the matching nodes
// (by model id) with a severity class, and clearing removes them - surviving re-render via decorations.

import { describe, it, expect } from "vitest";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { openScene } from "../src/load.js";
import { nodeViews } from "./views.js";
import { problemsPlugin, setProblemMarks } from "./problems.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

describe("inline problem squiggles (jsdom)", () => {
  it("decorates the node named by a problem mark, by id, by severity, and clears", () => {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, {
      state: EditorState.create({ doc: openScene(flowSource, locSource).doc, plugins: [problemsPlugin()] }),
      nodeViews,
    });
    const dom = view.dom as HTMLElement;
    expect(dom.querySelectorAll(".has-problem").length).toBe(0);

    setProblemMarks(view, [{ id: "L_greet", severity: "error" }]); // a real BARKEEP line beat in the fixture
    expect(dom.querySelectorAll(".problem-error").length).toBe(1);
    expect(dom.querySelector(".beat.kind-line.problem-error")).toBeTruthy();

    setProblemMarks(view, [{ id: "L_greet", severity: "warning" }]); // same node, switched severity
    expect(dom.querySelectorAll(".problem-error").length).toBe(0);
    expect(dom.querySelectorAll(".problem-warning").length).toBe(1);

    setProblemMarks(view, []); // cleared
    expect(dom.querySelectorAll(".has-problem").length).toBe(0);
    view.destroy();
  });
});
