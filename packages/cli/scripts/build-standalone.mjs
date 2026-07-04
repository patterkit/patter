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
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
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

for (const target of targets) {
  const base = TARGETS[target];
  if (!base) {
    console.error(`unknown target '${target}': expected one of: ${Object.keys(TARGETS).join(", ")}`);
    process.exit(2);
  }
  const outBase = join(distDir, base);
  run("bun", ["build", "src/cli.ts", "--compile", `--target=bun-${target}`, "--outfile", outBase]);
  const out = target.startsWith("windows") ? `${outBase}.exe` : outBase;

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
