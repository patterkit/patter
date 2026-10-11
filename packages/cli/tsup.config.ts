import { defineConfig } from "tsup";

// The npm CLI is THIN: only the CLI's own code goes into dist/cli.js, and its dependencies (ops, core,
// simple-vc-lib and theirs) install from npm beside it, as any npm package's do. It used to inline
// everything (8 MB, the PDF fonts included), which made every release large and slow to publish.
// Running with no node_modules at all is the standalone binaries' job: `build:standalone` (Bun
// --compile) bundles src/cli.ts and every dependency, fonts included.
export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  splitting: false,
  platform: "node",
  clean: true,
});
