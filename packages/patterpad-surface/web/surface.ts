// The embeddable script-editing surface. `mountSurface` builds a fully-wired ProseMirror zone-model
// editor into a host element and returns a small handle (get the round-tripped source, toggle
// formatting, focus, destroy). It is framework-neutral and host-agnostic: the dev harness (main.ts)
// and the Patterpad Electron renderer both mount it - the harness feeds it a fixture and shows the
// round-trip in a side pane; the app feeds it a real scene's source and persists getSource() to disk.
//
// HOST responsibilities (kept OUT of here, so the surface stays a pure editor): font loading, the
// theme / font / size chrome, where the round-tripped source goes, and the cast / jump-target lists
// (the project owns those). The surface only EDITS; it reports changes via `onChange`.

import { EditorState, TextSelection, Selection, NodeSelection, type Transaction, type Command } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { keymap } from "prosemirror-keymap";
import { baseKeymap, toggleMark } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";
import type { Node as PMNode, MarkType } from "prosemirror-model";
import type { PropertyDecl } from "@patterkit/model";
import { openScene, saveScene } from "../src/load.js";
import { navKeymap } from "../src/navigation.js";
import { openDirection, closeDirection } from "../src/direction.js";
import { enter, endBubble } from "../src/lines.js";
import { backspace, deleteSelectionGuarded } from "../src/delete.js";
import { toggleLineType, flipToFreeText, promoteToDialogue } from "../src/linetype.js";
import { context } from "../src/context.js";
import { inspect, inspectScene, type InspectorContext } from "../src/inspect.js";
import { duplicateChunk, notifyDuplicated, setDuplicateHandler, DUPLICABLE_KINDS } from "../src/duplicate.js";
import { STRUCTURAL_MOVE, setSnippetCondition, setSnippetEffects, type SnippetEffect, setGroupProps as setGroupPropsCmd, type GroupPropsPatch, insertOption, addOptionPrompt, deleteChunk as deleteChunkCmd, moveChunk as moveChunkCmd, chunkIsEmpty, deleteChunksAt, chunkContaining } from "../src/groups.js";
import { multiSelectState, multiSelectPositions } from "../src/multiselect.js";
import { setSnippetJump, insertJump } from "../src/special.js";
import { openTargetPicker, closeTargetPicker, type JumpData } from "./targetpicker.js";
import { setPlayBlockHandler } from "./actionmenu.js";
import { confirmDialog } from "./confirm.js";
import { cueText, isChoiceGroup, findByModelId, findBeatById, sayText as sayTextOf, sayStartOf } from "../src/zoneutil.js";
import { patterSchema } from "../src/schema.js";
import { nodeViews, setJumpLabelResolver, setJumpNavHandler, refreshJumpLabels, openSceneMenu } from "./views.js";
import { problemsPlugin, setProblemMarks, type ProblemMark } from "./problems.js";
import { docNotesPlugin, setDocNotes, setNoteHandler, type DocNote, type DocNoteMap } from "./docnotes.js";
import { commentsPlugin, setComments, setCommentHandler, commentRanges, type CommentMark, type CommentOpenRequest } from "./comments.js";
import { suggestionsPlugin, setSuggestions, setSuggestionHandler, type SuggestionMark, type SuggestionOpenRequest } from "./suggestions.js";
import { spellcheckPlugin, setSpellChecker, setSpellAddHandler, setSpellIgnoreHandler, spellingIssues, type SpellChecker } from "./spellcheck.js";
import { writingStatusPlugin, setWritingStatusMap, setWritingStatusShown, setWritingStatusLadder, setWritingStatusHandler, type WritingStatusMap, type WritingStatusRung } from "./writingstatus.js";
import { replaceSayText } from "../src/lines.js";
import { multiSelectDecorations } from "./multiselect.js";
export type {
  InspectorContext, InspectLevel, LeafLevel, SnippetLevel, GroupLevel, BlockLevel, SceneLevel, LeafKind,
} from "../src/inspect.js";
export type { GroupPropsPatch, SnippetEffect } from "../src/groups.js";
export type { OptionSummary } from "../src/inspect.js";
export type { DocNote, DocNoteMap } from "./docnotes.js";
export type { CommentMark, CommentOpenRequest } from "./comments.js";
export type { SuggestionMark, SuggestionOpenRequest } from "./suggestions.js";
export type { SpellChecker } from "./spellcheck.js";
export { initTooltips, tipBold } from "./tooltip.js"; // the shared themed tooltip (replaces native `title` rollovers)
import { createCuePopup } from "./cuepopup.js";
import { createSlashMenu } from "./slashmenu.js";
import { createHintBar } from "./hintbar.js";

export interface MountOptions {
  /** The scroll container the editor renders into (needs the tall bottom padding for typewriter scroll). */
  editor: HTMLElement;
  /** Optional footer element for the keystroke-hint bar; omitted -> no hints. */
  hintbar?: HTMLElement;
  /** The scene's `.patterflow` and `.patterloc` source text. */
  flowSource: string;
  locSource: string;
  /** Inline bold/italic markup (project `formatting` setting). Default ON. */
  formatting?: boolean;
  /** Recency-ordered cast seed; the opened scene's speakers are auto-adopted on top. */
  castSeed?: string[];
  /** Cross-scene jump targets offered by the jump picker, APPENDED to END + THIS scene (whose
   *  live blocks the surface reads from the doc). Each is a scene `{ id, label }` with its `blocks`
   *  (so you can jump to any scene OR any block); ids are the stable join keys stored on the jump,
   *  labels are shown. The app passes every other scene here. */
  jumpTargets?: Array<{ id: string; label: string; blocks?: Array<{ id: string; label: string }> }>;
  /** Prepend the scene-name title above the script (the harness / a single-scene view wants this). */
  showTitle?: boolean;
  /** Called (rAF-coalesced) whenever the document changes, and once on mount - the host reads
   *  `handle.getSource()` to persist / mirror. */
  onChange?: (handle: SurfaceHandle) => void;
  /** Called (rAF-coalesced) whenever the SELECTION or the doc changes, and once on mount, with the
   *  caret's container stack (leaf -> snippet -> group(s) -> block, innermost-first) - the host renders
   *  the detail inspector from it. `levels` is empty when there is nothing to inspect. */
  onSelect?: (ctx: InspectorContext) => void;
  /** Called when the author picks "Play block" in a snippet/group context menu, with the enclosing
   *  block's id - the host opens the play window entering that block. Omit to hide the item. */
  onPlayBlock?: (blockId: string) => void;
  /** Called when the author double-clicks a jump chip, with the divert's target id (a scene or block
   *  opaque id; never "END"). The host switches scene if needed and reveals the node. Omit to disable. */
  onOpenTarget?: (targetId: string) => void;
  /** Called to open / start a threaded comment (#148): from a bubble (existing thread) or the selection
   *  affordance (a range). Omit to disable comments. */
  onComments?: (req: CommentOpenRequest) => void;
  /** Called to open / add a documentation note on a node (#148 notes redesign): from the note icon or a
   *  right-click "Note…", with the node id, an anchor, and the node kind (narrows note classes). */
  onEditNote?: (nodeId: string, anchor: HTMLElement, kind?: string) => void;
  /** Called to create / review a "suggest a rewrite" proposal: from the right-click "Suggest rewrite…"
   *  (create) or a gutter pencil (review). Omit to disable suggestions. */
  onSuggestions?: (req: SuggestionOpenRequest) => void;
  /** Called when the author picks "Add to dictionary" on a misspelled word (#177) - the host adds it to
   *  the project dictionary, rebuilds the engine, and pushes it back via setSpellChecker. */
  onAddToDictionary?: (word: string) => void;
  /** Called when the author picks "Ignore" on a misspelled word (#177) - the host persists it to the
   *  project ignore list, rebuilds the engine, and refreshes the problems panel (so the toast drops it). */
  onIgnoreWord?: (word: string) => void;
  /** Called to SET a writing status (#196) on these beats (null = clear) - from the "Status" context-menu
   *  submenu (one beat, or a container / selection rippled to its line + prose beats). The host edits
   *  AuthoringFile.writing. Omit (with no ladder) to disable the status submenu. */
  onSetWritingStatus?: (ids: string[], status: string | null) => void;
  /** A chunk was duplicated: old id -> new id for every node in the copy, so the host can carry the
   *  sidecar authoring metadata (status, notes) from the originals to the copies. */
  onDuplicate?: (idMap: Record<string, string>) => void;
  /** Called when the author adds a BRAND-NEW character via the cue popup's "+ Add" row, with the (upper-cased)
   *  name - the host registers it in the project master cast (ProjectFile.cast) so it persists beyond this
   *  session. Omit and a new character lives only in the surface's session cast. */
  onAddCharacter?: (name: string) => void;
}

