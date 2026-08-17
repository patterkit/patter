// The preload bridge is SANDBOXED, and that constrains what it may import.
//
// electron-vite auto-externalises everything in `dependencies`, so any runtime import here becomes a
// `require` the sandbox cannot serve: the script fails to load, `contextBridge` never runs, and
// `window.patter` is undefined. The app then opens to the welcome screen with every control dead, and
// the only clue is one line in DevTools. It builds clean and typechecks clean, so nothing before this
// test could see it.
//
// That happened: `import { JOB_PROGRESS } from "@wildwinter/app-shell/job"` shipped for eleven commits.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JOB_PROGRESS } from "@wildwinter/app-shell/job";

const source = readFileSync(fileURLToPath(new URL("../src/preload/index.ts", import.meta.url)), "utf8");

/** Every `import ...` line, with the type-only ones dropped: those are erased and cost nothing. */
function runtimeImports(src: string): string[] {
  return [...src.matchAll(/^import\s+(?!type\s)(.+?)\s+from\s+["']([^"']+)["'];?$/gm)].map((m) => m[2]!);
}

describe("the sandboxed preload's imports", () => {
  it("imports electron and nothing else at runtime", () => {
    // Adding a module here is not a style question. If it is not `electron`, the bridge stops loading
    // and the whole app goes dark. Inline the value, or move the work into main.
    expect(runtimeImports(source)).toEqual(["electron"]);
  });

  it("pins the job-progress channel against the shell's constant", () => {
    // The channel is a literal in the preload precisely because it cannot be imported, so this is what
    // stops the two drifting: main sends on the shell's constant and the bridge listens on the literal.
    const declared = /const JOB_PROGRESS = "([^"]+)"/.exec(source)?.[1];
    expect(declared).toBe(JOB_PROGRESS);
  });
});
