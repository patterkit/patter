// ---------------------------------------------------------------------------
// Structural validator (spec §13).
//
// Checks tree invariants that don't need the expression engine: unique ids,
// mandatory non-empty scene/block names, snippet has >=1 beat or a jump, no
// dangling jumps, no jump into a non-addressable node, speaker `character`s
// present in the project cast, `temporary` only where it has meaning (a
// per-flow `@scene` prop), property/status-ladder declarations well-formed, and
// - because hand-edited JSON5 is a supported path - malformed shapes (missing
// ids, non-array children) become ISSUES, never crashes. (A scene holds any mix
// of line / text / game-event beats - spec §2 - so there is no beat-kind/scene gate.)
//
// (Expression-level validation of `condition` / effect `src` strings - via
// @wildwinter/expr configured with the Patter dialect - is a separate pass,
// wired in with the compiler.)
// ---------------------------------------------------------------------------

import { walkNodes, DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES, DEFAULT_DOCUMENTATION_CLASSES } from "@patterkit/model";
import type { ProjectFile, Scene, Block, Group, Snippet, PropertyDecl, ScalarValue, AuthoringFile } from "@patterkit/model";
import { isValidGameId, effectiveGameId } from "@patterkit/model";

export interface ValidationIssue {
  code:
    | "duplicate-id"
    | "missing-id"
    | "malformed-node"
    | "missing-name"
    | "empty-scene"
    | "empty-snippet"
    | "empty-container"
    | "dangling-jump"
    | "jump-into-non-addressable"
    | "invalid-gameid"
    | "duplicate-gameid"
    | "unknown-character"
    | "invalid-temporary"
    | "invalid-declaration"
    | "invalid-status-ladder"
    | "invalid-locales"
    | "invalid-captions"
    | "missing-prompt"
    | "invalid-prompt"
    | "multiple-fallbacks"
    | "choice-can-empty"
    | "invalid-status-value"
    | "unknown-doc-class"
    | "invalid-tag"
    | "invalid-gamedata-field";
  message: string;
  /** Id of the offending node/beat, where applicable. */
  id?: string;
}

export interface ProjectInput {
  project: ProjectFile;
  scenes: Scene[];
  /** Authoring shards, when loaded - status values are checked against the project ladders (spec section 13). */
  authoring?: AuthoringFile[];
}

/** True when any option in a choice jumps back to its own block / scene - so the choice can be
 *  re-entered (a hub). Used only to scope the dry-choice warning to genuinely exhaustible choices:
 *  a choice whose every option jumps AWAY can be all-once-only with no fallback and never run dry. */
function choiceLoopsBack(choice: Group, ...targets: Array<string | undefined>): boolean {
  const back = new Set(targets.filter((s): s is string => typeof s === "string" && s.length > 0));
  const hits = (n: Group | Snippet): boolean =>
    n.type === "snippet" ? !!n.jump && back.has(n.jump.to) : (n.children ?? []).some(hits);
  return (choice.children ?? []).some(hits);
}

/** A node the author has left with no real content: an empty bubble (no beats, no jump), or a
 *  container whose every descendant is itself contentless - the seeded "click to add" placeholder
 *  bubbles the surface leaves inside a freshly-made group or section. Emptiness is reported at the
 *  OUTERMOST such container (see `reportEmpty`), so the writer sees "this is empty" on the group /
 *  section they actually made, not "this snippet is empty" on the near-invisible placeholder bubble
 *  inside it. A group carrying a choice `prompt` is content (the choice text), so never counts. */
function isContentlessNode(node: Group | Snippet): boolean {
  if (node.type === "snippet") return (node.beats?.length ?? 0) === 0 && !node.jump;
  if (node.prompt) return false;
  return Array.isArray(node.children) && node.children.every(isContentlessNode);
}

