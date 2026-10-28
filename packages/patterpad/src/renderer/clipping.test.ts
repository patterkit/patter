// Two things the hands-on review of October 2026 saw clipped (Dev), measured in the browser preview and
// held here by reading the stylesheet, as chrome-scale.test.ts does (jsdom lays nothing out):
//  - the inspector's Writing and Recording status, a <select> up to 176px wide, ran past a narrow
//    inspector's edge with a long rung name, cut mid-letter. It now fits its row and ends in an ellipsis.
//  - Project Settings kept a 480px floor on its body, and the shell caps the dialog at 82vh: at the app's
//    minimum height (600px) Save and Cancel sat below the dialog's edge. The floor now gives way first.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const shell = readFileSync(fileURLToPath(new URL("./src/shell.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string): string => {
  const at = shell.indexOf(`\n${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return shell.slice(shell.indexOf("{", at) + 1, shell.indexOf("}", at));
};

describe("nothing clipped at the app's smallest sizes", () => {
  it("keeps a status select inside its inspector row, with an ellipsis for a long name", () => {
    const r = rule(".insp-status-select");
    expect(r).toContain("max-width: min(176px, 100%)");
    expect(r).toContain("text-overflow: ellipsis");
  });

  it("lets Project Settings' body floor give way, so Save and Cancel stay in a short window", () => {
    expect(rule(".settings-body")).toContain("min-height: min(480px, calc(82vh - 112px))");
    // At the minimum window (600px high): the 82vh cap less the floor leaves room for the title and Save row.
    const cap = 0.82 * 600, floor = Math.min(480, cap - 112);
    expect(cap - floor).toBeGreaterThanOrEqual(55 + 54); // the title and actions measured in the preview
  });
});
