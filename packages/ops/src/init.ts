// ---------------------------------------------------------------------------
// The init op: scaffold a new Patter project (spec §13) - the project file,
// folder conventions, a minimal playable starter scene + locale shard, an
// `.editorconfig`, and the VCS config for the team's VCS (spec §12): git gets
// a real `.gitattributes`; Perforce / Plastic / SVN configuration is not
// file-droppable (global / server-side), so they get a `vcs-setup.md` with
// copy-paste instructions. Pure planned-writes: nothing is written here.
// ---------------------------------------------------------------------------

import { join, basename, resolve } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { newId, slug, canonicalStringify } from "@patterkit/core";
import type { ProjectFile, FlowFile, LocaleFile } from "@patterkit/model";
import type { PlannedWrite } from "./write.js";

export type InitVcs = "git" | "perforce" | "plastic" | "svn";

/** Whether the compiled `.patterc` bundle is committed or built in CI (spec §11). */
export type BundlePosture = "commit" | "ignore";

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
    schema: "patter/project@0",
    project: { id: newId("proj"), name },
    locales: { default: "en", all: ["en"] },
    ...(opts.vcs ? { vcs: opts.vcs } : {}), // record the chosen VCS so it can be read / switched later
    voiced: true,
  };
  const flow: FlowFile = {
    schema: "patter/flow@0",
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
    schema: "patter/strings@0", scene: sceneId, locale: "en", default: true,
    strings: { [beatId]: `Welcome to ${name}. Edit scenes/start.patterflow, then run: patter play` },
  };

  const bundle: BundlePosture = opts.bundle ?? "commit";
  const projectFile = join(dir, `${fileSlug}.patterproj`);
  const writes: PlannedWrite[] = [
    { path: projectFile, content: canonicalStringify(project) },
    { path: join(dir, "scenes", "start.patterflow"), content: canonicalStringify(flow) },
    { path: join(dir, "loc", "en", "start.patterloc"), content: canonicalStringify(locale) },
    { path: join(dir, ".editorconfig"), content: EDITORCONFIG },
    ...vcsConfigWrites(dir, opts.vcs, bundle),
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
 *  `.gitattributes`, and the VCS's ignore file. Shared by `runInit` (scaffold) and the Project Settings
 *  "switch VCS" path (which re-emits these for the newly-chosen VCS). No collision check - callers
 *  overwrite when switching. */
export function vcsConfigWrites(dir: string, vcs: InitVcs | undefined, bundle: BundlePosture = "commit"): PlannedWrite[] {
  const writes: PlannedWrite[] = [{ path: join(dir, "vcs-setup.md"), content: vcsSetup(vcs, bundle) }];
  if (vcs === "git") writes.push({ path: join(dir, ".gitattributes"), content: GITATTRIBUTES });
  // The ignore file keeps generated artifacts out of source control: the packed document always, the
  // compiled bundle too under the "ignore" posture (§11).
  const ignore = ignoreFileFor(vcs);
  if (ignore) writes.push({ path: join(dir, ignore), content: ignoreContent(bundle) });
  return writes;
}

// --- emitted file bodies (spec §10/§12 hygiene + merge config) ---------------

const EDITORCONFIG = `# Patter projects are UTF-8 + LF, always (spec - patter format enforces this).
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true

[*.{patterflow,patterloc,patterx,patterproj}]
indent_style = space
indent_size = 2
`;

const GITATTRIBUTES = `# Patter source is UTF-8 + LF text (pinned; never let autocrlf touch it).
*.patterflow text eol=lf
*.patterloc  text eol=lf
*.patterx    text eol=lf
*.patterproj text eol=lf

# Id-keyed structured merge for Patter source (the 'patter merge' driver).
# Register it once per clone (see vcs-setup.md); until then git falls back to a
# normal text merge for these - no harm, just not structure-aware.
*.patterflow merge=patter
*.patterloc  merge=patter
*.patterx    merge=patter
*.patterproj merge=patter

# Generated artifacts (spec §11). The compiled bundle is committed but
# REGENERATED, never hand-merged - keep ours on conflict and rebuild (the
# validate staleness gate catches a stale one). Needs a one-time
# 'git config merge.ours.driver true' (see vcs-setup.md).
*.patterc    text eol=lf merge=ours
# The packed document (.patterpack) is a binary zip envelope - kept out of VCS (.gitignore).
*.patterpack binary
`;

/** The ignore filename for a VCS (SVN uses a property, not a file - documented). */
function ignoreFileFor(vcs?: InitVcs): string | undefined {
  switch (vcs) {
    case "git": return ".gitignore";
    case "perforce": return ".p4ignore";
    case "plastic": return "ignore.conf";
    default: return undefined; // svn (svn:ignore property) / none -> see vcs-setup.md
  }
}

/** Ignore patterns for generated artifacts (gitignore/p4ignore/Plastic share this syntax). */
function ignoreContent(bundle: BundlePosture): string {
  const lines = [
    "# Patter generated artifacts - not source (see vcs-setup.md).",
    "# Packed document (the send-and-return envelope):",
    "*.patterpack",
    "# Unresolved merge sidecar:",
    "*.patterconflict",
  ];
  if (bundle === "ignore") {
    lines.push("# Compiled bundle (built in CI, not committed under this posture):", "*.patterc");
  }
  return lines.join("\n") + "\n";
}

function vcsSetup(vcs: InitVcs | undefined, bundle: BundlePosture): string {
  const sections: Record<InitVcs, string> = {
    git: `## git

\`.gitattributes\` (already emitted) pins Patter source shards to UTF-8 + LF text
and marks the generated artifacts (the \`.patterc\` bundle \`merge=ours\`, the
\`.patterpack\` document \`binary\`). \`.gitignore\` (already emitted) keeps the document
(and the bundle, under the "ignore" posture) out of source control.

Recommended pre-commit hook (\`.git/hooks/pre-commit\`, executable):

    #!/bin/sh
    patter validate || exit 1

The \`merge=patter\` rules in \`.gitattributes\` are already active; register the
drivers once per clone (git config is not repo-tracked) - until then git falls
back to a normal text merge for those files:

    git config merge.patter.name "Patter structured merge"
    git config merge.patter.driver "patter merge %O %A %B -o %A"
    git config merge.ours.driver true

git invokes the per-path driver directly (no \`mergetool\` wrapper needed). \`%O %A
%B\` are base / ours / theirs; the merged result is written back to \`%A\`. On a
conflict \`patter merge\` exits non-zero and writes a \`.patterconflict\` sidecar
beside the file, so the merge stays unresolved.
`,
    perforce: `## Perforce

Add Patter extensions to the typemap (\`p4 typemap\`): source shards and the
compiled bundle are TEXT with LF; the packed document is BINARY:

    text   //....patterflow
    text   //....patterloc
    text   //....patterx
    text   //....patterproj
    text   //....patterc
    binary //....patterpack

On a unicode-mode server, set \`P4CHARSET=utf8\`. For the lock-based workflow
(spec: one scene per file = one lock per scene), add \`+l\` to make checkouts
exclusive. A \`.p4ignore\` (already emitted) keeps the packed document out of the
depot.

Perforce allows ONE global merge tool, so set \`patter mergetool\` as it - it
runs the structured merge for Patter source and hands everything else to your
normal tool. Map Perforce's variables into the order BASE THEIRS OURS OUT:

    patter mergetool --fallback "<your merge tool>" %b %t %y %r

(\`%b\` base, \`%t\` theirs, \`%y\` yours/ours, \`%r\` result - adjust to your P4
client's variable names; the argument ORDER is what matters.)
`,
    plastic: `## Plastic SCM (Unity VC)

Patter source shards are plain UTF-8 text; Plastic handles them as-is. The
\`ignore.conf\` (already emitted) keeps the packed document out of the repo. For
the lock-based workflow, configure exclusive checkout (lock.conf) for the shard
extensions.

In Preferences > Merge tools, add an external tool (a global entry is fine -
the wrapper sniffs the path) with the arguments in BASE THEIRS OURS OUT order:

    patter mergetool --fallback "<your merge tool>" @basefile @sourcefile @destinationfile @output
`,
    svn: `## SVN

Set auto-props so Patter source keeps LF (\`~/.subversion/config\` or repo config):

    [auto-props]
    *.patterflow = svn:eol-style=LF
    *.patterloc = svn:eol-style=LF
    *.patterx = svn:eol-style=LF
    *.patterproj = svn:eol-style=LF
    *.patterc = svn:eol-style=LF
    *.patterpack = svn:mime-type=application/octet-stream

SVN's ignore is a directory PROPERTY, not a file - set it from the project root:

    svn propset svn:ignore "*.patterpack${bundle === "ignore" ? "\\n*.patterc" : ""}\\n*.patterconflict" .

For the lock-based workflow add \`svn:needs-lock\` to the shard patterns.

SVN allows one global merge tool. Point \`[helpers] merge-tool-cmd\` at a small
wrapper script that forwards SVN's four arguments (base theirs mine merged =
BASE THEIRS OURS OUT) to \`patter mergetool\`:

    #!/bin/sh
    exec patter mergetool --fallback "<your merge tool>" "$1" "$2" "$3" "$4"
`,
  };
  const head = vcs
    ? sections[vcs]
    : `No VCS selected (\`patter init --vcs git|perforce|plastic|svn\` emits tailored
config). Whichever you adopt, the rules are the same: Patter source is UTF-8 +
LF text, one scene per file, and \`patter validate\` belongs in your pre-commit /
CI. Sections for every supported VCS:

${(Object.keys(sections) as InitVcs[]).map((k) => sections[k]).join("\n")}`;
  return `# Version-control setup for this Patter project\n\n${head}\n${bundleSection(bundle)}`;
}

/** Shared note: the two generated artifacts and the committed-bundle discipline (spec §11). */
function bundleSection(bundle: BundlePosture): string {
  const posture = bundle === "commit"
    ? `This project COMMITS the compiled \`.patterc\` bundle (\`patter init --bundle ignore\`
to build it in CI instead). The bundle is regenerated, never hand-merged: on a
conflict, keep ours and re-run \`patter export\`. \`patter validate\` recomputes the
bundle's embedded hash from source and FAILS if it is stale, so a forgotten
regenerate cannot ship silently.`
    : `This project IGNORES the compiled \`.patterc\` bundle (built in CI; \`patter init
--bundle commit\` to commit it instead). Run \`patter export\` as a build step.`;
  return `## Compiled bundle & packed document

${posture}

The packed \`.patterpack\` document (\`patter pack\`) is the send-and-return envelope
for collaborators without VCS. It is a binary zip and a projection of the
shards - NOT source - so it stays out of version control (ignored above); edits
return via \`patter unpack\`.
`;
}
