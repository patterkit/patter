// The read-only condition tag must show readable scene / block TITLES inside visits() / seen(),
// never the opaque node id the expression stores (e.g. `visits("blk_x7q2")`). humanizeCondition
// rewrites those args through the same resolver the jump chips use.

import { describe, it, expect, beforeEach } from "vitest";
import { humanizeCondition, setJumpLabelResolver } from "./views.js";

const TITLES: Record<string, string> = { blk_x7q2: "The Tavern", scn_int: "Intro" };

describe("humanizeCondition", () => {
  beforeEach(() => setJumpLabelResolver((id) => TITLES[id] ?? id));

  it("swaps a visits() node id for the block title", () => {
    expect(humanizeCondition('visits("blk_x7q2") > 0')).toBe("visits(The Tavern) > 0");
  });

  it("handles seen() and the world-wide patter_ variants, and single quotes", () => {
    expect(humanizeCondition("seen('scn_int')")).toBe("seen(Intro)");
    expect(humanizeCondition('patter_visits("blk_x7q2") >= 2')).toBe("patter_visits(The Tavern) >= 2");
    expect(humanizeCondition('patter_seen("scn_int")')).toBe("patter_seen(Intro)");
  });

  it("rewrites every call in a compound condition and leaves properties untouched", () => {
    expect(humanizeCondition('@gold > 5 && visits("blk_x7q2") == 0')).toBe("@gold > 5 && visits(The Tavern) == 0");
  });

  it("falls back to the id when it can't be resolved", () => {
    expect(humanizeCondition('visits("blk_unknown")')).toBe("visits(blk_unknown)");
  });
});
