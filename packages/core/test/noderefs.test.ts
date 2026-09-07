// The shared read-out-loud rule for node references in a condition (#64): one regex, two callers -
// the editor's condition tag and the readable-script export. They each had their own until the
// export's, which only matched a quoted id, printed raw ids into a PDF for conditions Patterpad had
// written with barewords.

import { describe, it, expect } from "vitest";
import { humanizeNodeRefs } from "../src/index.js";

const NAMES: Record<string, string> = { blk_lcd858q2: "Intro", vault: "The Vault", scn_1: "The Tavern" };
const label = (id: string): string => NAMES[id] ?? id;

describe("humanizeNodeRefs", () => {
  it("names a BAREWORD id (what Patterpad writes)", () => {
    expect(humanizeNodeRefs("not seen(blk_lcd858q2)", label)).toBe("not seen(Intro)");
  });

  it("names a quoted id, in either quote", () => {
    expect(humanizeNodeRefs("visits('vault') == 1", label)).toBe("visits(The Vault) == 1");
    expect(humanizeNodeRefs('visits("vault") == 1', label)).toBe("visits(The Vault) == 1");
  });

  it("covers the world-wide variants and several calls in one expression", () => {
    expect(humanizeNodeRefs("patter_seen(vault) || patter_visits(scn_1) > 2 && seen(blk_lcd858q2)", label))
      .toBe("patter_seen(The Vault) || patter_visits(The Tavern) > 2 && seen(Intro)");
  });

  it("leaves an id it cannot name exactly as it found it", () => {
    expect(humanizeNodeRefs("seen(blk_gone)", label)).toBe("seen(blk_gone)");
  });

  it("leaves the rest of the expression alone, including similar-looking names", () => {
    expect(humanizeNodeRefs("@seen_count > 1 && unseen(vault)", label)).toBe("@seen_count > 1 && unseen(vault)");
    expect(humanizeNodeRefs("@gold > 5", label)).toBe("@gold > 5");
  });

  it("tolerates the spacing a person might type", () => {
    expect(humanizeNodeRefs("seen( vault )", label)).toBe("seen(The Vault)");
    expect(humanizeNodeRefs("visits ('vault')", label)).toBe("visits(The Vault)");
  });
});
