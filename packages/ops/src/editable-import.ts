// ---------------------------------------------------------------------------
// Bringing an editable script back (patterkit/design/proposals/editable-script-handoff.md §6.1, §7).
//
// Takes what readEditableDocx found and decides what each piece means against the handoff record (what was
// sent) and the project (what is there now). Changed lines become Suggestions, the editor's remarks become
// Comments, and anything that can't be a suggestion becomes a comment quoting the editor's words: nothing
// they wrote is thrown away. Nothing in the script itself changes until somebody accepts a suggestion
// (or, with `direct`, the clean ones are accepted on the way in).
//
// Pure: the plan carries every write, the authoring shards and the handoff record's import log, for the
// caller to commit through VC in one go (all or nothing, under lock-based VCS).
// ---------------------------------------------------------------------------

import { canonicalStringify } from "@patterkit/core";
import type { AuthoringFile, Comment, HandoffFile, HandoffRow, Suggestion } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import type { PlannedWrite } from "./write.js";
import type { ReadBox, ReadItem, ReadText, ReturnedDoc } from "./docx-read.js";
import { readHandoff, handoffWrite } from "./handoff.js";
import type { Random } from "./handoff.js";
import { sourceStrings } from "./loaded-helpers.js";
import { authoringPath } from "./localisation.js";
import { applySuggestionDecisions, indexPlaces } from "./suggestions.js";
import { AUTHORING_SCHEMA, projectQualifiers } from "@patterkit/model";
import type { CastMember, SpeakerQualifier } from "@patterkit/model";

export interface ImportOptions {
  /** Who is importing (the import log). */
  by: string;
  /** The name changes without a recorded author are credited to (the dialog's "Edits by"): the
   *  handoff's recipient when absent. */
  as?: string;
  /** Count curly versus straight quotes and `...` versus `…` as edits (off: they're a tool's habit). */
  strictQuotes?: boolean;
  /** Accept the clean suggestions (not stale, no problems) on the way in, instead of leaving them open. */
  direct?: boolean;
  /** SHA-256 of the returned file, for the import log. */
  fileHash: string;
  now?: string;
  random?: Random;
}

/** Something about the returned file the person importing should know. */
export interface ImportProblem {
  severity: "warning" | "info";
  kind:
    | "damaged-marker" | "repaired-marker" | "duplicate-marker" | "missing-box" | "moved" | "placeholders"
    | "line-gone" | "unknown-speaker" | "unknown-qualifier" | "added-text" | "context-edited" | "untracked-edits" | "joined-paragraphs"
    | "dropped-formatting" | "stale";
  message: string;
  /** The project line or node it concerns, for "Go to". */
  anchor?: string;
  marker?: string;
}

export interface ImportReport {
  handoffId?: string;
  /** Set when nothing was imported, saying why. */
  refused?: string;
  counts: { changed: number; unchanged: number; stale: number; comments: number; problems: number };
  problems: ImportProblem[];
}

export interface ImportPlan {
  report: ImportReport;
  /** The suggestions and comments this import adds (also inside `writes`). */
  suggestions: Suggestion[];
  comments: Comment[];
  /** Authoring shards (and, with `direct`, the loc and flow shards the accepts touch) plus the handoff
   *  record with this import logged. Empty when refused. */
  writes: PlannedWrite[];
  /** The handoff this file belongs to, when found. */
  handoff?: HandoffFile;
}

/** The share of a handoff's lines that may come back missing or damaged before the file is refused. */
export const REFUSE_MISSING_SHARE = 0.25;

// ---------------------------------------------------------------------------
// Normalisation and the small text rules
// ---------------------------------------------------------------------------

