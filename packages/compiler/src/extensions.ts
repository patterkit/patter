// ---------------------------------------------------------------------------
// Patter extensions: the one manifest-driven pass (patterkit
// design/proposals/patter-storylet-extensions.md, "The command lines").
//
// The compiler knows that extension data exists, and its shape, never its
// meaning. Everything about the shape is `@wildwinter/toolkit/extensions`' (the
// manifest's checks, the value checks, what a bundle carries of a declaration
// and of a value); what is Patter's is where the data sits (one shard per
// extension per scene, and one for the project), which nodes there are, and how
// a claim meets the gameData fields the project declares.
//
// Pure, and a function of the source alone: export compiles the values onto
// the nodes, and validate reports the issues.
// ---------------------------------------------------------------------------

import { EXTENSIONS_DIR, MANIFEST_EXTENSION, PROJECT_LOCALE_SCENE } from "@patterkit/model";
import type {
  BundleExtension, ExtensionFieldDecl, ExtensionShard, GameData, Group, NodeExtensions, ProjectFile, Scene, Snippet,
} from "@patterkit/model";
import {
  HOSTS, claimClashes, compileEntry, compiledTarget, effectiveClaim, entryProblems, manifestProblems, orphanedEntries, pickClashes,
  pickLists, resolvedClaims, settingValues, targetOf, valueProblems,
} from "@wildwinter/toolkit/extensions";
import type { Manifest, Problem, ResolvedClaim, TypeDecl, ValueContext } from "@wildwinter/toolkit/extensions";

/** One extension's manifest, as a project keeps it (`extensions/<id>.extension.json`). */
export interface ExtensionManifestFile {
  /** Where it is, for the report. */
  path: string;
  /** The file's stem, which names the extension it should be. */
  id: string;
  /** The parsed JSON, unchecked: the pass says whether it is sound. */
  manifest: unknown;
}

/** One extension data shard (`.patterextension`), with where it is. */
export interface ExtensionShardFile {
  /** `<layout.extensions>/<extension id>/<scene file stem>.patterextension`: the folder names the extension. */
  path: string;
  shard: ExtensionShard;
}

/** What the pass reads: the project, its scenes, and its extension files. */
export interface ExtensionPassInput {
  project: ProjectFile;
  scenes: Scene[];
  manifests: readonly ExtensionManifestFile[];
  shards: readonly ExtensionShardFile[];
  /** The project file's path, for the report (default `""`). */
  projectPath?: string;
  /** Each scene's file, by scene id, for the report. */
  sceneFiles?: Readonly<Record<string, string>>;
}

/** One thing the pass found. `file` is the file to open; `node` the node id, when it is about one. */
export interface ExtensionIssue {
  severity: "error" | "warning";
  file: string;
  node?: string;
  /** The toolkit's stable name for the problem, when it is one of the toolkit's. */
  code?: string;
  message: string;
}

/** What the pass hands the bundle. */
export interface CompiledExtensions {
  /** The bundle's `extensions` section, by extension id. Empty when the project takes none. */
  readonly bundle: Record<string, BundleExtension>;
  /** Each node's compiled values, by node id: what goes on the node as `extensions`. */
  readonly nodes: ReadonlyMap<string, NodeExtensions>;
}

/** A node the project has: its kind, the scene it belongs to (none for the project's own), and its gameData. */
export interface ExtensionNode {
  readonly kind: string;
  readonly scene?: string;
  readonly gameData?: GameData;
}

/**
 * Every node an extension can attach to, by id (ids are project-unique): the project, each scene, block and
 * snippet, a choice's options (the groups directly inside a `choice` group, as gameData's `option` is), and
 * every beat by its kind, an option's prompt beat included. A bare snippet in a choice stays a snippet.
 */
export function extensionNodes(project: ProjectFile, scenes: readonly Scene[]): Map<string, ExtensionNode> {
  const nodes = new Map<string, ExtensionNode>();
  const add = (id: string, kind: string, scene: string | undefined, gameData: GameData | undefined): void => {
    if (!nodes.has(id)) nodes.set(id, { kind, ...(scene !== undefined ? { scene } : {}), ...(gameData !== undefined ? { gameData } : {}) });
  };
  add(project.project.id, "project", undefined, undefined);
  for (const scene of scenes) {
    const s = scene.id;
    add(s, "scene", s, scene.gameData);
    const walk = (children: Array<Group | Snippet>, inChoice: boolean): void => {
      for (const node of children ?? []) {
        if (node.type === "group") {
          if (inChoice) {
            add(node.id, "option", s, node.gameData);
            if (node.prompt) add(node.prompt.id, node.prompt.kind, s, node.prompt.gameData);
          }
          walk(node.children ?? [], node.selector === "choice");
          continue;
        }
        add(node.id, "snippet", s, node.gameData);
        for (const beat of node.beats ?? []) add(beat.id, beat.kind, s, beat.gameData);
      }
    };
    for (const block of scene.blocks ?? []) {
      add(block.id, "block", s, block.gameData);
      walk(block.children ?? [], false);
    }
  }
  return nodes;
}

