// ---------------------------------------------------------------------------
// The CLI shell: flag parsing edge cases and exit-code mapping (the ops behind
// the commands are tested in @patterkit/ops; this is the argv/print layer).
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs, main } from "../src/main.js";
import { parseSource } from "@patterkit/core";
import { setProvider, clearProvider } from "@wildwinter/simple-vc-lib";
import type { IVCProvider, VCStatus } from "@wildwinter/simple-vc-lib";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const lastError = () =>
  vi.mocked(console.error).mock.calls.map((c) => c.join(" ")).join("\n");

describe("parseArgs", () => {
  it("a boolean flag never consumes the next token", async () => {
    const { positionals, flags, errors } = parseArgs("format", ["--check", "a.patterflow"]);
    expect(flags.check).toBe(true);
    expect(positionals).toEqual(["a.patterflow"]);
    expect(errors).toEqual([]);
  });

  it("a valued flag always consumes the next token, even a negative number", async () => {
    const { flags, positionals } = parseArgs("play", ["--seed", "-5", "proj"]);
    expect(flags.seed).toBe("-5");
    expect(positionals).toEqual(["proj"]);
  });

  it("rejects unknown flags instead of silently ignoring them", async () => {
    const { errors } = parseArgs("play", ["--sceen", "x"]);
    expect(errors[0]).toContain("unknown flag '--sceen'");
  });

  it("rejects a valued flag with no value", async () => {
    const { errors } = parseArgs("export", ["proj", "-o"]);
    expect(errors[0]).toContain("-o needs a value");
  });
});