export interface SurfaceHandle {
  view: EditorView;
  /** Round-trip the current document back to canonical `.patterflow` + `.patterloc` source. */
  /** Serialize the doc to `.patterflow` + `.patterloc` source. Pass `{ prune: true }` on a real SAVE to
   *  tidy stray blank text lines (a snippet's lone / leading / trailing blank text beat) - never on the
   *  live mirror, where a just-created blank line is valid. */
  getSource(opts?: { prune?: boolean }): { flow: string; loc: string };
  /** The live cast (seed + auto-adopted + anything added via the popup). */
  getCast(): readonly string[];
  /** Toggle inline formatting. Turning it OFF strips existing marks so the doc matches what ships. */
  setFormatting(on: boolean): void;
  isFormatting(): boolean;
  /** Make the surface read-only (e.g. the scene is locked by another author under a lock-based VCS) or
   *  editable again. Read-only blocks typing / drag / structural keyboard edits; selection + reading
   *  still work, so the author can look but not change a file they couldn't save anyway (#145). */
  setEditable(on: boolean): void;
  isEditable(): boolean;
  /** Move the caret to the node with this model id (beat / snippet / group / block) and scroll it
   *  into view - for jump-to-site from the problems panel. Returns false if the id isn't in this scene.
   *  `instant` jumps without the smooth recentre (so the node is at its final position immediately -
   *  used when a popover is anchored right after, which can't wait out an animated scroll). */
  revealNode(id: string, opts?: { instant?: boolean }): boolean;
  /** The caret's current container stack (leaf -> snippet -> group(s) -> block), for the host to read
   *  on demand. The host normally drives the inspector off the `onSelect` callback instead. */
  selectionContext(): InspectorContext;
  /** Set (or clear, with "") the eligibility condition on the snippet / group with this model id -
   *  for the inspector's condition editor. Returns false if the id isn't a snippet / group here. */
  setCondition(id: string, src: string): boolean;
  /** Replace a SNIPPET's onEnter / onExit effect list (the inspector's effects editor). An empty
   *  list clears the phase. Returns false if the id isn't a snippet here. */
  setEffects(id: string, phase: "onEnter" | "onExit", effects: SnippetEffect[]): boolean;
  /** Set the scene's display name (the editable title) - rides in the doc's scene `raw`. */
  setSceneName(name: string): void;
  /** Set (or clear, with "") the host-facing gameId ADDRESS on the scene (pass the scene id) or a
   *  block (pass the block id). Clearing reverts to the name-derived address. Returns false on a bad id. */
  setGameId(id: string, gameId: string): boolean;
  /** Patch a GROUP's behaviour by id (selector / sequence order×exhaust / option secrecy) - the
   *  inspector's group data editors. Returns false if the id isn't a group here. */
  setGroupProps(id: string, patch: GroupPropsPatch): boolean;
  /** Set (or clear, with `value === undefined`) one author-defined gameData FIELD on any node by id
   *  (scene / block / snippet / beat). Stores only overrides (sparse); clearing falls back to the
   *  field's default. Returns false if the id isn't found. */
  setGameData(id: string, key: string, value: unknown): boolean;
  /** Replace the author tags (#215) on any node by id (scene / block / group / snippet / beat). An empty
   *  list drops the `tags` key. Returns false if the id isn't found. */
  setTags(id: string, tags: string[]): boolean;
  /** This scene's local `@scene` property declarations (read from the scene doc, for the editor). */
  sceneProps(): PropertyDecl[];
  /** Replace this scene's local `@scene` property declarations (an empty list clears them). */
  setSceneProps(props: PropertyDecl[]): void;
  /** Set (or clear, with null) a SNIPPET's terminal jump target by id. Returns false if not a snippet. */
  setJump(id: string, target: string | null): boolean;
  /** Set an existing snippet jump's mode: "jump" (one-way) or "call" (jump-and-return), keeping the
   *  target. Returns false if the snippet has no jump to re-mode. The `↪`/`⤳` chip updates on repaint. */
  setJumpMode(id: string, mode: "jump" | "call"): boolean;
  /** Open the shared type-and-filter jump picker for a SNIPPET, anchored to `anchor` (the inspector
   *  row / problems-fix button), seeded with its current jump; a pick sets/clears it. `afterPick`
   *  runs after a commit (e.g. save + refresh). The same picker `/jump` uses, for one consistent UX. */
  editJump(id: string, anchor: HTMLElement, afterPick?: () => void): void;
  /** The jump targets offered in this scene (FLAT: END + each scene + each block), for label lookup. */
  jumpTargets(): Array<{ id: string; label: string }>;
  /** THIS scene's blocks, live from the doc (unsaved adds/renames included), in document order.
   *  Feeds the host's block navigation (Patterpad's nav sub-list). */
  blockList(): Array<{ id: string; label: string }>;
  /** Replace the CROSS-SCENE jump targets (every other scene + its blocks) after the host learns of more
   *  scenes - e.g. Patterpad's lazy open finishing its background hydrate. The current scene's own live
   *  blocks are always derived from the doc, so they're untouched. */
  setJumpTargets(targets: Array<{ id: string; label: string; blocks?: Array<{ id: string; label: string }> }>): void;
  /** Open the shared scene/block picker for a flow-NODE reference (e.g. a condition's seen()/visits()
   *  arg), anchored to `anchor`, seeded with `current`. No END / clear rows - only real nodes. The
   *  chosen node id is handed to `onPick`. Reuses the same picker the jump affordances use. */
  pickNode(opts: { anchor: HTMLElement; current: string; onPick: (id: string) => void }): void;
  /** Append a fresh option to the CHOICE with this id (the consolidated options editor). False if not a choice. */
  addOption(choiceId: string): boolean;
  /** Insert an empty prompt cell into the OPTION with this id (the `missing-prompt` quick-fix). False
   *  if the id isn't a prompt-less option. */
  addPrompt(optionId: string): boolean;
  /** Delete the chunk (snippet / group / option) with this id. */
  deleteChunk(id: string): boolean;
  /** Duplicate what's currently selected - the node-selected block / group / snippet, else the chunk
   *  holding the caret - as its next sibling, children and all, with fresh ids throughout (Edit >
   *  Duplicate). False when the selection isn't inside a duplicable chunk. */
  duplicate(): boolean;
  /** Reorder the chunk with this id up / down within its container. */
  moveChunk(id: string, dir: "up" | "down"): boolean;
  /** Move the play PLAYHEAD to the node with this id (a running highlight, scrolled into view). The
   *  beat the playhead leaves keeps a quiet VISITED mark, so the path play took is visible. Pass null
   *  to clear just the playhead. */
  markLine(id: string | null): void;
  /** Clear the play marks entirely - the playhead and the whole visited trail (on a fresh run / reset). */
  resetPlay(): void;
  /** Set the inline validation squiggles: each node id present in this scene gets a wavy underline /
   *  accent by severity. Pass [] to clear. Ids not in this scene are ignored (cross-scene problems). */
  markProblems(marks: Array<{ id: string; severity: "error" | "warning" }>): void;
  /** Surface documentation notes (spec §18): the host pushes the already-filtered visible notes, keyed by
   *  node / scene id. Noted nodes get a tooltip + marker; scene / block notes also show under the heading. */
  setDocNotes(map: DocNoteMap): void;
  /** Surface comment threads (#148): the host pushes the visible set (active always; resolved when "show
   *  resolved" is on). Range threads highlight their span + fly a bubble; whole-beat threads fly a gutter
   *  bubble. A bubble click / selection affordance calls onComments. */
  setComments(marks: CommentMark[]): void;
  /** The threads' CURRENT spans as plain-text offsets (+ quote), so the host can refresh stored offsets
   *  at save time after in-session edits moved them. */
  commentRanges(): Array<{ id: string; from: number; to: number; quote: string }>;
  /** Surface "suggest a rewrite" markers (review flow): the host pushes the visible set; a beat with open
   *  proposals gets a tint + a gutter pencil. Clicking the pencil calls onSuggestions. */
  setSuggestions(marks: SuggestionMark[]): void;
  /** Set the spell-check engine (#177): the host builds it from the active dictionary + project words +
   *  cast and pushes it here; null turns spell-check off (or when no dictionary is installed). */
  setSpellChecker(checker: SpellChecker | null): void;
  /** The open scene's misspellings as { beat node id, word } - the host lists them in the problems panel. */
  spellingIssues(): Array<{ nodeId: string; word: string }>;
  /** Writing status (#196): the per-beat status map (beat id -> status name) that paints the gutter badges
   *  + seeds the "Status" submenu's check. Push on scene load + after any set. */
  setWritingStatus(map: WritingStatusMap): void;
  /** The writing-status ladder (Project Settings rungs, each with a palette slot) for the submenu + badges. */
  setWritingStatusLadder(rungs: WritingStatusRung[]): void;
  /** Which writing-status rungs show their gutter pill (Review > Line Status); empty = none, the default.
   *  Hidden in Writing View regardless. */
  setWritingStatusShown(shown: string[]): void;
  /** Replace a beat's say-zone text (Accept on a suggestion). Returns true if applied (the beat existed). */
  setSayText(nodeId: string, text: string): boolean;
  /** The LIVE say text of a beat by id (the suggestion "before" / staleness check), or null if gone. */
  sayText(nodeId: string): string | null;
  /** Every spoken LINE beat in the scene, in document order: id + say text + cue (character). Drives the
   *  scratch-recording walk (record one line, then carry on to the next). */
  lines(): Array<{ id: string; text: string; character: string }>;
  /** The DOM element of a node by id, to anchor a host popover (used by the Review Feedback walk to open
   *  a thread / proposal at its beat). Null if the node isn't in this scene / not rendered. */
  anchorFor(nodeId: string): HTMLElement | null;
  /** ProseMirror history undo / redo - so the host's Edit menu drives the real editor history. */
  undo(): void;
  redo(): void;
  sceneName(): string;
  focus(): void;
  destroy(): void;
}

