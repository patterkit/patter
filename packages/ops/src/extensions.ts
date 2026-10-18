// ---------------------------------------------------------------------------
// A project's Patter extensions, as the tools that touch files find them.
//
// The merge reads the manifest from the PROJECT, never from what is installed
// on the machine (patterkit design/proposals/patter-storylet-extensions.md,
// "Merge"), so every machine and CI merge alike. A git merge driver is handed
// three temp files and the shard's real path, so it finds the project from the
// path and the manifest in the working tree, which is this file's one job.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { canonicalStringify, parseSource } from "@patterkit/core";
import { EXTENSIONS_DIR, MANIFEST_EXTENSION } from "@patterkit/model";
import type { ExtensionShard, ProjectExtension } from "@patterkit/model";
import { manifestProblems, parseManifest, renameStages, targetOf } from "@wildwinter/toolkit/extensions";
import type { Manifest, TypeDecl } from "@wildwinter/toolkit/extensions";
import type { LoadedProject } from "./load.js";

/** Conflict markers a text merge leaves: a manifest that has them is in conflict itself. */
const CONFLICT_MARKERS = /^(<{7}|={7}|>{7})( |$)/m;

/** Where a project keeps an extension's manifest. */
export const manifestPath = (projectDir: string, id: string): string =>
  join(projectDir, EXTENSIONS_DIR, `${id}${MANIFEST_EXTENSION}`);

/**
 * The project's copy of an extension's manifest, when there is a sound one. Undefined when it's missing,
 * won't parse, is itself mid-conflict, or has errors: the merge then takes each node's entry as one value,
 * which is always safe (rule 4 of the merge).
 */
export function readProjectManifest(projectDir: string, id: string): Manifest | undefined {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) return undefined;
  let text: string;
  try { text = readFileSync(manifestPath(projectDir, id), "utf8"); } catch { return undefined; }
  return soundManifest(text);
}

/** A manifest's text as a merge may use it: undefined when it won't parse, is mid-conflict itself, or has
 *  errors. For a host holding files as text (a pack, say). */
export function soundManifest(text: string): Manifest | undefined {
  if (CONFLICT_MARKERS.test(text)) return undefined;
  try {
    const manifest = parseManifest(text);
    return manifestProblems(manifest).some((p) => p.severity === "error") ? undefined : manifest;
  } catch {
    return undefined;
  }
}

/** A manifest lookup for a merge in one project folder. */
export const projectManifests = (projectDir: string) => (id: string): Manifest | undefined =>
  readProjectManifest(projectDir, id);

/** A manifest as the loader read it (parsed, unchecked), when it is sound: undefined when it has errors. */
const soundOf = (manifest: unknown): Manifest | undefined =>
  manifestProblems(manifest).some((p) => p.severity === "error") ? undefined : (manifest as Manifest);

/** What taking new extension versions writes: each data shard with its renamed stages renamed, and the
 *  project file with the new pins. */
export interface ExtensionUpgrade {
  /** Absolute path to canonical content. */
  readonly writes: Map<string, string>;
  /** A line per change, for a person reading the output. */
  readonly report: string[];
  /** The same changes by the file each is in: the pins by the project file, the renames by shard. */
  readonly notes: Map<string, string[]>;
}

/**
 * Take every extension whose manifest is a version other than the project's pin (`patter format` on a
 * project folder): the stages the manifest says it renamed are renamed in that extension's data, and the pin
 * moves to the manifest's version, as one step (the proposal's "renamedStages" rule). A manifest that is
 * missing or unsound is left alone, as its data is. Until it runs, a renamed stage still in the data
 * compiles under its new name, with a warning.
 */
export function planExtensionUpgrades(loaded: LoadedProject): ExtensionUpgrade {
  const writes = new Map<string, string>();
  const report: string[] = [];
  const notes = new Map<string, string[]>();
  const note = (path: string, line: string): void => { notes.set(path, [...(notes.get(path) ?? []), line]); };
  const taken = loaded.project.extensions ?? {};
  const moved: Record<string, ProjectExtension> = {};
  const rel = (path: string): string => relative(loaded.root, path).split(sep).join("/");
  for (const [id, pin] of Object.entries(taken)) {
    const file = loaded.manifests.find((m) => m.id === id);
    const manifest = file !== undefined ? soundOf(file.manifest) : undefined;
    if (manifest === undefined || pin?.version === manifest.version) continue;
    moved[id] = { ...pin, version: manifest.version };
    const took = `took the Patter extension "${id}" at version ${manifest.version}${pin?.version ? ` (was ${pin.version})` : ""}`;
    report.push(took);
    note(loaded.projectFile, took);
    loaded.extensionShards.forEach((shard, i) => {
      if (shard.extension !== id) return;
      let renamed = 0;
      const entries: ExtensionShard["entries"] = {};
      for (const [kind, byNode] of Object.entries(shard.entries ?? {})) {
        const target = targetOf(manifest, "patter", kind);
        const out: Record<string, Record<string, unknown>> = {};
        for (const [node, entry] of Object.entries(byNode ?? {})) {
          if (target === undefined || typeof entry !== "object" || entry === null || Array.isArray(entry)) { out[node] = entry; continue; }
          const r = renameStages(target, entry);
          renamed += r.renames.length;
          out[node] = r.entry;
        }
        entries[kind] = out;
      }
      if (renamed > 0) {
        const path = loaded.extensionShardFiles[i]!;
        writes.set(path, canonicalStringify({ ...shard, entries }));
        const what = `renamed ${renamed} stage value${renamed === 1 ? "" : "s"} for "${id}"`;
        report.push(`  ${what} in ${rel(path)}`);
        note(path, what);
      }
    });
  }
  if (Object.keys(moved).length > 0) {
    // From the file as it is, not the loaded model: a merge's mark, say, is kept.
    const project = parseSource(readFileSync(loaded.projectFile, "utf8")) as Record<string, unknown>;
    writes.set(loaded.projectFile, canonicalStringify({ ...project, extensions: { ...taken, ...moved } }));
  }
  return { writes, report, notes };
}

