// Every channel the bridge invokes has a handler, and every handler is reachable.
//
// The two halves of an IPC channel are a string literal typed out twice, in two files, with nothing
// between them: `ipcRenderer.invoke("identity:suggest")` in the preload and `ipcMain.handle
// ("identity:suggest")` in main. Nothing checks that the two spellings agree. A typo, or a handler
// renamed on one side of the wire, gives an unhandled-channel rejection at the moment the author
// clicks the thing - not at build time, not in a test, and only if somebody happens to click it.
//
// That is the same failure mode as the dead preload bridge (see preload-imports.test.ts): a control
// that is only known to be broken when a person tries it. This closes the other half of it.
//
// The reverse direction is a much smaller matter - a handler nothing invokes is dead weight rather
// than a fault - but it is free to check here, and it catches the rename that moved only one side.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Source with comments stripped. A commented-out call is not a call, and matching one would let a
 *  channel that had been disabled keep vouching for its opposite number. */
function code(url: string): string {
  return readFileSync(fileURLToPath(new URL(url, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^.*$/gm, (line) => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.slice(0, i);
    });
}

/** Channel names in `fn("some:channel"` calls. Deliberately literal-only: a computed channel would be
 *  invisible to this test, so the test also stands as a reason not to write one. */
const channels = (src: string, fn: string): string[] =>
  [...src.matchAll(new RegExp(`${fn}\\(\\s*["']([^"']+)["']`, "g"))].map((m) => m[1]!).sort();

const invoked = [...new Set(channels(code("../src/preload/index.ts"), "ipcRenderer\\.invoke"))];
const handled = [...new Set(channels(code("../src/main/index.ts"), "ipcMain\\.handle"))];

describe("the IPC channels the preload and main agree on", () => {
  it("finds them, so a silent regex change cannot make this test vacuously pass", () => {
    // Both counts are near a hundred. An empty set on either side would satisfy every assertion below.
    expect(invoked.length).toBeGreaterThan(50);
    expect(handled.length).toBeGreaterThan(50);
  });

  it("has a handler in main for every channel the bridge invokes", () => {
    // Failing here means a control in the app throws "No handler registered" when clicked.
    expect(invoked.filter((c) => !handled.includes(c))).toEqual([]);
  });

  it("has no handler in main that nothing invokes", () => {
    // Failing here is usually half of a rename, and the other half is the test above.
    expect(handled.filter((c) => !invoked.includes(c))).toEqual([]);
  });
});
