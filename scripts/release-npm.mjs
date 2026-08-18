// Ship whatever the open "Version Packages" PR is holding.
//
//   npm run release:npm              show what it would publish, ask, merge, wait, verify
//   npm run release:npm -- --yes     no prompt
//   npm run release:npm -- --dry-run show the plan and stop
//
// The gap this fills: `ship:cli` runs the WHOLE chain starting from writing a changeset, which is wrong
// when the changeset already exists. Ordinary work adds changesets as it goes, so most of the time the
// situation is "a Version Packages PR is sitting open and I just want it out" - and until now that was
// two commands typed from memory, one of which (`npm view`) lies for several minutes after a publish.
//
// It deliberately does NOT create anything. If no PR is open there is nothing to ship and it says so.

import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { findVersionPr, plannedBumps, confirmPublish, waitForNpm } from "./lib/version-pr.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = (cmd) => execSync(cmd, { cwd: root, encoding: "utf8" }).trim();
const run = (cmd) => execSync(cmd, { cwd: root, stdio: "inherit" });
const die = (msg) => { console.error(`release:npm: ${msg}`); process.exit(1); };

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const dryRun = args.includes("--dry-run");
const REPO = "https://github.com/patterkit/patter";

// --- preflight --------------------------------------------------------------
try { out("gh auth status"); } catch { die("gh is not authenticated - run `gh auth login`"); }
if (out("git rev-parse --abbrev-ref HEAD") !== "main") die("not on main");

const pr = findVersionPr(root);
if (!pr) {
  // Not a failure. Either everything is published, or no changeset has reached main yet.
  console.log("release:npm: no Version Packages PR is open - nothing to publish.");
  console.log("  If you expected one, check the Release workflow, or add a changeset:  npm run changeset");
  process.exit(0);
}

const bumps = plannedBumps(root, pr);
if (bumps.length === 0) die(`PR #${pr} bumps nothing - look at it before merging: ${REPO}/pull/${pr}`);

const summary = bumps.map((b) => `    @patterkit/${b.pkg.padEnd(14)} ${b.from} -> ${b.to}`).join("\n");
console.log(`\nrelease:npm: PR #${pr} would publish\n\n${summary}`);

if (dryRun) {
  console.log("\nrelease:npm: dry run - nothing merged, nothing published.");
  process.exit(0);
}
if (!yes && !(await confirmPublish(pr, null, REPO))) {
  console.log(`\n  stopped. PR #${pr} is still open.`);
  process.exit(0);
}

// --- merge ------------------------------------------------------------------
// The merge is what publishes: it lands the bumped manifests on main, and the Release workflow's next
// run finds versions ahead of the registry and runs `changeset publish`. Merging with YOUR credentials
// is load-bearing - a push made with GITHUB_TOKEN does not trigger workflows, which is why the pipeline
// cannot merge this PR itself.
run(`gh pr merge ${pr} --squash`);
run("git pull -q --ff-only origin main");

// --- wait for the registry --------------------------------------------------
console.log("\nwaiting for npm (the publish runs in CI, so this is not instant)");
const failed = [];
for (const b of bumps) {
  const pkg = `@patterkit/${b.pkg}`;
  process.stdout.write(`  ${pkg}@${b.to} ... `);
  if (waitForNpm(pkg, b.to)) console.log("live");
  else { console.log("NOT SERVED YET"); failed.push(pkg); }
}

if (failed.length) {
  console.error(`\nrelease:npm: ${failed.join(", ")} did not appear in time.`);
  console.error(`  The merge succeeded, so this is most likely the workflow still running or a publish failure.`);
  console.error(`  Check: ${REPO}/actions/workflows/release.yml`);
  process.exit(1);
}

console.log(`\nrelease:npm: done. ${bumps.map((b) => `@patterkit/${b.pkg}@${b.to}`).join(", ")} published.`);
console.log("  If any of these ships a standalone binary too, tag it now:  npm run release:cli");