/** One extension data shard a cast rename rewrote. */
export interface CastKeyRewrite {
  path: string;
  shard: ExtensionShard;
  /** How many keys and values it renamed. */
  renamed: number;
}

/**
 * A cast rename carried into extension data (ruling 8 of the extensions proposal): every map key whose key
 * type is a reference to `cast`, and every reference value to `cast`, at any depth, that names an old name
 * is rewritten to the new one. All at once, so a swap of two names lands as a swap. Only what the manifest
 * declares is touched, so a shard whose manifest is missing or unsound is left as it is (a missing cast key
 * stays the error validation says it is). A map that already holds the new name as a key keeps both keys,
 * and validation reports the old one. Pure: returns the shards it changed, as new objects.
 */
export function renameCastKeys(
  shards: ReadonlyArray<{ path: string; shard: ExtensionShard }>,
  manifests: ReadonlyArray<{ id: string; manifest: unknown }>,
  renames: ReadonlyMap<string, string>,
): CastKeyRewrite[] {
  const out: CastKeyRewrite[] = [];
  if (renames.size === 0) return out;
  const sound = new Map<string, Manifest>();
  for (const m of manifests) { const s = soundOf(m.manifest); if (s !== undefined) sound.set(m.id, s); }
  for (const { path, shard } of shards) {
    const manifest = sound.get(shard.extension);
    if (manifest === undefined) continue;
    const count = { n: 0 };
    const entries: ExtensionShard["entries"] = {};
    for (const [kind, byNode] of Object.entries(shard.entries ?? {})) {
      const fields = targetOf(manifest, "patter", kind)?.fields ?? [];
      const nodes: Record<string, Record<string, unknown>> = {};
      for (const [node, entry] of Object.entries(byNode ?? {})) {
        nodes[node] = typeof entry === "object" && entry !== null && !Array.isArray(entry) ? renameFields(fields, entry, renames, count) : entry;
      }
      entries[kind] = nodes;
    }
    if (count.n > 0) out.push({ path, shard: { ...shard, entries }, renamed: count.n });
  }
  return out;
}

/** A record's declared fields, each renamed by its type; undeclared keys as they are. */
function renameFields(
  fields: readonly { name: string }[], record: Record<string, unknown>, renames: ReadonlyMap<string, string>, count: { n: number },
): Record<string, unknown> {
  const decls = new Map(fields.map((f) => [f.name, f as unknown as TypeDecl]));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    const decl = decls.get(k);
    out[k] = decl !== undefined ? renameValue(decl, v, renames, count) : v;
  }
  return out;
}

/** One value renamed by its declared type, at any depth. */
function renameValue(decl: TypeDecl, value: unknown, renames: ReadonlyMap<string, string>, count: { n: number }): unknown {
  const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  switch (decl.type) {
    case "reference": {
      const to = decl.to === "cast" && typeof value === "string" ? renames.get(value) : undefined;
      if (to === undefined) return value;
      count.n++;
      return to;
    }
    case "record":
      return isRecord(value) ? renameFields(decl.fields ?? [], value, renames, count) : value;
    case "list":
      return Array.isArray(value) && decl.of !== undefined ? value.map((v) => renameValue(decl.of!, v, renames, count)) : value;
    case "map": {
      if (!isRecord(value)) return value;
      const castKeys = decl.key?.type === "reference" && decl.key.to === "cast";
      // All keys at once, so a swap lands as a swap; a key whose new name another key also ends up with
      // (a member of that name already keyed) keeps its old name, for validation to report.
      const finals = Object.keys(value).map((k) => (castKeys ? renames.get(k) ?? k : k));
      const taken = new Map<string, number>();
      for (const f of finals) taken.set(f, (taken.get(f) ?? 0) + 1);
      const out: Record<string, unknown> = {};
      Object.entries(value).forEach(([k, v], i) => {
        const renamed = decl.of !== undefined ? renameValue(decl.of, v, renames, count) : v;
        const to = finals[i]!;
        if (to !== k && taken.get(to) === 1) { out[to] = renamed; count.n++; } else out[k] = renamed;
      });
      return out;
    }
    default:
      return value;
  }
}
