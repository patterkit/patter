// ---------------------------------------------------------------------------
// The resolve op: look up a node by its opaque id, Game ID (address), or name,
// and report WHERE it lives + what it says (spec §13) - the CLI counterpart to
// the editor's search (spec §6). The everyday need: a locale table, an audio
// file, or a runtime log names an `id`, and you need to find the line it refers
// to. Pure: indexes the loaded project and returns matches.
// ---------------------------------------------------------------------------

import { walkNodes, effectiveGameId, DEFAULT_WRITING_STATUSES, DEFAULT_RECORDING_STATUSES } from "@patterkit/model";
import type { Group, Snippet } from "@patterkit/model";
import type { LoadedProject } from "./load.js";
import { sourceStrings, mergeAuthoring, effectiveRecording } from "./loaded-helpers.js";

/** The editor's caret context, so a search can float the current scene's hits (from the caret onwards) to
 *  the top. Omit for a context-free search (the CLI). */
export interface SearchFocus {
  /** The scene the editor is currently showing. */
  sceneId: string;
  /** The beat id the caret is in (its hits, and later ones in the scene, rank first). */
  fromBeatId?: string;
}

export interface ResolveEntry {
  id: string;
  kind: "scene" | "block" | "group" | "snippet" | "beat";
  /** The author name (scenes / blocks only - other nodes are unnamed). */
  name?: string;
  /** The host-facing Game ID address (scenes / blocks only). */
  gameId?: string;
  /** The default-locale text content (line / text beats + choice prompts) - for the content search. */
  text?: string;
  /** The named location trail: scene name, then block name. */
  location: string[];
  /** The id of the scene this node lives in (for jump-to in the editor). */
  sceneId: string;
  /** The scene source file the node lives in. */
  file?: string;
}

/**
 * Look up a query against every node and beat in the project. Matching, in
 * priority order: exact id -> exact Game ID -> exact name (case-insensitive) ->
 * substring of id / Game ID / name (case-insensitive). The first tier with any
 * hits wins, so an exact match never drowns in fuzzy ones. This is the path that
 * answers "a locale string / audio file / log names id X - what line is that?".
 */
export function runResolve(loaded: LoadedProject, query: string): ResolveEntry[] {
  const entries = indexProject(loaded);
  const q = query.trim();
  const ql = q.toLowerCase();

  const tiers: Array<(e: ResolveEntry) => boolean> = [
    (e) => e.id === q,
    (e) => e.gameId?.toLowerCase() === ql,
    (e) => e.name?.toLowerCase() === ql,
    (e) =>
      e.id.toLowerCase().includes(ql) ||
      (e.gameId?.toLowerCase().includes(ql) ?? false) ||
      (e.name?.toLowerCase().includes(ql) ?? false),
  ];
  for (const match of tiers) {
    const hits = entries.filter(match);
    if (hits.length > 0) return hits;
  }
  return [];
}

/**
 * The editor's MAIN search (spec §6): content-oriented, the everyday "go to a thing" path. Matches a
 * query against **Game IDs, scene / block titles, and dialogue / narration / choice text**, with the
 * "Go to ID" power-search folded in: paste an opaque id and the node it names is found. Ranking: title /
 * Game-ID, then dialogue / text content, then raw id.
 */
export function runSearch(loaded: LoadedProject, query: string, focus?: SearchFocus): ResolveEntry[] {
  const ql = query.trim().toLowerCase();
  if (!ql) return [];
  const entries = indexProject(loaded); // in document order: scene, then its blocks / nodes / beats
  const inMeta = (e: ResolveEntry): boolean =>
    (e.gameId?.toLowerCase().includes(ql) ?? false) || (e.name?.toLowerCase().includes(ql) ?? false);
  const inText = (e: ResolveEntry): boolean => e.text?.toLowerCase().includes(ql) ?? false;
  // "Go to ID" folded in: also match the opaque internal id (paste an id, jump to its line).
  const inTech = (e: ResolveEntry): boolean => e.id.toLowerCase().includes(ql);
  const matched = entries.map((e, i) => ({ e, i })).filter(({ e }) => inMeta(e) || inText(e) || inTech(e));

  if (!focus) {
    // No editor context (e.g. the CLI): title / Game-ID first, then text content, then raw id.
    const meta = matched.filter(({ e }) => inMeta(e)).map((m) => m.e);
    const text = matched.filter(({ e }) => !inMeta(e) && inText(e)).map((m) => m.e);
    const tech = matched.filter(({ e }) => !inMeta(e) && !inText(e) && inTech(e)).map((m) => m.e);
    return [...meta, ...text, ...tech];
  }
  // Editor context: float the CURRENT scene's hits to the top - those AT / AFTER the caret first, in
  // document order (so "the next match from where I am" leads), then earlier ones in the scene, then the
  // rest of the project. `cut` is the caret beat's index (or -1 = no caret -> the whole scene leads).
  const cut = focus.fromBeatId ? entries.findIndex((e) => e.id === focus.fromBeatId) : -1;
  const group = (e: ResolveEntry, i: number): number =>
    e.sceneId !== focus.sceneId ? 2 : cut < 0 || i >= cut ? 0 : 1;
  return matched.sort((a, b) => group(a.e, a.i) - group(b.e, b.i) || a.i - b.i).map((m) => m.e);
}

