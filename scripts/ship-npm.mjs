// The whole npm-library release, end to end, in one command.
//
//   npm run ship:npm                 push what is committed, wait for the PR, run its CI, ask, publish
//   npm run ship:npm -- --yes        no prompt
//   npm run ship:npm -- --dry-run    show the plan and stop
//
// The gap this fills, found by walking somebody through a release by hand on 2026-08-19: ordinary
// library work already carries its own changeset, so the chain after committing is "push, wait for the
// bot, then `npm run release:npm`" - and the waiting is the part that goes wrong. Run release:npm a few
// seconds too early and it correctly reports that no Version Packages PR is open, which reads like
// "you are done" when it means "wait". `ship:cli` already solved this shape for the CLI train; this is
// the same chain for the packages, minus the changeset writing, because ordinary work brings its own.
//
// It does NOT commit. `ship:cli` does not either, and for the same reason: a script that stages files
// and invents a message is deciding what your change was. It refuses a dirty tree and tells you what is
// still loose.
//
// Step 3 exists because the PR's CI does not run itself: this repo requires approval for first-time
// contributors, `github-actions[bot]` is one, and the PR is merged long before anyone approves it. Every
// changeset-release/main run in this repo's history is `action_required` or a zero-job `failure`, which
// from the outside is indistinguishable from a gate that passes. Approving runs the suite and merges
// nothing; a red result stops here rather than at the prompt below.
//
// The merge in the middle is a REAL GATE. Merging the Version Packages PR publishes to npm, and npm
// versions cannot meaningfully be unpublished, so this stops and asks unless given --yes.

import { execSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findVersionPr, waitForVersionPr, plannedBumps, confirmPublish, waitForNpm, approveAndWaitForPrCi } from "./lib/version-pr.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const die = (msg) => { console.error(`ship:npm: ${msg}`); process.exit(1); };
const REPO = "https://github.com/patterkit/patter";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const run = (cmd) => {
  if (dryRun) { console.log(`  [dry-run] ${cmd}`); return ""; }
  return execSync(cmd, { cwd: root, stdio: "inherit", encoding: "utf8" }) ?? "";
};
const step = (n, msg) => console.log(`\n[${n}/5] ${msg}`);

// --- preflight, the same rules ship:cli enforces -----------------------------
if (out("git rev-parse --abbrev-ref HEAD") !== "main") die("not on main");
const dirty = out("git status --porcelain");
if (dirty) {
  console.error("ship:npm: working tree not clean - commit your work first (this script will not).\n");
  console.error(dirty.split("\n").map((l) => `  ${l}`).join("\n"));
  process.exit(1);
}
out("git fetch -q origin main");
if (out("git rev-list --count HEAD..origin/main") !== "0") die("main is behind origin - pull first");
try { out("gh auth status"); } catch { die("gh is not authenticated - run `gh auth login`"); }

// --- is there anything to do? -----------------------------------------------
const ahead = Number(out("git rev-list --count origin/main..HEAD"));
const openPr = findVersionPr(root);
const pending = readdirSync(join(root, ".changeset")).filter((f) => f.endsWith(".md") && f !== "README.md");

if (!ahead && !openPr && pending.length === 0) {
  console.log("ship:npm: nothing to ship - no unpushed commits, no pending changesets, no open Version Packages PR.");
  console.log("  A change to a published package needs a changeset:  npm run changeset");
  process.exit(0);
}
if (ahead && pending.length === 0 && !openPr) {
  // Not fatal: the commits may touch only private packages (patterpad, the surface, the corpus).
  console.log(`ship:npm: ${ahead} unpushed commit(s), but no changeset is pending.`);
  console.log("  If those commits change a PUBLISHED package, stop and write one:  npm run changeset");
  console.log("  If they only touch Patterpad, the surface or the corpus, this is expected - push and carry on.\n");
}

