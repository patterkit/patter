// The Night Ferry, the second worked example Patterpad carries (Help > Open an Example) and the
// download page offers as `night-ferry.patterpack`. Held to the Tour's standard: valid, silent under
// the reachability check, and playable to an ending with no steering, since `patter play` with no
// choices is the first thing its README suggests.

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { loadProject, reachabilityIssues, runPlay, runValidate } from "../src/index.js";

const dir = join(import.meta.dirname, "..", "..", "..", "examples", "projects", "night-ferry.patter");

describe("the Night Ferry", () => {
  it("validates with nothing to report", () => {
    const r = runValidate(loadProject(dir));
    expect([...r.structural, ...r.conditions, ...r.interpolation, ...r.hygiene, ...r.staleBundles]).toEqual([]);
  });

  it("reports nothing under the reachability check", () => {
    expect(reachabilityIssues(loadProject(dir))).toEqual([]);
  });

  it("plays to an ending with no choices steered", () => {
    // Taking the first option each time must still reach the far bank: the way out sits before the
    // sticky "Sit in silence", or an unsteered play loops on the silence until the step limit.
    const result = runPlay(loadProject(dir));
    expect(result.outcome).toBe("end");
  });

  it("remembers a passenger who could not pay, at the far bank", () => {
    const loaded = loadProject(dir);
    const first = runPlay(loaded);
    const fare = first.events.find((e) => e.type === "choice");
    const cannotPay = fare?.type === "choice" ? fare.options.find((o) => o.prompt?.text === "Tell him you can't pay")?.id : undefined;
    expect(cannotPay).toBeDefined();
    const lines = runPlay(loaded, { choices: [cannotPay!] }).events
      .flatMap((e) => (e.type === "line" || e.type === "text" ? [e.text] : []));
    expect(lines).toContain("And the fare? Forget it. Somebody paid yours a long time ago.");
  });
});
