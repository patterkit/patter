// ---------------------------------------------------------------------------
// `patter --version`.
//
// The CLI ships as a self-contained per-platform binary: no package.json beside it, no npm that installed
// it, and a filename that is whatever the person who downloaded it called it. So the tool itself is the
// only thing that can answer "what are you running?", which is the first question any support
// conversation opens with. Before this it printed the usage text, which looks like the tool considered
// the question and declined. (from-storylets/cli-version-flag, 2026-08-30.)
//
// The assertion reads package.json rather than a literal: a test that hardcodes the version passes by
// agreeing with a copy of itself, and goes stale at the same moment the code does.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { main, USAGE } from "../src/main.js";

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };

async function captured(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { lines.push(a.join(" ")); });
  try { return { code: await main(args), out: lines.join("\n") }; } finally { spy.mockRestore(); }
}

afterEach(() => vi.restoreAllMocks());

describe("patter --version", () => {
  for (const spelling of ["--version", "-v", "version"]) {
    it(`answers '${spelling}' with the manifest's version`, async () => {
      const { code, out } = await captured([spelling]);
      expect(out).toBe(manifest.version);
      expect(code).toBe(0);
    });
  }

  it("is discoverable in the usage text", () => {
    // An undiscoverable flag is only half-shipped.
    expect(USAGE).toContain("--version");
  });

  it("does not print the usage text instead", () => {
    // The failure it replaces: the whole manual, which reads as a refusal.
    return captured(["--version"]).then(({ out }) => expect(out).not.toContain("Usage:"));
  });
});
