// Two layout fixes from retaking the site's screenshots (October 2026). jsdom lays nothing out, so these hold
// the rules; the overlaps themselves were measured in a running Patterpad, before and after.
//   - In an inspector about 310px wide, a jump target's name ran over the Jump / Call toggle beside it: the
//     chip took `.insp-cond`'s zero basis, so the toggle never wrapped and the name spilled out of the chip.
//   - In Production Information, the "More below" pill floated over the report and hid a table's headings.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "packages/patterpad/src/renderer/src/shell.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `no rule for ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at));
};

describe("the inspector's Jump row in a narrow inspector", () => {
  it("sizes the chip by its target's name, so the toggle wraps under it", () => {
    expect(rule(".insp-jumpval")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".insp-jumpval > .insp-jump")).toMatch(/flex:\s*1 1 auto/);
  });

  it("breaks a name wider than the column inside the chip", () => {
    expect(rule(".insp-jumpval > .insp-jump")).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("Production Information's More below pill", () => {
  it("has a strip of its own under the report, so it never sits over it", () => {
    const room = /--more-room:\s*(\d+)px/.exec(rule(".report-scroll"))?.[1];
    expect(room).toBeDefined();
    expect(rule(".report-scroll")).toMatch(/padding-bottom:\s*var\(--more-room\)/);
    // The pill fits in the strip: its offset and height together are no taller than the room.
    const pill = rule(".report-more");
    const bottom = Number(/bottom:\s*(\d+)px/.exec(pill)?.[1]);
    const height = Number(/height:\s*(\d+)px/.exec(pill)?.[1]);
    expect(bottom + height).toBeLessThanOrEqual(Number(room));
    // And the fade sits on the report's clipped edge, not on the empty strip.
    expect(rule(".report-scroll::after")).toMatch(/bottom:\s*var\(--more-room\)/);
  });
});
