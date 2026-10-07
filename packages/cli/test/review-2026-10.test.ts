// ---------------------------------------------------------------------------
// The CLI review of October 2026 (patterkit design/patter-cli-review-2026-10.md): each test names the
// trigger of a finding at the CLI layer. The ops behind them are tested in @patterkit/ops.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs, main } from "../src/main.js";

let out: string[] = [], err: string[] = [];
beforeEach(() => {
  out = []; err = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { out.push(a.join(" ")); });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { err.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

const tmp = (): string => mkdtempSync(join(tmpdir(), "patter-cli-review-"));

describe("the family's flag grammar (ruling C)", () => {
  it("prints a command's usage for --help or -h, and runs nothing", async () => {
    for (const ask of ["--help", "-h"]) {
      out = [];
      expect(await main(["export", ask])).toBe(0);
      expect(out.join("\n")).toMatch(/^Usage:\n {2}patter export /);
    }
    expect(await main(["help", "fmt"])).toBe(0);
    expect(out.join("\n")).toContain("patter format");
  });

  it("treats every single-dash token as a flag, and `-` alone as a positional", () => {
    expect(parseArgs("validate", ["-q", "../other.patter"]).errors[0]).toContain("unknown flag '-q'");
    expect(parseArgs("format", ["-"]).positionals).toEqual(["-"]);
  });

  it("takes --flag=value, and refuses a value on a boolean", () => {
    expect(parseArgs("play", ["--seed=-5"]).flags.seed).toBe("-5");
    expect(parseArgs("format", ["--check=yes"]).errors[0]).toContain("--check takes no value");
  });

  it("refuses a stray positional and flags that contradict each other", () => {
    expect(parseArgs("validate", ["a", "b"]).errors[0]).toContain("unexpected argument: b");
    expect(parseArgs("merge", ["a", "b", "c", "--json", "-o", "x"]).errors[0]).toContain("cannot be used together");
    expect(parseArgs("suggestions", ["--json", "--accept-clean"]).errors[0]).toContain("cannot be used together");
  });

  it("prints every usage error under one prefix, with the command's short form", async () => {
    expect(await main(["unpack", "x.patterpack"])).toBe(2);
    expect(err).toEqual(["usage: -o <dir> is required", "usage: patter unpack <file> -o DIR [--merge --base SENT.patterpack]"]);
  });

  it("refuses a coverage run count that is not a whole number of at least one (item 24)", async () => {
    for (const runs of ["0", "-5", "1.5"]) expect(await main(["coverage", ".", "--runs", runs])).toBe(2);
  });
});

describe("merge as a git driver (item 2)", () => {
  const sides = (dir: string): string[] => {
    const loc = (s: Record<string, string>) => JSON.stringify({ schema: "patter/strings@0", scene: "s1", locale: "en", strings: s });
    const files = [["base", { A: "a" }], ["ours", { A: "ours" }], ["theirs", { A: "theirs" }]] as const;
    return files.map(([name, strings]) => { const p = join(dir, `${name}.patterloc`); writeFileSync(p, loc(strings)); return p; });
  };

  it("writes the sidecar beside --path, the real file, not beside git's temporary -o", async () => {
    const dir = tmp();
    const [base, ours, theirs] = sides(dir);
    const real = join(dir, "loc", "en", "s.patterloc");
    expect(await main(["merge", base!, ours!, theirs!, "-o", ours!, "--path", real])).toBe(1);
    expect(existsSync(`${real}.patterconflict`)).toBe(true);
    expect(existsSync(`${ours}.patterconflict`)).toBe(false);
    expect(readFileSync(ours!, "utf8")).toContain("ours");
  });
});