/** Validate a project's structural invariants. Returns an empty array when valid. */
export function validateProject(input: ProjectInput): ValidationIssue[] {
  const { project, scenes } = input;
  const issues: ValidationIssue[] = [];

  const allIds = new Map<string, string>();      // id -> kind label
  const addressable = new Set<string>();         // scene + block ids (jump targets)
  const sceneGameIds = new Map<string, string>(); // effective gameId -> scene id (project-wide uniqueness)
  const jumps: Array<{ to: string; from: string }> = [];
  const castNames = new Set((project.cast ?? []).map((c) => c.name));

  // Author tags (#215): non-empty, no whitespace, no comma (the entry delimiter). Reported per offending tag.
  const checkTags = (tags: string[] | undefined, where: string, id?: string): void => {
    for (const t of tags ?? []) {
      if (typeof t !== "string" || t.length === 0 || /[\s,]/.test(t)) {
        issues.push({ code: "invalid-tag", message: `${where} has an invalid tag '${String(t)}' (no spaces or commas, and not empty)`, id });
      }
    }
  };

  // An id must be a non-empty string; a missing one gets located by context so
  // the author can find the hand-edited node that lost it.
  const seeId = (id: unknown, kind: string, where: string): id is string => {
    if (typeof id !== "string" || id.length === 0) {
      issues.push({ code: "missing-id", message: `${kind} in ${where} has no id` });
      return false;
    }
    const existing = allIds.get(id);
    if (existing !== undefined) {
      issues.push({ code: "duplicate-id", message: `duplicate id '${id}' (${kind} and ${existing})`, id });
    } else {
      allIds.set(id, kind);
    }
    return true;
  };

  validateProjectFile(project, issues);

  for (const scene of scenes) {
    seeId(scene.id, "scene", "project");
    const where = `scene '${scene.id}'`;
    if (typeof scene.id === "string") addressable.add(scene.id);
    if (!scene.name?.trim()) {
      issues.push({ code: "missing-name", message: `${where} has no name`, id: scene.id });
    }
    // The host-facing address (gameId): valid format if pinned, unique project-wide as an effective value.
    if (scene.gameId && !isValidGameId(scene.gameId)) {
      issues.push({ code: "invalid-gameid", message: `${where} address '${scene.gameId}' is invalid (lowercase letters, digits, hyphens; no leading/trailing hyphen)`, id: scene.id });
    }
    const sgid = effectiveGameId(scene);
    if (sgid) {
      const prev = sceneGameIds.get(sgid);
      if (prev && prev !== scene.id) issues.push({ code: "duplicate-gameid", message: `${where} address '${sgid}' is already used by scene '${prev}'`, id: scene.id });
      else sceneGameIds.set(sgid, scene.id);
    }
    const blockGameIds = new Map<string, string>(); // effective gameId -> block id (scene-scoped uniqueness)
    checkTags(scene.tags, where, scene.id);
    checkDecls(scene.sceneProps, `${where} sceneProps`, issues);
    for (const decl of scene.sceneProps ?? []) {
      if (decl.temporary && (decl.shared ?? false)) {
        issues.push({ code: "invalid-temporary",
          message: `${where} property '${decl.name}': 'temporary' cannot be combined with 'shared'`, id: scene.id });
      }
    }

    if (!Array.isArray(scene.blocks)) {
      issues.push({ code: "malformed-node", message: `${where} has no blocks array`, id: scene.id });
      continue;
    }
    if (scene.blocks.length === 0) {
      issues.push({ code: "empty-scene", message: `${where} has no blocks`, id: scene.id });
    }

    for (const block of scene.blocks) {
      seeId(block.id, "block", where);
      checkTags(block.tags, `block '${block.id}'`, block.id);
      if (typeof block.id === "string") addressable.add(block.id);
      if (!block.name?.trim()) {
        issues.push({ code: "missing-name", message: `block '${block.id}' has no name`, id: block.id });
      }
      if (block.gameId && !isValidGameId(block.gameId)) {
        issues.push({ code: "invalid-gameid", message: `block '${block.id}' address '${block.gameId}' is invalid (lowercase letters, digits, hyphens; no leading/trailing hyphen)`, id: block.id });
      }
      const bgid = effectiveGameId(block);
      if (bgid) {
        const prev = blockGameIds.get(bgid);
        if (prev && prev !== block.id) issues.push({ code: "duplicate-gameid", message: `block '${block.id}' address '${bgid}' is already used by block '${prev}' in ${where}`, id: block.id });
        else blockGameIds.set(bgid, block.id);
      }
      if (!Array.isArray(block.children)) {
        issues.push({ code: "malformed-node", message: `block '${block.id}' in ${where} has no children array`, id: block.id });
        continue;
      }
      // Empty reporting, OUTERMOST-first: if the whole block is contentless, name the block and
      // stop; otherwise descend and name the highest empty group (or a genuinely lone empty bubble).
      const inBlockOf = `block '${block.id}'`;
      const reportEmpty = (nodes: Array<Group | Snippet>): void => {
        for (const n of nodes) {
          if (isContentlessNode(n)) {
            if (n.type === "group") {
              issues.push({ code: "empty-container", message: `group '${n.id}' in ${inBlockOf} is empty`, id: n.id });
            } else {
              issues.push({ code: "empty-snippet", message: `snippet '${n.id}' has no beats and no jump`, id: n.id });
            }
            // Outermost: do not descend into its (all-contentless) placeholder children.
          } else if (n.type === "group" && Array.isArray(n.children)) {
            reportEmpty(n.children);
          }
        }
      };
      if (block.children.length === 0 || block.children.every(isContentlessNode)) {
        issues.push({ code: "empty-container", message: `block '${block.id}' in ${where} is empty`, id: block.id });
      } else {
        reportEmpty(block.children);
      }

      walkNodes<Group | Snippet>(block.children, (node) => {
        const inBlock = `block '${block.id}'`;
        checkTags(node.tags, `${node.type} '${node.id}'`, node.id);
        if (node.type === "group") {
          seeId(node.id, "group", inBlock);
          if (!Array.isArray(node.children)) {
            issues.push({ code: "malformed-node", message: `group '${node.id}' in ${inBlock} has no children array`, id: node.id });
          }
          // Emptiness (empty-container) is reported above, outermost-first - not here.
          // A choice's options each need a `prompt` (the choice text, spec §5) - a line | text beat.
          // No derivation / look-ahead. (A bare-snippet child is runtime tolerance, not authored.)
          if (node.selector === "choice") {
            let fallbacks = 0;
            let hasSticky = false;
            for (const opt of node.children ?? []) {
              if (opt.fallback === true) fallbacks++;        // sticky / fallback live on the option (group OR bare snippet)
              if (opt.sticky === true) hasSticky = true;
              if (opt.type !== "group") continue;
              const p = opt.prompt;
              if (!p) {
                issues.push({ code: "missing-prompt", message: `choice option '${opt.id}' in ${inBlock} has no prompt`, id: opt.id });
              } else {
                if (p.kind !== "line" && p.kind !== "text") {
                  issues.push({ code: "invalid-prompt", message: `choice option '${opt.id}' prompt must be a line or text beat`, id: opt.id });
                }
                // The prompt is a real, addressable beat (the choice text): register its id so authoring
                // metadata - writing/recording status, cut, documentation - can target it like any other line.
                // Without this, status set on the whole scene reads back as an "unknown id" on the prompt.
                seeId(p.id, "prompt", `choice option '${opt.id}'`);
                checkTags(p.tags, `prompt '${p.id}'`, p.id);
                if (p.kind === "line" && p.character && !castNames.has(p.character)) {
                  issues.push({ code: "unknown-character", message: `prompt '${p.id}' speaker '${p.character}' is not in the project cast`, id: p.id });
                }
              }
            }
            // At most one fallback (spec §5) - more than one is ambiguous about which is the last resort.
            if (fallbacks > 1) {
              issues.push({ code: "multiple-fallbacks", message: `choice '${node.id}' in ${inBlock} has ${fallbacks} fallback options (at most one allowed)`, id: node.id });
            }
            // A choice runs DRY (falls through, contributing nothing) when nothing is takeable. Two ways in:
            //  (b) NO GUARANTEED PATH: every option AND any fallback is conditional, so if every condition
            //      fails at once there is nothing eligible. A single unconditional option or fallback rules
            //      this out (it is always eligible). A conditional fallback does NOT: it can fail too, which
            //      is why this is not gated on `fallbacks === 0`.
            //  (a) EXHAUSTION: it does have an unconditional path, but every option is once-only AND the
            //      choice loops back to its own block / scene with no fallback and no sticky - a hub that
            //      empties out on re-entry. (A choice whose options jump away is fine being all-once-only.)
            const hasUnconditionalEscape = (node.children ?? []).some((opt) => !opt.condition);
            if ((node.children?.length ?? 0) > 0 && !hasUnconditionalEscape) {
              issues.push({ code: "choice-can-empty", message: `choice '${node.id}' in ${inBlock} has no unconditional option or fallback - it runs dry (falls through) if every condition fails`, id: node.id });
            } else if (!hasSticky && fallbacks === 0 && choiceLoopsBack(node, block.id, bgid, scene.id, sgid)) {
              issues.push({ code: "choice-can-empty", message: `choice '${node.id}' in ${inBlock} can be re-entered but every option is once-only with no fallback - it will run dry`, id: node.id });
            }
          }
          return;
        }
        // snippet (emptiness - empty-snippet - is reported above, outermost-first - not here)
        seeId(node.id, "snippet", inBlock);
        for (const beat of node.beats ?? []) {
          seeId(beat.id, "beat", `snippet '${node.id}'`);
          checkTags(beat.tags, `beat '${beat.id}'`, beat.id);
          if (beat.kind === "line" && beat.character && !castNames.has(beat.character)) {
            issues.push({
              code: "unknown-character",
              message: `beat '${beat.id}' speaker '${beat.character}' is not in the project cast`,
              id: beat.id,
            });
          }
        }
        if (node.jump) jumps.push({ to: node.jump.to, from: node.id });
      });
    }
  }

  if (input.authoring) validateAuthoring(input.authoring, project, allIds, issues);

  // Resolve jumps once all ids are known.
  for (const d of jumps) {
    if (d.to === "END") continue;
    if (!allIds.has(d.to)) {
      issues.push({ code: "dangling-jump", message: `jump in '${d.from}' targets unknown id '${d.to}'`, id: d.from });
    } else if (!addressable.has(d.to)) {
      issues.push({
        code: "jump-into-non-addressable",
        message: `jump in '${d.from}' targets '${d.to}' (${allIds.get(d.to)}); jumps may only target a scene, block, or END`,
        id: d.from,
      });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Project-file declarations: properties, status ladders, locales (spec §7/§13).
// ---------------------------------------------------------------------------

function validateProjectFile(project: ProjectFile, issues: ValidationIssue[]): void {
  checkDecls(project.properties, "project properties", issues);

  // `temporary` (reseed-each-entry) only has meaning on a per-flow scene-local
  // property: a global never re-seeds (no scene-entry event).
  for (const decl of project.properties ?? []) {
    if (decl.temporary) {
      issues.push({ code: "invalid-temporary",
        message: `global property '${decl.name}': 'temporary' applies only to scene-local (@scene) properties` });
    }
  }

  if (project.locales && !project.locales.all.includes(project.locales.default)) {
    issues.push({ code: "invalid-locales",
      message: `default locale '${project.locales.default}' is not in locales.all [${project.locales.all.join(", ")}]` });
  }

  // Closed-caption delimiters (#214): both ends must be non-empty (they may be the same token).
  const cc = project.closedCaptions;
  if (cc && (cc.open.length === 0 || cc.close.length === 0)) {
    issues.push({ code: "invalid-captions",
      message: "closed-caption delimiters must both be non-empty" });
  }

  // Status ladders (spec §13): ordered not-done -> done; each readiness marker
  // is a threshold declared on exactly one status.
  const writing = project.writingStatuses;
  if (writing) {
    checkLadderNames(writing.map((s) => s.name), "writingStatuses", issues);
    for (const marker of ["readyToRecord", "readyToShip"] as const) {
      const count = writing.filter((s) => s[marker]).length;
      if (count !== 1) {
        issues.push({ code: "invalid-status-ladder",
          message: `writingStatuses must declare '${marker}' on exactly one status (found ${count})` });
      }
    }
  }
  if (project.recordingStatuses) {
    checkLadderNames(project.recordingStatuses.map((s) => s.name), "recordingStatuses", issues);
  }

  // gameData field definitions (the author-defined custom fields per node type): within each node
  // type, field names are unique, and an enum field declares its allowed values.
  for (const [kind, fields] of Object.entries(project.gameDataFields ?? {})) {
    const seen = new Set<string>();
    for (const f of fields ?? []) {
      const key = f.name.trim().toLowerCase();
      if (!f.name.trim()) issues.push({ code: "invalid-gamedata-field", message: `${kind} gameData field has no name` });
      else if (seen.has(key)) issues.push({ code: "invalid-gamedata-field", message: `${kind} gameData field '${f.name}' is declared more than once` });
      else seen.add(key);
      if (f.type === "enum" && !(f.values && f.values.length)) {
        issues.push({ code: "invalid-gamedata-field", message: `${kind} gameData field '${f.name}' is an enum but lists no values` });
      }
    }
  }
}


/**
 * Stored authoring metadata against the project's ladders and scene-type defaults
 * (spec §13): every status on a LIVE beat is a ladder member, every doc class is
 * declared. Metadata keyed on an id that no longer exists is harmless residue from
 * deleting a beat (like an orphaned comment) - it is ignored, not flagged. `planned`
 * entries need only a name (they have no id yet).
 */
function validateAuthoring(
  files: AuthoringFile[],
  project: ProjectFile,
  allIds: Map<string, string>,
  issues: ValidationIssue[],
): void {
  const writingLadder = new Set((project.writingStatuses ?? DEFAULT_WRITING_STATUSES).map((s) => s.name));
  const recordingLadder = new Set((project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES).map((s) => s.name));
  const docClasses = new Set((project.documentationClasses ?? DEFAULT_DOCUMENTATION_CLASSES).map((c) => c.name));

  const checkLines = (lines: unknown, where: string): void => {
    if (lines !== undefined && (typeof lines !== "number" || !Number.isFinite(lines) || lines < 0)) {
      issues.push({ code: "invalid-status-value", message: `${where}: estimate lines must be a non-negative number, got ${JSON.stringify(lines)}` });
    }
  };

  // Estimating config (project-level, spec §13): the threshold rung must exist; line counts must be sane.
  const est = project.estimating;
  if (est) {
    if (est.thresholdStatus !== undefined && !writingLadder.has(est.thresholdStatus)) {
      issues.push({ code: "invalid-status-value", message: `estimating: threshold status '${est.thresholdStatus}' is not in the writing ladder` });
    }
    checkLines(est.defaultLines, "estimating default");
    for (const tg of est.tagEstimates ?? []) checkLines(tg.lines, `estimating tag '${tg.tag}'`);
  }

  // Per-beat authoring metadata keyed on an id that no longer exists is harmless RESIDUE - deleting a
  // beat leaves its writing/recording status, cut flag, or notes behind, exactly like an orphaned comment
  // (kept as a gutter bubble). It never ships and has no runtime effect, so it is IGNORED here, not
  // flagged: skip an orphaned id entirely (don't even value-check it). Only LIVE ids are validated.
  for (const file of files) {
    for (const [id, value] of Object.entries(file.writing ?? {})) {
      if (!allIds.has(id)) continue;
      if (!writingLadder.has(value)) {
        issues.push({ code: "invalid-status-value", message: `writing status '${value}' on '${id}' is not in the project ladder`, id });
      }
    }
    for (const [id, value] of Object.entries(file.recording ?? {})) {
      if (!allIds.has(id)) continue;
      if (!recordingLadder.has(value)) {
        issues.push({ code: "invalid-status-value", message: `recording status '${value}' on '${id}' is not in the project ladder`, id });
      }
    }
    for (const [id, lines] of Object.entries(file.documentation ?? {})) {
      if (!allIds.has(id)) continue;
      for (const line of lines) {
        // Untyped = editor-only (allowed); a named class must be declared.
        if (line.type !== undefined && !docClasses.has(line.type)) {
          issues.push({ code: "unknown-doc-class", message: `documentation class '${line.type}' on '${id}' is not declared (project documentationClasses)`, id });
        }
      }
    }
  }
}

function checkLadderNames(names: string[], where: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (!name?.trim()) {
      issues.push({ code: "invalid-status-ladder", message: `${where} has an empty status name` });
      continue;
    }
    if (seen.has(name)) {
      issues.push({ code: "invalid-status-ladder", message: `${where} declares '${name}' more than once` });
    }
    seen.add(name);
  }
}

/** Well-formedness of property declarations: unique names, enum/flags values, default/type agreement. */
function checkDecls(decls: PropertyDecl[] | undefined, where: string, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  for (const decl of decls ?? []) {
    const name = decl.name?.toLowerCase();
    if (!name) {
      issues.push({ code: "invalid-declaration", message: `${where}: a property declaration has no name` });
      continue;
    }
    if (seen.has(name)) {
      issues.push({ code: "invalid-declaration", message: `${where}: duplicate property '${decl.name}'` });
    }
    seen.add(name);

    if ((decl.type === "enum" || decl.type === "flags") && !decl.values?.length) {
      issues.push({ code: "invalid-declaration",
        message: `${where}: '${decl.name}' is ${decl.type} but declares no values` });
    }
    if (decl.default !== undefined && !defaultMatchesType(decl.default, decl)) {
      issues.push({ code: "invalid-declaration",
        message: `${where}: '${decl.name}' default ${JSON.stringify(decl.default)} does not match type '${decl.type}'` });
    }
  }
}

function defaultMatchesType(value: ScalarValue, decl: PropertyDecl): boolean {
  switch (decl.type) {
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number";
    case "string": return typeof value === "string";
    case "enum": return typeof value === "string" && (decl.values?.includes(value) ?? true);
    case "flags":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && (decl.values?.includes(v) ?? true));
  }
}
