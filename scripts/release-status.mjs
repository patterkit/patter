// Where every release train stands, in one command.
//
//   npm run release:status
//
// Replaces the handful of things you otherwise type one at a time while shepherding a release:
// `npm view` per package, `git log @{u}..`, `npx changeset status`, `gh pr list`, `gh run list`.
// Nothing here changes anything; it is safe to run at any moment.
//
// Registry reads use `--prefer-online`. npm caches package metadata, and within a few minutes of a
// publish a plain `npm view` will happily report the version you just replaced - which on 2026-08-18
// made a successful publish look like a failed one twice over (once on npm, once on NuGet in the
// sibling repo). A status tool that can tell you the opposite of the truth is worse than no tool.

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
/** Run something whose failure is not our problem (no gh, no network, not logged in). */
const soft = (cmd) => { try { return out(cmd); } catch { return null; } };

const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const paint = (s, c) => (process.stdout.isTTY ? `${c}${s}${RESET}` : s);

// --- published packages: repo vs registry -----------------------------------
const cfg = JSON.parse(readFileSync(join(root, ".changeset/config.json"), "utf8"));
const ignored = new Set(cfg.ignore ?? []);
const pkgs = [];
for (const dir of readdirSync(join(root, "packages"))) {
  const manifest = join(root, "packages", dir, "package.json");
  if (!existsSync(manifest)) continue;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  if (pkg.private || ignored.has(pkg.name)) continue;
  pkgs.push({ name: pkg.name, version: pkg.version });
}

console.log("\npublished packages");
let drift = 0;
for (const p of pkgs.sort((a, b) => a.name.localeCompare(b.name))) {
  const npmVer = soft(`npm view ${p.name} version --prefer-online`) ?? "?";
  const same = npmVer === p.version;
  if (!same) drift++;
  const state = npmVer === "?" ? paint("unreachable", DIM)
    : same ? paint("ok", GREEN)
    : paint("UNPUBLISHED", YELLOW);
  console.log(`  ${p.name.padEnd(26)} repo ${p.version.padEnd(9)} npm ${npmVer.padEnd(9)} ${state}`);
}

// --- the app, which is not on npm at all ------------------------------------
const pad = JSON.parse(readFileSync(join(root, "packages/patterpad/package.json"), "utf8"));
const padTag = soft(`git tag -l "v${pad.version}"`) ? "tagged" : paint("UNTAGGED", YELLOW);
console.log(`\npatterpad                    ${pad.version.padEnd(9)} ${padTag} ${paint("(GitHub Releases, never npm)", DIM)}`);

// --- local state ------------------------------------------------------------
const branch = out("git rev-parse --abbrev-ref HEAD");
const dirty = out("git status --porcelain");
soft("git fetch -q origin main");
const ahead = soft("git rev-list --count origin/main..HEAD") ?? "?";
const behind = soft("git rev-list --count HEAD..origin/main") ?? "?";
console.log("\nlocal");
console.log(`  branch     ${branch}${branch === "main" ? "" : paint("  (release scripts require main)", YELLOW)}`);
console.log(`  tree       ${dirty ? paint(`${dirty.split("\n").length} file(s) uncommitted`, YELLOW) : "clean"}`);
console.log(`  vs origin  ${ahead} ahead, ${behind} behind${ahead !== "0" ? paint("  (unpushed)", YELLOW) : ""}`);

// --- pending changesets -----------------------------------------------------
const pending = readdirSync(join(root, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md");
console.log("\nchangesets");
if (pending.length === 0) {
  console.log(`  none pending${drift ? paint("  - but a package above is unpublished, so a Version Packages PR may be open", YELLOW) : ""}`);
} else {
  for (const f of pending) {
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(root, ".changeset", f), "utf8"));
    const named = (fm?.[1] ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
    console.log(`  ${f}  ${paint(named, DIM)}`);
  }
}

// --- anything in flight -----------------------------------------------------
/** Indent HERE rather than in the jq template: `out()` trims the whole string, which would strip the
 *  leading spaces off the first row only and leave the block visibly ragged. */
const indent = (text) => text.split("\n").map((l) => `  ${l}`).join("\n");

const prs = soft('gh pr list --state open --json number,title,headRefName --jq \'.[] | "#\\(.number)  \\(.title)  (\\(.headRefName))"\'');
console.log("\nopen PRs");
console.log(prs && prs.length ? indent(prs) : "  none");

const runs = soft('gh run list --limit 6 --json status,conclusion,name,headBranch --jq \'.[] | "\\(.conclusion // .status)\\t\\(.name)\\t\\(.headBranch)"\'');
console.log("\nrecent pipeline runs");
console.log(runs && runs.length ? indent(runs) : `  ${paint("gh unavailable", DIM)}`);
console.log("");
