#!/usr/bin/env node
//
// Regenerate the document .ico set from the canonical brand sources under
// branding/document-icons/. Runs automatically before the Windows packaging
// steps (npm run dist / dist:win / dist:all); safe to run by hand too.
//
// Companion to build-mac-icons.sh, same reasoning: for fileAssociations
// electron-builder copies the icon path verbatim into the platform's
// icon-registration mechanism (NSIS registry entries on Windows), so a PNG
// there renders as a blank document icon. We bake the .ico ourselves and
// point the win fileAssociations at it.
//
// The APP icon (build/icon.ico) is baked here too: electron-builder's own
// PNG conversion embeds a single 256px frame, which Windows shell surfaces
// (shortcut, taskbar, search) render as a blank icon - they want the small
// bitmap sizes. A proper multi-size .ico fixes it.
//
// Mac-only currently: uses Apple's `sips` for the resize step (matches
// build-mac-icons.sh). If we ever package Windows from Linux, swap in
// `sharp` or similar - the rest is platform-agnostic.
//
// Sources are the SQUARE masters under branding/document-icons/square/ (the
// page-shaped brand art pre-padded to 1024x1024; see build-doc-squares.py).
//
// Input  (repo root):    branding/document-icons/square/{doc-patter,doc-patterproj,doc-patterc,doc-patterpack}.png
// Output (this package):  build/{doc-patter,doc-patterproj,doc-patterc,doc-patterpack}.ico
//   doc-patter      -> the .patter project package
//   doc-patterproj  -> the project shards (.patterproj/.patterflow/.patterloc/.patterx)
//   doc-patterc     -> the compiled .patterc bundle
//   doc-patterpack  -> the .patterpack single-file project package

import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import pngToIco from "png-to-ico";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR    = resolve(SCRIPT_DIR, "..");
const REPO_ROOT  = resolve(APP_DIR, "../..");
const SRC_DIR    = join(REPO_ROOT, "branding/document-icons/square");
const OUT_DIR    = join(APP_DIR, "build");

// Windows-friendly icon sizes. 256 is the largest a single .ico entry can
// hold (Win Vista+ supports it via PNG-compressed encoding); the smaller
// variants keep it crisp from the taskbar (16/24) up to Explorer's "Large
// Icons" view (256).
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

// What this script produces, and therefore what the Windows build needs to find. Named here rather than
// inferred from the calls below so the off-mac check can run before any of them.
const OUTPUTS = ["doc-patter", "doc-patterproj", "doc-patterc", "doc-patterpack", "icon"];

// Off macOS there is no `sips`, so nothing can be generated here. That is FINE, because the .ico set is
// committed (see .gitignore) - but only while it is actually there. This used to exit 0 unconditionally,
// which meant a missing icon was announced as a "skip" in one step and surfaced a minute later in another
// as electron-builder failing on a file nobody had mentioned. A build step that no-ops when it cannot do
// its job hands the error to whoever runs next, and that is a different machine with no idea what was
// skipped. (from-storylets/win-icons-skip-blind, 2026-08-30, where this cost them an hour.)
if (process.platform !== "darwin") {
  const missing = OUTPUTS.filter((n) => !existsSync(join(OUT_DIR, `${n}.ico`)));
  if (missing.length === 0) {
    console.log("build-win-icons.mjs: using the committed .ico files (regenerate on a Mac when branding changes)");
    process.exit(0);
  }
  console.error(
    `build-win-icons.mjs: missing committed icons: ${missing.map((n) => `${n}.ico`).join(", ")}\n`
    + "  The resize step needs Apple's sips, so these cannot be built here.\n"
    + "  On a Mac: npm run --workspace @patterkit/patterpad build:win-icons, then commit build/*.ico",
  );
  process.exit(1);
}

function runSips(args) {
  const r = spawnSync("sips", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) {
    console.error(`build-win-icons.mjs: sips failed for: ${args.join(" ")}`);
    process.exit(1);
  }
}

async function generateIco(name, srcOverride) {
  const src = srcOverride ?? join(SRC_DIR, `${name}.png`);
  const out = join(OUT_DIR, `${name}.ico`);
  if (!existsSync(src)) {
    console.error(`build-win-icons.mjs: source missing: ${src}`);
    process.exit(1);
  }
  const tmp = mkdtempSync(join(tmpdir(), "build-win-icons-"));
  try {
    // Pre-resize the source to every entry the .ico will hold, then feed the
    // variants to png-to-ico (rather than one resolution) so the .ico embeds
    // genuinely-sharp bitmaps at small sizes instead of one downscaled blob.
    const variants = ICO_SIZES.map((sz) => join(tmp, `${name}-${sz}.png`));
    for (let i = 0; i < ICO_SIZES.length; i++) {
      const sz = String(ICO_SIZES[i]);
      runSips(["-z", sz, sz, src, "--out", variants[i]]);
    }
    const buf = await pngToIco(variants);
    writeFileSync(out, buf);
    console.log(`build-win-icons.mjs: built ${out.slice(REPO_ROOT.length + 1)}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

mkdirSync(OUT_DIR, { recursive: true });
// Driven from OUTPUTS, so the list the off-mac check tests for cannot drift from the list this makes.
for (const name of OUTPUTS) {
  // The app icon itself (window / shortcut / taskbar / search) comes from the app branding rather than
  // the document-icon sources.
  await generateIco(name, name === "icon" ? join(REPO_ROOT, "branding/icons/png/icon-patterpad-1024.png") : undefined);
}
