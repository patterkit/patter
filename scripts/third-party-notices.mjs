// GENERATED - vendored from expr/tooling/third-party-notices.mjs by scripts/vendor-ports.mjs.
// Do not edit here; edit the shared source and re-run the script.
// Collect the licence notices of every third-party package a bundle contains, from the bundler's
// metafile (Bun's `--metafile`, or esbuild's: the same `inputs` shape), or from a list of the files it
// bundled (a Vite / Rollup plugin reads them off each chunk's `moduleIds`).
//
//   node scripts/third-party-notices.mjs <metafile> -o notices.txt [--cwd dir] [--exclude a,b,@scope/]
//
// or, from a build script or plugin:
//
//   import { collectNotices, collectNoticesFromFiles } from "./third-party-notices.mjs";
//   const { text, packages } = collectNotices(metafilePath, { cwd, exclude: ["@patterkit/"] });
//   const { text } = collectNoticesFromFiles(chunk.moduleIds, { exclude: ["@patterkit/"] });
//
// WHY: a single-file build (a standalone CLI compiled with Bun) carries the code of a hundred or so
// npm packages and none of their licence files. MIT, ISC, BSD and Apache-2.0 all ask for the
// copyright notice and licence text to travel with copies, and Apache-2.0 for any NOTICE file too.
// Installing from npm keeps each package's own files in node_modules; a compiled binary has to carry
// them itself. So the build lists every package the metafile names, finds each one's licence files,
// and writes one text the binary embeds and prints.
//
// What counts: each input file belongs to the nearest folder above it with a NAMED package.json
// (some packages nest nameless package.json files to set "type"). Packages are deduped by name and
// version. Licence files are LICENSE, LICENCE, COPYING and NOTICE, with any extension or suffix. A
// package outside node_modules (a sibling checkout, consumed from source) that has none of its own
// takes the first one above it, which is its repository's. A package with no file at all says so,
// with what its package.json declares, rather than inventing a copyright line.
//
// `exclude` takes package names, or prefixes ending in "/" for a whole scope: the family's own code,
// whose licence the tool prints itself.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

function licenceFiles(dir) {
  return readdirSync(dir).filter((f) => LICENCE_FILE.test(f)).sort();
}

function packageOf(file) {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, "utf8"));
      if (pkg.name) return { dir, pkg };
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** The licence text for one package: its own files, else (outside node_modules) its repository's. */
function licenceText(dir) {
  let files = licenceFiles(dir);
  let from = dir;
  if (files.length === 0 && !dir.split(sep).includes("node_modules")) {
    for (let up = dirname(dir); up !== dirname(up); up = dirname(up)) {
      const found = licenceFiles(up);
      if (found.length > 0) { files = found; from = up; break; }
      if (existsSync(join(up, ".git"))) break;
    }
  }
  return files.map((f) => readFileSync(join(from, f), "utf8").trim()).join("\n\n");
}

const describe = (value) => (typeof value === "string" ? value : value?.name ?? value?.type ?? JSON.stringify(value));

export function collectNotices(metafile, options = {}) {
  const meta = JSON.parse(readFileSync(metafile, "utf8"));
  return collectNoticesFromFiles(Object.keys(meta.inputs ?? {}), options);
}

/** The same, from the bundled files themselves. Bundler ids that are not files (Rollup's virtual
 *  "\0" modules, a query such as "?commonjs-proxy") are cleaned or skipped. */
export function collectNoticesFromFiles(files, { cwd = process.cwd(), exclude = [] } = {}) {
  const excluded = (name) => exclude.some((e) => (e.endsWith("/") ? name.startsWith(e) : name === e));
  const seen = new Map();
  for (const raw of files) {
    if (raw.startsWith("\0")) continue;
    const file = resolve(cwd, raw.split("?")[0]);
    if (!existsSync(file)) continue;
    const found = packageOf(file);
    if (!found || excluded(found.pkg.name)) continue;
    const key = `${found.pkg.name}@${found.pkg.version}`;
    if (!seen.has(key)) seen.set(key, found);
  }
  const packages = [...seen.values()]
    .map(({ dir, pkg }) => {
      const licence = describe(pkg.license ?? pkg.licenses?.[0]) ?? "not declared";
      const text = licenceText(dir) || [
        `(The package carries no licence file. Its package.json declares: ${licence}.`,
        pkg.author ? ` Author: ${describe(pkg.author)}.` : "",
        pkg.repository ? ` Repository: ${describe(pkg.repository?.url ?? pkg.repository)}.` : "",
        ")",
      ].join("");
      return { name: pkg.name, version: pkg.version, licence, text };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || String(a.version).localeCompare(String(b.version)));
  const text = packages.map((p) => `=== ${p.name} ${p.version} (${p.licence}) ===\n\n${p.text}`).join("\n\n") + "\n";
  return { text, packages };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
  const out = flag("-o");
  const cwd = flag("--cwd");
  const exclude = (flag("--exclude") ?? "").split(",").filter(Boolean);
  const [metafile] = args;
  if (!metafile || !out) {
    console.error("usage: third-party-notices.mjs <metafile> -o notices.txt [--cwd dir] [--exclude a,b,@scope/]");
    process.exit(2);
  }
  const { text, packages } = collectNotices(metafile, { cwd, exclude });
  writeFileSync(out, text);
  console.log(`third-party notices: ${packages.length} packages -> ${out}`);
}
