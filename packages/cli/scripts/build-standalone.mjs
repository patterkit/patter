// ---------------------------------------------------------------------------
// Build standalone `patter` binaries (spec §13): one self-contained executable
// per platform, no Node required. Bun --compile bundles src/cli.ts (every
// workspace + sibling dep inlined) and emits a native binary; Bun cross-compiles
// every target from any host, so CI builds the whole set from two runners.
//
//   node scripts/build-standalone.mjs                 # the host's native target
//   node scripts/build-standalone.mjs --targets=linux-x64,windows-x64,...
//   PATTER_TARGETS=darwin-arm64,darwin-x64 node scripts/build-standalone.mjs
//
// macOS binaries are codesigned (hardened runtime + JIT entitlements, so they
// stay notarization-ready) when built ON macOS with a Developer ID identity in
// the keychain, or PATTER_SIGN_IDENTITY. No identity (contributors / keychain-
// less CI) → the binary is still produced, ad-hoc signed, with a note. We do not
// notarize a CLI. Windows ships unsigned by policy; the download page covers
// SmartScreen. Linux needs no signature.
//
// The PDF export's fonts are files in upstream font packages (ops's script-fonts.json lists them), which
// ops resolves from node_modules at run time, and a compiled binary has no node_modules. So Bun compiles a
// generated entry that embeds each file (`with { type: "file" }`), hands the embedded paths to ops's
// useScriptFontFiles, then runs src/cli.ts. Each font package's licence file is embedded the same way, for
// `patter licences`, and so are Patter's own LICENSE and the notices of every library the binary contains
// (collected from a Bun metafile by the shared scripts/third-party-notices.mjs). The host's own binary is
// then run once to export a PDF and list the licences, so a font or notice that failed to embed stops the
// build.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { collectNotices } from "../../../scripts/third-party-notices.mjs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const pkgDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(pkgDir, "dist");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: pkgDir, stdio: "inherit" });
const probe = (cmd, args) => execFileSync(cmd, args, { cwd: pkgDir, encoding: "utf8" });

// Bun --target → the download asset basename (Bun appends `.exe` for windows).
// The names are matched by the website's download list, so keep them stable.
const TARGETS = {
  "darwin-arm64": "patter-macos-arm64",
  "darwin-x64": "patter-macos-x64",
  "linux-x64": "patter-linux-x64",
  "linux-arm64": "patter-linux-arm64",
  "windows-x64": "patter-windows-x64",
};