/** Every distinct character the document already names (for cast auto-adopt). */
function charactersInDoc(doc: PMNode): string[] {
  const names: string[] = [];
  doc.descendants((n) => {
    if (n.type.name === "line") { const t = cueText(n); if (t) names.push(t); return false; }
    return true;
  });
  return names;
}

/**
 * The vertical mid-point (viewport px) of the caret line, robust to an empty zone
 * where coordsAtPos returns 0,0 (then fall back to the caret node's DOM rect).
 */
function caretMidY(v: EditorView): number | null {
  const head = v.state.selection.head;
  try {
    const c = v.coordsAtPos(head);
    if (Number.isFinite(c.top) && (c.top !== 0 || c.bottom !== 0)) return (c.top + c.bottom) / 2;
  } catch { /* fall through */ }
  try {
    const at = v.domAtPos(head);
    const node = at.node.nodeType === Node.TEXT_NODE ? at.node.parentElement : (at.node as HTMLElement);
    const r = node?.getBoundingClientRect();
    if (r) return (r.top + r.bottom) / 2;
  } catch { /* give up */ }
  return null;
}

/**
 * The speaker is a TOKEN, not editable text: a caret must never rest INSIDE a populated cue. If one
 * lands there (a click, an arrow step), select the whole name - the popup then opens to replace it.
 */
function normalizeCueSelection(state: EditorState): EditorState {
  const c = context(state);
  if (state.selection.empty && c.zone?.role === "cue" && c.zone.textLen > 0) {
    const from = c.zone.pos + 1;
    const sel: Transaction = state.tr.setSelection(TextSelection.create(state.doc, from, from + c.zone.textLen));
    return state.apply(sel);
  }
  return state;
}

/**
 * Sweep wholly-empty line / prose beats - an unfinished dialogue line the author started but left blank
 * (no character, no direction, no text, no game data / tags) - out of the doc. Run on BLUR (when the
 * author exits the editor): an abandoned blank line otherwise has no way to be removed and would render at
 * runtime as an empty line emitting its raw id. A bubble left beat-less is kept as the "add a line" ghost
 * (a valid empty state - only the stray beat is removed). Null when there is nothing to sweep.
 */
export function sweepEmptyBeats(state: EditorState): Transaction | null {
  const spans: Array<{ from: number; to: number }> = [];
  state.doc.descendants((node, pos) => {
    const k = node.type.name;
    if (k === "line" || k === "prose") {
      let hasData = false;
      try { const raw = JSON.parse((node.attrs.raw as string) || "{}"); hasData = !!(raw.gameData && Object.keys(raw.gameData).length) || !!(raw.tags && raw.tags.length); } catch { /* no raw data */ }
      if (node.textContent.trim() === "" && !hasData) spans.push({ from: pos, to: pos + node.nodeSize });
      return false; // a beat's zones (cue / paren / say) are not themselves beats
    }
    return k !== "gameEvent"; // descend into containers; never into atoms
  });
  if (!spans.length) return null;
  let tr = state.tr;
  for (const s of spans.reverse()) tr = tr.delete(s.from, s.to); // high-to-low so earlier offsets stay valid
  return tr.docChanged ? tr : null;
}

/**
 * Backspace / Delete on an EXPLICITLY SELECTED chunk (a snippet or group NodeSelection) deletes it -
 * through the same themed confirm + deleteChunk path as the action menu's Delete (groups §7), so a
 * keyboard delete can't silently destroy content. An empty chunk (nothing typed inside) is removed
 * without a prompt, matching the menu. Returns false for any other selection so the normal
 * backspace / range-delete commands still run.
 */
