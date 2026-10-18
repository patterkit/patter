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
import { EXTENSION_SCHEMA, UNRESOLVED_KEY } from "@patterkit/model";
import { parseSource, canonicalStringify } from "@patterkit/core";
import { sceneToDoc, docToScene, type Strings, type ExtValue } from "./bridge.js";

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
 * removed beats' empty strings. A beat in `carrying` (one holding extension data) is never blank: the
 * editor keeps it, so the save does too, data and all.
 */
function pruneStrayBlankText(scene: Scene, strings: Strings, carrying: ReadonlySet<string> = new Set()): void {
  const empty = (b: Beat | undefined): boolean => !carrying.has(b!.id) && !(strings[b!.id]?.trim());
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
  /** The scene's Patter extension data, by extension id: what of each shard isn't in the document. Absent
   *  when the scene was opened with none. */
  extensions?: Map<string, OpenedExtension>;
}

/** One extension's shard for the scene being opened, as the host read it. */
export interface SceneExtensionSource {
  /** The extension's id. */
  id: string;
  /** The shard's source text; "" when the scene has no shard for it yet. */
  source: string;
  /** The project takes the extension AND its manifest is sound: only then do its entries go into the
   *  document to be edited. Otherwise the shard is held whole and never written. */
  live: boolean;
}

/** Extension entries by node kind, then node id (a shard's `entries`). */
export type ExtensionEntries = Record<string, Record<string, Record<string, unknown>>>;

