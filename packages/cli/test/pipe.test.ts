// ---------------------------------------------------------------------------
// The CLI as a real process with its stdout on a pipe: the one thing main()
// called in-process cannot see. `process.exit` ends the process at once, and
// on macOS a pipe is written asynchronously, so whatever had not drained was
// lost: `export -o -` and `--json` output stopped at exactly 64 KB, mid-JSON.
// On Linux a pipe is written synchronously, so CI passes either way; this test
// is for the platform the fault lives on.
//
// The entry is bundled here, from source, rather than read from dist/: the
// suite runs before the build, and a test of a stale dist proves nothing.
// Workspace packages resolve to their source, as vitest's own aliases do; the
// sibling libraries come from node_modules, as the shipped build takes them.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const WORKSPACE = ["model", "core", "dialect", "compiler", "runtime", "play-helpers", "ops"];
const BIG = 300_000; // well past the 64 KB a macOS pipe holds

let tmp: string;
let entry: string;
let project: string;
let loc: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "patter-pipe-"));
  entry = join(tmp, "cli.mjs");
  await build({
    entryPoints: [join(root, "packages", "cli", "src", "cli.ts")],
    outfile: entry,
    bundle: true,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    // tsup's banner, for the CommonJS dependencies that `require` node builtins.
    banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
    plugins: [{
      name: "workspace-source",
      setup(b) {
        b.onResolve({ filter: /^@patterkit\/[a-z-]+$/ }, (args) => {
          const name = args.path.slice("@patterkit/".length);
          return WORKSPACE.includes(name) ? { path: join(root, "packages", name, "src", "index.ts") } : undefined;
        });
      },
    }],
  });

  // A scaffolded project whose one line is longer than the pipe's buffer.
  project = join(tmp, "big.patter");
  execFileSync(process.execPath, [entry, "init", project, "--name", "Big"], { cwd: tmp });
  loc = join(project, "loc", "en", "start.patterloc");
  writeFileSync(loc, readFileSync(loc, "utf8").replace(/"Welcome[^"]*"/, JSON.stringify("x".repeat(BIG))));
}, 120_000);

afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

/** Run the bundled CLI with stdout on a pipe, and collect every byte it wrote. */
const piped = (argv: string[]): Promise<{ code: number | null; stdout: Buffer }> => new Promise((done, fail) => {
  const child = spawn(process.execPath, [entry, ...argv], { cwd: tmp, stdio: ["ignore", "pipe", "ignore"] });
  const chunks: Buffer[] = [];
  child.stdout.on("data", (c: Buffer) => chunks.push(c));
  child.on("error", fail);
  child.on("close", (code) => done({ code, stdout: Buffer.concat(chunks) }));
});

describe("stdout on a pipe", () => {
  it("export -o - arrives whole, byte for byte what -o FILE writes", async () => {
    const file = join(tmp, "big.patterc");
    execFileSync(process.execPath, [entry, "export", project, "-o", file], { cwd: tmp });
    const expected = readFileSync(file);
    expect(expected.length, "the fixture has to be bigger than the pipe's buffer").toBeGreaterThan(BIG);
    const r = await piped(["export", project, "-o", "-"]);
    expect(r.code).toBe(0);
    // Raw: what the serialiser wrote, with nothing added after it.
    expect(r.stdout.equals(expected)).toBe(true);
    expect(() => JSON.parse(r.stdout.toString("utf8"))).not.toThrow();
  }, 60_000);

  it("export-html -o - arrives whole", async () => {
    const file = join(tmp, "big.html");
    execFileSync(process.execPath, [entry, "export-html", project, "-o", file], { cwd: tmp });
    const r = await piped(["export-html", project, "-o", "-"]);
    expect(r.code).toBe(0);
    expect(r.stdout.equals(readFileSync(file))).toBe(true);
  }, 60_000);

  it("--json arrives whole: merge --json of a large strings file", async () => {
    const r = await piped(["merge", loc, loc, loc, "--json"]);
    expect(r.code).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(BIG);
    expect(() => JSON.parse(r.stdout.toString("utf8"))).not.toThrow();
  }, 60_000);
});
