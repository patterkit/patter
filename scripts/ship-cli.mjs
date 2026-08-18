// The whole CLI release, end to end, in one command.
//
//   npm run ship:cli -- patch        (or minor / major, or an explicit 0.2.1)
//   npm run ship:cli -- patch --yes  (no prompts)
//   npm run ship:cli -- patch --dry-run
//
// The chain this replaces, run by hand on 2026-08-18 and the reason this exists: write a changeset,
// commit, push, wait for the Version Packages PR, merge it, wait for the npm publish, pull, then
// `npm run release:cli`. Nine steps, two waits, and two ways to get it subtly wrong - forget the
// changeset and the publish silently no-ops, or tag too early and ship binaries whose version says
// one thing and whose contents say another.
//
// It publishes TWO things, and they are separate trains that must not drift apart:
//   1. `@patterkit/cli` on npm, via Changesets (changeset -> Version Packages PR -> publish)
//   2. the standalone `patter` executables, via a `cli-v<ver>` tag
// (2) takes its version from the manifest that (1) bumps, so the order is not negotiable.
//
// The merge in the middle is a REAL GATE. Merging the Version Packages PR publishes to npm, and npm
// versions cannot meaningfully be unpublished, so this stops and asks unless given --yes.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const die = (msg) => { console.error(`ship:cli: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => !a.startsWith("--"));
const run = (cmd) => {
  if (dryRun) { console.log(`  [dry-run] ${cmd}`); return ""; }
  return execSync(cmd, { cwd: root, stdio: "inherit", encoding: "utf8" }) ?? "";
};
const step = (n, msg) => console.log(`\n[${n}/6] ${msg}`);

if (!["patch", "minor", "major"].includes(bump ?? "") && !/^\d+\.\d+\.\d+$/.test(bump ?? "")) {
  die("usage: npm run ship:cli -- <patch|minor|major|X.Y.Z> [--yes] [--dry-run]");
}

// --- preflight, the same rules release.mjs enforces -------------------------
if (out("git rev-parse --abbrev-ref HEAD") !== "main") die("not on main");
if (out("git status --porcelain")) die("working tree not clean - commit or stash first");
out("git fetch -q origin main");
if (out("git rev-list --count HEAD..origin/main") !== "0") die("main is behind origin - pull first");
try { out("gh auth status"); } catch { die("gh is not authenticated - run `gh auth login`"); }

const manifest = join(root, "packages/cli/package.json");
const startVersion = JSON.parse(readFileSync(manifest, "utf8")).version;
console.log(`\nship:cli: @patterkit/cli is at ${startVersion}, releasing a ${bump}${dryRun ? "  (dry run)" : ""}`);

// --- 1. the changeset -------------------------------------------------------
// Written directly rather than through `changeset add`, which is interactive. An explicit X.Y.Z is
// still expressed as a bump type, because Changesets decides the number - and letting two sources
// decide it is how a manifest and a tag come to disagree.
step(1, "writing the changeset");
const kind = ["patch", "minor", "major"].includes(bump) ? bump : "patch";
const note = args.find((a) => a.startsWith("--note="))?.slice(7)
  ?? `\`@patterkit/cli\` ${kind} release.`;
const csPath = join(root, ".changeset", `ship-cli-${startVersion.replace(/\./g, "-")}.md`);
if (!dryRun) writeFileSync(csPath, `---\n"@patterkit/cli": ${kind}\n---\n\n${note}\n`);
console.log(`  ${csPath.replace(root + "/", "")}: @patterkit/cli ${kind}`);
if (/^\d+\.\d+\.\d+$/.test(bump)) {
  console.log(`  note: an explicit ${bump} was asked for; Changesets will compute the ${kind} bump instead.`);
  console.log("        Check the Version Packages PR before approving it.");
}

step(2, "committing and pushing");
run(`git add ${JSON.stringify(csPath)}`);
run(`git commit -m "changeset: @patterkit/cli ${kind}"`);
run("git push origin main");

// --- 3. wait for the bot ----------------------------------------------------
step(3, "waiting for the Version Packages PR");
const findPr = () => {
  const json = out('gh pr list --state open --head changeset-release/main --json number,title --limit 1');
  const list = JSON.parse(json || "[]");
  return list[0]?.number ?? null;
};
let pr = null;
if (!dryRun) {
  for (let i = 0; i < 40 && !pr; i++) {           // ~4 minutes; the bot usually takes well under one
    pr = findPr();
    if (!pr) execSync("sleep 6");
  }
  if (!pr) die("no Version Packages PR appeared - check the Release workflow, then merge it by hand");
  console.log(`  PR #${pr} is open`);
} else console.log("  [dry-run] would wait for the changeset-release/main PR");

// --- 4. the gate ------------------------------------------------------------
step(4, "merging it (this publishes to npm)");
if (dryRun) console.log("  [dry-run] would stop here and ask before publishing");
else if (!yes) {
  console.log(`\n  https://github.com/patterkit/patter/pull/${pr}`);
  console.log("  Merging publishes @patterkit/cli to npm. Published versions cannot be unpublished.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("  merge and publish? [y/N] ")).trim().toLowerCase();
  rl.close();
  if (answer !== "y" && answer !== "yes") {
    console.log(`\n  stopped. PR #${pr} is still open; merge it yourself, then: npm run release:cli`);
    process.exit(0);
  }
}
if (!dryRun) run(`gh pr merge ${pr} --squash`);
else console.log("  [dry-run] gh pr merge <n> --squash");

// --- 5. wait for the publish ------------------------------------------------
step(5, "waiting for npm");
run("git pull -q --ff-only origin main");
const target = dryRun ? "(dry run)" : JSON.parse(readFileSync(manifest, "utf8")).version;
if (!dryRun) {
  if (target === startVersion) die(`the manifest is still ${startVersion} after the merge - check the PR`);
  console.log(`  manifest is now ${target}; polling the registry`);
  let live = false;
  for (let i = 0; i < 40 && !live; i++) {
    // --prefer-online, always: npm's metadata cache will report the previous version for minutes
    // after a publish, which is exactly how a working release gets mistaken for a broken one.
    const v = execSync(`npm view @patterkit/cli version --prefer-online`, { encoding: "utf8" }).trim();
    live = v === target;
    if (!live) execSync("sleep 6");
  }
  if (!live) die(`npm has not served ${target} yet - check the Release workflow, then: npm run release:cli`);
  console.log(`  @patterkit/cli@${target} is live`);
}

// --- 6. the standalone binaries ---------------------------------------------
step(6, "tagging the standalone binaries");
run("npm run release:cli");

if (dryRun) {
  console.log("\nship:cli: dry run complete - nothing was written, pushed, merged or tagged.");
} else {
  console.log(`\nship:cli: done. @patterkit/cli@${target} on npm; cli-v${target} tagged.`);
  console.log("The CLI release workflow is building the executables now:");
  console.log("  https://github.com/patterkit/patter/actions/workflows/cli.yml");
}