/** One extension's shard as the opened scene holds it, outside ProseMirror. */
export interface OpenedExtension {
  /** The shard as it was read (its `entries` included), or null when there was none, or it won't parse. */
  envelope: Record<string, unknown> | null;
  /** See SceneExtensionSource.live. */
  live: boolean;
  /** Entries the document has no place for: a node not in the scene (an orphan), a node of another kind,
   *  a kind that isn't Patter's. Written back untouched. A non-live shard holds nothing here: it is never
   *  rebuilt at all. */
  held: ExtensionEntries;
  /** The canonical text of the entries as opened, the baseline a save compares against. */
  baseline: string;
  /** A save has reported this shard changed: from then on every save reports it, so an undo back to the
   *  opened data is written too (the host skips a write whose bytes it already has). */
  reported: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Every (kind, id) a scene's nodes write extension data under, as `kind\0id`: the scene, its blocks,
 *  options (every group), snippets, and beats, an option's prompt included. */
function extensionKeys(scene: Scene): Set<string> {
  const keys = new Set<string>([`scene\0${scene.id}`]);
  const beat = (b: Beat): void => { keys.add(`${b.kind === "text" ? "text" : b.kind}\0${b.id}`); };
  const visit = (n: Group | Snippet): void => {
    if (n.type === "group") { keys.add(`option\0${n.id}`); if (n.prompt) beat(n.prompt); n.children.forEach(visit); }
    else if (n.type === "snippet") { keys.add(`snippet\0${n.id}`); (n.beats ?? []).forEach(beat); }
  };
  for (const b of scene.blocks) { keys.add(`block\0${b.id}`); b.children.forEach(visit); }
  return keys;
}

/** Read the scene's extension shards: each live one's entries split between the document (the `ext`
 *  lookup) and what it holds back. */
function openExtensions(scene: Scene, sources: readonly SceneExtensionSource[]): {
  extensions: Map<string, OpenedExtension>; lookup: (kind: string, id: string) => string;
} {
  const extensions = new Map<string, OpenedExtension>();
  const inDoc = extensionKeys(scene);
  const byNode = new Map<string, Record<string, unknown>>(); // kind\0id -> { extension id: entry }
  for (const src of [...sources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    let envelope: Record<string, unknown> | null = null;
    let live = src.live;
    if (src.source.trim()) {
      try {
        const parsed = parseSource(src.source);
        if (isObj(parsed)) envelope = parsed; else live = false;
      } catch { live = false; } // a shard that won't parse is left alone: the host reports it
    }
    const entries = envelope && isObj(envelope.entries) ? envelope.entries as ExtensionEntries : {};
    const held: ExtensionEntries = {};
    if (live) {
      for (const [kind, ids] of Object.entries(entries)) {
        if (!isObj(ids)) { held[kind] = ids as Record<string, Record<string, unknown>>; continue; }
        for (const [id, entry] of Object.entries(ids)) {
          const key = `${kind}\0${id}`;
          if (inDoc.has(key) && isObj(entry)) {
            const node = byNode.get(key) ?? {};
            node[src.id] = entry;
            byNode.set(key, node);
          } else {
            (held[kind] ??= {})[id] = entry as Record<string, unknown>;
          }
        }
      }
    }
    // The baseline without empty kind maps (a hand edit or a merge may leave `"line": {}`), as a save rebuilds
    // it, so an untouched scene never writes.
    const baseline = Object.fromEntries(Object.entries(entries).filter(([, ids]) => !isObj(ids) || Object.keys(ids).length > 0));
    extensions.set(src.id, { envelope, live, held, baseline: canonicalStringify(baseline), reported: false });
  }
  return { extensions, lookup: (kind, id) => { const v = byNode.get(`${kind}\0${id}`); return v ? JSON.stringify(v) : ""; } };
}

/** The scene's extension shards rebuilt from the document's `ext` values and what each holds back (the
 *  document wins where both have a node), by extension id: the canonical text of each shard that changed,
 *  or null for one left with no data (its file goes). Unchanged shards are left out, unless `all`. */
function saveExtensions(
  opened: OpenedScene, sceneId: string, values: readonly ExtValue[], all: boolean,
): Record<string, string | null> {
  const fromDoc = new Map<string, ExtensionEntries>();
  for (const v of values) {
    let parsed: unknown;
    try { parsed = JSON.parse(v.value); } catch { continue; }
    if (!isObj(parsed)) continue;
    for (const [extId, entry] of Object.entries(parsed)) {
      if (!isObj(entry)) continue;
      const entries = fromDoc.get(extId) ?? {};
      (entries[v.kind] ??= {})[v.id] = entry;
      fromDoc.set(extId, entries);
    }
  }
  const out: Record<string, string | null> = {};
  const opens = opened.extensions ?? new Map<string, OpenedExtension>();
  const ids = [...new Set([...opens.keys(), ...fromDoc.keys()])].sort();
  for (const extId of ids) {
    let ext = opens.get(extId);
    if (ext && !ext.live) continue; // held whole, never rewritten
    if (!ext) { // an extension that had no shard and wasn't named at open: written fresh
      ext = { envelope: null, live: true, held: {}, baseline: canonicalStringify({}), reported: false };
      opens.set(extId, ext);
      opened.extensions = opens;
    }
    const entries: ExtensionEntries = structuredClone(ext.held);
    for (const [kind, nodes] of Object.entries(fromDoc.get(extId) ?? {})) {
      for (const [id, entry] of Object.entries(nodes)) (entries[kind] ??= {})[id] = entry;
    }
    for (const kind of Object.keys(entries)) if (isObj(entries[kind]) && Object.keys(entries[kind]!).length === 0) delete entries[kind];
    const changed = canonicalStringify(entries) !== ext.baseline;
    if (!changed && !ext.reported && !all) continue;
    if (changed) ext.reported = true;
    const marked = !!ext.envelope && Object.prototype.hasOwnProperty.call(ext.envelope, UNRESOLVED_KEY);
    if (Object.keys(entries).length === 0 && !marked) {
      if (ext.envelope || ext.reported) out[extId] = null; // emptied: the file goes (none on disk: nothing to do)
      continue;
    }
    const base = ext.envelope ?? { schema: EXTENSION_SCHEMA, extension: extId, scene: sceneId };
    out[extId] = canonicalStringify({ ...base, entries });
  }
  return out;
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
 *  product default) decides whether inline bold / italic markup in the strings is parsed into marks.
 *  `extensions` are the scene's Patter extension shards (patterkit design/patterpad-undo.md, half A):
 *  each live one's entries go onto their nodes' `ext`, and everything else is held back. */
export function openScene(flowSource: string, locSource: string, formatting = true, extensions: readonly SceneExtensionSource[] = []): OpenedScene {
  const flow = flowFromSource(flowSource);
  const locale = localeFromSource(locSource);
  if (extensions.length === 0) return { doc: sceneToDoc(flow.scene, locale.strings, formatting), flow, locale, formatting };
  const ext = openExtensions(flow.scene, extensions);
  return { doc: sceneToDoc(flow.scene, locale.strings, formatting, ext.lookup), flow, locale, formatting, extensions: ext.extensions };
}

/** What a save produces: the flow and loc shards' text, and the extension shards that changed. */
export interface SavedScene {
  flow: string;
  loc: string;
  /** By extension id: the shard's new text, or null when it has no data left (its file is deleted). Only
   *  the shards whose entries changed since the scene was opened (and, after that, every save of them),
   *  so a scene whose extension data nobody touched writes none. */
  extensions: Record<string, string | null>;
}

/**
 * Save an opened scene back to canonical `.patterflow` + `.patterloc` bytes. The
 * (possibly edited) document supplies the scene structure and beat text; the
 * locale is reconciled over the one it was opened from, so **every key the
 * surface does not manage (choice labels, etc.) is preserved** - the editor must
 * never silently drop locale a writer or another layer owns. Envelope metadata
 * (schema, locale, scene id, default) rides through untouched.
 *
 * The extension shards are rebuilt from the document's `ext` values plus the entries held back at open,
 * keeping each shard's envelope (an `unresolved` mark included). `rebuildExtensions` reports every live
 * shard, changed or not (for tests). Marks the shards it reports on `opened`, so later saves keep
 * reporting them (see OpenedExtension.reported).
 */
export function saveScene(opened: OpenedScene, opts?: { prune?: boolean; rebuildExtensions?: boolean }): SavedScene {
  const { scene, strings: beatStrings, ext } = docToScene(opened.doc, opened.formatting);
  // Beat text is authoritative from the document; live choice labels are carried
  // over from the opened locale. Any other key (a removed beat's orphaned string)
  // is dropped - the locale stays exactly the keys the scene still references.
  const strings: Strings = { ...beatStrings };
  // Tidy stray blank text lines on save (not while editing), keeping any beat that carries extension data.
  if (opts?.prune) pruneStrayBlankText(scene, strings, new Set(ext.filter((v) => v.value).map((v) => v.id)));
  for (const key of promptKeys(scene)) {
    const value = opened.locale.strings[key];
    if (value !== undefined && !(key in strings)) strings[key] = value;
  }
  // A beat the prune removed takes its extension data with it, as a deleted beat does.
  const kept = opts?.prune ? extensionKeys(scene) : null;
  const values = kept ? ext.filter((v) => kept.has(`${v.kind}\0${v.id}`)) : ext;
  const extensions = opened.extensions || values.length ? saveExtensions(opened, scene.id, values, opts?.rebuildExtensions === true) : {};
  return {
    flow: serializeFlow({ ...opened.flow, scene }),
    loc: serializeLocale({ ...opened.locale, strings }),
    extensions,
  };
}
