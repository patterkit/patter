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
