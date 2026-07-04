#!/usr/bin/env node
//
// Regenerate the document .ico set from the canonical brand sources under
// branding/document-icons/. Runs automatically before the Windows packaging
// steps (npm run dist / dist:win / dist:all); safe to run by hand too.
//
// Companion to build-mac-icons.sh, same reasoning: electron-builder
// converts the APP icon from PNG, but for fileAssociations it copies the
// path verbatim into the platform's icon-registration mechanism (NSIS
// registry entries on Windows), so a PNG there renders as a blank document
// icon. We bake the .ico ourselves and point the win fileAssociations at it.
//
// Mac-only currently: uses Apple's `sips` for the resize step (matches
// build-mac-icons.sh). If we ever package Windows from Linux, swap in
// `sharp` or similar - the rest is platform-agnostic.
//
// Sources are the SQUARE masters under branding/document-icons/square/ (the
// page-shaped brand art pre-padded to 1024x1024; see build-doc-squares.py).
//
// Input  (repo root):    branding/document-icons/square/{doc-patter,doc-patterproj,doc-patterc}.png
// Output (this package):  build/{doc-patter,doc-patterproj,doc-patterc}.ico
//   doc-patter      -> the .patter project package
//   doc-patterproj  -> the project shards (.patterproj/.patterflow/.patterloc/.patterx)
//   doc-patterc     -> the compiled .patterc bundle

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

if (process.platform !== "darwin") {
  console.error("build-win-icons.mjs: skipping - the sips resize step is mac-only");
  process.exit(0);
}

function runSips(args) {
  const r = spawnSync("sips", args, { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) {
    console.error(`build-win-icons.mjs: sips failed for: ${args.join(" ")}`);
    process.exit(1);
  }
}

async function generateIco(name) {
  const src = join(SRC_DIR, `${name}.png`);
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
await generateIco("doc-patter");
await generateIco("doc-patterproj");
await generateIco("doc-patterc");