/**
 * Status browse (Patterpad #205): every LINE / TEXT beat whose writing status is `status`, in document
 * order (the caret's scene first when `focus` is given). A beat with no explicit status reads as the LOWEST
 * rung, so browsing the lowest status surfaces every un-started line. Actions and choice prompts are never
 * status-tracked, so they're excluded (mirrors the surface + the production report).
 */
export function runStatusBrowse(loaded: LoadedProject, status: string, dimension: "writing" | "recording" = "writing", focus?: SearchFocus, recordingOverride?: Map<string, string>): ResolveEntry[] {
  const strings = sourceStrings(loaded);
  const merged = mergeAuthoring(loaded);
  // Recording status (#206) is dialogue-only and tracked on `recording`; writing status (#196) covers
  // line + text beats and is tracked on `writing`. Unset reads as the LOWEST rung either way.
  // In Audio Folders mode the host passes `recordingOverride` (folder-derived status) - it replaces the
  // manual per-line map entirely, so filtering reflects what's on disk.
  const recording = dimension === "recording";
  const statusOf = recording ? (recordingOverride ?? merged.recording) : merged.writing; // beat id -> rung, merged across shards
  const ladder = recording ? (loaded.project.recordingStatuses ?? DEFAULT_RECORDING_STATUSES) : (loaded.project.writingStatuses ?? DEFAULT_WRITING_STATUSES);
  const lowest = ladder[0]?.name; // unset == lowest
  // Recording status is masked by the "needs re-record" flag (#227): a flagged line reads as the reserved
  // `rerecord` status, so browsing by `rerecord` finds it and browsing by its on-disk rung does not.
  const statusAt = (id: string): string | undefined =>
    recording ? effectiveRecording(id, statusOf, merged.rerecord, lowest ?? "") : (statusOf.get(id) ?? lowest);

  const out: ResolveEntry[] = [];
  for (const scene of loaded.scenes) {
    const file = loaded.sceneFiles[scene.id];
    for (const block of scene.blocks) {
      const segments = [scene.name, block.name];
      const consider = (beat: { id: string; kind: string }): void => {
        const tracked = recording ? beat.kind === "line" : (beat.kind === "line" || beat.kind === "text");
        if (!tracked) return; // recording is dialogue-only; writing covers line + text
        if (statusAt(beat.id) !== status) return;
        out.push({ id: beat.id, kind: "beat", text: strings[beat.id], location: segments, sceneId: scene.id, file });
      };
      walkNodes<Group | Snippet>(block.children, (node) => {
        // A choice option's prompt is a real line/text beat (the choice text), so its status is tracked like
        // any other line - browsing by status must surface it too (else a prompt set to "final" is unfindable).
        if (node.type === "group") { if (node.prompt) consider(node.prompt); return; }
        for (const beat of node.beats ?? []) consider(beat);
      });
    }
  }
  // The caret's scene first (stable: V8 sort keeps document order within each group).
  if (focus) out.sort((a, b) => (a.sceneId === focus.sceneId ? 0 : 1) - (b.sceneId === focus.sceneId ? 0 : 1));
  return out;
}

/**
 * List every distinct author tag (#215) used anywhere in the project, with how many nodes carry it, sorted
 * alphabetically. Drives the search window's Tag tab chips (the tag counterpart to the status ladder).
 * Counts a node's OWN tags only (not the accumulated runtime union), so the number is "places I applied it".
 */
