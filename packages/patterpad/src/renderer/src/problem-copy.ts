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
import type { ExtensionDto, ExtensionFieldDto, Problem } from "../../shared/api.js";

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
const quoted = (s: string): string => `“${s}”`;
const cap = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
const article = (s: string): string => (/^[aeiou]/i.test(s) ? "an" : "a");

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

/** A field inside a node's entry, by its label: "Note", "sound in cue", "item 2 of words". */
function fieldPhrase(fields: readonly ExtensionFieldDto[], path: string): string {
  const tokens = path.split(/\.|(?=\[)/).filter((t) => t !== "");
  const top = fields.find((f) => f.name === tokens[0]);
  const topLabel = top?.label ?? tokens[0] ?? "";
  if (tokens.length <= 1) return topLabel;
  const last = tokens[tokens.length - 1]!;
  const index = /^\[(\d+)\]$/.exec(last);
  if (index) return `item ${Number(index[1]) + 1} of ${topLabel}`;
  const parts = [...(top?.fields ?? []), ...(top?.of?.fields ?? [])];
  return `${parts.find((f) => f.name === last)?.label ?? last} in ${topLabel}`;
}

/** The sentence for one value a check refused, by the toolkit's code; undefined for a code it doesn't know. */
function valueSentence(code: string | undefined, field: string, node: string, message: string, name: string): { text: string; next?: string } | undefined {
  const on = `${field} on ${node}`;
  const value = /^"[^"]*" is "([^"]*)"/.exec(message)?.[1];
  switch (code) {
    case "required": return { text: `${node} needs ${article(field)} ${field}.` };
    case "wrong-type": return { text: `${on} isn't the kind of value ${name} expects.`, next: "Set it again in the inspector." };
    case "below-min": { const m = / is ([^,]+), below the least it may be, (.+)$/.exec(message); return m ? { text: `${on} is ${m[1]}, but ${name} takes nothing below ${m[2]}.` } : undefined; }
    case "above-max": { const m = / is ([^,]+), above the most it may be, (.+)$/.exec(message); return m ? { text: `${on} is ${m[1]}, but ${name} takes nothing above ${m[2]}.` } : undefined; }
    case "not-a-value":
      if (/not among its flags$/.test(message)) return { text: `${on} has a flag that isn't one of its choices.`, next: "Pick from the choices in the inspector." };
      return { text: `${on} is ${quoted(value ?? "")}, which isn't one of its choices.`, next: "Pick one in the inspector." };
    case "not-a-stage": return { text: `${on} is ${quoted(value ?? "")}, which isn't one of its stages.`, next: "Pick one in the inspector." };
    case "renamed-stage": {
      const m = / is "([^"]*)", a stage this extension has since renamed "([^"]*)"/.exec(message);
      return m ? { text: `${on} is ${quoted(m[1]!)}, a stage ${name} has since renamed ${quoted(m[2]!)}.`, next: `Pick ${quoted(m[2]!)} to update it.` } : undefined;
    }
    case "no-such-node": {
      const m = / (?:names|is keyed by) (\w+) "([^"]*)", which does not exist/.exec(message);
      return m ? { text: `${on} names the ${kindWord(m[1]!)} ${quoted(m[2]!)}, which isn't in the project.`, next: "Choose another, or clear it." } : undefined;
    }
    case "missing-id": return { text: `An item in ${field} on ${node} has no id.`, next: "Give it one in the inspector." };
    case "duplicate-id": { const id = / repeats the id "([^"]*)"/.exec(message)?.[1]; return { text: `Two items in ${field} on ${node} share the id ${quoted(id ?? "")}.`, next: "Give each its own." }; }
    case "unknown-field": case "unknown-key":
      return { text: `${node} has a value for ${quoted(field)}, which ${name} doesn't declare any more.`, next: "It's kept, but your game won't get it." };
    default: return undefined;
  }
}