/** Tidy what tools do to text without anyone meaning it: spacing, non-breaking spaces, soft breaks. */
const tidy = (s: string): string => s.replace(/[\s   ]+/g, " ").trim();
/** Tidy, and fold quote style unless it counts. */
function normalise(s: string, strictQuotes: boolean): string {
  const t = tidy(s);
  return strictQuotes ? t : t.replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, "\"").replace(/…/g, "...");
}
/** The `{@…}` placeholders in a text, sorted, as a multiset. */
const placeholders = (s: string): string[] => [...s.matchAll(/\{@[^}]*\}/g)].map((m) => m[0]).sort();
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Inline `[[notes]]` the editor added (any already in the line as sent are the line's own text). */
function takeNotes(text: string, baseline: string): { text: string; notes: string[] } {
  const notes: string[] = [];
  const out = text.replace(/\[\[([\s\S]*?)\]\]/g, (whole, note: string) => {
    if (baseline.includes(whole)) return whole;
    if (note.trim()) notes.push(note.trim());
    return " ";
  });
  return { text: notes.length ? tidy(out) : out, notes };
}

/** Patter's markup taken out, for a reader-facing quote. */
const plainText = (s: string): string => s.replace(/<\/?(?:b|i|bi)>/g, "");
const quote = (s: string): string => `“${plainText(tidy(s))}”`;

/** The words a context row shows in the document, as the exporter wrote them (script-docx.ts). */
function shownAs(row: Extract<HandoffRow, { node: string }>): string[] {
  switch (row.kind) {
    case "condition": return [`‹ ${row.text} ›`];
    case "jump": return [`↪ ${row.text}`, `↪ ${row.text} (not in this document)`];
    case "gameEvent": return [`⚙ ${row.text}`];
    case "note": return [`Note: ${row.text}`];
    default: return [row.text]; // scene, block, group label, else (case is styling)
  }
}
const loose = (s: string): string => tidy(plainText(s)).toLowerCase();

// ---------------------------------------------------------------------------

/** Plan an import. Reads the handoff record named in the document from the project. */
export function planEditableImport(loaded: LoadedProject, returned: ReturnedDoc, opts: ImportOptions): ImportPlan {
  const now = opts.now ?? new Date().toISOString();
  const random = opts.random ?? Math.random;
  const rid = (prefix: string): string => `${prefix}_${Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("")}`;
  const problems: ImportProblem[] = [];
  const refuse = (why: string, handoff?: HandoffFile): ImportPlan => ({
    report: { ...(returned.handoffId ? { handoffId: returned.handoffId } : {}), refused: why, counts: { changed: 0, unchanged: 0, stale: 0, comments: 0, problems: 0 }, problems },
    suggestions: [], comments: [], writes: [], ...(handoff ? { handoff } : {}),
  });

  // §7.1: whose file is this?
  if (!returned.handoffId) return refuse("This file has no handoff id in its page header, so it can't be matched to what was sent.");
  let handoff: HandoffFile | undefined;
  try { handoff = readHandoff(loaded.root, returned.handoffId); }
  catch (e) { return refuse(`The handoff record ${returned.handoffId} is damaged: ${e instanceof Error ? e.message : String(e)}`); }
  if (!handoff) return refuse(`Handoff ${returned.handoffId} isn't in this project. Was it exported from another one?`);

  const fallbackAuthor = opts.as?.trim() || handoff.recipient || "Editor";
  const codes = Object.keys(handoff.lines);
  const boxOrder = handoff.skeleton.filter((r): r is Extract<HandoffRow, { kind: "box" }> => r.kind === "box").map((r) => r.marker);
  const orderOf = new Map(boxOrder.map((c, i) => [c, i]));

  // ---- Markers: claim, find duplicates, repair damaged ones from their position (§7.3) ----
  const boxes = returned.items.filter((i): i is ReadBox => i.kind === "box");
  const byCode = new Map<string, ReadBox[]>();
  const damaged: ReadBox[] = [];
  for (const b of boxes) {
    if (b.marker?.valid && handoff.lines[b.marker.code]) (byCode.get(b.marker.code) ?? byCode.set(b.marker.code, []).get(b.marker.code)!).push(b);
    else damaged.push(b);
  }
  const codeOfBox = new Map<ReadBox, string>();
  for (const [code, list] of byCode) if (list.length === 1) codeOfBox.set(list[0]!, code);
  for (const b of damaged) {
    // The valid boxes either side of it in the document bound where it could have come from.
    const at = boxes.indexOf(b);
    const before = boxes.slice(0, at).reverse().find((x) => codeOfBox.has(x));
    const after = boxes.slice(at + 1).find((x) => codeOfBox.has(x));
    const lo = before ? orderOf.get(codeOfBox.get(before)!)! : -1;
    const hi = after ? orderOf.get(codeOfBox.get(after)!)! : boxOrder.length;
    const free = boxOrder.slice(lo + 1, hi).filter((c) => !byCode.has(c));
    const rivals = damaged.filter((d) => {
      const i = boxes.indexOf(d);
      return i > (before ? boxes.indexOf(before) : -1) && i < (after ? boxes.indexOf(after) : boxes.length);
    });
    if (free.length === 1 && rivals.length === 1) {
      codeOfBox.set(b, free[0]!); byCode.set(free[0]!, [b]);
      problems.push({ severity: "info", kind: "repaired-marker", marker: free[0]!, anchor: handoff.lines[free[0]!]!.id, message: `A damaged marker${b.marker ? ` [#${b.marker.code}]` : ""} was matched to its line by position.` });
    }
  }

  const missing = codes.filter((c) => !byCode.has(c));
  const unrepaired = damaged.filter((b) => !codeOfBox.has(b));
  if (codes.length && (missing.length + unrepaired.length) / codes.length > REFUSE_MISSING_SHARE) {
    return refuse(`${missing.length} of ${codes.length} lines are missing from the returned file${unrepaired.length ? `, and ${unrepaired.length} came back with damaged markers` : ""}. It looks retyped or not the file that was sent, so nothing was imported.`, handoff);
  }

  // ---- The project as it is now ----
  const places = indexPlaces(loaded);
  const live = sourceStrings(loaded);
  const cast = loaded.project.cast ?? [];
  const qualifiers = projectQualifiers(loaded.project);

  const suggestions: Suggestion[] = [];
  const comments: Comment[] = [];
  let unchanged = 0, stale = 0;

  /** The nearest line that still exists in the project, at or before box index `i` (else after). */
  const nearestLine = (fromBox: number): string | undefined => {
    for (let i = fromBox; i >= 0; i--) { const c = codeOfBox.get(boxes[i]!); const id = c && handoff!.lines[c]!.id; if (id && places.has(id)) return id; }
    for (let i = fromBox + 1; i < boxes.length; i++) { const c = codeOfBox.get(boxes[i]!); const id = c && handoff!.lines[c]!.id; if (id && places.has(id)) return id; }
    return handoff!.range.scenes.find((s) => places.has(s));
  };
  const comment = (anchor: string | undefined, author: string, body: string, ts = now, replies: Array<{ author: string; date?: string; text: string }> = []): void => {
    if (!anchor) return;
    comments.push({ id: rid("cmt"), anchor, messages: [{ author, ts, body }, ...replies.map((r) => ({ author: r.author, ts: r.date ?? ts, body: r.text }))] });
  };

  // Duplicates: neither applied, both texts kept.
  for (const [code, list] of byCode) {
    if (list.length < 2) continue;
    const line = handoff.lines[code]!;
    problems.push({ severity: "warning", kind: "duplicate-marker", marker: code, anchor: line.id, message: `[#${code}] appears ${list.length} times (a copied box). Neither copy was applied; both are in a comment.` });
    comment(places.has(line.id) ? line.id : nearestLine(boxes.indexOf(list[0]!)), fallbackAuthor,
      `This line came back ${list.length} times: ${list.map((b) => quote(b.text.proposed)).join(" and ")}.`);
  }

  // Boxes gone entirely: a comment, never a cut.
  for (const code of missing) {
    const line = handoff.lines[code]!;
    problems.push({ severity: "warning", kind: "missing-box", marker: code, anchor: line.id, message: `The line ${quote(line.baseline)} is missing from the returned file.` });
    if (places.has(line.id)) comment(line.id, fallbackAuthor, `This line's box was deleted in the returned document (it read ${quote(line.baseline)}).`);
  }

  // Damaged markers that couldn't be matched: their words become a comment.
  for (const b of unrepaired) {
    problems.push({ severity: "warning", kind: "damaged-marker", ...(b.marker ? { marker: b.marker.code } : {}), message: `A box came back with a damaged marker and couldn't be matched to its line: ${quote(b.text.proposed)}.` });
    comment(nearestLine(boxes.indexOf(b)), fallbackAuthor, `A line near here came back with a damaged marker. Its words were: ${quote(b.text.proposed)}`);
  }

  // Moved boxes: the ones outside the longest run still in their sent order.
  const claimed = boxes.filter((b) => codeOfBox.has(b) && byCode.get(codeOfBox.get(b)!)!.length === 1);
  const inOrder = longestIncreasing(claimed.map((b) => orderOf.get(codeOfBox.get(b)!)!));
  claimed.forEach((b, i) => {
    if (inOrder.has(i)) return;
    const code = codeOfBox.get(b)!, line = handoff!.lines[code]!;
    const prev = claimed[i - 1];
    const after = prev ? `after ${quote(handoff!.lines[codeOfBox.get(prev)!]!.baseline)}` : "to the start";
    problems.push({ severity: "warning", kind: "moved", marker: code, anchor: line.id, message: `The editor moved this line ${after}.` });
    if (places.has(line.id)) comment(line.id, fallbackAuthor, `The editor moved this line ${after}.`);
  });

  // ---- Each claimed box: §7.2 and §6.1 ----
  for (const b of claimed) {
    const code = codeOfBox.get(b)!, sent = handoff.lines[code]!;
    const here = places.has(sent.id) ? sent.id : undefined;
    const changeAuthors = rankAuthors([...b.text.changes, ...b.lead.changes]);
    const author = changeAuthors[0] ?? fallbackAuthor;
    const ts = latest([...b.text.changes, ...b.lead.changes]) ?? now;

    if (b.paragraphs > 1) problems.push({ severity: "info", kind: "joined-paragraphs", marker: code, anchor: sent.id, message: "An Enter inside this box was joined into one line." });
    if (b.text.droppedFormatting) problems.push({ severity: "info", kind: "dropped-formatting", marker: code, anchor: sent.id, message: "Formatting other than bold and italic was dropped." });

    // The words: notes out, then compare.
    const { text: proposedRaw, notes } = takeNotes(b.rowDeleted ? "" : b.text.proposed, sent.baseline);
    const proposed = tidy(proposedRaw);
    const textChanged = normalise(proposed, !!opts.strictQuotes) !== normalise(sent.baseline, !!opts.strictQuotes);
    const tracked = b.text.changes.length > 0;
    if (tracked && normalise(b.text.original, !!opts.strictQuotes) !== normalise(sent.baseline, !!opts.strictQuotes)) {
      problems.push({ severity: "info", kind: "untracked-edits", marker: code, anchor: sent.id, message: "This line has tracked changes and some untracked ones too, so the credit may be incomplete." });
    }

    // The cue (speaker and speaker qualifier) and direction (spoken lines).
    const cue = sent.kind === "line" ? readLead(b.lead.proposed) : undefined;
    let proposedCharacter: string | undefined, proposedQualifier: string | undefined, proposedDirection: string | undefined;
    if (sent.kind === "line" && cue) {
      const read = readCue(cue.character, sent.character ?? "", sent.qualifier ?? "", cast, qualifiers);
      if (read.unknownSpeaker !== undefined) {
        problems.push({ severity: "warning", kind: "unknown-speaker", marker: code, anchor: sent.id, message: `The speaker was changed to ${read.unknownSpeaker}, who isn't in the cast; it's in a comment.` });
        comment(here ?? nearestLine(boxes.indexOf(b)), author, `Speaker changed from ${sentCue(sent.character, sent.qualifier, qualifiers) || "(none)"} to ${read.unknownSpeaker}, who isn't in the cast.`, ts);
      }
      if (read.unknownQualifier !== undefined) {
        problems.push({ severity: "warning", kind: "unknown-qualifier", marker: code, anchor: sent.id, message: `The speaker qualifier was changed to (${read.unknownQualifier}), which isn't one of the project's qualifiers; it's in a comment.` });
        comment(here ?? nearestLine(boxes.indexOf(b)), author, `Speaker changed from ${sentCue(sent.character, sent.qualifier, qualifiers) || "(none)"} to ${tidy(cue.character)}, but (${read.unknownQualifier}) isn't one of the project's qualifiers.`, ts);
      }
      if (read.character !== undefined && read.character !== (sent.character ?? "")) proposedCharacter = read.character;
      if (read.qualifier !== undefined && read.qualifier !== (sent.qualifier ?? "")) proposedQualifier = read.qualifier;
      if (tidy(cue.direction) !== tidy(sent.direction ?? "")) proposedDirection = tidy(cue.direction);
    }
    const cueChanged = !!proposedCharacter || proposedQualifier !== undefined || proposedDirection !== undefined;

    for (const note of notes) comment(here ?? nearestLine(boxes.indexOf(b)), author, note, ts);

    if (!here) {
      if (textChanged || cueChanged) {
        problems.push({ severity: "warning", kind: "line-gone", marker: code, message: `The line ${quote(sent.baseline)} is no longer in the project; the editor's version is in a comment nearby.` });
        comment(nearestLine(boxes.indexOf(b)), author, `For a line no longer in the project (${quote(sent.baseline)}), the editor wrote: ${quote(proposed)}`, ts);
      } else unchanged++;
      continue;
    }

    // Emptied: a cut suggestion, never an empty line.
    if (proposed === "" && sent.baseline.trim() !== "") {
      suggestions.push(suggestion({ proposed: sent.baseline, proposedCut: true }));
      continue;
    }

    // Placeholders must come back exactly.
    if (textChanged && !sameList(placeholders(proposed), placeholders(sent.baseline))) {
      problems.push({ severity: "warning", kind: "placeholders", marker: code, anchor: sent.id, message: `The {@…} placeholders changed, so this line wasn't suggested; the editor's version is in a comment.` });
      comment(here, author, `The editor's version changes the {@…} placeholders (${placeholders(sent.baseline).join(", ") || "none"} became ${placeholders(proposed).join(", ") || "none"}), so it wasn't made a suggestion: ${quote(proposed)}`, ts);
      if (!cueChanged) continue;
    }
    const keepText = textChanged && sameList(placeholders(proposed), placeholders(sent.baseline));

    if (!keepText && !cueChanged) { unchanged++; continue; }
    suggestions.push(suggestion({
      proposed: keepText ? proposed : sent.baseline,
      ...(proposedCharacter ? { proposedCharacter, baselineCharacter: sent.character ?? "" } : {}),
      ...(proposedQualifier !== undefined ? { proposedQualifier, baselineQualifier: sent.qualifier ?? "" } : {}),
      ...(proposedDirection !== undefined ? { proposedDirection, baselineDirection: sent.direction ?? "" } : {}),
    }));

    function suggestion(parts: Partial<Suggestion> & { proposed: string }): Suggestion {
      const isStale = (live[sent.id] ?? "") !== sent.baseline;
      if (isStale) { stale++; problems.push({ severity: "info", kind: "stale", marker: code, anchor: sent.id, message: "This line has changed in the project since it was sent; its suggestion will show as out of date." }); }
      return {
        id: rid("sg"), anchor: sent.id, baseline: sent.baseline, author, ...(changeAuthors.length > 1 ? { authors: changeAuthors } : {}), ts,
        handoff: { id: handoff!.id, marker: code }, ...parts,
      };
    }
  }

  // ---- Paragraphs: comments on context rows, edited rows, and text added outside the boxes ----
  const anchorOfItem = alignParagraphs(returned.items, handoff.skeleton, codeOfBox, (item, row) => {
    // A context row the editor changed.
    if (!places.has(row.node)) return;
    problems.push({ severity: "warning", kind: "context-edited", anchor: row.node, message: `The editor changed ${quote(row.text)} to ${quote(item.text.proposed)}; it's a comment, since only the boxes are edited.` });
    comment(row.node, rankAuthors(item.text.changes)[0] ?? fallbackAuthor, `Changed in the document from ${quote(row.text)} to ${quote(item.text.proposed)}.`, latest(item.text.changes) ?? now);
  }, (item, nearBox) => {
    // Text typed outside every box.
    const anchor = nearestLine(nearBox);
    problems.push({ severity: "warning", kind: "added-text", ...(anchor ? { anchor } : {}), message: `The editor added text outside the boxes: ${quote(item.text.proposed)}; it's a comment on the line before.` });
    comment(anchor, rankAuthors(item.text.changes)[0] ?? fallbackAuthor, `Editor added: ${quote(item.text.proposed)}`, latest(item.text.changes) ?? now);
  }, (code) => handoff!.lines[code]?.id);

  // ---- The document's own comments: on the line or node where each starts (§7.5) ----
  for (const c of returned.comments) {
    const anchor = anchorOfItem.get(c.id);
    const where = anchor && places.has(anchor) ? anchor : undefined;
    if (!where) { problems.push({ severity: "info", kind: "added-text", message: `A comment by ${c.author || fallbackAuthor} wasn't on any line of the script (the front page?): ${quote(c.text)}` }); continue; }
    comment(where, c.author || fallbackAuthor, c.text, c.date ?? now, c.replies);
  }

  // ---- Writes: authoring shards, per scene; open suggestions from an earlier import of this handoff go ----
  const shards = new Map<string, AuthoringFile>();
  const shardFor = (anchor: string): AuthoringFile => {
    const path = authoringPath(loaded, places.get(anchor)!.sceneId);
    let af = shards.get(path);
    if (!af) {
      const i = loaded.authoringFiles.indexOf(path);
      af = i >= 0 ? structuredClone(loaded.authoring[i]!) : { schema: AUTHORING_SCHEMA };
      shards.set(path, af);
    }
    return af;
  };
  loaded.authoringFiles.forEach((path, i) => {
    const af = loaded.authoring[i]!;
    if ((af.suggestions ?? []).some((s) => s.handoff?.id === handoff!.id && !s.resolved)) {
      const copy = shards.get(path) ?? structuredClone(af);
      copy.suggestions = (copy.suggestions ?? []).filter((s) => !(s.handoff?.id === handoff!.id && !s.resolved));
      shards.set(path, copy);
    }
  });
  for (const s of suggestions) { const af = shardFor(s.anchor); af.suggestions = [...(af.suggestions ?? []), s]; }
  for (const c of comments) { const af = shardFor(c.anchor); af.comments = [...(af.comments ?? []), c]; }

  let writes: PlannedWrite[] = [...shards].map(([path, af]) => ({ path, content: canonicalStringify(af) }));

  // `direct`: accept the clean ones (not stale, no warning on their line) on the way in.
  if (opts.direct && suggestions.length) {
    const warned = new Set(problems.filter((p) => p.severity === "warning" && p.anchor).map((p) => p.anchor!));
    const clean = suggestions.filter((s) => (live[s.anchor] ?? "") === s.baseline && !warned.has(s.anchor));
    if (clean.length) {
      const withSuggestions: LoadedProject = { ...loaded, authoringFiles: [...loaded.authoringFiles], authoring: [...loaded.authoring] };
      for (const [path, af] of shards) {
        const i = withSuggestions.authoringFiles.indexOf(path);
        if (i >= 0) withSuggestions.authoring[i] = af; else { withSuggestions.authoringFiles.push(path); withSuggestions.authoring.push(af); }
      }
      const decided = applySuggestionDecisions(withSuggestions, clean.map((s) => ({ id: s.id, accept: true })), { now, by: opts.by });
      const byPath = new Map(writes.map((w) => [w.path, w]));
      for (const w of decided.writes) byPath.set(w.path, w);
      writes = [...byPath.values()];
    }
  }

  const counts = { changed: suggestions.length, unchanged, stale, comments: comments.length, problems: problems.filter((p) => p.severity === "warning").length };
  const logged: HandoffFile = { ...handoff, imports: [...(handoff.imports ?? []), { at: now, by: opts.by, fileHash: opts.fileHash, counts }] };
  writes.push(handoffWrite(loaded.root, logged));
  writes.sort((a, b) => a.path.localeCompare(b.path));

  return { report: { handoffId: handoff.id, counts, problems }, suggestions, comments, writes, handoff: logged };
}

// ---------------------------------------------------------------------------

/** A lead cell's cue and direction, as the exporter wrote them: "CUE", then "(direction)" on its own line. */
function readLead(text: string): { character: string; direction: string } {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const direction = lines.find((l) => /^\(.*\)$/s.test(l));
  const character = lines.find((l) => l !== direction) ?? "";
  return { character, direction: direction ? direction.slice(1, -1) : "" };
}

/** What a returned cue says, read against the cast and the project's qualifiers. `character` and `qualifier`
 *  (a `gameId`, "" for none) are set only for what could be read; `unknownSpeaker` and `unknownQualifier`
 *  carry what couldn't, as written. */
interface ReadCue { character?: string; qualifier?: string; unknownSpeaker?: string; unknownQualifier?: string }

/** The cue as the exporter printed it for a speaker and qualifier (`TAM (O.S.)`), for comparing and quoting. */
function sentCue(character: string | undefined, qualifier: string | undefined, qualifiers: SpeakerQualifier[]): string {
  if (!character) return "";
  if (!qualifier) return character;
  return `${character} (${qualifiers.find((q) => q.gameId === qualifier)?.name ?? qualifier})`;
}

/**
 * Read a returned cue. A cue that still reads as sent (case aside) changes nothing, so a cast member whose
 * name looks like a qualified cue round-trips untouched. Otherwise the WHOLE cue is matched against the cast
 * first: an exact cast name wins, since a cast name may itself hold brackets, and means no qualifier. Only
 * when nothing matches is a trailing `(…)` split off: the rest must be a cast member (or the speaker as
 * sent), and the bracket one of the project's qualifier names, both case-insensitively as the speaker
 * always was. A bracket that names no qualifier is reported, and the speaker before it is still read.
 */
function readCue(text: string, sentCharacter: string, sentQualifier: string, cast: CastMember[], qualifiers: SpeakerQualifier[]): ReadCue {
  const cue = tidy(text);
  if (!cue) return {}; // the cue cell emptied: nothing to read (the speaker isn't removed this way)
  const upper = (s: string): string => s.toUpperCase();
  if (upper(cue) === upper(sentCue(sentCharacter, sentQualifier, qualifiers))) return {};
  const speaker = (name: string): string | undefined =>
    cast.find((c) => upper(c.name) === upper(name))?.name ?? (sentCharacter && upper(name) === upper(sentCharacter) ? sentCharacter : undefined);

  const whole = speaker(cue);
  if (whole !== undefined) return { character: whole, qualifier: "" };

  const m = /^(.*?)\s*\(([^()]*)\)$/s.exec(cue);
  const rest = m ? speaker(m[1]!.trim()) : undefined;
  if (!m || rest === undefined) return { unknownSpeaker: cue };
  const bracket = m[2]!.trim();
  const q = qualifiers.find((x) => upper(x.name) === upper(bracket));
  return q ? { character: rest, qualifier: q.gameId } : { character: rest, unknownQualifier: bracket };
}

/** Change authors, the most prolific first (ties by first appearance). */
function rankAuthors(changes: Array<{ author: string }>): string[] {
  const counts = new Map<string, number>();
  for (const c of changes) if (c.author) counts.set(c.author, (counts.get(c.author) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([a]) => a);
}

/** The latest change date, if any carried one. */
function latest(changes: Array<{ date?: string }>): string | undefined {
  return changes.map((c) => c.date).filter((d): d is string => !!d).sort().pop();
}

/** Indices (into `xs`) of one longest strictly increasing subsequence. */
function longestIncreasing(xs: number[]): Set<number> {
  const tails: number[] = [], tailIdx: number[] = [], prev: number[] = new Array(xs.length).fill(-1);
  xs.forEach((x, i) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid]! < x) lo = mid + 1; else hi = mid; }
    tails[lo] = x; tailIdx[lo] = i; prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1;
  });
  const out = new Set<number>();
  for (let i = tailIdx[tails.length - 1] ?? -1; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

/**
 * Walk the returned items against the skeleton. Between each pair of boxes the skeleton expects certain
 * context rows; the returned paragraphs there are matched to them by their original text. A row matched
 * whose proposed text differs was edited (`onEdited`); a paragraph that matches nothing is text the
 * editor added (`onAdded`), except a lone unmatched paragraph facing a lone unmatched row, which is that
 * row edited without tracking. Returns where each comment starts: comment id -> line or node id.
 */
function alignParagraphs(
  items: ReadItem[],
  skeleton: HandoffRow[],
  codeOfBox: Map<ReadBox, string>,
  onEdited: (item: Exclude<ReadItem, ReadBox>, row: Extract<HandoffRow, { node: string }>) => void,
  onAdded: (item: Exclude<ReadItem, ReadBox>, nearBox: number) => void,
  lineIdOf: (code: string) => string | undefined,
): Map<string, string> {
  const anchors = new Map<string, string>();
  const note = (ids: string[], anchor: string | undefined): void => { if (anchor) for (const id of ids) if (!anchors.has(id)) anchors.set(id, anchor); };

  // The script starts at the first row of the skeleton (a scene heading): everything before is the front
  // page or the cast page.
  const first = skeleton[0];
  const firstShown = first && first.kind !== "box" ? shownAs(first).map(loose) : [];
  let start = items.findIndex((it) => it.kind !== "box" && firstShown.includes(loose(it.text.original)));
  if (start < 0) start = items.findIndex((it) => it.kind === "box");
  if (start < 0) return anchors;

  // Skeleton segments: the context rows before each box, in box order; the last one is after the last box.
  const segments: Array<Array<Extract<HandoffRow, { node: string }>>> = [];
  const order = new Map<string, number>();
  let pending: Array<Extract<HandoffRow, { node: string }>> = [];
  for (const row of skeleton) {
    if (row.kind === "box") { order.set(row.marker, segments.length); segments.push(pending); pending = []; } else pending.push(row);
  }
  segments.push(pending);

  // The rows a gap should hold: every segment since the last box we could place, up to and including this
  // one's (a box that couldn't be placed in between leaves its segment to be shared). A box out of order
  // just brings its own.
  let placed = -1;
  const rowsBefore = (to: number): Array<Extract<HandoffRow, { node: string }>> => {
    const rows = to > placed ? segments.slice(placed + 1, to + 1).flat() : [...segments[to]!];
    placed = Math.max(placed, to);
    return rows;
  };

  let boxIndex = -1, gap: Array<Exclude<ReadItem, ReadBox>> = [], lastLine: string | undefined;
  /** `near`: the box index added text is nearest (the box before the gap). */
  const settle = (to: number, near: number): void => {
    const rows = rowsBefore(to);
    const unmatchedItems: Array<Exclude<ReadItem, ReadBox>> = [];
    for (const item of gap) {
      const k = rows.findIndex((r) => shownAs(r).map(loose).includes(loose(item.text.original)));
      if (k < 0) { unmatchedItems.push(item); continue; }
      const row = rows.splice(k, 1)[0]!;
      note(item.text.comments, row.node);
      if (!shownAs(row).map(loose).includes(loose(item.text.proposed))) onEdited(item, row);
    }
    if (unmatchedItems.length === 1 && rows.length === 1) {
      note(unmatchedItems[0]!.text.comments, rows[0]!.node);
      onEdited(unmatchedItems[0]!, rows[0]!);
    } else {
      for (const item of unmatchedItems) { note(item.text.comments, lastLine); onAdded(item, near); }
    }
    gap = [];
  };

  for (const item of items.slice(start)) {
    if (item.kind === "box") {
      const code = codeOfBox.get(item);
      boxIndex++;
      if (code === undefined) continue; // can't be placed: its gap merges into the next one's
      settle(order.get(code)!, boxIndex - 1);
      const line = code ? lineIdOf(code) : undefined;
      if (line) { lastLine = line; note([...item.text.comments, ...item.lead.comments, ...item.margin.comments], line); }
      continue;
    }
    if (item.text.proposed.trim() === "" && item.text.original.trim() === "" && !item.text.comments.length) continue; // spacers
    gap.push(item);
  }
  settle(segments.length - 1, boxIndex);
  return anchors;
}