const deleteSelectedChunk: Command = (state, _dispatch, view) => {
  if (!view) return false;
  // A multi-select set (shift run OR a Cmd-click set, groups §6): one themed confirm, then delete every
  // chunk in the set (gather - they may be discontiguous, e.g. [1,2,4]).
  const positions = multiSelectPositions(state);
  if (positions.length >= 2) {
    const n = positions.length;
    const removeSet = (): void => { const tr = deleteChunksAt(view.state, multiSelectPositions(view.state)); if (tr) view.dispatch(tr); view.focus(); };
    void confirmDialog({
      title: `Delete these ${n} items?`,
      body: `${n} items and everything inside them will be removed. You can undo it.`,
      confirmLabel: "Delete",
    }).then((ok) => { if (ok) removeSet(); });
    return true;
  }
  const sel = state.selection;
  if (!(sel instanceof NodeSelection) || (sel.node.type.name !== "snippet" && sel.node.type.name !== "group")) return false;
  const node = sel.node;
  const pos = sel.from;
  const isOption = node.type.name === "group" && isChoiceGroup(state.doc.resolve(pos).parent);
  const noun = isOption ? "option" : node.type.name === "group" ? "group" : "snippet";
  const remove = (): void => { const tr = deleteChunkCmd(view.state, pos); if (tr) view.dispatch(tr); view.focus(); };
  if (chunkIsEmpty(node)) { remove(); return true; } // nothing lost -> no prompt (matches the action menu)
  void confirmDialog({
    title: `Delete this ${noun}?`,
    body: `The ${noun} and everything inside it will be removed. You can undo it.`,
    confirmLabel: "Delete",
  }).then((ok) => { if (ok) remove(); });
  return true;
};

