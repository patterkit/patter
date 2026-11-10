// Where a shipped example's copy goes (Help > Open an Example, the welcome's tiles). Most examples are one
// `.patter` folder. One whose audio root sits beside the project (the tour's `audioRoot: "../audio"`, the layout
// Patterpad seeds) needs that folder too, or the copy opens with no audio. Such an example goes into a folder
// named after it, holding the project and its audio side by side, so the copy keeps the layout it teaches and
// never lands on an `audio` folder already in the place the writer chose.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep, isAbsolute } from "node:path";
import { parseSource } from "@patterkit/core";
import { fileSafeName } from "../shared/file-name.js";

export interface ExampleCopyPlan {
  /** The folder the writer sees created: the `.patter` copy itself, or the wrapper folder holding it. */
  shown: string;
  /** The `.patter` copy, which is what opens. */
  project: string;
  /** Each tree to copy, source to destination: the project first. */
  copies: Array<{ from: string; to: string }>;
}

/** The project's audio root, read from its `.patterproj`, or undefined when it has none (or it can't be read). */
function audioRootOf(projectDir: string): string | undefined {
  try {
    const file = readdirSync(projectDir).find((f) => f.endsWith(".patterproj"));
    if (!file) return undefined;
    const root = (parseSource(readFileSync(join(projectDir, file), "utf8")) as { audioRoot?: unknown }).audioRoot; // the canonical form (trailing commas)
    return typeof root === "string" && root.trim() ? root.trim() : undefined;
  } catch { return undefined; }
}

/** Plan the copy of the example at `source` into `parent`, named `name` for its wrapper folder. An audio root
 *  inside the project travels with it anyway; one beside it (`../audio`) is copied beside the copy, inside the
 *  wrapper. One further away, or missing, is left behind: the copy then opens without audio, as before. */
export function planExampleCopy(source: string, parent: string, name: string): ExampleCopyPlan {
  const audioRoot = audioRootOf(source);
  const audio = audioRoot && !isAbsolute(audioRoot) ? resolve(source, audioRoot) : undefined;
  const beside = audio !== undefined && dirname(audio) === dirname(source) && audio !== source && existsSync(audio);
  if (!beside) {
    const project = join(parent, basename(source));
    return { shown: project, project, copies: [{ from: source, to: project }] };
  }
  const wrapper = join(parent, fileSafeName(name) || basename(source).replace(/\.patter$/i, ""));
  const project = join(wrapper, basename(source));
  const audioRel = relative(dirname(source), audio).split(sep).join("/");
  return { shown: wrapper, project, copies: [{ from: source, to: project }, { from: audio, to: join(wrapper, audioRel) }] };
}