describe("main exit codes", () => {
  it("unknown command prints usage and exits 2", async () => {
    expect(await main(["frobnicate"])).toBe(2);
  });

  it("usage errors exit 2 before any work happens", async () => {
    expect(await main(["play", "--seed"])).toBe(2);
    expect(await main(["play", "proj", "--seed", "banana"])).toBe(2);
  });

  it("format --check exits 1 on a non-canonical file and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-fmt-"));
    const file = join(dir, "x.patterflow");
    writeFileSync(file, "{ b: 2, a: 1 }", "utf8");
    expect(await main(["format", "--check", file])).toBe(1);
    expect(readFileSync(file, "utf8")).toBe("{ b: 2, a: 1 }"); // untouched
    expect(await main(["format", file])).toBe(0);                    // now actually formats
    expect(await main(["format", "--check", file])).toBe(0);         // canonical now
  });

  it("a malformed source file exits 1 with the file path in the message", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "patter-cli-bad-")), "bad.patter");
    expect(await main(["init", dir, "--name", "Bad"])).toBe(0);
    const scene = join(dir, "scenes", "start.patterflow");
    writeFileSync(scene, "{ scene: ", "utf8"); // truncated JSON5
    expect(await main(["validate", dir])).toBe(1);
    expect(lastError()).toContain(scene); // names the offending file, not a bare SyntaxError
  });

  it("a playthrough that cannot finish exits 1 (CI gating)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-stall-"));
    mkdirSync(join(dir, "scenes"), { recursive: true });
    writeFileSync(join(dir, "stall.patterproj"), JSON.stringify({
      schema: "patter/project@0", project: { id: "p", name: "Stall" },
      locales: { default: "en", all: ["en"] },
      properties: [{ name: "never", type: "boolean", shared: true, default: false }],
    }));
    // A choice whose only option is greyed (ineligible, NOT hidden): the host
    // sees it but the auto-runner has nothing pickable - a stall.
    writeFileSync(join(dir, "scenes", "stall.patterflow"), JSON.stringify({
      schema: "patter/flow@0",
      scene: { id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "B", children: [
          { id: "g", type: "group", selector: "choice", children: [
            { id: "locked", type: "snippet", condition: "@never", choiceText: "C", jump: { to: "END" } },
          ] },
        ] },
      ] },
    }));
    expect(await main(["play", dir])).toBe(1);
  });

  it("usage finds where a property is referenced (and exits cleanly when unused)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-usage-"));
    mkdirSync(join(dir, "scenes"), { recursive: true });
    writeFileSync(join(dir, "u.patterproj"), JSON.stringify({
      schema: "patter/project@0", project: { id: "u", name: "U" },
      locales: { default: "en", all: ["en"] },
      properties: [{ name: "gold", type: "number", default: 0 }],
    }));
    writeFileSync(join(dir, "scenes", "s.patterflow"), JSON.stringify({
      schema: "patter/flow@0",
      scene: { id: "s", type: "scene", name: "S", blocks: [
        { id: "b", type: "block", name: "B", children: [
          { id: "n", type: "snippet", condition: "@gold >= 10", jump: { to: "END" } },
        ] },
      ] },
    }));
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((m?: unknown) => { lines.push(String(m)); });
    try {
      expect(await main(["usage", "@gold", dir])).toBe(0);
      expect(lines.some((l) => l.includes("if @gold >= 10"))).toBe(true);
      expect(await main(["usage", "@unused", dir])).toBe(0); // unused property → still exit 0
      expect(await main(["usage"])).toBe(2);                  // no query → arg error
    } finally { spy.mockRestore(); }
  });

  it("init + play round-trips through the real commands", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "patter-cli-init-")), "game.patter"); // already canonical
    expect(await main(["init", dir, "--name", "CLI Game"])).toBe(0);
    expect(await main(["validate", dir])).toBe(0);
    expect(await main(["play", dir])).toBe(0);
    expect(await main(["report", dir])).toBe(0);
    const xlsx = join(dir, "report.xlsx");
    expect(await main(["stats", dir, "--xlsx", xlsx])).toBe(0); // alias + spreadsheet view
    expect(readFileSync(xlsx).length).toBeGreaterThan(0);
    const both = join(dir, "both.xlsx");
    expect(await main(["report", dir, "--xlsx", both, "--json"])).toBe(0); // --xlsx honoured alongside --json
    expect(readFileSync(both).length).toBeGreaterThan(0);
    expect(await main(["init", dir])).toBe(1); // refuses to scaffold over an existing project
  });

  it("init appends .patter to a bare project name (the canonical project folder)", async () => {
    const base = mkdtempSync(join(tmpdir(), "patter-cli-ext-"));
    expect(await main(["init", join(base, "MyGame"), "--name", "My Game"])).toBe(0);
    expect(existsSync(join(base, "MyGame.patter", "my_game.patterproj"))).toBe(true);
    expect(existsSync(join(base, "MyGame"))).toBe(false); // not the bare folder
  });

  it("export writes the conventional dist/<name>.patterc by default; -o overrides; -o - is stdout", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "patter-cli-export-")), "game.patter");
    expect(await main(["init", dir, "--name", "Export Game"])).toBe(0);

    // No -o: the conventional path. Strict JSON (no trailing comma), parseable.
    expect(await main(["export", dir])).toBe(0);
    const def = join(dir, "dist", "export_game.patterc");
    const bundle = JSON.parse(readFileSync(def, "utf8"));
    expect(bundle.schema).toBe("patter/bundle@0");

    // -o <file> overrides the path.
    const custom = join(dir, "out.patterc");
    expect(await main(["export", dir, "-o", custom])).toBe(0);
    expect(JSON.parse(readFileSync(custom, "utf8")).schema).toBe("patter/bundle@0");

    // -o - goes to stdout (exit 0) and writes no file.
    const sw = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await main(["export", dir, "-o", "-"])).toBe(0);
    expect(sw).toHaveBeenCalled();
    sw.mockRestore();
  });

  it("mergetool: Patter source -> structured merge (BASE THEIRS OURS OUT order)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-mt-"));
    const loc = (s: Record<string, string>) => ({ schema: "patter/strings@0", scene: "s1", locale: "en", strings: s });
    writeFileSync(join(dir, "base.patterloc"), JSON.stringify(loc({ A: "a", B: "b" })));
    writeFileSync(join(dir, "theirs.patterloc"), JSON.stringify(loc({ A: "a", B: "b2" })));
    writeFileSync(join(dir, "ours.patterloc"), JSON.stringify(loc({ A: "a2", B: "b" })));
    const out = join(dir, "out.patterloc");
    const code = await main(["mergetool", join(dir, "base.patterloc"), join(dir, "theirs.patterloc"), join(dir, "ours.patterloc"), out]);
    expect(code).toBe(0); // disjoint edits auto-merge
    const text = readFileSync(out, "utf8");
    expect(text).toContain('"A": "a2"');
    expect(text).toContain('"B": "b2"');
  });

  it("mergetool: a non-Patter file runs --fallback and returns its exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-mt2-"));
    for (const f of ["base", "theirs", "ours", "out"]) writeFileSync(join(dir, `${f}.txt`), "x");
    const args = (cmd: string) => ["mergetool", "--fallback", cmd, join(dir, "base.txt"), join(dir, "theirs.txt"), join(dir, "ours.txt"), join(dir, "out.txt")];
    expect(await main(args("true"))).toBe(0);   // fallback succeeded
    expect(await main(args("false"))).toBe(1);  // fallback's exit code propagates
    expect(await main(["mergetool", "b.txt", "t.txt", "o.txt", "out.txt"])).toBe(2); // non-Patter, no fallback
  });
});

