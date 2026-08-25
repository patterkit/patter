// ---------------------------------------------------------------------------
// The BUNDLED CLI, run as a user runs it. Everything else in this suite tests src; none of it can see
// a fault that only exists in the tsup bundle - and one shipped: pdfkit's default-font loader reads an
// AFM file via `__dirname`, which an ESM bundle does not define, so every `export-script` on the
// published npm CLI died with "__dirname is not defined". The unit suites stayed green throughout,
// because they import source, where node_modules and CJS `__dirname` both exist.
//
// Skips when dist/cli.js is absent (a source-only checkout); CI builds before testing, so the gate is
// real there. RELEASING.md lists it as a pre-ship step for the standalone binaries too.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, "../dist/cli.js");

describe.skipIf(!existsSync(cli))("the bundled dist/cli.js", () => {
  it("scaffolds a project and exports a PDF end to end", () => {
    const dir = mkdtempSync(join(tmpdir(), "patter-bundle-"));
    const proj = join(dir, "smoke.patter");
    execFileSync(process.execPath, [cli, "init", proj, "--name", "Smoke"], { cwd: dir });
    const pdf = join(dir, "smoke.pdf");
    execFileSync(process.execPath, [cli, "export-script", proj, "-o", pdf], { cwd: dir });
    const buf = readFileSync(pdf);
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });
});