/** A problem from the shared checks, in this pass's report shape. */
const issueOf = (file: string, p: Problem, prefix = "", node?: string): ExtensionIssue => ({
  severity: p.severity, file, code: p.code,
  ...(node !== undefined ? { node } : {}),
  message: p.path === "" ? `${prefix}${p.message}` : `${prefix}${p.path}: ${p.message}`,
});

/** The folder a shard sits in, which names its extension. */
const folderOf = (path: string): string | undefined => {
  const parts = path.split(/[\\/]/);
  return parts.length >= 2 ? parts[parts.length - 2] : undefined;
};

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** The extensions a project takes and the manifests it has, matched up. */
interface Taken {
  readonly id: string;
  readonly settings: Readonly<Record<string, unknown>>;
  /** The manifest, when the project has a sound one. */
  readonly manifest?: Manifest;
}

/**
 * Validate every extension, and compile what may be compiled. `issues` is the pass's report; `compiled` is
 * what the bundle carries. Data whose manifest is missing or unsound is reported and left out of the bundle,
 * never changed; an entry with an error is left out on its own.
 */
export function extensionPass(input: ExtensionPassInput): { issues: ExtensionIssue[]; compiled: CompiledExtensions } {
  const { project, scenes } = input;
  const issues: ExtensionIssue[] = [];
  const projectPath = input.projectPath ?? "";
  const taken = project.extensions ?? {};
  const manifests = new Map<string, { path: string; manifest: unknown; sound: boolean }>();

  // --- the manifests --------------------------------------------------------------
  for (const m of input.manifests) {
    const problems = manifestProblems(m.manifest);
    for (const p of problems) issues.push(issueOf(m.path, p, "manifest "));
    let sound = !problems.some((p) => p.severity === "error");
    const id = (m.manifest as { id?: unknown } | null)?.id;
    if (sound && id !== m.id) {
      issues.push({ severity: "error", file: m.path,
        message: `the manifest's id is "${String(id)}", but its file is named for "${m.id}"; a manifest is called <id>${MANIFEST_EXTENSION}` });
      sound = false;
    }
    if (sound && (m.manifest as Manifest).targets.patter === undefined) {
      issues.push({ severity: "warning", file: m.path,
        message: `"${m.id}" isn't a Patter extension: its manifest targets no Patter node kind, so it adds nothing here` });
    }
    manifests.set(m.id, { path: m.path, manifest: m.manifest, sound });
  }

  // --- what the project takes ---------------------------------------------------------
  const takenList: Taken[] = [];
  for (const [id, entry] of Object.entries(taken)) {
    const m = manifests.get(id);
    const version = typeof entry?.version === "string" ? entry.version : "";
    const settings = (entry?.settings ?? {}) as Record<string, unknown>;
    if (m === undefined) {
      issues.push({ severity: "warning", file: projectPath,
        message: `the project takes the Patter extension "${id}", but has no manifest for it at ${EXTENSIONS_DIR}/${id}${MANIFEST_EXTENSION}; its data is left as it is, and not compiled` });
      takenList.push({ id, settings });
      continue;
    }
    if (!m.sound) { takenList.push({ id, settings }); continue; }
    const manifest = m.manifest as Manifest;
    if (version !== manifest.version) {
      issues.push({ severity: "warning", file: projectPath,
        message: `the project takes "${id}" ${version === "" ? "with no version" : `at version ${version}`}, but its manifest is version ${manifest.version}; run \`patter format\` to take it (renamed stages are renamed in the data as it does)` });
    }
    const known = new Set((manifest.settings ?? []).map((s) => s.name));
    for (const [name, value] of Object.entries(settings)) {
      if (!known.has(name)) {
        issues.push({ severity: "warning", file: projectPath, message: `"${id}" has no setting "${name}"; it's ignored` });
      } else if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        issues.push({ severity: "error", file: projectPath,
          message: `"${id}"'s setting "${name}" names a gameData field, so it's a field name, not ${JSON.stringify(value)}` });
      }
    }
    takenList.push({ id, settings, manifest });
  }
  const sound = new Map(takenList.filter((t) => t.manifest !== undefined).map((t) => [t.id, t.manifest!]));

  // --- claims on gameData fields --------------------------------------------------------
  const nodes = extensionNodes(project, scenes);
  const claims: ResolvedClaim[] = takenList.flatMap((t) => (t.manifest ? resolvedClaims(t.manifest, "patter", t.settings) : []));
  for (const p of claimClashes(claims)) issues.push({ severity: p.severity, file: projectPath, code: p.code, message: p.message });
  issues.push(...claimIssues(input, nodes, claims));

  // --- the data ---------------------------------------------------------------------------
  const exists = (kind: string, id: string): boolean =>
    kind === "cast" ? (project.cast ?? []).some((c) => c.name === id) : nodes.get(id)?.kind === kind;
  // A pick's choices: the cast and the project's nodes by kind, and each extension's own project lists, read
  // off its project entry wherever that entry sits.
  const projectId = project.project.id;
  const projectEntries = new Map<string, Record<string, unknown>>();
  for (const { shard } of input.shards) {
    const entry = (shard.entries as Record<string, Record<string, unknown> | undefined> | undefined)?.["project"]?.[projectId];
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry) && !projectEntries.has(shard.extension)) {
      projectEntries.set(shard.extension, entry as Record<string, unknown>);
    }
  }
  const contexts = new Map<string, ValueContext>();
  for (const [ext, manifest] of sound) {
    contexts.set(ext, { exists, list: pickLists(targetOf(manifest, "patter", "project"), projectEntries.get(ext)) });
  }
  const nodesOf = (kind: string): { id: string }[] =>
    kind === "cast" ? (project.cast ?? []).map((c) => ({ id: c.name })) : [...nodes].filter(([, n]) => n.kind === kind).map(([id]) => ({ id }));
  for (const [ext, manifest] of [...sound].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    // A name two of a pick's sources hold, once for the project however many fields offer it.
    const said = new Set<string>();
    for (const decl of pickDecls(manifest)) {
      for (const p of pickClashes(decl, { nodes: nodesOf, list: contexts.get(ext)!.list! })) {
        if (said.has(p.message)) continue;
        said.add(p.message);
        issues.push({ severity: p.severity, file: projectPath, node: projectId, code: p.code, message: `the Patter extension "${ext}": ${p.message}` });
      }
    }
  }

  const sceneIds = new Set(scenes.map((s) => s.id));
  const values = new Map<string, NodeExtensions>();
  const projectValues = new Map<string, Record<string, unknown>>();
  for (const { path, shard } of [...input.shards].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const folder = folderOf(path);
    if (folder !== undefined && shard.extension !== folder) {
      issues.push({ severity: "error", file: path,
        message: `this shard says it holds "${String(shard.extension)}", but it sits in the folder for "${folder}"` });
      continue;
    }
    const ext = shard.extension;
    if (!own(taken, ext)) {
      issues.push({ severity: "warning", file: path,
        message: `data for the Patter extension "${ext}", which the project doesn't take; it's left as it is, and not compiled` });
      continue;
    }
    const entries = shard.entries as unknown;
    if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
      issues.push({ severity: "error", file: path, message: "entries are an object, by node kind and then node id" });
      continue;
    }
    const shardScene = shard.scene === PROJECT_LOCALE_SCENE ? undefined : shard.scene;
    const sceneKnown = shardScene === undefined || sceneIds.has(shardScene);
    if (!sceneKnown) {
      issues.push({ severity: "warning", file: path,
        message: `this shard is for scene "${shard.scene}", which the project doesn't have; its entries are compiled where their nodes are` });
    }
    for (const p of orphanedEntries(shard, exists)) issues.push(issueOf(path, p));
    const manifest = sound.get(ext);
    if (manifest === undefined) continue;   // reported above; the data stays as it is
    for (const [kind, byNode] of Object.entries(entries as Record<string, unknown>)) {
      if (!HOSTS.patter.kinds.includes(kind)) {
        issues.push({ severity: "warning", file: path,
          message: `entries.${kind}: "${kind}" isn't a Patter node kind; these entries are kept, and not compiled` });
        continue;
      }
      const target = targetOf(manifest, "patter", kind);
      if (target === undefined) {
        issues.push({ severity: "warning", file: path,
          message: `entries.${kind}: "${ext}" declares nothing for a ${kind}; these entries are kept, and not compiled` });
        continue;
      }
      if (typeof byNode !== "object" || byNode === null || Array.isArray(byNode)) continue;
      for (const [id, entry] of Object.entries(byNode as Record<string, unknown>)) {
        const node = nodes.get(id);
        if (node === undefined || node.kind !== kind) continue;   // an orphan: reported above
        if (sceneKnown && node.scene !== shardScene) {
          issues.push({ severity: "warning", file: path, node: id,
            message: `entries.${kind}.${id} belongs ${node.scene === undefined ? "in the project's own shard" : `in scene "${node.scene}"'s shard`}; it's compiled from here all the same` });
        }
        const problems = entryProblems(target, entry, contexts.get(ext) ?? { exists });
        for (const p of problems) issues.push(issueOf(path, p, `entries.${kind}.${id}${p.path === "" ? ": " : "."}`, id));
        if (problems.some((p) => p.severity === "error")) continue;
        const compiled = compileEntry(target, entry as Record<string, unknown>);
        if (compiled === undefined) continue;
        if (kind === "project") { projectValues.set(ext, compiled); continue; }
        values.set(id, { ...(values.get(id) ?? {}), [ext]: compiled });
      }
    }
  }

  // --- the bundle's section ---------------------------------------------------------------
  const bundle: Record<string, BundleExtension> = {};
  const chosen = new Map(takenList.map((t) => [t.id, t.settings]));
  for (const [id, manifest] of [...sound.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const fields: Record<string, ExtensionFieldDecl[]> = {};
    for (const kind of Object.keys(manifest.targets.patter ?? {}).sort()) {
      const target = targetOf(manifest, "patter", kind);
      if (target !== undefined) fields[kind] = compiledTarget(target) as unknown as ExtensionFieldDecl[];
    }
    const projectEntry = projectValues.get(id);
    // Every setting the manifest declares, the project's value or else its default, so a game can read which
    // host field a claim presents. Only when the manifest declares settings.
    const settings = (manifest.settings ?? []).length > 0 ? sortRecord(settingValues(manifest, chosen.get(id))) : undefined;
    bundle[id] = {
      version: manifest.version, fields,
      ...(projectEntry !== undefined ? { project: projectEntry } : {}),
      ...(settings !== undefined ? { settings } : {}),
    };
  }
  const sortedNodes = new Map([...values.entries()].map(([id, v]) => [id, sortRecord(v)]));
  return { issues, compiled: { bundle, nodes: sortedNodes } };
}

/** Every pick a manifest declares for Patter, at any depth (in a record, or as a map's or a list's items). */
function pickDecls(manifest: Manifest): TypeDecl[] {
  const out: TypeDecl[] = [];
  const walk = (decl: TypeDecl): void => {
    if (decl.type === "pick") out.push(decl);
    for (const f of decl.fields ?? []) walk(f);
    if (decl.of !== undefined) walk(decl.of);
  };
  for (const target of Object.values(manifest.targets.patter ?? {})) for (const f of target.fields ?? []) walk(f);
  return out;
}

/** A record with its keys in order: the same values, whatever order the shards were read in. */
function sortRecord<T>(r: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(r).sort().map((k) => [k, r[k]!]));
}

/**
 * Claims against the project's gameData fields. A claim on a field the project doesn't declare for that node
 * kind is a warning (the field may be on its way); one the project declares with another type is an error.
 * Every value the field holds on a node of that kind is checked against the claim too, over the project's
 * declaration (`effectiveClaim`): a claim that lists no values or stages takes the field's.
 */
function claimIssues(input: ExtensionPassInput, nodes: ReadonlyMap<string, ExtensionNode>, claims: readonly ResolvedClaim[]): ExtensionIssue[] {
  const issues: ExtensionIssue[] = [];
  const projectPath = input.projectPath ?? "";
  const declared = input.project.gameDataFields ?? {};
  for (const claim of claims) {
    const decl = (declared[claim.kind as keyof typeof declared] ?? []).find((d) => d.name === claim.field);
    if (decl === undefined) {
      issues.push({ severity: "warning", file: projectPath,
        message: `the Patter extension "${claim.extension}" claims the ${claim.kind} gameData field "${claim.field}", which the project doesn't declare` });
      continue;
    }
    if (decl.type !== claim.claim.type) {
      issues.push({ severity: "error", file: projectPath,
        message: `the Patter extension "${claim.extension}" claims the ${claim.kind} gameData field "${claim.field}" as ${claim.claim.type}, but the project declares it as ${decl.type}` });
      continue;
    }
    // The claim over the project's declaration: a claim that leaves out an enum's or flags' values, or a
    // quality's stages, takes the field's own, so its values are checked against the project's vocabulary.
    const effective = effectiveClaim(claim.claim, decl);
    for (const [id, node] of nodes) {
      if (node.kind !== claim.kind || node.gameData === undefined || !own(node.gameData, claim.field)) continue;
      const file = (node.scene !== undefined ? input.sceneFiles?.[node.scene] : undefined) ?? projectPath;
      for (const p of valueProblems(effective, node.gameData[claim.field])) {
        issues.push({ severity: p.severity, file, node: id, code: p.code,
          message: `${claim.kind} '${id}' gameData "${claim.field}", as the Patter extension "${claim.extension}" claims it: ${p.message}` });
      }
    }
  }
  return issues;
}
