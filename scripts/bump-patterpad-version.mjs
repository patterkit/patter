// Bump the Patterpad desktop app to a new version.
//
//   npm run bump:pad -- 0.2.0
//
// Patterpad has its own tag-driven release pipeline (patterpad-v* -> .github/workflows/patterpad.yml),
// separate from Changesets and from the runtimes' lockstep `bump:play`. This script:
//   1. writes the version into packages/patterpad/package.json (electron-builder takes the
//      installer file names, the app's About version, and the updater feed version from it)
//   2. stamps today's date into packages/patterpad/CHANGELOG.md: an existing
//        "## [<version>] - Unreleased" heading is dated in place; otherwise the
//        "## [Unreleased]" section (which must have content) becomes "## [<version>] - <date>"
//        and a fresh empty "## [Unreleased]" is inserted above it
//   3. prints the tag command that triggers the release pipeline
//
// The release workflow refuses a tag whose version does not match the manifest + changelog, so
// this script is the one route to a release. (Patterpad is a private workspace - never published
// to npm - so there is no Changesets interaction to guard against.)

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("usage: npm run bump:pad -- <semver>   e.g. npm run bump:pad -- 0.2.0");
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

// --- 1. the manifest ---------------------------------------------------------

// Line-targeted replace (not a JSON rewrite) to keep the file's formatting.
edit("packages/patterpad/package.json", (s, rel) => {
  if (!/^  "version": "[^"]+",$/m.test(s)) throw new Error(`${rel}: no version line found`);
  return s.replace(/^  "version": "[^"]+",$/m, `  "version": "${version}",`);
});

// --- 2. the changelog ----------------------------------------------------------

edit("packages/patterpad/CHANGELOG.md", (s, rel) => {
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

// --- 3. write + report (all-or-nothing: nothing was written before this point) ---

console.log(`Patterpad -> ${version}\n`);
for (const { path, rel, after } of pending) {
  writeFileSync(path, after);
  console.log(`  updated ${rel}`);
}
console.log(`
Next steps (review the diffs first):
  git add packages/patterpad/package.json packages/patterpad/CHANGELOG.md
  git commit -m "Patterpad ${version}"
  git tag patterpad-v${version}
  git push && git push --tags          # the tag triggers the Patterpad release pipeline
                                       # (builds + signs mac/win/linux, publishes installers
                                       # + the electron-updater feeds to the GitHub Release)
`);
