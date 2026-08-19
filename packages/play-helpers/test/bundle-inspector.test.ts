// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The bundle inspector's web view: a read-only panel over describeBundle.
//
// What is worth testing is what an integrator came to the panel FOR: the
// addresses game code may call, the host properties the game must supply, and
// the two warnings that are easy to miss in a build - a source-debug build, and
// a declared property with no default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { exportBundle } from "@patterkit/compiler";
import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";
import { createBundleInspector } from "../src/index.js";

const project: ProjectFile = {
  schema: "patter/project@0", project: { id: "tav", name: "Tavern" },
  locales: { default: "en", all: ["en", "fr"] },
  properties: [{ name: "gold", type: "number", shared: true, default: 5 }],
  scopeRegistry: { version: 1, scopes: [
    { token: "world", declarations: [
      { name: "isnight", type: "boolean", default: true },
      { name: "weather", type: "string" },          // no default: the game MUST supply it
    ] },
    { token: "game" },                               // opaque
  ] },
};
const scene: Scene = {
  id: "s1", type: "scene", name: "Opening Night",
  sceneProps: [{ name: "seen", type: "boolean" }],
  blocks: [{ id: "b1", type: "block", name: "The Bar", children: [
    { id: "sn", type: "snippet", beats: [{ id: "L", kind: "text" }], jump: { to: "END" } },
  ] }],
};
const en: LocaleFile = { schema: "patter/strings@0", scene: "s1", locale: "en", strings: { L: "Quiet tonight." } };
const bundle = exportBundle({ project, scenes: [scene], locales: [en] });

const mount = (b = bundle) => {
  const container = document.createElement("div");
  document.body.append(container);
  return createBundleInspector(b, { container });
};
const sectionText = (panel: HTMLElement, name: string): string =>
  panel.querySelector(`details[data-section="${name}"]`)?.textContent ?? "";

describe("the bundle inspector panel", () => {
  it("lists the addresses game code may call, blocks under their scene", () => {
    const panel = mount();
    const addresses = sectionText(panel.el, "addresses");
    expect(addresses).toContain("opening-night");
    expect(addresses).toContain("the-bar");
    // Nested rather than flattened: a block address is scene-scoped.
    const rows = panel.el.querySelectorAll('details[data-section="addresses"] .pp-bundle-row');
    expect(rows[1]?.classList.contains("pp-bundle-sub")).toBe(true);
    panel.destroy();
  });

  it("names what the host must supply, and marks a property with no default", () => {
    const panel = mount();
    const host = sectionText(panel.el, "hostScopes");
    expect(host).toContain("@world");
    expect(host).toContain("weather");
    expect(host).toContain("no default");     // the row an integrator is scanning for
    panel.destroy();
  });

  it("shows an opaque scope as unchecked rather than as an empty list", () => {
    const panel = mount();
    expect(sectionText(panel.el, "hostScopes")).toContain("any name, unchecked");
    panel.destroy();
  });

  it("separates story properties from host ones", () => {
    const panel = mount();
    const owned = sectionText(panel.el, "properties");
    expect(owned).toContain("gold");
    expect(owned).toContain("seen");
    expect(owned).not.toContain("isnight");
    panel.destroy();
  });

  it("says loudly when the build is source-debug, which is not shippable", () => {
    // A source-debug build is a bundle-level flag, so it is set on the compiled
    // artefact rather than asked of the compiler.
    const debugBundle = { ...bundle, localisation: { mode: "ids" as const, sourceDebug: true } };
    const panel = mount(debugBundle);
    const identity = sectionText(panel.el, "identity");
    expect(identity).toContain("not shippable");
    expect(panel.el.querySelector(".pp-bundle-warn")).not.toBeNull();
    panel.destroy();
  });

  it("hands back the description as well as the panel, and cleans up after itself", () => {
    const panel = mount();
    expect(panel.description.counts.scenes).toBe(1);
    expect(document.body.contains(panel.el)).toBe(true);
    panel.destroy();
    expect(document.body.contains(panel.el)).toBe(false);
  });

  it("survives a bundle with no host scopes and no game data", () => {
    const bare = exportBundle({
      project: { schema: "patter/project@0", project: { id: "b", name: "Bare" }, locales: { default: "en", all: ["en"] } },
      scenes: [scene], locales: [en],
    });
    const panel = mount(bare);
    expect(sectionText(panel.el, "hostScopes")).toContain("the game supplies nothing");
    expect(panel.el.querySelector('details[data-section="gameData"]')).toBeNull();
    panel.destroy();
  });
});