const hostTarget = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "arm64" : "x64"}`;
const requested = process.argv.find((a) => a.startsWith("--targets="))?.slice("--targets=".length) ?? process.env.PATTER_TARGETS;
const targets = (requested ? requested.split(",") : [hostTarget]).map((t) => t.trim()).filter(Boolean);

// Resolve a macOS signing identity once (only consulted for darwin targets on macOS).
let identity = process.env.PATTER_SIGN_IDENTITY;
if (!identity && process.platform === "darwin") {
  try {
    identity = probe("security", ["find-identity", "-v", "-p", "codesigning"])
      .match(/"(Developer ID Application: [^"]+)"/)?.[1];
  } catch {
    // `security` exits non-zero on a keychain-less runner: take the unsigned path.
  }
}

// The generated entry: embed every font file and each font package's licence, point ops at the embedded
// copies, then run the CLI. Licences are found as ops finds them (LICENSE, LICENSE.txt or OFL.txt).
const faces = JSON.parse(readFileSync(join(pkgDir, "../ops/src/script-fonts.json"), "utf8"));
const specs = [...new Set(Object.values(faces).flat())];
const opsRequire = createRequire(join(pkgDir, "../ops/package.json"));
const packages = [...new Set(specs.map((spec) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/")))];
const licencePaths = packages.map((name) => {
  const dir = (opsRequire.resolve.paths(name) ?? []).map((p) => join(p, name)).find((d) => existsSync(d));
  const file = dir && readdirSync(dir).find((f) => /^(licen[cs]e|ofl)/i.test(f));
  if (!dir || !file) throw new Error(`no licence file found for ${name}`);
  return join(dir, file);
});
// The libraries the binary contains: bundle src/cli.ts once (not compiled) for its metafile, then collect
// every third-party package's licence files. Patter's own packages are covered by its LICENSE, and the
// fonts by the font licences above.
const scratch = mkdtempSync(join(tmpdir(), "patter-notices-"));
run("bun", ["build", "src/cli.ts", "--target=bun", "--outdir", join(scratch, "out"), `--metafile=${join(scratch, "meta.json")}`]);
const notices = collectNotices(join(scratch, "meta.json"), { cwd: pkgDir, exclude: ["@patterkit/", ...packages] });
rmSync(scratch, { recursive: true, force: true });
const noticesFile = join(distDir, "third-party-notices.txt");
const entry = join(distDir, "standalone-entry.mjs");
mkdirSync(distDir, { recursive: true });
writeFileSync(noticesFile, notices.text);
console.log(`notices: ${notices.packages.length} libraries`);
writeFileSync(entry, [
  `import { useScriptFontFiles } from "@patterkit/ops";`,
  `import { useEmbeddedNotices } from "../src/notices.ts";`,
  `import licence from "../LICENSE" with { type: "file" };`,
  `import libraries from "./third-party-notices.txt" with { type: "file" };`,
  `useEmbeddedNotices({ licence, libraries });`,
  ...specs.map((spec, i) => `import f${i} from ${JSON.stringify(spec)} with { type: "file" };`),
  ...licencePaths.map((path, i) => `import l${i} from ${JSON.stringify(path)} with { type: "file" };`),
  `useScriptFontFiles(`,
  `  { ${specs.map((spec, i) => `${JSON.stringify(spec)}: f${i}`).join(", ")} },`,
  `  { ${packages.map((name, i) => `${JSON.stringify(name)}: l${i}`).join(", ")} },`,
  `);`,
  `await import("../src/cli.ts");`,
  "",
].join("\n"));

// Run a freshly built binary as a user would, from somewhere else: scaffold a project, export its PDF.
function smoke(out) {
  const dir = mkdtempSync(join(tmpdir(), "patter-standalone-"));
  try {
    execFileSync(out, ["init", "smoke.patter", "--name", "Smoke"], { cwd: dir, stdio: "pipe" });
    execFileSync(out, ["export-script", "smoke.patter", "-o", "smoke.pdf"], { cwd: dir, stdio: "pipe" });
    if (readFileSync(join(dir, "smoke.pdf")).subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
    const listed = execFileSync(out, ["licences"], { cwd: dir, encoding: "utf8" });
    const sections = (listed.match(/^=== /gm) ?? []).length;
    if (sections !== packages.length + notices.packages.length || !/open font license/i.test(listed) || !/^MIT License/m.test(listed)) {
      throw new Error("licences missing");
    }
    console.log(`smoke: ${out} exported a PDF and listed its licence, ${packages.length} font licences and ${notices.packages.length} library notices`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const target of targets) {
  const base = TARGETS[target];
  if (!base) {
    console.error(`unknown target '${target}': expected one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  const outBase = join(distDir, base);
  run("bun", ["build", entry, "--compile", `--target=bun-${target}`, "--outfile", outBase]);
  const out = target.startsWith("windows") ? `${outBase}.exe` : outBase;
  if (target === hostTarget) smoke(out);

  if (!target.startsWith("darwin")) continue; // only macOS binaries are signed
  if (process.platform !== "darwin") {
    console.log(`(${base}: cross-built off macOS, cannot codesign here; left ad-hoc)`);
    continue;
  }
  if (!identity) {
    console.log(`(${base}: no Developer ID identity in the keychain, left ad-hoc signed)`);
    continue;
  }
  run("codesign", [
    "--force", "--timestamp", "--options", "runtime",
    "--entitlements", join(pkgDir, "entitlements.plist"),
    "--sign", identity, out,
  ]);
  run("codesign", ["--verify", "--strict", "--verbose=2", out]);
  console.log(`signed: ${base} (${identity})`);
}

rmSync(entry); // dist/ is the npm package's folder: never leave the generated files in it
rmSync(noticesFile);