export function listProjectTags(loaded: LoadedProject): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  const add = (tags: string[] | undefined): void => { for (const t of tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1); };
  for (const scene of loaded.scenes) {
    add(scene.tags);
    for (const block of scene.blocks) {
      add(block.tags);
      walkNodes<Group | Snippet>(block.children, (node) => {
        add(node.tags);
        if (node.type === "group") { add(node.prompt?.tags); return; }
        for (const beat of node.beats ?? []) add(beat.tags);
      });
    }
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tag browse (#215 follow-up): every node whose OWN tags include `tag`, at any level (scene, block, group,
 * snippet, prompt, or beat), in document order (the caret's scene first when `focus` is given). Matches the
 * authored tag, not the accumulated runtime union, so it points at where the tag was actually applied.
 * A row previews what the node is: a beat / prompt shows its text, a snippet its first beat, a scene / block
 * its name.
 */
export function runTagBrowse(loaded: LoadedProject, tag: string, focus?: SearchFocus): ResolveEntry[] {
  if (!tag) return [];
  const strings = sourceStrings(loaded);
  const has = (tags: string[] | undefined): boolean => !!tags && tags.includes(tag);
  const out: ResolveEntry[] = [];
  for (const scene of loaded.scenes) {
    const file = loaded.sceneFiles[scene.id];
    if (has(scene.tags)) out.push({ id: scene.id, kind: "scene", name: scene.name, gameId: effectiveGameId(scene), location: [scene.name], sceneId: scene.id, file });
    for (const block of scene.blocks) {
      const segments = [scene.name, block.name];
      if (has(block.tags)) out.push({ id: block.id, kind: "block", name: block.name, gameId: effectiveGameId(block), location: segments, sceneId: scene.id, file });
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (has(node.tags)) {
          const preview = node.type === "group" ? (node.prompt ? strings[node.prompt.id] : undefined) : strings[node.beats?.[0]?.id ?? ""];
          out.push({ id: node.id, kind: node.type, text: preview, location: segments, sceneId: scene.id, file });
        }
        if (node.type === "group") {
          if (node.prompt && has(node.prompt.tags)) out.push({ id: node.prompt.id, kind: "beat", text: strings[node.prompt.id], location: segments, sceneId: scene.id, file });
          return;
        }
        for (const beat of node.beats ?? []) if (has(beat.tags)) out.push({ id: beat.id, kind: "beat", text: strings[beat.id], location: segments, sceneId: scene.id, file });
      });
    }
  }
  if (focus) out.sort((a, b) => (a.sceneId === focus.sceneId ? 0 : 1) - (b.sceneId === focus.sceneId ? 0 : 1));
  return out;
}

/**
 * Property-usage search (#205 follow-up): every node that REFERENCES a property in a **condition**, an
 * **effect** (a `set` target or value), or **interpolated text**: the coverage-driven "this dead branch's
 * condition uses `@x`; where else is `@x` used?" path. `query` is a property ref (`@gold`, `gold`,
 * `@world.threat`), optionally followed by a value to narrow to usages that also mention it (`gold 10`,
 * `faction rebels`). Returns a row per usage, with `text` describing it (the condition, the `set`, or the
 * interpolated string). Bare names also match their explicit `@patter.` form.
 */
export function runPropertyUsage(loaded: LoadedProject, query: string, focus?: SearchFocus): ResolveEntry[] {
  const parsed = parsePropertyQuery(query);
  if (!parsed) return [];
  const { regexes, value } = parsed;
  const strings = sourceStrings(loaded);
  const refs = (src: string | undefined): src is string => !!src && regexes.some((re) => re.test(src));
  const valueOk = (src: string): boolean => !value || src.toLowerCase().includes(value);

  const out: ResolveEntry[] = [];
  for (const scene of loaded.scenes) {
    const file = loaded.sceneFiles[scene.id];
    const push = (id: string, kind: ResolveEntry["kind"], segments: string[], usage: string): void => {
      out.push({ id, kind, text: usage, location: segments, sceneId: scene.id, file });
    };
    // Scene-entry effects.
    for (const e of scene.onEntry ?? []) {
      const src = `${e.target} = ${e.value}`;
      if ((refs(e.target) || refs(e.value)) && valueOk(src)) push(scene.id, "scene", [scene.name], `on entry: set ${src}`);
    }
    for (const block of scene.blocks) {
      const segments = [scene.name, block.name];
      walkNodes<Group | Snippet>(block.children, (node) => {
        if (refs(node.condition) && valueOk(node.condition)) push(node.id, node.type, segments, `if ${node.condition}`);
        if (node.type === "group") {
          if (node.prompt && refs(strings[node.prompt.id]) && valueOk(strings[node.prompt.id]!)) push(node.prompt.id, "beat", segments, strings[node.prompt.id]!);
          return;
        }
        for (const phase of ["onEnter", "onExit"] as const) {
          for (const e of node[phase] ?? []) {
            const src = `${e.target} = ${e.value}`;
            if ((refs(e.target) || refs(e.value)) && valueOk(src)) push(node.id, "snippet", segments, `${phase === "onEnter" ? "on enter" : "on exit"}: set ${src}`);
          }
        }
        for (const beat of node.beats ?? []) {
          if (refs(strings[beat.id]) && valueOk(strings[beat.id]!)) push(beat.id, "beat", segments, strings[beat.id]!);
        }
      });
    }
  }
  // Caret's scene first (stable sort keeps document order within each group).
  if (focus) out.sort((a, b) => (a.sceneId === focus.sceneId ? 0 : 1) - (b.sceneId === focus.sceneId ? 0 : 1));
  return out;
}

