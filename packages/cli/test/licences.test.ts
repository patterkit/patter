// ---------------------------------------------------------------------------
// `patter licences`. Patter's own MIT licence, then the fonts the PDF export embeds (SIL Open Font
// License), each font package's licence file in full under its name. A standalone binary carries those
// files with nothing beside it, so the tool itself has to show them; its library notices are checked by
// build-standalone.mjs's smoke run, since only a standalone build has them. Here, from source, the
// libraries install beside it, and it says so.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { SCRIPT_FONT_PACKAGES } from "@patterkit/ops";
import { main } from "../src/main.js";

afterEach(() => vi.restoreAllMocks());

describe("patter licences", () => {
  for (const spelling of ["licences", "licenses"]) {
    it(`prints every font package's licence (${spelling})`, async () => {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
      expect(await main([spelling])).toBe(0);
      const out = lines.join("\n");
      for (const name of SCRIPT_FONT_PACKAGES) expect(out).toContain(`=== ${name} ===`);
      expect(out).toMatch(/SIL OPEN FONT LICENSE/i);
      expect(out).toContain('Reserved Font Name "Plex"'); // IBM's own notice, which a third party's copy dropped
      expect(out).toMatch(/is free software under the MIT License:\n\nMIT License\n\nCopyright \(c\) \d{4} Ian Thomas/);
      expect(out).toContain("Its libraries install from npm beside it");
    });
  }
});
