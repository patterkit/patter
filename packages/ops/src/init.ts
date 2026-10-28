// ---------------------------------------------------------------------------
// The init op: scaffold a new Patter project (spec §13) - the project file,
// folder conventions, a minimal playable starter scene + locale shard, an
// `.editorconfig`, and the VCS config for the team's VCS (spec §12): git gets
// a real `.gitattributes`; Perforce / Plastic / SVN configuration is not
// file-droppable (global / server-side), so they get a `vcs-setup.md` with
// copy-paste instructions. Pure planned-writes: nothing is written here.
// ---------------------------------------------------------------------------

import { join, basename, resolve } from "node:path";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { newId, slug, canonicalStringify } from "@patterkit/core";
import type { ProjectFile, FlowFile, LocaleFile } from "@patterkit/model";
import type { PlannedWrite } from "./write.js";
import { FLOW_SCHEMA, PROJECT_SCHEMA, STRINGS_SCHEMA, MANIFEST_EXTENSION, EXTENSIONS_DIR } from "@patterkit/model";
import { vcsConfigFiles, bundlePostureOf, type VcsFormat, type VcsKind, type BundlePosture } from "@wildwinter/toolkit/vcs";
import { SHARD_EXTENSIONS } from "./pack.js";
import { CONFLICT_SIDECAR } from "./merge.js";

/** The VCSs `init` sets a project up for: toolkit's list, shared with Storylets. */
export type InitVcs = VcsKind;

/** Whether the compiled `.patterc` bundle is committed or built in CI (spec §11). */
export type { BundlePosture };

/** What Patter's files are, for toolkit's version-control setup (the rules and the words are shared). */
export const PATTER_VCS_FORMAT: VcsFormat = {
  product: "Patter",
  tool: "patter",
  driver: "patter",
  source: SHARD_EXTENSIONS.map((ext) => ext.slice(1)),
  manifest: { dir: EXTENSIONS_DIR, suffix: MANIFEST_EXTENSION },
  bundle: "patterc",
  pack: "patterpack",
  conflict: CONFLICT_SIDECAR.slice(1),
};

export interface InitOptions {
  /** Directory to scaffold into (created by the caller's `applyWrites`). */
  dir: string;
  /** Project name; defaults to the directory's basename. */
  name?: string;
  /** Emit VCS config for this VCS (spec §12). */
  vcs?: InitVcs;
  /** Compiled-bundle posture (spec §11): "commit" (default - team ships it,
   *  kept honest by the validate staleness gate) or "ignore" (built in CI). */
  bundle?: BundlePosture;
}

export interface InitResult {
  writes: PlannedWrite[];
  /** Path of the project file the scaffold creates. */
  projectFile: string;
  name: string;
}

/** Scaffold a new project as planned writes. Throws if `dir` already holds a project. */
export function runInit(opts: InitOptions): InitResult {
  const dir = resolve(opts.dir);
  // Derive the name from the folder, dropping the canonical `.patter` extension.
  const name = opts.name?.trim() || basename(dir).replace(/\.patter$/, "");
  const fileSlug = slug(name);

  let existing: string[] = [];
  try {
    existing = readdirSync(dir).filter((f) => f.endsWith(".patterproj"));
  } catch {
    // dir does not exist yet - fine, applyWrites creates it.
  }
  if (existing.length > 0) throw new Error(`a project already exists here: ${existing[0]}`);

  const sceneId = newId("scn");
  const beatId = newId("T");
  const project: ProjectFile = {
    schema: PROJECT_SCHEMA,
    project: { id: newId("proj"), name },
    locales: { default: "en", all: ["en"] },
    start: { scene: sceneId }, // the one scene is where the story starts
    ...(opts.vcs ? { vcs: opts.vcs } : {}), // record the chosen VCS so it can be read / switched later
    voiced: true,
  };
  const flow: FlowFile = {
    schema: FLOW_SCHEMA,
    scene: {
      id: sceneId, type: "scene", name: "Start",
      blocks: [{
        id: newId("blk"), type: "block", name: "Main",
        children: [{
          id: newId("sn"), type: "snippet",
          beats: [{ id: beatId, kind: "text" }],
          jump: { to: "END" },
        }],
      }],
    },
  };
  const locale: LocaleFile = {
    schema: STRINGS_SCHEMA, scene: sceneId, locale: "en", default: true,
    // The starter line is STORY content the writer replaces, so it must read the same however the
    // project was made: no file paths, no commands. (Front-ends give their own next step - `patter init`
    // prints "try: patter play <dir>" on the terminal, and Patterpad just opens the scene for editing.)
    strings: { [beatId]: `Welcome to ${name}. This is the first line of your story - replace it with your own.` },
  };

  const bundle: BundlePosture = opts.bundle ?? "commit";
  const projectFile = join(dir, `${fileSlug}.patterproj`);
  // The project file LAST: it is what makes the folder a project, and what a second `init` refuses on,
  // so an init that fails part way (a lock, a full disk) must leave the folder able to take a rerun.
  const writes: PlannedWrite[] = [
    { path: join(dir, "scenes", "start.patterflow"), content: canonicalStringify(flow) },
    { path: join(dir, "loc", "en", "start.patterloc"), content: canonicalStringify(locale) },
    { path: join(dir, ".editorconfig"), content: EDITORCONFIG },
    ...vcsConfigWrites(dir, opts.vcs, bundle),
    { path: projectFile, content: canonicalStringify(project) },
  ];

  // A non-empty directory without a project file can still collide with the
  // scaffold - refuse rather than plan silent overwrites.
  const collisions = writes.map((w) => w.path).filter((p) => existsSync(p));
  if (collisions.length > 0) {
    throw new Error(`refusing to overwrite existing file(s): ${collisions.join(", ")}`);
  }

  return { writes, projectFile, name };
}

/** The VCS-specific config writes for a project (spec §12): the `vcs-setup.md` guide, git's
 *  `.gitattributes`, and the VCS's ignore file, from toolkit's `vcsConfigFiles`. Shared by `runInit`
 *  (scaffold) and the Project Settings "switch VCS" path (which re-emits these for the newly-chosen VCS).
 *  No collision check - callers overwrite when switching. */
export function vcsConfigWrites(dir: string, vcs: InitVcs | undefined, bundle: BundlePosture = "commit"): PlannedWrite[] {
  return vcsConfigFiles(PATTER_VCS_FORMAT, vcs, bundle).map((f) => ({ path: join(dir, f.path), content: f.content }));
}

/** The bundle posture a project was set up with, read back from the files `init` wrote (toolkit's
 *  `bundlePostureOf`). Switching VCS re-emits these files, and always writing "commit" lost the ignore
 *  rule of a project made with `init --bundle ignore`. */
export function currentBundlePosture(dir: string, vcs: InitVcs | undefined): BundlePosture {
  return bundlePostureOf(PATTER_VCS_FORMAT, vcs, (name) => { try { return readFileSync(join(dir, name), "utf8"); } catch { return undefined; } });
}

// --- emitted file bodies (spec §10/§12 hygiene + merge config) ---------------

const EDITORCONFIG = `# Patter projects are UTF-8 + LF, always (spec - patter format enforces this).
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true

[*.{patterflow,patterloc,patterx,patterproj,patterextension}]
indent_style = space
indent_size = 2
`;
