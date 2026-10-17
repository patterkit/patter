// @vitest-environment jsdom
// A quality's stage renamed in place, in both editors that declare one: the Properties list hands the rename
// to its caller (which carries it into the scenes on save), and the World tab keeps its renames for the
// settings save, with the default following the stage. A reorder asks for its note.

import { describe, it, expect } from "vitest";
import type { PropertyDecl } from "@patterkit/model";
import { mountProperties } from "./src/settings-properties.js";
import { mountWorld } from "./src/settings-world.js";

const LADDER = ["troubled", "confronted", "resolved"];

/** Open a row's details (the stages sit behind the disclosure), then rename the stage `from` to `to`. */
function renameStage(host: HTMLElement, from: string, to: string): void {
  for (const d of host.querySelectorAll<HTMLElement>("details, .shell-expandable")) d.setAttribute("open", "");
  const label = [...host.querySelectorAll<HTMLElement>(".shell-tag-label")].find((l) => l.textContent?.endsWith(from));
  if (!label) throw new Error(`no stage ${from}`);
  label.click();
  const field = host.querySelector<HTMLInputElement>("input.shell-stage-rename");
  if (!field) throw new Error("no rename field");
  field.value = to;
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

describe("renaming a quality's stage", () => {
  it("on the Properties list, is handed to the caller with the declaration, and the default follows", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const calls: Array<[string, string, string]> = [];
    const handle = mountProperties(host, [{ name: "debt", type: "quality", stages: [...LADDER], default: "confronted" }], {
      onStageRename: (decl: PropertyDecl, from, to) => calls.push([decl.name, from, to]),
    });
    renameStage(host, "confronted", "faced");
    expect(calls).toEqual([["debt", "confronted", "faced"]]);
    expect(handle.value()[0]).toMatchObject({ stages: ["troubled", "faced", "resolved"], default: "faced" });
    host.remove();
  });

  it("on the World tab, is kept for the save, with its scope, and the default follows", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const handle = mountWorld(host, {
      scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "act", type: "quality", stages: [...LADDER], default: "troubled" }] }] },
      onPropose: () => Promise.resolve([]),
    });
    renameStage(host, "troubled", "uneasy");
    expect(handle.stageRenames()).toEqual([{ scope: "world", name: "act", from: "troubled", to: "uneasy" }]);
    expect(handle.value().scopeRegistry?.scopes[0]?.declarations?.[0]).toMatchObject({ stages: ["uneasy", "confronted", "resolved"], default: "uneasy" });
    host.remove();
  });

  it("asks for the reorder note when the stages move", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const asked: string[] = [];
    mountWorld(host, {
      scopeRegistry: { version: 1, scopes: [{ token: "world", declarations: [{ name: "act", type: "quality", stages: [...LADDER] }] }] },
      onPropose: () => Promise.resolve([]),
      onStageReorder: (target, note) => { asked.push(`${target.scope}.${target.name}`); note.textContent = "noted"; },
    });
    const later = host.querySelector<HTMLButtonElement>('button[aria-label="Move troubled later"], button[data-tip="Move troubled later"]');
    expect(later).not.toBeNull();
    later!.click();
    expect(asked).toEqual(["world.act"]);
    expect(host.querySelector(".shell-stage-note")?.textContent).toBe("noted");
    host.remove();
  });
});
