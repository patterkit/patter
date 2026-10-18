// Patter extension values at runtime: the corpus pins delivery; this pins what the corpus can't see, that a
// saved pending choice doesn't carry an option's values and gets them back off the bundle as it loads.

import { describe, it, expect } from "vitest";
import { Engine } from "../src/index.js";
import type { Bundle } from "@patterkit/model";

const bundle = (icon: string): Bundle => ({
  schema: "patter/bundle@0",
  content: { project: "p" },
  voiced: false,
  locales: { default: "en", included: ["en"] },
  extensions: { probe: { version: "1.0.0", fields: { option: [{ name: "icon", type: "text", default: "" }] } } },
  scenes: {
    s: { id: "s", type: "scene", name: "S", blocks: [{ id: "b", type: "block", name: "B", children: [
      { id: "g", type: "group", selector: "choice", children: [
        { id: "o", type: "group", prompt: { id: "P", kind: "text" }, extensions: { probe: { icon } },
          children: [{ id: "sn", type: "snippet", jump: { to: "END" } }] },
      ] },
    ] }] },
  },
  strings: { en: { P: "Go" } },
});

describe("extension values on a saved choice", () => {
  it("are left out of the save and read off the bundle on load", () => {
    const engine = new Engine(bundle("door"));
    const step = engine.openFlow("main", { scene: "s" }).advance();
    expect(step.type === "choice" && step.options[0]!.extensions).toEqual({ probe: { icon: "door" } });
    const save = JSON.parse(JSON.stringify(engine.saveGame()));
    expect(JSON.stringify(save)).not.toContain("door");
    // Loaded onto an edited bundle: the option carries the bundle's values now.
    const next = new Engine(bundle("gate"));
    next.loadGame(save);
    const again = next.getFlow("main")!.advance();
    expect(again.type === "choice" && again.options[0]!.extensions).toEqual({ probe: { icon: "gate" } });
  });
});
