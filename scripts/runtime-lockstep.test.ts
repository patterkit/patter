// The lockstep check under `npm test`, so a runtime manifest or version constant that's drifted fails locally, not
// only in CI.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("the Patterplay runtimes", () => {
  it("carry one version, in every manifest and version constant", () => {
    const script = fileURLToPath(new URL("./check-runtime-lockstep.mjs", import.meta.url));
    expect(() => execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" })).not.toThrow();
  });
});