describe("loc-export / loc-import", () => {
  // A minimal en+fr project: one scene with a line + narration, a cast member with a display name.
  function makeLocProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "patter-cli-loc-"));
    for (const d of ["scenes", "loc/en", "loc/fr", "authoring"]) mkdirSync(join(dir, d), { recursive: true });
    const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));
    w("game.patterproj", { schema: "patter/project@0", project: { id: "loc", name: "Loc" },
      locales: { default: "en", all: ["en", "fr"] }, cast: [{ name: "ANNA", displayName: "Anna" }] });
    w("scenes/one.patterflow", { schema: "patter/flow@0", scene: { id: "s1", type: "scene", name: "Opening", blocks: [
      { id: "b1", type: "block", name: "Main", children: [
        { id: "n1", type: "snippet", beats: [{ id: "L1", kind: "line", character: "ANNA" }, { id: "T1", kind: "text" }], jump: { to: "END" } },
      ] } ] } });
    w("loc/en/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true, strings: { L1: "Hello", T1: "Narration" } });
    w("loc/fr/strings.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "fr", strings: { L1: "Bonjour" } });
    return dir;
  }

  it("requires --format and -o on export", async () => {
    const dir = makeLocProject();
    expect(await main(["loc-export", dir])).toBe(2);
    expect(await main(["loc-export", dir, "--format", "po"])).toBe(2);          // missing -o
    expect(await main(["loc-export", dir, "--format", "bogus", "-o", join(dir, "x.po")])).toBe(2);
  });

  it("exports a PO template (no --locale) and a per-locale PO", async () => {
    const dir = makeLocProject();
    const pot = join(dir, "strings.pot");
    expect(await main(["loc-export", dir, "--format", "po", "-o", pot])).toBe(0);
    const template = readFileSync(pot, "utf8");
    expect(template).toContain('msgctxt "L1"');
    expect(template).toContain('msgctxt "cast:ANNA"'); // the display-name string rides along
    expect(template).not.toContain('msgstr "Bonjour"');  // template has no translations

    const frPo = join(dir, "fr.po");
    expect(await main(["loc-export", dir, "--format", "po", "--locale", "fr", "-o", frPo])).toBe(0);
    expect(readFileSync(frPo, "utf8")).toContain('msgstr "Bonjour"');
  });

  it("round-trips via JSON: a translation imported back lands in the fr shard", async () => {
    const dir = makeLocProject();
    const jsonPath = join(dir, "fr.json");
    expect(await main(["loc-export", dir, "--format", "json", "--locale", "fr", "-o", jsonPath])).toBe(0);

    // Translate the previously-missing narration, then import.
    const cat = JSON.parse(readFileSync(jsonPath, "utf8")) as { entries: Array<{ id: string; translation: string }> };
    cat.entries.find((e) => e.id === "T1")!.translation = "Narration FR";
    writeFileSync(jsonPath, JSON.stringify(cat));
    expect(await main(["loc-import", jsonPath, dir, "--locale", "fr"])).toBe(0);

    const fr = parseSource(readFileSync(join(dir, "loc", "fr", "strings.patterloc"), "utf8")) as { strings: Record<string, string> };
    expect(fr.strings.T1).toBe("Narration FR"); // newly imported
    expect(fr.strings.L1).toBe("Bonjour");       // preserved
  });

  it("voice-export writes an xlsx (requires -o + a voiced project, #206)", async () => {
    const dir = makeLocProject();
    // Mark the line ready to record so the default filter keeps it.
    mkdirSync(join(dir, "authoring"), { recursive: true });
    writeFileSync(join(dir, "authoring", "one.patterx"), JSON.stringify({ schema: "patter/authoring@0", writing: { L1: "final" } }));
    const out = join(dir, "vo.xlsx");
    // A non-voiced project has no VO script - refused even with -o.
    expect(await main(["voice-export", dir, "-o", out])).toBe(2);
    // Mark the project voiced; now it exports.
    writeFileSync(join(dir, "game.patterproj"), JSON.stringify({ schema: "patter/project@0", project: { id: "loc", name: "Loc" },
      locales: { default: "en", all: ["en", "fr"] }, voiced: true, cast: [{ name: "ANNA", displayName: "Anna" }] }));
    expect(await main(["voice-export", dir])).toBe(2); // -o still required
    expect(await main(["voice-export", dir, "-o", out])).toBe(0);
    expect(readFileSync(out).subarray(0, 2).toString("latin1")).toBe("PK"); // xlsx (zip) magic
  });

  it("rejects an unknown import format and a source-locale import", async () => {
    const dir = makeLocProject();
    writeFileSync(join(dir, "bad.txt"), "x");
    expect(await main(["loc-import", join(dir, "bad.txt"), dir, "--locale", "fr"])).toBe(2);
    const jsonPath = join(dir, "en.json");
    expect(await main(["loc-export", dir, "--format", "json", "--locale", "fr", "-o", jsonPath])).toBe(0);
    expect(await main(["loc-import", jsonPath, dir, "--locale", "en"])).toBe(2); // en is the source locale
  });
});

