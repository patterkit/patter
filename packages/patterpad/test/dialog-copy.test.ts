// macOS open panels IGNORE `title`.
//
// Every folder or file requester the app opens carries a `title`, and on Windows and Linux that is the
// sentence the user reads. On macOS it is dropped: the panel renders the file browser, a confirm button
// reading "Open", and nothing else. A dialog whose only explanation lives in `title` therefore explains
// itself everywhere except on the platform most of these users are on.
//
// The two fields macOS DOES render are `message` (the line above the browser) and `buttonLabel` (the
// confirm button). Five of the eight open dialogs already carry all three, including both halves of the
// Merge a Returned Patterpack pair, where the second `message` exists precisely because "and now the one
// you SENT" is not obvious from a second identical file picker. Three had drifted off that convention.
//
// This is a source scan rather than a behavioural test because the drift is silent: a new dialog is one
// options object, `title` reads like the field that talks to the user, nothing goes red, and the fault is
// invisible unless you are on a Mac and looking. Reported from the Storylet Studio side, 2026-08-30,
// where the same drift had reached seven dialogs.
//
// SAVE dialogs are deliberately exempt. A save panel shows a filename field and an extension filter,
// which already say what is about to happen; holding them to this rule would be noise, and noise is how
// a gate gets weakened later.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const source = readFileSync(fileURLToPath(new URL("../src/main/index.ts", import.meta.url)), "utf8");

/** The options object of every `showOpenDialog(` call, brace-matched so nested objects (filters,
 *  properties) come along and the next call's options do not. */
function openDialogOptions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/showOpenDialog\(/g)) {
    const open = src.indexOf("{", m.index! + m[0].length);
    if (open < 0) continue;
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) { out.push(src.slice(open, i + 1)); break; }
    }
  }
  return out;
}

const label = (opts: string): string => opts.match(/title:\s*"([^"]+)"/)?.[1] ?? "(untitled)";

describe("what an open dialog says on macOS", () => {
  const dialogs = openDialogOptions(source);

  // Assert the scan FOUND them before asserting anything about them: renaming the call site should fail
  // this test rather than silently emptying it and passing.
  it("finds every open dialog in main", () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(8);
  });

  it("gives each one a message, which is the line macOS actually renders", () => {
    expect(dialogs.filter((d) => !/\bmessage:/.test(d)).map(label)).toEqual([]);
  });

  it("names each confirm button for the act, rather than leaving it 'Open'", () => {
    expect(dialogs.filter((d) => !/\bbuttonLabel:/.test(d)).map(label)).toEqual([]);
  });
});
