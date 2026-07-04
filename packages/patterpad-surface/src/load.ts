// ---------------------------------------------------------------------------
// Real-shard I/O for the surface: turn on-disk Patter source into an editor
// document and back, through @patterkit/core - the SAME parse / serialize the
// CLI and CI use. The files are envelopes (spec section 10): a `.patterflow` is
// `{ schema, scene }`, a `.patterloc` is `{ schema, scene, locale, default?,
// strings }`. The editor edits the scene + its strings; the envelope metadata
// (schema, locale, ...) is preserved untouched. Line/text prose lives in the
// locale, keyed by beat id; the flow holds no prose.
// ---------------------------------------------------------------------------

import type { Node as PMNode } from "prosemirror-model";
import type { Scene, Group, Snippet, Beat, FlowFile, LocaleFile } from "@patterkit/model";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { sceneToDoc, docToScene, type Strings } from "./bridge.js";

/**
 * Locale keys a scene references that don't come from the document's beats: an
 * option's `prompt` beat id (spec §5; the prompt rides on the option group, so its
 * localised text is keyed by that beat id). Beat text keys come from the document
 * directly; everything else in a loc file that is NOT one of these is an orphan
 * (e.g. the string of a beat a merge removed) and is dropped on save - so deleting
 * content cannot silently leave dangling locale.
 */
/**
 * Drop a snippet's STRAY blank content beats on save (user request, design-lead). An empty-content
 * **dialogue line** is always removed (an incomplete beat, never deliberate). An empty **text line** is
 * removed too EXCEPT when it sits strictly between two non-blank beats - a deliberate paragraph break;
 * so a lone / leading / trailing / doubled blank text line goes, a single separator stays. SAVE-TIME
 * ONLY (never while editing - a just-created line is a valid lone blank). Mutates the scene + drops the
 * removed beats' empty strings.
 */
function pruneStrayBlankText(scene: Scene, strings: Strings): void {
  const empty = (b: Beat | undefined): boolean => !(strings[b!.id]?.trim());
  const blankText = (b: Beat | undefined): boolean => !!b && b.kind === "text" && empty(b);
  const blankLine = (b: Beat | undefined): boolean => !!b && b.kind === "line" && empty(b);
  const blank = (b: Beat | undefined): boolean => blankText(b) || blankLine(b); // any empty-content beat
  const visit = (node: Group | Snippet): void => {
    if (node.type === "group") { node.children.forEach(visit); return; }
    if (!node.beats) return;
    node.beats = node.beats.filter((b, i, arr) => {
      if (blankLine(b)) { delete strings[b.id]; return false; } // empty dialogue line: always pruned
      if (!blankText(b)) return true;
      const prev = arr[i - 1], next = arr[i + 1];
      const keep = !!prev && !!next && !blank(prev) && !blank(next); // a blank text line survives only as a deliberate separator
      if (!keep) delete strings[b.id];
      return keep;
    });
  };
  scene.blocks.forEach((bk) => bk.children.forEach(visit));
}

function promptKeys(scene: Scene): Set<string> {
  const keys = new Set<string>();
  const visit = (node: Group | Snippet): void => {
    if (node.type === "group") { if (node.prompt) keys.add(node.prompt.id); node.children.forEach(visit); }
  };
  scene.blocks.forEach((b) => b.children.forEach(visit));
  return keys;
}

/** An opened scene: the editor document plus the two file envelopes it came from. */
export interface OpenedScene {
  doc: PMNode;
  /** The `.patterflow` envelope; `.scene` is the opened (now editable) scene. */
  flow: FlowFile;
  /** The `.patterloc` envelope; `.strings` are the opened strings. */
  locale: LocaleFile;
  /** Whether inline formatting (bold / italic markup) is parsed / serialized for this scene
   *  (the project's `formatting` setting). Carried so save uses the same mode as open. */
  formatting: boolean;
}

function asObject(parsed: unknown, what: string): Record<string, unknown> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`not a ${what} (expected a JSON object)`);
  }
  return parsed as Record<string, unknown>;
}

/** Parse `.patterflow` source into a FlowFile envelope. Throws on the wrong shape/schema. */
export function flowFromSource(flowSource: string): FlowFile {
  const obj = asObject(parseSource(flowSource), ".patterflow file");
  if (typeof obj.schema !== "string" || !obj.schema.startsWith("patter/flow")) {
    throw new Error(`.patterflow: schema is '${String(obj.schema)}', expected 'patter/flow@...'`);
  }
  const scene = obj.scene;
  if (!scene || typeof scene !== "object" || !Array.isArray((scene as { blocks?: unknown }).blocks)) {
    throw new Error(".patterflow: `scene` is missing or has no `blocks` array");
  }
  return obj as unknown as FlowFile;
}

/** The scene inside a `.patterflow` (convenience over {@link flowFromSource}). */
export const sceneFromSource = (flowSource: string): Scene => flowFromSource(flowSource).scene;

/** Parse `.patterloc` source into a LocaleFile envelope. Throws on the wrong shape/schema. */
export function localeFromSource(locSource: string): LocaleFile {
  const obj = asObject(parseSource(locSource), ".patterloc file");
  if (typeof obj.schema !== "string" || !obj.schema.startsWith("patter/strings")) {
    throw new Error(`.patterloc: schema is '${String(obj.schema)}', expected 'patter/strings@...'`);
  }
  if (!obj.strings || typeof obj.strings !== "object" || Array.isArray(obj.strings)) {
    throw new Error(".patterloc: `strings` is missing or not an object");
  }
  return obj as unknown as LocaleFile;
}

/** Serialize a FlowFile to canonical `.patterflow` source bytes. */
export const serializeFlow = (flow: FlowFile): string => canonicalStringify(flow);

/** Serialize a LocaleFile to canonical `.patterloc` source bytes. */
export const serializeLocale = (locale: LocaleFile): string => canonicalStringify(locale);

/** Open a `.patterflow` + `.patterloc` pair as one editable scene. `formatting` (default ON, the
 *  product default) decides whether inline bold / italic markup in the strings is parsed into marks. */
export function openScene(flowSource: string, locSource: string, formatting = true): OpenedScene {
  const flow = flowFromSource(flowSource);
  const locale = localeFromSource(locSource);
  return { doc: sceneToDoc(flow.scene, locale.strings, formatting), flow, locale, formatting };
}

/**
 * Save an opened scene back to canonical `.patterflow` + `.patterloc` bytes. The
 * (possibly edited) document supplies the scene structure and beat text; the
 * locale is reconciled over the one it was opened from, so **every key the
 * surface does not manage (choice labels, etc.) is preserved** - the editor must
 * never silently drop locale a writer or another layer owns. Envelope metadata
 * (schema, locale, scene id, default) rides through untouched.
 */
export function saveScene(opened: OpenedScene, opts?: { prune?: boolean }): { flow: string; loc: string } {
  const { scene, strings: beatStrings } = docToScene(opened.doc, opened.formatting);
  // Beat text is authoritative from the document; live choice labels are carried
  // over from the opened locale. Any other key (a removed beat's orphaned string)
  // is dropped - the locale stays exactly the keys the scene still references.
  const strings: Strings = { ...beatStrings };
  if (opts?.prune) pruneStrayBlankText(scene, strings); // tidy stray blank text lines on save (not while editing)
  for (const key of promptKeys(scene)) {
    const value = opened.locale.strings[key];
    if (value !== undefined && !(key in strings)) strings[key] = value;
  }
  return {
    flow: serializeFlow({ ...opened.flow, scene }),
    loc: serializeLocale({ ...opened.locale, strings }),
  };
}