// A minimal scriptable provider (the simple-vc-lib harness): refuse one path's checkout, ok for the rest.
const refusingProvider = (endsWith: string, status: VCStatus, message: string): IVCProvider => {
  const okR = { success: true, status: "ok" as VCStatus, message: "" };
  const prepareToWrite = (p: string) => (p.endsWith(endsWith) ? { success: false, status, message } : okR);
  const statusOf = (paths: string[]) => paths.map((filePath) => ({ filePath, system: "perforce" as const, writable: true }));
  return {
    name: "perforce",
    prepareToWrite, finishedWrite: () => okR, deleteFile: () => okR, deleteFolder: () => okR,
    renameFile: () => okR, renameFolder: () => okR, status: statusOf,
    // Async twins (0.2.0 IVCProvider).
    prepareToWriteAsync: (p) => Promise.resolve(prepareToWrite(p)),
    finishedWriteAsync: () => Promise.resolve(okR), deleteFileAsync: () => Promise.resolve(okR),
    deleteFolderAsync: () => Promise.resolve(okR), renameFileAsync: () => Promise.resolve(okR),
    renameFolderAsync: () => Promise.resolve(okR), statusAsync: (paths) => Promise.resolve(statusOf(paths)),
  };
};

describe("CLI writes through the configured VCS", () => {
  afterEach(() => clearProvider()); // never leak the override into the suites above

  it("init reports a VCS lock refusal (with who holds it) and exits 1, not a forced write", async () => {
    const parent = mkdtempSync(join(tmpdir(), "cli-vcs-"));
    setProvider(refusingProvider(".patterproj", "locked", "'project.patterproj' is locked by bob@bob-ws"));
    const code = await main(["init", join(parent, "story"), "--name", "Story"]);
    expect(code).toBe(1);
    expect(lastError()).toMatch(/locked by bob@bob-ws/);
  });
});
