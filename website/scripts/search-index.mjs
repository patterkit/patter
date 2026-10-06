// ---------------------------------------------------------------------------
// Make the Pagefind search index on disk match the one Pagefind built.
//
// Starlight runs Pagefind through its Node API, which drives a Rust backend
// process: index the site, write the files, then close(), which kills the
// backend. Pagefind 1.5.2 writes each file with tokio's `write_all` and never
// flushes, so the backend can acknowledge "files written" while a write is
// still queued; the kill that follows then leaves that file empty or cut short
// at a 4 KiB boundary. The build exits 0 either way, and the deploy ships a
// site whose search does not load. On this machine it was 2 builds in 10.
//
// Fixed upstream in Pagefind fab688b ("flush output files before they drop",
// Pagefind/pagefind#1272), which no release carried yet as of 1.5.2. Once a
// release with it is installed, this step finds nothing to repair and can go.
//
// The index is deterministic, so this builds it again in memory with the same
// calls Starlight makes (about 150 ms), compares every file byte for byte with
// what is in dist/pagefind/, and writes back any that differ, synchronously,
// from Node. check-docs.mjs then fails the build if a file there is still
// empty, so a repair that did not happen cannot ship either.
//
// Runs as the first half of `postbuild`, before check-docs.mjs.
// ---------------------------------------------------------------------------

import * as pagefind from "pagefind";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const out = join(dist, "pagefind");

if (!existsSync(out)) {
  console.error("search-index: no dist/pagefind/ - run the build first");
  process.exit(1);
}

let files;
try {
  const { index, errors: createErrors } = await pagefind.createIndex();
  const { errors: addErrors, page_count } = await index.addDirectory({ path: dist });
  const { errors: getErrors, files: built } = await index.getFiles();
  const errors = [...createErrors, ...addErrors, ...getErrors];
  if (errors.length > 0) throw new Error(errors.join("\n"));
  if (!page_count) throw new Error("indexed no pages");
  files = built;
} finally {
  await pagefind.close();
}

const repaired = [];
for (const { path, content } of files) {
  const file = join(out, path);
  const want = Buffer.from(content);
  const have = existsSync(file) ? readFileSync(file) : null;
  if (have && have.equals(want)) continue;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, want);
  repaired.push(`  ${path}  ${have ? `${have.length} bytes on disk` : "missing"}, should be ${want.length}`);
}

if (repaired.length > 0) {
  console.warn(`search-index: rewrote ${repaired.length} Pagefind file(s) the build left incomplete:`);
  for (const line of repaired) console.warn(line);
} else {
  console.log(`search-index: ok (${files.length} files)`);
}
