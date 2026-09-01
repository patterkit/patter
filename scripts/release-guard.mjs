// GENERATED - vendored from expr/tooling/release-guard.mjs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// Refuse a push that moves a published package's source with no changeset covering it.
//
//   npm run release:guard                 # origin/main..HEAD
//   npm run release:guard -- <base> <head>
//   npm run release:guard -- --warn       # report, exit 0
//
// THE FAILURE THIS EXISTS FOR, from Patterplay on 2026-08-18: two published packages both
// gained a feature, went to main with no changeset, and the Release workflow ran green in
// 44 seconds having published nothing. That is worse than a missed release. The registry
// keeps serving one build while the repo at that version number holds different source, so
// a version number stops identifying a build - and nothing anywhere goes red, because
// publishing nothing is a legitimate outcome for that workflow.
//
// A `changeset-check` on pull requests cannot catch it. Both families work directly on
// main, so the check has to run on the push path, which is what this does.
//
// ONE PACKAGE IS NOT ORDINARY. The JS runtime named below is the JS member of the lockstep
// runtime set, versioned by `npm run bump:play` together with the Unity, Unreal and Godot
// ports, because one version number has to mean one runtime behaviour across all four. A
// changeset naming it would bump it out of step with three ports that never had that
// version, so naming it is an error of its own, and changing it is reported as a note.
//
// Packages that are `private` AND `ignore`d never publish, so their source moves freely.
// It takes both: `ignore` keeps a package out of versioning, `private` keeps it out of the
// registry, and a public package sitting at 0.0.0 is one workflow run from being on the
// registry forever.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const args = process.argv.slice(2);
const warnOnly = args.includes("--warn");
const positional = args.filter((a) => !a.startsWith("--"));
const base = positional[0] ?? "origin/main";
/** The tip to inspect. Overridable so the guard can be pointed at a past range and shown to fire. */
const head = positional[1] ?? "HEAD";

/** The JS runtime's version comes from bump:play, never from a changeset. */
const LOCKSTEP = "@patterkit/runtime";

// --- which packages publish -------------------------------------------------
const cfg = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
const ignored = new Set(cfg.ignore ?? []);
/** dir name -> package name, for every package that actually reaches a registry. */
const published = new Map();
for (const dir of readdirSync(join(root, "packages"))) {
  const manifest = join(root, "packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || ignored.has(pkg.name)) continue;
  published.set(dir, pkg.name);
}

// --- what changed -----------------------------------------------------------
let range;
try {
  // Two dots, not three: we want what these commits actually touch, not what the branch has
  // diverged by. `^{commit}` matters: --verify accepts any well-formed 40-character SHA whether
  // or not the object is present, so without it a base that has left the repo sails past here.
  out(`git rev-parse --verify --quiet "${base}^{commit}"`);
  range = `${base}..${head}`;
} catch {
  console.error(`release-guard: no such ref '${base}' - skipping (nothing to compare against)`);
  process.exit(0);
}
const changedFiles = out(`git diff --name-only ${range}`).split("\n").filter(Boolean);
if (changedFiles.length === 0) process.exit(0);

/** Package dirs with a source change. Manifests and CHANGELOGs are excluded: a Version Packages
 *  PR touches exactly those, and demanding a changeset for the release commit itself would never
 *  end. Tests alone ship nothing. */
const touched = new Set();
for (const f of changedFiles) {
  const m = /^packages\/([^/]+)\/(.+)$/.exec(f);
  if (!m) continue;
  const [, dir, rest] = m;
  if (!published.has(dir)) continue;
  if (rest === "package.json" || rest === "CHANGELOG.md") continue;
  if (rest.startsWith("test/") || rest.includes(".test.")) continue;
  touched.add(dir);
}
if (touched.size === 0) process.exit(0);

// --- what the pending changesets already cover ------------------------------
/** Package names named by any changeset markdown. Parsed directly rather than via
 *  `changeset status`, which needs a git ref it can diff and returns nothing useful pre-push. */
const covered = new Set();
/** The .changeset/ directory AS OF `head`, not the working copy: pointing the guard at a past
 *  range must judge it by the changesets that existed then. */
const listAt = (ref) => {
  // A range whose head predates the adoption of changesets has no .changeset tree at all.
  // That is "nothing covered", not a crash: git exits non-zero and execSync throws.
  try {
    return out(`git ls-tree --name-only ${ref}:.changeset 2>/dev/null`).split("\n").filter(Boolean).map((p) => p.replace(/^.*\//, ""));
  } catch {
    return [];
  }
};
const changesetFiles = head === "HEAD" ? readdirSync(join(root, ".changeset")) : listAt(head);
const readChangeset = (f) => head === "HEAD"
  ? readFileSync(join(root, ".changeset", f), "utf8")
  : out(`git show ${head}:.changeset/${f}`);

for (const f of changesetFiles) {
  if (!f.endsWith(".md") || f === "README.md") continue;
  const text = readChangeset(f);
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) continue;
  for (const line of fm[1].split("\n")) {
    const named = /^\s*["']?(@?[^"':]+)["']?\s*:\s*(major|minor|patch)\s*$/.exec(line);
    if (named) covered.add(named[1].trim());
  }
}

// --- report -----------------------------------------------------------------
const missing = [];
let lockstepChanged = false;
for (const dir of [...touched].sort()) {
  const name = published.get(dir);
  if (name === LOCKSTEP) { lockstepChanged = true; continue; }
  if (!covered.has(name)) missing.push({ dir, name });
}

const problems = [];
if (missing.length) {
  problems.push(
    `changed with no changeset: ${missing.map((m) => m.name).join(", ")}`,
    "  These publish to npm. Without a changeset their versions stay put while their source moves,",
    "  so the registry serves one build under a version number the repo gives to another.",
    "  Fix:  npm run changeset",
    "  If this genuinely ships nothing (a comment, a refactor with no behaviour change):",
    "        npm run changeset -- --empty",
  );
}
if (covered.has(LOCKSTEP)) {
  problems.push(
    `${LOCKSTEP} is named by a changeset, and must not be.`,
    "  It is versioned by `npm run bump:play` as the JS member of the lockstep runtime set.",
    "  Remove it from the changeset; release it with the other three runtimes instead.",
  );
}
if (lockstepChanged) {
  // Not a failure on its own: the lockstep release is a separate, deliberate act.
  console.error(`release-guard: note - ${LOCKSTEP} source changed; it ships via 'npm run bump:play' and its four tags, not a changeset.`);
}

if (problems.length === 0) process.exit(0);
const label = warnOnly ? "warning" : "error";
console.error(`\nrelease-guard (${label}), comparing ${range}:\n`);
for (const line of problems) console.error(line.startsWith(" ") ? line : `  ${line}`);
console.error("");
process.exit(warnOnly ? 0 : 1);
