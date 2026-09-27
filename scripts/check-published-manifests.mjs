// GENERATED - vendored from expr/tooling/check-published-manifests.mjs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// Refuse to publish while npm serves a package whose dependencies differ from the repo's under the
// same version number.
//
//   node scripts/check-published-manifests.mjs          # exit 1 on a difference
//   node scripts/check-published-manifests.mjs --warn   # report, exit 0
//
// THE FAILURE THIS EXISTS FOR, from both families on 2026-09-27. A commit moved the JS runtime's
// range on @wildwinter/scoperegistry from ^0.7.0 to ^0.8.0 without a new runtime version, because
// the runtime's version comes from `npm run bump:play` and that release had not been cut. The
// dialect's new range went out on the next library publish; the runtime's did not. npm then served
// runtime 0.14.0 on ^0.7.0 beside dialect 0.2.1 on ^0.8.0, every install got two copies of the
// registry, and a game's ScopeRegistry stopped being the type the runtime used. The repo looked
// fixed the whole time: it said ^0.8.0 under 0.14.0, and nothing compares the repo with npm.
//
// This does. It runs inside `npm run release`, just before `changeset publish`, so a library publish
// cannot go out while another public package in the family is stale on npm. It compares the fields
// that decide an install (dependencies, peerDependencies, optionalDependencies) for every public
// package whose version is already on npm. A version not yet on npm is about to publish, and is fine.
//
// The fix it asks for is always a new version: a changeset for an ordinary package, the runtime set's
// own release for the lockstep member(s) named below.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const warnOnly = process.argv.includes("--warn");

/** The lockstep member(s) on npm, versioned with the engine runtimes rather than by a changeset. */
const LOCKSTEP = new Set("@patterkit/runtime".split(",").map((s) => s.trim()).filter(Boolean));

const FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

// --- which packages publish (the same rule as release-guard) -----------------
const cfg = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
const ignored = new Set(cfg.ignore ?? []);
const packages = [];
for (const dir of readdirSync(join(root, "packages")).sort()) {
  const manifest = join(root, "packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || ignored.has(pkg.name)) continue;
  packages.push(pkg);
}

/** What npm holds for name@version, or null when that version is not on npm (yet). */
function published(name, version) {
  let raw;
  try {
    raw = execSync(`npm view "${name}@${version}" version ${FIELDS.join(" ")} --json`, {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    // A package never published answers E404. Anything else (network, auth) must not pass silently:
    // a gate that cannot see the registry has not checked anything.
    if (String(err.stderr ?? "").includes("E404")) return null;
    throw new Error(`npm view ${name}@${version} failed:\n${err.stderr ?? err.message}`);
  }
  if (!raw) return null; // the package exists, this version does not
  const got = JSON.parse(raw);
  // One field asked for comes back bare; several come back as an object. We always ask several.
  return typeof got === "object" && got !== null ? got : null;
}

const canonical = (deps) => JSON.stringify(Object.fromEntries(Object.entries(deps ?? {}).sort(([a], [b]) => a.localeCompare(b))));

// --- compare ------------------------------------------------------------------
const stale = [];
for (const pkg of packages) {
  const onNpm = published(pkg.name, pkg.version);
  if (!onNpm) continue;
  const diffs = [];
  for (const field of FIELDS) {
    const local = pkg[field] ?? {};
    const remote = onNpm[field] ?? {};
    if (canonical(local) === canonical(remote)) continue;
    for (const dep of [...new Set([...Object.keys(local), ...Object.keys(remote)])].sort()) {
      if (local[dep] === remote[dep]) continue;
      diffs.push(`${field}.${dep}: npm has ${remote[dep] ?? "(none)"}, the repo has ${local[dep] ?? "(none)"}`);
    }
  }
  if (diffs.length) stale.push({ pkg, diffs });
}

if (stale.length === 0) {
  console.log(`check-published-manifests: every published version matches the repo (${packages.length} packages checked)`);
  process.exit(0);
}

const label = warnOnly ? "warning" : "error";
console.error(`\ncheck-published-manifests (${label}): npm serves a different install graph under the same version:\n`);
for (const { pkg, diffs } of stale) {
  console.error(`  ${pkg.name}@${pkg.version}`);
  for (const d of diffs) console.error(`    ${d}`);
  console.error(LOCKSTEP.has(pkg.name)
    ? "    Fix: release the runtime set (the family's release:play / bump:play route), so npm gets a new version."
    : "    Fix: add a changeset naming it (npm run changeset), so npm gets a new version.");
  console.error("");
}
console.error("  Publishing now would ship the other packages beside these stale ones, which is how an install");
console.error("  ends up with two copies of a dependency that must exist once.");
console.error("");
process.exit(warnOnly ? 0 : 1);