console.log(`ship:npm: ${ahead} unpushed commit(s), ${pending.length} pending changeset(s)`
  + `${openPr ? `, PR #${openPr} already open` : ""}${dryRun ? "  (dry run)" : ""}`);

// --- 1. push -----------------------------------------------------------------
step(1, ahead ? "pushing" : "nothing to push");
if (ahead) run("git push origin main");

// --- 2. wait for the bot -----------------------------------------------------
step(2, "waiting for the Version Packages PR");
let pr = openPr;
if (dryRun) {
  console.log(pr ? `  PR #${pr} is open` : "  [dry-run] would wait for the changeset-release/main PR");
} else if (!pr) {
  pr = waitForVersionPr(root);                     // the bot usually takes well under a minute
  if (!pr) die(`no Version Packages PR appeared - check ${REPO}/actions/workflows/release.yml, then: npm run release:npm`);
  console.log(`  PR #${pr} is open`);
} else console.log(`  PR #${pr} was already open`);

// --- 3. the PR's own CI, which does not run itself ---------------------------
//
// Folded in here because it is otherwise a step in a document that nobody performs: the run is parked
// awaiting approval, the PR is merged within the minute, and the tick never turns green in either
// direction. Approving runs the suite; it does not merge anything, and the gate below still asks.
step(3, "the PR's CI (parked awaiting approval, so nothing runs it by itself)");
if (dryRun) {
  console.log("  [dry-run] would approve the parked run and wait for it");
} else {
  const ci = approveAndWaitForPrCi(root, pr, (m) => console.log(m));
  if (ci === "failed") {
    die(`CI FAILED on PR #${pr}. Look before you publish: ${REPO}/pull/${pr}\n`
      + "  (nothing was merged; npm versions cannot meaningfully be unpublished, so this stops here.)");
  }
  if (ci === "none") {
    die(`no CI run appeared for PR #${pr}'s head. Look before you publish: ${REPO}/pull/${pr}\n`
      + "  (nothing was merged. Approve or re-run its CI there, then: npm run release:npm)");
  }
}

// --- 4. the gate -------------------------------------------------------------
step(4, "merging it (this publishes to npm)");
const bumps = pr ? plannedBumps(root, pr) : [];
if (bumps.length) {
  console.log(bumps.map((b) => `    @patterkit/${b.pkg.padEnd(14)} ${b.from} -> ${b.to}${b.private ? "  (private: versioned, never published)" : ""}`).join("\n"));
} else if (!dryRun) {
  die(`PR #${pr} bumps nothing - look at it before merging: ${REPO}/pull/${pr}`);
}
if (dryRun) {
  console.log("\nship:npm: dry run complete - nothing was pushed, merged or published.");
  process.exit(0);
}
if (!yes && !(await confirmPublish(pr, null, REPO))) {
  console.log(`\n  stopped. PR #${pr} is still open; ship it later with: npm run release:npm`);
  process.exit(0);
}
run(`gh pr merge ${pr} --squash`);
run("git pull -q --ff-only origin main");

// --- 5. wait for the registry ------------------------------------------------
step(5, "waiting for npm (the publish runs in CI, so this is not instant)");
const failed = [];
for (const b of bumps) {
  if (b.private) continue;                         // versioned by the cascade, never on npm
  const pkg = `@patterkit/${b.pkg}`;
  process.stdout.write(`  ${pkg}@${b.to} ... `);
  if (waitForNpm(pkg, b.to)) console.log("live");
  else { console.log("NOT SERVED YET"); failed.push(pkg); }
}
if (failed.length) {
  console.error(`\nship:npm: ${failed.join(", ")} did not appear in time.`);
  console.error("  The merge succeeded, so this is most likely the workflow still running or a publish failure.");
  console.error(`  Check: ${REPO}/actions/workflows/release.yml`);
  process.exit(1);
}

console.log(`\nship:npm: done. ${bumps.map((b) => `@patterkit/${b.pkg}@${b.to}`).join(", ")} published.`);
console.log("  A train that also ships a binary or an app wants its own tag:  npm run release:cli | release:play | release:pad");