/** The bar's line for a Patter extension's problem, or undefined to show the message as it is. */
export function extensionProblemLine(p: Pick<Problem, "message" | "detail" | "extension">, ctx: ExtensionProblemContext): string | undefined {
  const x = p.extension ? ctx.extension(p.extension) : undefined;
  const name = x?.name ?? (p.extension ? quoted(p.extension) : "This extension");
  const say = (c: { text: string; next?: string } | undefined): string | undefined =>
    c ? `${name}: ${cap(c.text)}${c.next ? ` ${c.next}` : ""}` : undefined;
  const m = p.message;

  // A node's entry: "entries.<kind>.<id>[.<path>]: <what's wrong>".
  const wrongScene = /^entries\.(\w+)\.(\S+) belongs (in the project's own shard|in scene "[^"]*"'s shard)/.exec(m);
  if (wrongScene) {
    return say({ text: `The values for ${nodePhrase(wrongScene[1]!, wrongScene[2]!, ctx)} are kept in another scene's file.`, next: "They're used all the same." });
  }
  const entry = /^entries\.(\w+)\.([^.:\s[]+)(\S*?): (.*)$/.exec(m);
  if (entry) {
    const [, kind, id, rest, said] = entry as unknown as [string, string, string, string, string];
    if (p.detail === "orphan") return say({ text: `There are values for ${article(kindWord(kind))} ${kindWord(kind)} that isn't in the project any more.`, next: "They're kept, but your game won't get them." });
    if (p.detail === "unresolved") return say({ text: `A merge left a clash in this data that hasn't been resolved.`, next: "Resolve it before you publish." });
    const path = rest.replace(/^\./, "");
    const field = fieldPhrase(x?.targets[kind]?.fields ?? [], path);
    return say(valueSentence(p.detail, field, nodePhrase(kind, id, ctx), said, name));
  }

  // A claimed gameData value: "<kind> '<id>' gameData "<field>", as the Patter extension "<x>" claims it: ...".
  const claim = /^(\w+) '([^']+)' gameData "([^"]+)", as the Patter extension "[^"]+" claims it: (.*)$/.exec(m);
  if (claim) {
    const [, kind, id, f, said] = claim as unknown as [string, string, string, string, string];
    const label = x?.targets[kind]?.claims.find((c) => c.field === f)?.decl.label ?? f;
    return say(valueSentence(p.detail, label, nodePhrase(kind, id, ctx), `"${f}" ${said.replace(/^the value /, "")}`, name));
  }

  // The project's side: its pin, its manifest, and its claims on gameData fields.
  const noManifest = /^the project takes the Patter extension "([^"]+)", but has no manifest for it/.exec(m);
  if (noManifest) return `This project takes the extension ${quoted(noManifest[1]!)}, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.`;
  const version = /^the project takes "[^"]+" (?:at version (\S+)|with no version), but its manifest is version ([^;]+);/.exec(m);
  if (version) {
    return say({ text: version[1] ? `The project takes version ${version[1]}, but the manifest is version ${version[2]}.` : `The project doesn't say which version it takes, and the manifest is version ${version[2]}.`, next: "Run patter format to take the manifest's version." });
  }
  const clash = /^the Patter extension "[^"]+" claims the (\w+) gameData field "([^"]+)" as (\w+), but the project declares it as (\w+)$/.exec(m);
  if (clash) return say({ text: `It reads the ${kindWord(clash[1]!)} game data field ${quoted(clash[2]!)} as ${clash[3]}, but the project declares it as ${clash[4]}.`, next: "Change the field's type in Project Settings ▸ Game Data so they agree." });
  const undeclared = /^the Patter extension "[^"]+" claims the (\w+) gameData field "([^"]+)", which the project doesn't declare$/.exec(m);
  if (undeclared) return say({ text: `It reads the ${kindWord(undeclared[1]!)} game data field ${quoted(undeclared[2]!)}, which the project doesn't declare.`, next: "Add it in Project Settings ▸ Game Data." });
  const notTaken = /^data for the Patter extension "([^"]+)", which the project doesn't take/.exec(m);
  if (notTaken) return `There's data here for the extension ${quoted(notTaken[1]!)}, which this project doesn't take. It's kept, but your game won't get it.`;
  return undefined;
}
