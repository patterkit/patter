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
// whose message is already writer-facing (not-in-project, spelling, hygiene,
// game-scopes, and an extension's, which names the entry and field it means),
// which fall through to the translator's fallback as they are.
// ---------------------------------------------------------------------------

import { defaultProblemCopy, describeProblem, problemName, type ProblemCopyTable, type ProblemLike } from "@wildwinter/app-shell";
import { PAD_AFTER_MIN, PAD_AFTER_MAX } from "@patterkit/model";
import { entryProblemLine, extensionLine, quoted } from "@wildwinter/app-shell/extension-copy";
import type { ExtensionDto, Problem } from "../../shared/api.js";

/** The sentence for each code, in Patter nouns (snippet, scene, choice, fallback, cast, prompt),
 *  over the family's defaults. A code the validator never raises costs nothing. */
export const PATTERPAD_PROBLEM_COPY: ProblemCopyTable = {
  ...defaultProblemCopy,
  "missing-prompt": () => ({ text: "This option needs a label.", next: "What does the player choose here?" }),
  "invalid-prompt": () => ({ text: "An option's label should be a single line." }),
  "unknown-character": (p) => ({ text: `${p.title ? problemName(p) : "This line's speaker"} isn't in your cast yet.` }),
  "unknown-qualifier": (p) => ({
    text: `${p.title ? `The qualifier ${problemName(p)}` : "This line's qualifier"} isn't one of the project's qualifiers.`,
    next: "Pick another, or add it in Project Settings.",
  }),
  "invalid-qualifier": () => ({
    text: "A speaker qualifier in Project Settings isn't set up properly.",
    next: "Each one needs a name and its own Game ID.",
  }),
  "invalid-gamedata-value": (p) => ({
    text: /not one of its stages/.test(p.message ?? "")
      ? "This node's game-data value is no longer one of its field's stages."
      : "This node's game-data value doesn't fit its field's type.",
    next: /not one of its stages/.test(p.message ?? "") ? "Choose the stage it belongs at now." : "Change it in the inspector, or clear it to use the field's default.",
  }),
  "invalid-pad": () => ({
    text: "This pause is outside the range Patter allows.",
    next: `Use a number of seconds from ${PAD_AFTER_MIN} to ${PAD_AFTER_MAX}.`,
  }),
  "pad-overlaps-seam": () => ({
    text: "This line ends its snippet, so nothing can cut in on it.",
    next: "It plays with no pause after it. Set the pause to 0 or more.",
  }),
  "prompt-pad-without-beat": () => ({
    text: "This option plays nothing after its prompt, so nothing can cut in on it.",
    next: "Add a line to the option, or set the prompt's pause to 0 or more.",
  }),
  "qualifier-without-speaker": () => ({
    text: "This line has a speaker qualifier but no speaker.",
    next: "Choose who says it, or remove the qualifier.",
  }),
  "empty-snippet": () => ({ text: "This snippet is empty.", next: "Add a line, or send it somewhere." }),
  "empty-container": () => ({ text: "This is empty.", next: "Add something inside it." }),
  "empty-scene": (p) => ({ text: `${p.title ? problemName(p) : "This scene"} has nothing in it yet.` }),
  "missing-name": (p) => ({ text: `${problemName(p)} needs a name.` }),
  "choice-can-empty": () => ({
    text: "This choice can run dry.",
    next: "Once each option is used up and there's no fallback, it has nothing left to show.",
  }),
  "multiple-fallbacks": () => ({ text: "A choice can have at most one fallback option." }),
  "jump-cycle": () => ({
    text: "These jumps go round in a loop with nothing in between.",
    next: "Add a line, a choice, or a condition somewhere in the loop, or the story gets stuck here.",
  }),
  "unreachable-after-jump": () => ({
    text: "This never plays: something before it always jumps away.",
    next: "Move it before the jump, or remove it.",
  }),
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
    case "not-in-project": case "spelling": case "hygiene": case "game-scopes": case "extensions": return undefined; // already writer-facing (#177)
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
 *  speaker of an unknown-character problem, the gameId of an unknown-qualifier one; the file, for a
 *  hygiene note, so the fallback names it. */
export function toProblemLike(p: Problem, path?: string): ProblemLike {
  const code = problemCode(p);
  const softened = code !== undefined || p.category === "structure" || p.category === "condition" || p.category === "interpolation";
  const speaker = code === "unknown-character" ? /'([^']+)' is not in the project cast/.exec(p.message)?.[1] : undefined;
  // An unknown qualifier is named by the gameId the line carries (the only name it still has).
  const qualifier = code === "unknown-qualifier" ? /qualifier '([^']+)' is not in the project's qualifiers/.exec(p.message)?.[1] : undefined;
  const title = speaker ?? qualifier ?? (p.category === "hygiene" ? path : undefined);
  return {
    ...(code !== undefined ? { code } : {}),
    message: softened ? softenProblemMessage(p.message) : p.message,
    ...(path !== undefined ? { path } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

/** The problems bar's one line for `p`: the sentence, then the next step. A Patter extension's problem is
 *  worded from what the editor knows of the project (`ext`): the extension's name, the node in the writer's
 *  words, and the field's label. */
export function problemLineFor(p: Problem, path?: string, ext?: ExtensionProblemContext): string {
  if (p.category === "extensions" && ext) {
    const line = extensionProblemLine(p, ext);
    if (line !== undefined) return line;
  }
  const { text, next } = describeProblem(toProblemLike(p, path), PATTERPAD_PROBLEM_COPY);
  return next ? `${text} ${next}` : text;
}

// --- Patter extensions ---------------------------------------------------------------------------------
// The compiler's extension pass words its problems for the command line: "entries.line.L_greet.cue.sound:
// "cue.sound" is required and not set". The bar says the same for the writer, keyed on the toolkit's code
// (the problem's `detail`) or, for the pass's own checks, the message's shape: the extension by its name,
// the node as the writer knows it, and the field by its label. A shape it doesn't know stands as it is.

/** What the bar knows to word an extension's problem. */
export interface ExtensionProblemContext {
  /** The extension, by id: its name and declarations. */
  extension(id: string): ExtensionDto | undefined;
  /** A node by id: its kind and the label the editor shows for it ("BARKEEP: What'll it be, stranger?"). */
  node(id: string): { kind: string; label: string } | undefined;
}

const KIND_WORD: Record<string, string> = {
  line: "line", text: "text", gameEvent: "game event", snippet: "snippet", option: "option", block: "block", scene: "scene",
  cast: "cast member", project: "project",
};
const kindWord = (kind: string): string => KIND_WORD[kind] ?? kind;
/** Where a writer changes an extension's value in Patterpad. */
const PLACE = "in the inspector";

/** A node as the writer knows it: a line or text by its words, a block or scene by its name. */
function nodePhrase(kind: string, id: string, ctx: ExtensionProblemContext): string {
  if (kind === "project") return "the project";
  const label = ctx.node(id)?.label;
  if (!label || label === id) return `the ${kindWord(kind)} ${id}`;
  if (kind === "line") { const said = /^[^:]+: (.+)$/.exec(label)?.[1]; return said ? quoted(said) : `${label}'s line`; }
  if (kind === "text") return quoted(label);
  if (kind === "snippet" || kind === "option") return `the ${kind} ${quoted(label)}`;
  return `the ${kindWord(kind)} ${label}`;
}

/** The bar's line for a Patter extension's problem, or undefined to show the message as it is. */
export function extensionProblemLine(p: Pick<Problem, "message" | "detail" | "extension">, ctx: ExtensionProblemContext): string | undefined {
  const x = p.extension ? ctx.extension(p.extension) : undefined;
  const name = x?.name ?? (p.extension ? quoted(p.extension) : "This extension");
  const say = (c: { text: string; next?: string } | undefined): string | undefined => extensionLine(name, c);
  const m = p.message;

  // A node's entry: "entries.<kind>.<id>[.<path>]: <what's wrong>".
  const wrongScene = /^entries\.(\w+)\.(\S+) belongs (in the project's own shard|in scene "[^"]*"'s shard)/.exec(m);
  if (wrongScene) {
    return say({ text: `The values for ${nodePhrase(wrongScene[1]!, wrongScene[2]!, ctx)} are kept in another scene's file.`, next: "They're used all the same." });
  }
  if (/^entries\./.test(m)) {
    return entryProblemLine(m, p.detail, {
      extension: name, fields: (kind) => x?.targets[kind]?.fields ?? [], node: (kind, id) => nodePhrase(kind, id, ctx),
      place: PLACE, kindWord,
    });
  }

  // The project's side: its pin and its manifest.
  const noManifest = /^the project takes the Patter extension "([^"]+)", but has no manifest for it/.exec(m);
  if (noManifest) return `This project takes the extension ${quoted(noManifest[1]!)}, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.`;
  const version = /^the project takes "[^"]+" (?:at version (\S+)|with no version), but its manifest is version ([^;]+);/.exec(m);
  if (version) {
    return say({ text: version[1] ? `The project takes version ${version[1]}, but the manifest is version ${version[2]}.` : `The project doesn't say which version it takes, and the manifest is version ${version[2]}.`, next: "Run patter format to take the manifest's version." });
  }
  if (/^the project's pin for "[^"]+" still has settings/.test(m)) {
    return say({ text: "The project file still gives it settings, which extensions no longer have.", next: "They're ignored, and you can delete them from the project file." });
  }
  // A name two of a pick's sources hold: "the Patter extension "<x>": "<name>" is <sources>, so a value naming it is ambiguous".
  const pickClash = /^the Patter extension "[^"]+": "([^"]*)" is (.+), so a value naming it is ambiguous$/.exec(m);
  if (pickClash) {
    const listLabel = (list: string): string => x?.targets["project"]?.fields.find((f) => f.name === list)?.label ?? list;
    const sources = pickClash[2]!.replace(/the list "([^"]*)"/g, (_, list: string) => `the list ${quoted(listLabel(list))}`);
    return say({ text: `${quoted(pickClash[1]!)} is ${sources}, so a value naming it is ambiguous.`, next: "Rename one of them." });
  }
  const notTaken = /^data for the Patter extension "([^"]+)", which the project doesn't take/.exec(m);
  if (notTaken) return `There's data here for the extension ${quoted(notTaken[1]!)}, which this project doesn't take. It's kept, but your game won't get it.`;
  return undefined;
}
