// ---------------------------------------------------------------------------
// The init op: scaffold -> a valid, immediately playable project (spec §13).
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { runInit, applyWrites, loadProject, runValidate, runPlay, renderPlay } from "../src/index.js";

const scratch = () => mkdtempSync(join(tmpdir(), "patter-init-"));

describe("runInit", () => {
  it("scaffolds a valid project that plays out of the box", () => {
    const dir = join(scratch(), "my-game");
    const result = runInit({ dir, name: "My Game" });
    applyWrites(result.writes);

    const loaded = loadProject(dir);
    expect(loaded.project.project.name).toBe("My Game");
    expect(runValidate(loaded).ok).toBe(true);

    const transcript = renderPlay(runPlay(loaded)).join("\n");
    expect(transcript).toContain("Welcome to My Game");
    expect(transcript).toContain("--- END ---");
  });

  it("derives the name from the directory and emits the conventions", () => {
    const dir = join(scratch(), "river-town");
    const result = runInit({ dir });
    expect(result.name).toBe("river-town");
    applyWrites(result.writes);
    expect(existsSync(join(dir, "river_town.patterproj"))).toBe(true);
    expect(existsSync(join(dir, ".editorconfig"))).toBe(true);
    expect(existsSync(join(dir, "vcs-setup.md"))).toBe(true);
    expect(existsSync(join(dir, ".gitattributes"))).toBe(false); // no --vcs git
  });

  it("emits .gitattributes (eol pinning + bundle/document rules) for --vcs git", () => {
    const dir = join(scratch(), "g");
    applyWrites(runInit({ dir, vcs: "git" }).writes);
    const attrs = readFileSync(join(dir, ".gitattributes"), "utf8");
    expect(attrs).toContain("*.patterflow text eol=lf");
    expect(attrs).toContain("*.patterflow merge=patter"); // structured-merge driver, active
    expect(attrs).not.toContain("# *.patterflow merge=patter"); // not commented out
    expect(attrs).toContain("*.patterc    text eol=lf merge=ours"); // committed-but-regenerated bundle
    expect(attrs).toContain("*.patterpack binary");                 // packed document envelope
    expect(readFileSync(join(dir, "vcs-setup.md"), "utf8")).toContain("## git");
  });

  it("--bundle posture controls the ignore file (default commit ignores only the document)", () => {
    const commit = join(scratch(), "commit");
    applyWrites(runInit({ dir: commit, vcs: "git" }).writes); // default = commit
    const ci = readFileSync(join(commit, ".gitignore"), "utf8");
    expect(ci).toContain("*.patterpack");      // packed document always ignored
    expect(ci).toContain("*.patterconflict");  // merge sidecar
    expect(ci).not.toMatch(/^\*\.patterc$/m);  // bundle is committed under "commit"

    const ignore = join(scratch(), "ignore");
    applyWrites(runInit({ dir: ignore, vcs: "git", bundle: "ignore" }).writes);
    const ii = readFileSync(join(ignore, ".gitignore"), "utf8");
    expect(ii).toMatch(/^\*\.patterc$/m);      // bundle ignored under "ignore"

    expect(readFileSync(join(commit, "vcs-setup.md"), "utf8")).toContain("COMMITS the compiled");
    expect(readFileSync(join(ignore, "vcs-setup.md"), "utf8")).toContain("IGNORES the compiled");
  });

  it("emits the right ignore filename per VCS (svn uses a property, not a file)", () => {
    const cases = [["git", ".gitignore"], ["perforce", ".p4ignore"], ["plastic", "ignore.conf"]] as const;
    for (const [vcs, fname] of cases) {
      const dir = join(scratch(), vcs);
      applyWrites(runInit({ dir, vcs }).writes);
      expect(existsSync(join(dir, fname))).toBe(true);
    }
    const svn = join(scratch(), "svn");
    applyWrites(runInit({ dir: svn, vcs: "svn" }).writes);
    expect(existsSync(join(svn, ".gitignore"))).toBe(false);
    expect(readFileSync(join(svn, "vcs-setup.md"), "utf8")).toContain("svn propset svn:ignore");
  });

  it("tailors vcs-setup.md per VCS", () => {
    for (const [vcs, marker] of [["perforce", "p4 typemap"], ["plastic", "Plastic SCM"], ["svn", "svn:eol-style"]] as const) {
      const dir = join(scratch(), vcs);
      applyWrites(runInit({ dir, vcs }).writes);
      expect(readFileSync(join(dir, "vcs-setup.md"), "utf8")).toContain(marker);
    }
  });

  it("refuses to scaffold over an existing project", () => {
    const dir = join(scratch(), "x");
    applyWrites(runInit({ dir }).writes);
    expect(() => runInit({ dir })).toThrow(/already exists/);
  });
});
