// One-command releases: bump + commit + tag + push, for the tag-driven deliverables.
//
//   npm run release:pad  -- 0.2.0    Patterpad        (bump:pad, commit, tag v0.2.0)
//   npm run release:play -- 0.2.0    the 4 runtimes   (bump:play, commit, 4 play-*-v tags)
//   npm run release:cli  [-- 0.2.0]  standalone CLI   (no bump; tag cli-v<ver>, defaulting
//                                                      to packages/cli/package.json)
//
// Each pushed tag triggers its release pipeline (.github/workflows/*), which re-gates the
// tag against the manifests + a dated changelog, runs the tests / conformance corpus, and
// publishes the release straight from CI. This script only automates the local choreography;
// nothing ships that the pipelines would not have shipped.
//
// Guard rails:
//   - must be on main, with a CLEAN tree (Patterpad's VC layer can leave files staged after
//     a scratch-recording session - a dirty tree would silently ride along in the commit)
//   - refuses a tag that already exists locally or on origin
//   - pushes tags ONE PER PUSH: GitHub creates no push events at all when more than three
//     tags arrive in a single push, which is how the first release run shipped nothing
//
// The plain `bump:pad` / `bump:play` scripts remain for a look-before-you-leap bump.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const die = (msg) => { console.error(`release.mjs: ${msg}`); process.exit(1); };

const target = process.argv[2];
let version = process.argv[3];
if (!["pad", "play", "cli"].includes(target ?? "")) {
  die("usage: node scripts/release.mjs <pad|play|cli> [version]  (via npm run release:<target> -- <version>)");
}

// ---- preflight -------------------------------------------------------------
if (out("git rev-parse --abbrev-ref HEAD") !== "main") die("not on main");
if (out("git status --porcelain")) {
  die("working tree not clean - commit or stash first (check for files Patterpad's VC layer left staged)");
}
run("git fetch -q origin main");
const behind = out("git rev-list --count HEAD..origin/main");
if (behind !== "0") die(`main is ${behind} commit(s) behind origin - pull first`);

const semver = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
if (target === "cli" && !version) {
  version = JSON.parse(readFileSync(resolve(root, "packages/cli/package.json"), "utf8")).version;
  console.log(`release.mjs: no version given - using @patterkit/cli's ${version}`);
}
if (!version || !semver.test(version)) die("version must be plain semver, e.g. 0.2.0");

const tags = {
  pad: [`v${version}`],
  play: [`play-js-v${version}`, `play-unity-v${version}`, `play-godot-v${version}`, `play-unreal-v${version}`],
  cli: [`cli-v${version}`],
}[target];

for (const t of tags) {
  if (out(`git tag -l "${t}"`)) die(`tag ${t} already exists locally`);
  if (out(`git ls-remote --tags origin "refs/tags/${t}"`)) die(`tag ${t} already exists on origin`);
}

// ---- bump + commit (pad / play) --------------------------------------------
if (target === "pad") {
  run(`node scripts/bump-patterpad-version.mjs ${version}`); // gates the changelog; exits non-zero on refusal
  run("git add packages/patterpad/package.json packages/patterpad/CHANGELOG.md");
  run(`git commit -m "Patterpad ${version}"`);
} else if (target === "play") {
  run(`node scripts/bump-play-version.mjs ${version}`); // writes every runtime manifest + changelog, all-or-nothing
  run("git add -u"); // tree was clean, so -u stages exactly the bump
  run(`git commit -m "Patterplay ${version}"`);
}
// cli: no bump - the standalone binaries are built from HEAD at the tag; the version rides the tag name.

// ---- tag + push ------------------------------------------------------------
for (const t of tags) run(`git tag ${t}`);
run("git push origin main");
for (const t of tags) run(`git push origin refs/tags/${t}`); // one per push (see header)

console.log(`\nrelease.mjs: done - pushed ${tags.join(", ")}.`);
console.log("Watch the pipeline(s): https://github.com/patterkit/patter/actions");
