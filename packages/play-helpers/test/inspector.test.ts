// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The live @patter property inspector (DOM panel): renders a row per property,
// edits write through to the engine, reset restores the default, and a refresh
// reflects external changes without clobbering the field being edited.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { Engine } from "@patterkit/runtime";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { createPropertyInspector } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "h", name: "H" },
  locales: { default: "en", all: ["en"] },
  properties: [
    { name: "gold", type: "number", default: 5 },
    { name: "met", type: "boolean", default: false },
    { name: "name", type: "string", default: "" },
    { name: "mood", type: "enum", values: ["calm", "tense"], default: "calm" },
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

describe("createPropertyInspector", () => {
  it("renders one row per @patter property with the right editors", () => {
    const engine = new Engine(bundle);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const insp = createPropertyInspector(engine, { container, pollMs: 0 });

    const refs = Array.from(insp.el.querySelectorAll(".pp-insp-ref")).map((e) => e.textContent);
    expect(refs).toEqual(["@gold", "@met", "@name", "@mood"]);
    expect(insp.el.querySelector(".pp-insp-row input[type=number]")).toBeTruthy();  // gold
    expect(insp.el.querySelector(".pp-insp-row input[type=checkbox]")).toBeTruthy(); // met
    expect(insp.el.querySelector(".pp-insp-row select")).toBeTruthy();               // mood (enum)
    insp.destroy();
    expect(insp.el.isConnected).toBe(false);
  });

  it("editing a control writes through to the engine", () => {
    const engine = new Engine(bundle);
    const insp = createPropertyInspector(engine, { container: document.body, pollMs: 0 });
    const num = insp.el.querySelector(".pp-insp-row input[type=number]") as HTMLInputElement;
    num.value = "42";
    num.dispatchEvent(new Event("change"));
    expect(engine.getProperty("@gold")).toBe(42);

    const sel = insp.el.querySelector(".pp-insp-row select") as HTMLSelectElement;
    sel.value = "tense";
    sel.dispatchEvent(new Event("change"));
    expect(engine.getProperty("@mood")).toBe("tense");
    insp.destroy();
  });

  it("reset restores the declared default and disables when already default", () => {
    const engine = new Engine(bundle);
    const insp = createPropertyInspector(engine, { container: document.body, pollMs: 0 });
    const goldRow = insp.el.querySelector(".pp-insp-row") as HTMLElement; // first row = @gold
    const reset = goldRow.querySelector(".pp-insp-reset") as HTMLButtonElement;
    expect(reset.disabled).toBe(true);                 // starts at default (5)

    engine.setProperty("@gold", 99);
    insp.refresh();
    expect(reset.disabled).toBe(false);                // no longer default
    reset.click();
    expect(engine.getProperty("@gold")).toBe(5);       // back to default
    expect(reset.disabled).toBe(true);
    insp.destroy();
  });

  it("refresh reflects an external change but never clobbers the focused field", () => {
    const engine = new Engine(bundle);
    const insp = createPropertyInspector(engine, { container: document.body, pollMs: 0 });
    const num = insp.el.querySelector(".pp-insp-row input[type=number]") as HTMLInputElement;

    engine.setProperty("@gold", 7);
    insp.refresh();
    expect(num.value).toBe("7");                       // picked up the external change

    num.focus();
    num.value = "123";                                 // user is mid-edit
    engine.setProperty("@gold", 500);                  // engine changes underneath
    insp.refresh();
    expect(num.value).toBe("123");                     // NOT clobbered while focused
    insp.destroy();
  });
});