export function mountSurface(opts: MountOptions): SurfaceHandle {
  const editorEl = opts.editor;
  // editorEl is host-owned and outlives this mount, so its listeners would pile up on remount. Bind every
  // listener to this signal and abort it in destroy() - one teardown for all of them (view.dom listeners
  // die with view.destroy(), but routing them here too keeps the rule uniform).
  const listeners = new AbortController();
  const sig = listeners.signal;
  let titleEl: HTMLElement | null = null;
  let formattingEnabled = opts.formatting ?? true;
  const opened = openScene(opts.flowSource, opts.locSource, formattingEnabled);

  // The project cast. Seed (recency-ordered) + auto-adopt every speaker the opened scene already
  // names, so an imported file's speakers are first-class. The popup's "add new" prepends here.
  const cast: string[] = [];
  const addToCast = (name: string): void => { const n = name.trim(); if (n && !cast.some((c) => c.toLowerCase() === n.toLowerCase())) cast.unshift(n); };
  (opts.castSeed ?? []).forEach(addToCast);
  charactersInDoc(opened.doc).forEach(addToCast);

  // The popup's "+ Add" registers a new character: into the session cast (so it's pickable at once) AND, via
  // the host callback, into the persisted project master cast. Seed / auto-adopt above go through addToCast
  // directly, so only an explicit popup add notifies the host.
  const popup = createCuePopup(() => cast, (name) => { addToCast(name); opts.onAddCharacter?.(name); });
  // Jump targets, HIERARCHICAL (READABLE address shown; stable internal id stored): END + THIS scene
  // (live blocks read from the doc), then every other scene + its blocks (host-supplied). Feeds the
  // type-and-filter picker (`/jump` + inspector + problems), and a FLAT view feeds the chip-label
  // resolver. Reads the LIVE doc once the view exists, else the initial `opened.doc`.
  let liveDoc: PMNode = opened.doc;
  const buildJumpData = (): JumpData => {
    const scenes: JumpData["scenes"] = [];
    const docRaw = JSON.parse(liveDoc.attrs.raw as string) as { id?: string; name?: string };
    const curId = typeof docRaw.id === "string" ? docRaw.id : null;
    if (curId) {
      const blocks: Array<{ id: string; label: string }> = [];
      liveDoc.forEach((b) => {
        if (b.type.name !== "block") return;
        const r = JSON.parse(b.attrs.raw as string) as { id?: string; name?: string };
        if (typeof r.id === "string") blocks.push({ id: r.id, label: r.name ?? r.id });
      });
      scenes.push({ scene: { id: curId, label: docRaw.name ?? curId }, blocks });
    }
    for (const t of opts.jumpTargets ?? []) {
      if (t.id === curId) continue; // the current scene is already in (with live blocks)
      scenes.push({ scene: { id: t.id, label: t.label }, blocks: (t.blocks ?? []).slice() });
    }
    return { scenes };
  };
  const flatTargets = (): Array<{ id: string; label: string }> => {
    const out: Array<{ id: string; label: string }> = [{ id: "END", label: "END" }];
    for (const g of buildJumpData().scenes) { out.push(g.scene); for (const b of g.blocks) out.push(b); }
    return out;
  };
  // jumpLabel is called per jump-chip repaint; rebuilding the flat target list (parsing the doc + every
  // block + the host scenes) each time is wasteful. Memoize on `liveDoc` IDENTITY - PM reuses the same doc
  // node for selection-only transactions, so this rebuilds only on an actual edit - and look up via a map.
  let jumpLabels: { doc: PMNode; labels: Map<string, string> } | null = null;
  const jumpLabel = (id: string): string => {
    if (!jumpLabels || jumpLabels.doc !== liveDoc) {
      const labels = new Map<string, string>();
      for (const t of flatTargets()) labels.set(t.id, t.label);
      jumpLabels = { doc: liveDoc, labels };
    }
    return jumpLabels.labels.get(id) ?? id;
  };
  setJumpLabelResolver(jumpLabel); // BEFORE the view paints, so existing jump chips show labels
  setPlayBlockHandler(opts.onPlayBlock ?? null); // the context-menu "Play block" item routes here
  setJumpNavHandler(opts.onOpenTarget ?? null);  // double-click a jump chip -> follow the divert
  setCommentHandler(opts.onComments ?? null);    // the comment bubble + selection affordance route here
  setNoteHandler(opts.onEditNote ?? null);       // the note icon + right-click "Note…" route here
  setSuggestionHandler(opts.onSuggestions ?? null); // the suggest-rewrite pencil + right-click route here
  setSpellAddHandler(opts.onAddToDictionary ?? null); // "Add to dictionary" on a misspelling routes here (#177)
  setSpellIgnoreHandler(opts.onIgnoreWord ?? null); // "Ignore" on a misspelling routes here (persist + refresh, #177)
  setWritingStatusHandler(opts.onSetWritingStatus ?? null); // the "Status" submenu routes here (#196)
  setDuplicateHandler(opts.onDuplicate ?? null);            // Duplicate hands the host its old -> new id map
  // `/jump`: open the shared picker BELOW THE CARET; on pick, insert (replace / split per special.ts).
  const slash = createSlashMenu((view) => {
    openTargetPicker({
      anchor: { caretOf: view }, data: buildJumpData(), current: "", allowClear: false,
      onPick: (target) => { if (target) { const tr = insertJump(view.state, target); if (tr) view.dispatch(tr); } },
      afterClose: () => view.focus(),
    });
  });
  const renderHints = opts.hintbar ? createHintBar(opts.hintbar) : () => {};

  // The cast popup / speaker highlight must activate only on an explicit click ON a character name,
  // or on keyboard / programmatic entry - NOT on a stray click that snaps the caret into a cue. We
  // track the most recent INPUT: pointer-down records whether it hit a cue; a keystroke marks
  // "keyboard". The flag persists until the next input so it still applies when the click's selection
  // transaction flushes asynchronously.
  let lastInputWasPointer = false;
  let lastPointerOnCue = false;
  let lastKeyWasVertical = false; // the last keydown was Up/Down - such a move passes THROUGH cues (#20)
  // The beat the caret last sat in; when it changes (click / arrow / entering a prompt) we recentre.
  let lastBeatPos: number | null = null;
  let recenterScheduled = false; // coalesce recentres, and defer the layout read out of dispatch

  const getSource = (opts?: { prune?: boolean }): { flow: string; loc: string } =>
    saveScene({ ...opened, doc: view.state.doc, formatting: formattingEnabled }, opts);

  // Change notifications are coalesced to one rAF tick (a docToScene walk per keystroke is too heavy).
  let changeScheduled = false;
  const scheduleChange = (): void => {
    if (!opts.onChange || changeScheduled) return;
    changeScheduled = true;
    requestAnimationFrame(() => { changeScheduled = false; opts.onChange?.(handle); });
  };

  // Selection-context (inspector) notifications, likewise coalesced. Fires when the selection OR the
  // doc changes (editing a condition / jump changes the inspected data without moving the caret).
  let selectScheduled = false;
  // The scene title sits OUTSIDE the editable flow, so "inspect the scene" can't be a PM selection. While
  // it's pinned the inspector shows the scene; the pin is set on title focus and cleared by the next real
  // editor selection change (clicking a beat / block / group) - so editing scene fields in the inspector,
  // or committing the rename, doesn't snap it back to the last beat.
  let scenePinned = false;
  const scheduleSelect = (): void => {
    if (!opts.onSelect || selectScheduled) return;
    selectScheduled = true;
    requestAnimationFrame(() => {
      selectScheduled = false;
      opts.onSelect?.(scenePinned ? inspectScene(view.state) : inspect(view.state));
    });
  };

  /**
   * Ease the caret line back to ~45% of the viewport (just above centre, so cast / slash popups have
   * room below), but ONLY when it has drifted out of a wide COMFORT BAND. Always a smooth scroll.
   */
  function recenterCaret(v: EditorView): boolean {
    // A node CLICK (block heading, bubble, group) shouldn't yank the viewport - the thing you clicked is
    // already on screen. Only an actual caret (typing / arrow nav) recentres. Explicit jumps (search,
    // problems, reveal) do their own centring in revealNode, so this never starves them.
    if (v.state.selection instanceof NodeSelection) return true; // handled = skip PM's default scroll-into-view
    const mid = caretMidY(v); if (mid == null) return false;
    const r = editorEl.getBoundingClientRect();
    const rel = (mid - r.top) / r.height;
    if (rel >= 0.28 && rel <= 0.72) return true;            // comfortably mid-screen: leave it be
    editorEl.scrollTo({ top: Math.max(0, editorEl.scrollTop + (mid - (r.top + 0.45 * r.height))), behavior: "smooth" });
    return true;
  }

  // Cmd-B / Cmd-I author bold / italic - but ONLY when formatting is enabled. Either way the shortcut
  // is SWALLOWED (return true) so the browser never applies its own native bold/italic. When off it's
  // a no-op here; the "you tried to format while it's disabled" hint is a shell-level affordance.
  const fmtKey = (mark: MarkType): Command =>
    (state, dispatch) => { if (formattingEnabled) toggleMark(mark)(state, dispatch); return true; };

  // Read-only gate (#145): when the scene is locked by another author the host flips this off, so
  // ProseMirror blocks typing / drag / paste. Programmatic edits (inspector commands) are gated by the
  // host dimming the inspector; this covers the direct-typing surface.
  let isEditable = true;

  const view = new EditorView(editorEl, {
    editable: () => isEditable,
    // Turn OFF the browser's native spellchecker on the editable: we run our own (#177, nspell + the project
    // dictionary / ignore list), and the OS one would double-underline words our system has accepted (and
    // ignores the author's Ignore list entirely). autocorrect / autocapitalize off for the same reason.
    attributes: { spellcheck: "false", autocorrect: "off", autocapitalize: "off" },
    scrollMargin: 140, // keep the caret off the top edge (no typing in the gutter)
    // Typewriter-ish scrolling for transactions that asked to scroll (typing, Enter); clicks / arrows
    // are handled in dispatchTransaction. Needs the tall padding-bottom on the editor element.
    handleScrollToSelection: (v) => recenterCaret(v),
    state: EditorState.create({
      doc: opened.doc,
      plugins: [
        history(),
        keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
        // An explicitly selected chunk (snippet / group NodeSelection) deletes via the themed confirm,
        // ahead of the normal backspace / range-delete (which still run for any other selection).
        keymap({ Backspace: deleteSelectedChunk, Delete: deleteSelectedChunk }),
        keymap({
          Enter: enter, "Shift-Enter": endBubble, "Mod-Enter": endBubble,
          Backspace: backspace, Delete: deleteSelectionGuarded,
          "Mod-t": toggleLineType, "Alt-t": toggleLineType, // Cmd-T is browser new-tab; Alt-T in the harness
        }),
        keymap({ "Mod-b": fmtKey(patterSchema.marks.strong), "Mod-i": fmtKey(patterSchema.marks.em) }),
        keymap(navKeymap),
        keymap(baseKeymap),
        multiSelectState(),       // the discontiguous chunk-selection set (groups §6)
        multiSelectDecorations(), // ...painted as one selection
        problemsPlugin(), // inline validation squiggles (host pushes the set via handle.markProblems)
        docNotesPlugin(), // documentation notes surfaced as tooltips + under-heading text (handle.setDocNotes)
        commentsPlugin(), // threaded-comment bubbles on beats with a visible thread (handle.setComments)
        suggestionsPlugin(), // "suggest a rewrite" pencils on beats with open proposals (handle.setSuggestions)
        spellcheckPlugin(), // inline spell-check squiggles + right-click fix menu (#177; handle.setSpellChecker)
        writingStatusPlugin(), // per-beat writing-status colour badges in the LEFT icon gutter (#196)
      ],
    }),
    nodeViews,
    handleDOMEvents: {
      mousedown: (_v, event) => {
        const t = event.target as Element | null;
        lastInputWasPointer = true;
        lastPointerOnCue = !!(t && t.closest && t.closest(".zone.cue"));
        return false;
      },
      blur: (v) => {
        // Exiting the editor sweeps any unfinished, wholly-empty line the author started but never filled,
        // so it can't be stranded with no way to remove it. Skip while the cast popup owns input (a fresh
        // line mid character-pick is not abandoned) and never edit a read-only scene.
        if (!isEditable || popup.isOpen()) return false;
        const tr = sweepEmptyBeats(v.state);
        if (tr) v.dispatch(tr);
        return false;
      },
    },
    handleTextInput: (v, _from, _to, text) => {
      if (text === "(") return openDirection(v.state, v.dispatch);
      if (text === ")") return closeDirection(v.state, v.dispatch);
      if (slash.handleTextInput(v, text)) { popup.close(); return true; }
      // While the cast popup owns input (it buffers keys in handleKeyDown), the document must NEVER be
      // edited: in Chrome a keydown preventDefault does not cancel `beforeinput`, so without this the
      // typed letter would leak in and overwrite the selected cue token, stranding the caret. (Invisible
      // to jsdom, which fires no beforeinput - hence the unit tests passed while the live editor broke.)
      if (popup.isOpen()) return true;
      return false;
    },
    handleKeyDown: (v, event) => {
      lastInputWasPointer = false;
      lastKeyWasVertical = event.key === "ArrowUp" || event.key === "ArrowDown";
      if (slash.handleKeyDown(v, event)) return true;
      if (popup.handleKeyDown(v, event)) return true;
      if (event.key === " ") { const tr = flipToFreeText(v.state); if (tr) { v.dispatch(tr); popup.close(); return true; } }
      if (event.key === "Tab") {
        if (closeDirection(v.state, v.dispatch)) return true;
        return promoteToDialogue(v.state, v.dispatch);
      }
      return false;
    },
    dispatchTransaction(tr) {
      const fromStrayClick = lastInputWasPointer && !lastPointerOnCue;
      const applied = view.state.apply(tr);
      const next = fromStrayClick ? applied : normalizeCueSelection(applied);
      // Point the jump-label resolver at the NEW doc BEFORE the repaint: node views that resolve a jump /
      // condition label DURING updateState (e.g. a condition tag re-humanizing `visits(block)`, or a recreated
      // jump chip) must see the just-applied doc. Setting it after updateState let the memo hand back a stale
      // map keyed to the pre-edit doc, so a block reference could stick on its raw id (the paint guards then
      // prevent a later re-resolve).
      liveDoc = next.doc;
      view.updateState(next);
      const ctx = context(next);
      if (tr.docChanged) scheduleChange();
      if (tr.selectionSet) scenePinned = false; // a real selection move (beat / block / group) un-pins the scene
      if (tr.selectionSet || tr.docChanged) { slash.close(); scheduleSelect(); }
      // A vertical (Up/Down) move only passes THROUGH a cue, so it must not raise the cast popup; a
      // sideways move or a click into the cue may (#20). A click off the cue is already a stray-click close.
      const mayOpenCue = lastInputWasPointer ? lastPointerOnCue : !lastKeyWasVertical;
      if (tr.getMeta(STRUCTURAL_MOVE) || fromStrayClick) popup.close(); else popup.update(view, ctx, mayOpenCue);
      // Hints depend only on the selection context, which changes only when the selection or doc does
      // (multi-select dispatches also set the selection) - so skip the rebuild on metadata-only
      // transactions (problem-mark updates), matching the scheduleSelect gate above.
      if (tr.selectionSet || tr.docChanged) renderHints(view, ctx);
      const beatPos = ctx.beat?.pos ?? null;
      // Recentre when the caret moves to a new beat - but defer the layout read (getBoundingClientRect /
      // coordsAtPos) to a rAF so it never forces a synchronous reflow inside dispatchTransaction.
      if (beatPos !== lastBeatPos) {
        lastBeatPos = beatPos;
        if (!tr.scrolledIntoView && !recenterScheduled) {
          recenterScheduled = true;
          requestAnimationFrame(() => { recenterScheduled = false; recenterCaret(view); });
        }
      }
    },
  });
  liveDoc = view.state.doc;
  view.dispatch(view.state.tr); // priming dispatch (normalizes selection)
  renderHints(view, context(view.state)); // initial hint render (the priming tr is metadata-only, now gated out above)

  if (opts.showTitle) {
    const title = document.createElement("div"); title.className = "scene-title";
    title.textContent = opened.flow.scene.name;
    // The scene name is author-editable here (the title IS the edit surface); commit on blur / Enter.
    title.setAttribute("contenteditable", "plaintext-only");
    title.spellcheck = false;
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } }, { signal: sig });
    // The title sits OUTSIDE the editable flow, so clicking it can't move the caret; focusing it instead
    // PINS the inspector to the whole scene (until the next editor selection move clears it - see
    // scheduleSelect), so editing scene fields in the inspector doesn't snap back to the last beat.
    title.addEventListener("focus", () => { scenePinned = true; opts.onSelect?.(inspectScene(view.state)); }, { signal: sig });
    title.addEventListener("blur", () => { const n = (title.textContent ?? "").trim(); if (n) handle.setSceneName(n); else title.textContent = handle.sceneName(); }, { signal: sig });
    // Right-click the scene header -> a scene menu: add / edit a scene-level note (#148) + set the writing
    // status of the whole scene (#196). The scene id rides in the doc.
    title.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      try { const id = (JSON.parse(view.state.doc.attrs.raw as string) as { id?: string }).id; if (id) openSceneMenu(view, { x: e.clientX, y: e.clientY }, id); } catch { /* no scene id */ }
    }, { signal: sig });
    editorEl.prepend(title);
    titleEl = title;
  }

  // Clicking the empty BACKGROUND (the editor container, or the ProseMirror root's own padding - not a
  // node) releases a node / multi-select: collapse to a caret so a run is easy to deselect (feedback).
  editorEl.addEventListener("mousedown", (e) => {
    const t = e.target as Node;
    if ((t === editorEl || t === view.dom) && !view.state.selection.empty) {
      view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(view.state.selection.head))));
    }
  }, { signal: sig });

  // The hint bar follows focus: a transaction doesn't fire on focus/blur, so refresh it there too -
  // it clears when the editor loses focus (no live cursor) and returns on focus.
  view.dom.addEventListener("focus", () => renderHints(view), { signal: sig });
  view.dom.addEventListener("blur", () => renderHints(view), { signal: sig });

  // Find the document position of the node carrying this model id (beat id attr, or a chunk's raw.id).
  const findNodePos = (id: string): number | null => findByModelId(view.state.doc, id)?.pos ?? null;

  let markedEl: HTMLElement | null = null; // the beat the playhead is currently on
  const visitedEls = new Set<HTMLElement>(); // beats the playhead has passed through this run
  let cancelPendingMark: (() => void) | null = null; // tears down a not-yet-applied .playing (pointer still gliding)

  // The floating play pointer (#182): a bold chevron that hovers in the left margin pointing at the
  // beat the playhead is on - a far more obvious cue than the inline ::before dot alone. It lives in
  // the #editor scroller's CONTENT coordinate space (an absolute child), so it stays glued to its beat
  // as the editor scrolls; only its top/left transition when the playhead moves to another beat.
  const playPointer = document.createElement("div");
  playPointer.className = "play-pointer";
  playPointer.setAttribute("aria-hidden", "true");
  playPointer.innerHTML =
    '<svg viewBox="0 0 13 20" fill="none"><path class="pp-chevron" d="M3.5 4 L10 10 L3.5 16" ' +
    'stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  editorEl.appendChild(playPointer);

  // The current beat's anchor in #editor CONTENT coords: the first-line centre (the ::before dot's
  // 0.72em line) and the x just left of the text. Both the pointer and the auto-scroll key off THIS
  // one point, so they always agree - including when the playhead jumps back to a tall choice group,
  // where centring the group's BOX (the old scrollIntoView) left its start off-screen.
  const markedAnchor = (): { top: number; left: number } | null => {
    if (!markedEl) return null;
    const er = editorEl.getBoundingClientRect();
    const br = markedEl.getBoundingClientRect();
    const em = parseFloat(getComputedStyle(markedEl).fontSize) || 16;
    const top = br.top - er.top + editorEl.scrollTop + 0.72 * em;
    const left = Math.max(2, br.left - er.left + editorEl.scrollLeft - 6); // just left, never past the gutter
    return { top, left };
  };

  // Re-anchor the pointer, hugging just left of the beat's first line. Opacity fades purely in CSS
  // (.is-active). The `gliding` class - added only AFTER the first placement - turns on the top/left
  // transition, so the pointer SNAPS to the first beat (no slide in from 0,0) then GLIDES as play advances.
  const repositionPointer = (): void => {
    const a = markedAnchor();
    if (!a) { playPointer.classList.remove("is-active", "gliding"); return; }
    playPointer.style.top = `${a.top}px`;
    playPointer.style.left = `${a.left}px`;
    if (!playPointer.classList.contains("is-active")) {
      playPointer.classList.add("is-active"); // fade in at the placed spot (no position transition yet)
      requestAnimationFrame(() => { if (markedEl) playPointer.classList.add("gliding"); }); // glide subsequent moves
    }
  };

  // Centre the current beat's first-line anchor in the editor (smooth). Keyed off the SAME point as the
  // pointer, so the view follows the chevron even on a backward jump to a tall choice group.
  const scrollMarkedToCentre = (): void => {
    const a = markedAnchor();
    if (!a) return;
    editorEl.scrollTo({ top: Math.max(0, a.top - editorEl.clientHeight / 2), behavior: "smooth" });
  };
  const pointerResize = new ResizeObserver(() => repositionPointer()); // follow width/layout changes
  pointerResize.observe(editorEl);

  const handle: SurfaceHandle = {
    view,
    getSource,
    getCast: () => cast,
    setFormatting(on) {
      if (on === formattingEnabled) return;
      if (!on) { // disabling strips existing marks so the doc matches the plain strings that ship
        const tr = view.state.tr;
        tr.removeMark(0, view.state.doc.content.size, patterSchema.marks.strong);
        tr.removeMark(0, view.state.doc.content.size, patterSchema.marks.em);
        if (tr.docChanged) view.dispatch(tr);
      }
      formattingEnabled = on;
      opts.onChange?.(handle);
    },
    isFormatting: () => formattingEnabled,
    setEditable(on) {
      if (on === isEditable) return;
      isEditable = on;
      view.setProps({ editable: () => isEditable }); // re-evaluate so the DOM contentEditable updates now
    },
    isEditable: () => isEditable,
    revealNode(id, opts) {
      const at = findNodePos(id);
      if (at == null) return false;
      // An explicit jump (search, problems, review) must land the target front-and-CENTRE, not just "in
      // view": dispatch the selection WITHOUT the scrollIntoView flag (so the typing-oriented recentre, with
      // its leave-it-alone comfort band, doesn't fire), then centre the node's DOM ourselves. `instant`
      // snaps; otherwise it eases there.
      // Land the caret in the SAY-text content for a line / prose beat - never on the leading cue token
      // (that would select the speaker name and pop the cast selector). Fall back to the node start for
      // everything else (snippets, groups, choices).
      const sayStart = sayStartOf(view.state.doc, id);
      let sel: Selection;
      if (sayStart >= 0) {
        sel = Selection.near(view.state.doc.resolve(sayStart));
      } else {
        // No editable say-target (an empty container or a beat-less bubble): keep the selection ON this
        // node. Selection.near(at + 1) would bump PAST an empty node to the next selectable spot - the
        // "one step beyond the actual problem" reveal - so if it escapes this node's range, select the
        // node itself (which also highlights the empty container, exactly what a jump-to-problem wants).
        const node = view.state.doc.nodeAt(at);
        const near = Selection.near(view.state.doc.resolve(at + 1));
        sel = node && (near.from <= at || near.from >= at + node.nodeSize)
          ? NodeSelection.create(view.state.doc, at)
          : near;
      }
      view.dispatch(view.state.tr.setSelection(sel));
      view.focus();
      const dom = view.nodeDOM(at);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "center", behavior: opts?.instant ? "auto" : "smooth" });
      return true;
    },
    selectionContext: () => inspect(view.state),
    setCondition(id, src) {
      const at = findNodePos(id);
      if (at == null) return false;
      const node = view.state.doc.nodeAt(at);
      // A condition is the bare expression - never a leading "if" (that's only a display prefix). Strip
      // any that slips in (e.g. typed out of habit in raw text) so it can't contaminate the stored value.
      const clean = src.replace(/^\s*if\b\s*/i, "");
      const tr = node?.type.name === "snippet" ? setSnippetCondition(view.state, at, clean)
        : node?.type.name === "group" ? setGroupPropsCmd(view.state, at, { condition: clean })
        : null;
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    setEffects(id, phase, effects) {
      const at = findNodePos(id);
      if (at == null) return false;
      if (view.state.doc.nodeAt(at)?.type.name !== "snippet") return false;
      const tr = setSnippetEffects(view.state, at, phase, effects);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    setSceneName(name) {
      const raw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      raw.name = name;
      view.dispatch(view.state.tr.setDocAttribute("raw", JSON.stringify(raw)));
      refreshJumpLabels(); // a jump targeting this scene shows its title - repaint those chips
    },
    setGameId(id, gameId) {
      const g = gameId.trim();
      const docRaw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      if (docRaw.id === id) { // the scene (the doc node)
        if (g) docRaw.gameId = g; else delete docRaw.gameId;
        view.dispatch(view.state.tr.setDocAttribute("raw", JSON.stringify(docRaw)));
        return true;
      }
      const at = findNodePos(id);
      if (at == null) return false;
      const node = view.state.doc.nodeAt(at);
      if (node?.type.name !== "block") return false;
      const raw = JSON.parse(node.attrs.raw as string) as Record<string, unknown>;
      if (g) raw.gameId = g; else delete raw.gameId;
      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, raw: JSON.stringify(raw) }));
      return true;
    },
    setGroupProps(id, patch) {
      const at = findNodePos(id);
      if (at == null) return false;
      if (view.state.doc.nodeAt(at)?.type.name !== "group") return false;
      const tr = setGroupPropsCmd(view.state, at, patch);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    setGameData(id, key, value) {
      // Edit `gameData[key]` inside the node's `raw` model JSON (sparse: drop the key, and the whole
      // `gameData` object, when emptied). Mirrors setGameId; works for the scene (doc node) + any node.
      const apply = (rawStr: string): string => {
        const raw = JSON.parse(rawStr) as Record<string, unknown>;
        const gd = (raw.gameData && typeof raw.gameData === "object" ? { ...(raw.gameData as Record<string, unknown>) } : {});
        if (value === undefined) delete gd[key]; else gd[key] = value;
        if (Object.keys(gd).length) raw.gameData = gd; else delete raw.gameData;
        return JSON.stringify(raw);
      };
      const docRaw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      if (docRaw.id === id) { // the scene is the doc node
        view.dispatch(view.state.tr.setDocAttribute("raw", apply(view.state.doc.attrs.raw as string)));
        return true;
      }
      const at = findNodePos(id);
      if (at == null) return false;
      const node = view.state.doc.nodeAt(at);
      if (!node) return false;
      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, raw: apply(node.attrs.raw as string) }));
      return true;
    },
    setTags(id, tags) {
      // Replace `raw.tags` (author tags #215); drop the key when empty. Mirrors setGameData - works for the
      // scene (doc node) + any node (block / group / snippet / beat).
      const apply = (rawStr: string): string => {
        const raw = JSON.parse(rawStr) as Record<string, unknown>;
        if (tags.length) raw.tags = tags; else delete raw.tags;
        return JSON.stringify(raw);
      };
      const docRaw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      if (docRaw.id === id) { // the scene is the doc node
        view.dispatch(view.state.tr.setDocAttribute("raw", apply(view.state.doc.attrs.raw as string)));
        return true;
      }
      const at = findNodePos(id);
      if (at == null) return false;
      const node = view.state.doc.nodeAt(at);
      if (!node) return false;
      view.dispatch(view.state.tr.setNodeMarkup(at, undefined, { ...node.attrs, raw: apply(node.attrs.raw as string) }));
      return true;
    },
    sceneProps() {
      const raw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      return Array.isArray(raw.sceneProps) ? (raw.sceneProps as PropertyDecl[]) : [];
    },
    setSceneProps(props) {
      // `sceneProps` rides in the scene doc's raw (bridge: `without(scene, "blocks")`), so this persists
      // via getSource like any other scene-level field. An empty list drops the key.
      const raw = JSON.parse(view.state.doc.attrs.raw as string) as Record<string, unknown>;
      if (props.length) raw.sceneProps = props; else delete raw.sceneProps;
      view.dispatch(view.state.tr.setDocAttribute("raw", JSON.stringify(raw)));
    },
    setJump(id, target) {
      const at = findNodePos(id);
      if (at == null) return false;
      if (view.state.doc.nodeAt(at)?.type.name !== "snippet") return false;
      const tr = setSnippetJump(view.state, at, target);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    setJumpMode(id, mode) {
      const at = findNodePos(id);
      if (at == null) return false;
      const node = view.state.doc.nodeAt(at);
      if (node?.type.name !== "snippet") return false;
      const cur = node.attrs.jump ? ((JSON.parse(node.attrs.jump as string) as { to?: string }).to ?? "") : "";
      if (!cur) return false; // no jump to re-mode
      const tr = setSnippetJump(view.state, at, cur, mode);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    editJump(id, anchor, afterPick) {
      const at = findNodePos(id);
      if (at == null) return;
      const node = view.state.doc.nodeAt(at);
      if (node?.type.name !== "snippet") return;
      const cur = node.attrs.jump ? ((JSON.parse(node.attrs.jump as string) as { to?: string }).to ?? "") : "";
      openTargetPicker({
        anchor, data: buildJumpData(), current: cur, allowClear: cur !== "",
        onPick: (target) => { const p = findNodePos(id); if (p == null) return; const tr = setSnippetJump(view.state, p, target); if (tr) view.dispatch(tr); afterPick?.(); },
      });
    },
    jumpTargets: () => flatTargets(),
    blockList: () => buildJumpData().scenes[0]?.blocks.slice() ?? [],
    setJumpTargets(targets) {
      opts.jumpTargets = targets;
      jumpLabels = null; // labels are memoized by doc identity; force a rebuild against the new targets
      refreshJumpLabels(); // re-humanize already-painted jump chips + condition tags against the new targets
                           // (a lazy load paints them before the cross-scene targets arrive - #171)
    },
    pickNode({ anchor, current, onPick }) {
      openTargetPicker({
        anchor, data: buildJumpData(), current, allowClear: false, allowEnd: false,
        onPick: (target) => { if (target) onPick(target); }, // scenes/blocks only; END/clear suppressed
      });
    },
    addOption(choiceId) {
      const at = findNodePos(choiceId);
      if (at == null) return false;
      const tr = insertOption(view.state, at);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    addPrompt(optionId) {
      const at = findNodePos(optionId);
      if (at == null) return false;
      const tr = addOptionPrompt(view.state, at);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    deleteChunk(id) {
      const at = findNodePos(id);
      if (at == null) return false;
      const tr = deleteChunkCmd(view.state, at);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    duplicate() {
      // A node-selected block / group / snippet duplicates itself; otherwise duplicate the chunk the
      // caret sits in (so Edit > Duplicate works while typing, without selecting the bubble first).
      const sel = view.state.selection;
      const at = sel instanceof NodeSelection && DUPLICABLE_KINDS.has(sel.node.type.name)
        ? sel.from
        : chunkContaining(view.state.doc, sel.from);
      if (at == null) return false;
      const res = duplicateChunk(view.state, at);
      if (!res) return false;
      notifyDuplicated(res.idMap); // the host carries status / notes across to the copies
      view.dispatch(res.tr);
      view.focus();
      return true;
    },
    moveChunk(id, dir) {
      const at = findNodePos(id);
      if (at == null) return false;
      const tr = moveChunkCmd(view.state, at, dir);
      if (!tr) return false;
      view.dispatch(tr);
      return true;
    },
    markLine(id) {
      cancelPendingMark?.(); cancelPendingMark = null; // drop any mark still waiting on the previous glide
      if (markedEl) { markedEl.classList.remove("playing"); markedEl.classList.add("visited"); visitedEls.add(markedEl); }
      markedEl = null;
      if (id == null) { repositionPointer(); return; }
      const at = findNodePos(id);
      if (at == null) { repositionPointer(); return; }
      const dom = view.nodeDOM(at);
      if (dom instanceof HTMLElement) {
        dom.classList.remove("visited"); visitedEls.delete(dom); // the playhead is here now, not behind
        markedEl = dom;
        const prevTop = playPointer.style.top;
        scrollMarkedToCentre(); // centre the first-line anchor (not the box) so a tall choice group's start shows
        repositionPointer();    // start the chevron gliding toward this beat
        // Light up the beat only once the chevron ARRIVES, so the wash never appears ahead of the pointer.
        // First placement (no glide yet) or a no-move re-mark: light up at once. Otherwise wait for the
        // pointer's `top` transition to end, with a timeout fallback in case it's missed.
        if (!playPointer.classList.contains("gliding") || playPointer.style.top === prevTop) {
          dom.classList.add("playing");
        } else {
          const apply = (): void => { cleanup(); if (markedEl === dom) dom.classList.add("playing"); };
          const onEnd = (e: TransitionEvent): void => { if (e.propertyName === "top") apply(); };
          const timer = window.setTimeout(apply, 260);
          const cleanup = (): void => { clearTimeout(timer); playPointer.removeEventListener("transitionend", onEnd); cancelPendingMark = null; };
          cancelPendingMark = cleanup;
          playPointer.addEventListener("transitionend", onEnd);
        }
      } else {
        repositionPointer();
      }
    },
    resetPlay() {
      cancelPendingMark?.(); cancelPendingMark = null;
      markedEl?.classList.remove("playing"); markedEl = null;
      for (const el of visitedEls) el.classList.remove("visited");
      visitedEls.clear();
      repositionPointer();
    },
    markProblems: (marks: ProblemMark[]) => setProblemMarks(view, marks),
    setSpellChecker: (checker: SpellChecker | null) => setSpellChecker(view, checker),
    spellingIssues: () => spellingIssues(view),
    setDocNotes: (map: DocNoteMap) => setDocNotes(view, map),
    setComments: (marks: CommentMark[]) => setComments(view, marks),
    commentRanges: () => commentRanges(view),
    setSuggestions: (marks: SuggestionMark[]) => setSuggestions(view, marks),
    setWritingStatus: (map: WritingStatusMap) => setWritingStatusMap(view, map),
    setWritingStatusLadder: (rungs: WritingStatusRung[]) => setWritingStatusLadder(rungs),
    setWritingStatusShown: (shown: string[]) => setWritingStatusShown(view, shown),
    setSayText: (nodeId: string, text: string) => {
      const tr = replaceSayText(view.state, nodeId, text);
      if (!tr) return false;
      view.dispatch(tr); view.focus(); return true;
    },
    sayText: (nodeId: string) => { const b = findBeatById(view.state.doc, nodeId); return b ? sayTextOf(b.node) : null; },
    lines: () => {
      const out: Array<{ id: string; text: string; character: string }> = [];
      view.state.doc.descendants((node) => {
        if (node.type.name === "line") { const id = node.attrs["id"] as string | undefined; if (id) out.push({ id, text: sayTextOf(node), character: cueText(node) }); }
        return true;
      });
      return out;
    },
    anchorFor: (nodeId: string) => { const b = findByModelId(view.state.doc, nodeId); if (!b) return null; const dom = view.nodeDOM(b.pos); return dom instanceof HTMLElement ? dom : null; },
    undo: () => { undo(view.state, view.dispatch); view.focus(); },
    redo: () => { redo(view.state, view.dispatch); view.focus(); },
    sceneName: () => opened.flow.scene.name,
    focus: () => view.focus(),
    destroy: () => { cancelPendingMark?.(); listeners.abort(); closeTargetPicker(); setPlayBlockHandler(null); setJumpNavHandler(null); pointerResize.disconnect(); playPointer.remove(); titleEl?.remove(); view.destroy(); },
  };
  opts.onChange?.(handle); // initial mirror
  opts.onSelect?.(inspect(view.state)); // initial inspector context
  return handle;
}
