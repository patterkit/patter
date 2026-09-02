// The npm half of a release: find the Changesets "Version Packages" PR, merge it, and wait for the
// registry to actually serve what it published.
//
// Shared by `release:npm` (merge a PR that is already open) and `ship:cli` (which creates the changeset
// first, then does exactly this). Extracted rather than copied: the two differ only in how the PR came
// to exist, and a copy would drift on the parts that matter - the confirmation wording and the
// --prefer-online poll.

import { execSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", ...opts }).trim();

/** The open Version Packages PR, or null. Changesets always uses this branch name. */
export function findVersionPr(cwd) {
  const json = sh('gh pr list --state open --head changeset-release/main --json number --limit 1', { cwd });
  return JSON.parse(json || "[]")[0]?.number ?? null;
}

/** Poll for the PR the Release workflow is about to open. Returns null if it never appears. */
export function waitForVersionPr(cwd, seconds = 240) {
  for (let waited = 0; waited < seconds; waited += 6) {
    const pr = findVersionPr(cwd);
    if (pr) return pr;
    execSync("sleep 6");
  }
  return null;
}

/**
 * The PR-side CI gate, which does not run by itself.
 *
 * A workflow run on the bot's PR is PARKED at `action_required`: this repo requires approval for
 * first-time contributors, `github-actions[bot]` is one, and nobody approves it because the PR is merged
 * within the minute. Every `changeset-release/main` CI run in this repo's history is either
 * `action_required` or a zero-job `failure` for exactly that reason. A gate that has never once run looks
 * from the outside precisely like a gate that passes, which is why this is done here rather than left as
 * a step in a document.
 *
 * Approving is not the dangerous half of a release: it runs the suite, and the merge that follows is
 * still confirmed separately. So this approves, waits, and REPORTS - it never merges on its own.
 *
 * Returns one of: "passed" | "failed" | "none" | "skipped".
 */
export function approveAndWaitForPrCi(cwd, pr, log = console.log, seconds = 900) {
  // Matched on the PR's HEAD COMMIT, not just the branch name. The branch is reused for every release
  // and its runs outlive the PRs they belong to, so "the latest run on changeset-release/main" is very
  // often the parked one from LAST time - which, being a zero-job failure, would abort this release over
  // a run that has nothing to do with it. (Found by running this against a freshly-merged release.)
  const sha = sh(`gh pr view ${pr} --json headRefOid --jq .headRefOid`, { cwd });
  const runOf = () => {
    const json = sh('gh run list --branch changeset-release/main --workflow ci.yml --limit 10'
      + ' --json databaseId,status,conclusion,headSha', { cwd });
    return JSON.parse(json || "[]").find((x) => x.headSha === sha) ?? null;
  };
  // The run can lag the PR by a few seconds.
  let r = null;
  for (let waited = 0; waited < 60 && !r; waited += 6) {
    r = runOf();
    if (!r) execSync("sleep 6");
  }
  if (!r) { log(`  no CI run for ${sha.slice(0, 8)} - nothing to approve`); return "none"; }

  // A parked run reports `status: "completed"` with `conclusion: "action_required"` - it is not
  // pending, it has finished by refusing to start. Testing only `status` therefore never approved
  // anything, fell through to the wait below, read the conclusion as not-success and called a
  // release FAILED that had never run. (Hit on the Patterplay 0.9.0 cut, 2026-09-02.)
  if (r.status === "action_required" || r.status === "waiting" || r.conclusion === "action_required") {
    log(`  run ${r.databaseId} is parked awaiting approval - approving`);
    try {
      sh(`gh api -X POST repos/{owner}/{repo}/actions/runs/${r.databaseId}/approve`, { cwd });
    } catch {
      // Not fatal. The publish has its own gate (the `release` script runs the suite), so a failure to
      // approve costs a second opinion rather than the only one.
      log(`  could not approve it from here - approve it in the browser if you want it: ${r.databaseId}`);
      return "skipped";
    }
  }

  for (let waited = 0; waited < seconds; waited += 10) {
    r = runOf();
    if (!r) return "none";
    // An approved run goes back to queued/in_progress, but for a moment still reports the parked
    // result; treating that as the verdict would fail the release we just unblocked.
    if (r.status === "completed" && r.conclusion !== "action_required") {
      log(`  CI ${r.conclusion} (run ${r.databaseId})`);
      return r.conclusion === "success" ? "passed" : "failed";
    }
    if (waited === 0) log("  waiting for it to finish");
    execSync("sleep 10");
  }
  log("  CI did not finish in time - not waiting any longer");
  return "skipped";
}

/**
 * What a Version Packages PR would publish, read off its diff: [{ pkg, from, to }].
 *
 * Parsed from the unified diff rather than fetched per file: one call, and the minus/plus pair for a
 * manifest's `version` line IS the bump, so there is nothing to reconstruct or guess.
 */
export function plannedBumps(cwd, pr) {
  const diff = sh(`gh pr diff ${pr}`, { cwd, maxBuffer: 32 * 1024 * 1024 });
  const bumps = [];
  let file = null, from = null;
  for (const line of diff.split("\n")) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { file = header[1]; from = null; continue; }
    if (!file?.endsWith("package.json")) continue;
    const minus = /^-\s*"version":\s*"([^"]+)"/.exec(line);
    if (minus) { from = minus[1]; continue; }
    const plus = /^\+\s*"version":\s*"([^"]+)"/.exec(line);
    // Only a PAIR is a bump. A lone + line is a dependency range being rewritten, not a release.
    if (plus && from) {
      bumps.push({ pkg: file.replace(/\/package\.json$/, "").replace(/^packages\//, ""), from, to: plus[1] });
      from = null;
    }
  }
  return bumps;
}

/**
 * Ask before publishing. npm versions cannot meaningfully be unpublished, so this is a real gate and
 * the default is NO. Returns true to proceed.
 */
export async function confirmPublish(pr, summary, repoUrl) {
  console.log(`\n  ${repoUrl}/pull/${pr}`);
  if (summary) console.log(summary);
  console.log("\n  Merging publishes to npm. Published versions cannot be unpublished.\n");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("  merge and publish? [y/N] ")).trim().toLowerCase();
  rl.close();
  return answer === "y" || answer === "yes";
}

/**
 * Wait for the registry to serve `version` of `pkg`.
 *
 * `--prefer-online` is not optional. npm caches package metadata, so for minutes after a publish a
 * plain `npm view` reports the version you just replaced - which is exactly how a working release gets
 * read as a broken one, twice in one afternoon.
 */
export function waitForNpm(pkg, version, seconds = 240) {
  for (let waited = 0; waited < seconds; waited += 6) {
    const live = sh(`npm view ${pkg} version --prefer-online`);
    if (live === version) return true;
    execSync("sleep 6");
  }
  return false;
}
