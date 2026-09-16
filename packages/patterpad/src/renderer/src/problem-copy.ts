// ---------------------------------------------------------------------------
// The problems bar's copy: every validator category Patterpad raises, rewritten
// for the writer at the keyboard, through the shell's translator
// (`describeProblem`, @wildwinter/app-shell/problems). The audience is writers,
// not engineers: a hand-written sentence and a next step per structural code,
// the two file-level categories mapped onto the family's own keys, and a
// fallback that softens the technical residue (spec citations dropped, `@prop`
// shown as “prop”). The CLI keeps the precise technical codes.
//
// Keying: a Patterpad Problem carries `category` + `detail`, not a `code`.
// `problemCode` derives the translator's key from the pair: the category for
// `stale-bundle` (-> "stale-build") and `merge` (-> "merge-conflict"), the
// validator's `detail` for the structural codes, and nothing for the categories
// whose message is already writer-facing (not-in-project, spelling, hygiene),
// which fall through to the translator's fallback as they are.
// ---------------------------------------------------------------------------

import { defaultProblemCopy, describeProblem, problemName, type ProblemCopyTable, type ProblemLike } from "@wildwinter/app-shell";
import type { Problem } from "../../shared/api.js";

/** The sentence for each code, in Patter nouns (snippet, scene, choice, fallback, cast, prompt),
 *  over the family's defaults. A code the validator never raises costs nothing. */
export const PATTERPAD_PROBLEM_COPY: ProblemCopyTable = {
  ...defaultProblemCopy,
  "missing-prompt": () => ({ text: "This option needs a label.", next: "What does the player choose here?" }),
  "invalid-prompt": () => ({ text: "An option's label should be a single line." }),
  "unknown-character": (p) => ({ text: `${p.title ? problemName(p) : "This line's speaker"} isn't in your cast yet.` }),
  "empty-snippet": () => ({ text: "This snippet is empty.", next: "Add a line, or send it somewhere." }),
  "empty-container": () => ({ text: "This is empty.", next: "Add something inside it." }),
  "empty-scene": (p) => ({ text: `${p.title ? problemName(p) : "This scene"} has nothing in it yet.` }),
  "missing-name": (p) => ({ text: `${problemName(p)} needs a name.` }),
  "choice-can-empty": () => ({
    text: "This choice can run dry.",
    next: "Once each option is used up and there's no fallback, it has nothing left to show.",
  }),
  "multiple-fallbacks": () => ({ text: "A choice can have at most one fallback option." }),
  "dangling-jump": () => ({ text: "This doesn't point anywhere valid.", next: "Choose where it goes." }),
  "jump-into-non-addressable": () => ({ text: "This doesn't point anywhere valid.", next: "Choose where it goes." }),
  "invalid-gameid": (p) => ({
    text: `${p.title ? `The Game ID on ${problemName(p)}` : "This Game ID"} isn't valid.`,
    next: "Use lowercase letters, digits and hyphens.",
  }),
  "duplicate-gameid": (p) => ({
    text: `${p.title ? `The Game ID on ${problemName(p)}` : "This Game ID"} is already used elsewhere.`,
    next: "Each one must be unique.",
  }),
  // A problem about a FILE names it, relative to the project: "this file" with no file was the one
  // thing a reader could not act on, since these have no node for "Go to issue" to reveal (2026-09-03).
  "stale-build": (p) => ({
    text: `Your playable build${p.path ? ` (${p.path})` : ""} is out of date.`,
    next: "It refreshes the next time you export.",
  }),
  "merge-conflict": (p) => ({ text: `${p.path ?? "This file"} still has an unresolved merge conflict in it.` }),
};

/** The translator's key for a Patterpad problem, or undefined when the message should stand as it is. */
export function problemCode(p: Pick<Problem, "category" | "detail">): string | undefined {
  switch (p.category) {
    case "stale-bundle": return "stale-build";
    case "merge": return "merge-conflict";
    case "not-in-project": case "spelling": case "hygiene": return undefined; // already writer-facing (#177)
    default: return p.detail;
  }
}

/** Soften a validator message's technical residue, keeping the gist: the fallback for a condition /
 *  interpolation problem (and any unmapped structural code). */
export function softenProblemMessage(message: string): string {
  return message
    .replace(/\s*\(spec §[^)]*\)/g, "")            // drop spec citations
    .replace(/'?@([A-Za-z0-9_.]+)'?/g, "“$1”")      // '@gold' / @gold -> “gold” (eat any wrapping quotes)
    .replace(/^unresolved property reference /i, "uses a property that isn't set up yet: ")
    .replace(/^unknown property( in interpolation slot)?:? /i, "uses a property that isn't set up yet: ")
    .replace(/ is not a declared property$/i, " isn't set up yet")
    .replace(/voiced line beats cannot contain interpolation/i, "voiced lines can't contain inserts");
}

/** A Patterpad problem as the shell translator reads it. `path` is the offending file as the project
 *  sees it (relative to its folder). The title is what the renderer can resolve from the message: the
 *  speaker of an unknown-character problem; the file, for a hygiene note, so the fallback names it. */
export function toProblemLike(p: Problem, path?: string): ProblemLike {
  const code = problemCode(p);
  const softened = code !== undefined || p.category === "structure" || p.category === "condition" || p.category === "interpolation";
  const speaker = code === "unknown-character" ? /'([^']+)' is not in the project cast/.exec(p.message)?.[1] : undefined;
  const title = speaker ?? (p.category === "hygiene" ? path : undefined);
  return {
    ...(code !== undefined ? { code } : {}),
    message: softened ? softenProblemMessage(p.message) : p.message,
    ...(path !== undefined ? { path } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

/** The problems bar's one line for `p`: the sentence, then the next step. */
export function problemLineFor(p: Problem, path?: string): string {
  const { text, next } = describeProblem(toProblemLike(p, path), PATTERPAD_PROBLEM_COPY);
  return next ? `${text} ${next}` : text;
}
