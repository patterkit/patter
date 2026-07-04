// Bump the Patterplay runtimes (JS / Unity / Unreal / Godot) to a new version, in lockstep.
//
//   npm run bump:play -- 0.2.0
//
// One version number always spans the whole runtime set. This script:
//   1. writes the version into every runtime manifest
//        packages/runtime/package.json                  "version" (the JS runtime; also
//                                                        refreshes in-repo pins on it)
//        ports/unity/Patterplay/package.json            "version"
//        ports/unreal/Patterplay/Patterplay.uplugin     "VersionName" (+ bumps "Version")
//        ports/godot/addons/patterplay/plugin.cfg       version=
//      (ports/unreal/PatterplayDemo is a versionless sample .uproject riding the same zip)
//   2. stamps today's date into each runtime CHANGELOG.md: an existing
//        "## [<version>] - Unreleased" heading is dated in place; otherwise the
//        "## [Unreleased]" section (which must have content) becomes "## [<version>] - <date>"
//        and a fresh empty "## [Unreleased]" is inserted above it
//   3. prints the tag commands that trigger the release pipelines
//
// The release workflows refuse a tag whose version does not match the manifests, so this
// script is the one route to a release.
//
// The JS runtime note: @patterkit/runtime is deliberately NOT versioned by Changesets - this
// script is its version authority (its internal deps are caret ranges so dependency bumps
// don't cascade into it). `changeset publish` still publishes it to npm, because it publishes
// any public package whose local version is ahead of the registry. Never add a changeset that
// names @patterkit/runtime (this script warns if one exists). See RELEASING.md.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: npm run bump:play -- <semver>   e.g. npm run bump:play -- 0.2.0");
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const pending = []; // computed first, written only when EVERY file transformed cleanly

function edit(rel, fn) {
  const path = resolve(root, rel);
  const before = readFileSync(path, "utf8");
  const after = fn(before, rel);
  if (after !== before) pending.push({ path, rel, after });
}

// --- 0. guard: the JS runtime must not also be driven by a changeset --------

for (const f of readdirSync(resolve(root, ".changeset"))) {
  if (!f.endsWith(".md") || f === "README.md") continue;
  const body = readFileSync(resolve(root, ".changeset", f), "utf8");
  if (body.includes("@patterkit/runtime")) {
    console.warn(
      `WARNING: .changeset/${f} names @patterkit/runtime - the runtime is versioned by THIS\n` +
      `script, not Changesets. Remove it from that changeset or lockstep will break.\n`,
    );
  }
}

// --- 1. manifests ------------------------------------------------------------

// The JS runtime. Line-targeted replace (not a JSON rewrite) to keep the file's formatting.
edit("packages/runtime/package.json", (s, rel) => {
  if (!/^  "version": "[^"]+",$/m.test(s)) throw new Error(`${rel}: no version line found`);
  return s.replace(/^  "version": "[^"]+",$/m, `  "version": "${version}",`);
});

// In-repo dependents pin @patterkit/runtime exactly; keep the pins on the lockstep version.
for (const rel of [
  "packages/play-helpers/package.json",
  "packages/ops/package.json",
  "packages/patterpad/package.json",
]) {
  edit(rel, (s) => s.replace(/"@patterkit\/runtime": "[^"]+"/, `"@patterkit/runtime": "${version}"`));
}

edit("ports/unity/Patterplay/package.json", (s) => {
  const pkg = JSON.parse(s);
  pkg.version = version;
  return JSON.stringify(pkg, null, 2) + "\n";
});

edit("ports/unreal/Patterplay/Patterplay.uplugin", (s) => {
  const up = JSON.parse(s);
  if (up.VersionName !== version) up.Version = (up.Version ?? 0) + 1; // UE's int rev, once per release
  up.VersionName = version;
  return JSON.stringify(up, null, "\t") + "\n";
});

edit("ports/godot/addons/patterplay/plugin.cfg", (s, rel) => {
  if (!/^version="[^"]*"$/m.test(s)) throw new Error(`${rel}: no version= line found`);
  return s.replace(/^version="[^"]*"$/m, `version="${version}"`);
});

// --- 2. changelogs ------------------------------------------------------------

for (const rel of [
  "packages/runtime/CHANGELOG.md",
  "ports/unity/Patterplay/CHANGELOG.md",
  "ports/unreal/Patterplay/CHANGELOG.md",
  "ports/godot/addons/patterplay/CHANGELOG.md",
]) {
  edit(rel, (s) => {
    if (s.includes(`## [${version}] - Unreleased`)) {
      // The pending section already carries this version: just date it.
      return s.replace(`## [${version}] - Unreleased`, `## [${version}] - ${today}`);
    }
    if (new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}`, "m").test(s)) {
      throw new Error(`${rel}: ${version} is already released`);
    }
    const m = s.match(/^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|\s*$(?![\s\S]))/m);
    if (!m) throw new Error(`${rel}: no "## [Unreleased]" section to promote`);
    if (!m[1].trim()) {
      throw new Error(`${rel}: the Unreleased section is empty - write the changelog first`);
    }
    return s.replace(/^## \[Unreleased\]/m, `## [Unreleased]\n\n## [${version}] - ${today}`);
  });
}

// --- 3. write + report (all-or-nothing: nothing was written before this point) ---

console.log(`Patterplay runtimes -> ${version}\n`);
for (const { path, rel, after } of pending) {
  writeFileSync(path, after);
  console.log(`  updated ${rel}`);
}
console.log(`
Next steps (review the diffs first):
  git add <the files above>            # commit the bump
  git commit -m "Patterplay ${version}"
  git tag play-js-v${version} && git tag play-unity-v${version} && git tag play-godot-v${version} && git tag play-unreal-v${version}
  git push && git push --tags          # tags trigger the release pipelines
                                       # (npm publishes @patterkit/runtime on the next main release run)
`);