/** Parse a property-usage query into ref regex(es) + an optional value substring. A bare name (`gold`) also
 *  matches its explicit `@patter.gold` form; a scoped name (`world.threat`) matches only itself. */
function parsePropertyQuery(query: string): { regexes: RegExp[]; value?: string } | null {
  const m = /^@?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)(.*)$/.exec(query.trim());
  if (!m) return null;
  const prop = m[1]!;
  const value = m[2]!.replace(/^[\s=<>!]+/, "").replace(/^["']|["']$/g, "").trim().toLowerCase() || undefined;
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexes = prop.includes(".")
    ? [new RegExp(`@${esc(prop)}\\b`, "i")]
    : [new RegExp(`@${esc(prop)}\\b`, "i"), new RegExp(`@patter\\.${esc(prop)}\\b`, "i")];
  return { regexes, value };
}

// Memoize the project index: it's pure over `loaded.scenes` + `loaded.locales`, yet the editor rebuilds
// it on every ⌘K keystroke (a full O(nodes) walk). Cache it, invalidating when
// the project is replaced (a fresh `loaded`) or any scene / locale shard is swapped in place - applyLiveSource
// (save / live edit) replaces the element OBJECT, so a shallow element-identity check catches every edit.
let indexCache: { loaded: LoadedProject; scenes: readonly unknown[]; locales: readonly unknown[]; entries: ResolveEntry[] } | null = null;
function sameRefs(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Index every scene / block / group / snippet / beat with its Game ID, text, and location. */
function indexProject(loaded: LoadedProject): ResolveEntry[] {
  if (indexCache && indexCache.loaded === loaded && sameRefs(indexCache.scenes, loaded.scenes) && sameRefs(indexCache.locales, loaded.locales)) {
    return indexCache.entries; // read-only by every caller (runSearch / runResolve map+filter into fresh arrays)
  }
  const entries = buildIndex(loaded);
  indexCache = { loaded, scenes: [...loaded.scenes], locales: [...loaded.locales], entries };
  return entries;
}

function buildIndex(loaded: LoadedProject): ResolveEntry[] {
  const out: ResolveEntry[] = [];
  const strings = sourceStrings(loaded); // every default-locale shard merged (beat ids are project-unique)
  for (const scene of loaded.scenes) {
    const file = loaded.sceneFiles[scene.id];
    out.push({
      id: scene.id, kind: "scene", name: scene.name, gameId: effectiveGameId(scene),
      location: [scene.name], sceneId: scene.id, file,
    });
    for (const block of scene.blocks) {
      const segments = [scene.name, block.name];
      out.push({
        id: block.id, kind: "block", name: block.name, gameId: effectiveGameId(block),
        location: segments, sceneId: scene.id, file,
      });
      walkNodes<Group | Snippet>(block.children, (node) => {
        out.push({
          id: node.id, kind: node.type,
          location: segments, sceneId: scene.id, file,
        });
        // A choice option's prompt is searchable text too (on-screen choice text).
        if (node.type === "group" && node.prompt) {
          out.push({
            id: node.prompt.id, kind: "beat", text: strings[node.prompt.id],
            location: segments, sceneId: scene.id, file,
          });
          return;
        }
        if (node.type !== "snippet") return;
        for (const beat of node.beats ?? []) {
          out.push({
            id: beat.id, kind: "beat", text: strings[beat.id],
            location: segments, sceneId: scene.id, file,
          });
        }
      });
    }
  }
  return out;
}
