// ---------------------------------------------------------------------------
// Every package Patter publishes to npm carries the repository's LICENSE. npm adds a package's LICENSE
// file to its tarball automatically, but only from the package's own folder, and the MIT licence asks
// for its text to travel with every copy. So each public package keeps a copy, and this keeps the
// copies identical to the root's.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const licence = readFileSync(join(root, "LICENSE"), "utf8");
const published = readdirSync(join(root, "packages"))
  .map((dir) => ({ dir, manifest: join(root, "packages", dir, "package.json") }))
  .filter(({ manifest }) => existsSync(manifest) && !JSON.parse(readFileSync(manifest, "utf8")).private);

describe("published packages carry the licence", () => {
  it("finds the public packages", () => expect(published.length).toBeGreaterThan(0));
  for (const { dir } of published) {
    it(dir, () => expect(readFileSync(join(root, "packages", dir, "LICENSE"), "utf8")).toBe(licence));
  }
});
