import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The monorepo has no built `dist/` for its packages - they're consumed from SOURCE via aliases (the
// same way root tsconfig.json / vitest.config.ts do). We mirror those aliases here so the Electron
// main + renderer bundle `@patterkit/*` (and the sibling `@wildwinter/*` expr libs) straight from
// TypeScript source. The surface is pulled in via its own subpath exports.
const root = fileURLToPath(new URL("../..", import.meta.url)); // repo root
const expr = resolve(root, "../expr");                          // sibling expr repo (per root tsconfig paths)

const alias: Record<string, string> = {
  "@patterkit/model": resolve(root, "packages/model/src/index.ts"),
  "@patterkit/core": resolve(root, "packages/core/src/index.ts"),
  "@patterkit/dialect": resolve(root, "packages/dialect/src/index.ts"),
  "@patterkit/compiler": resolve(root, "packages/compiler/src/index.ts"),
  "@patterkit/runtime": resolve(root, "packages/runtime/src/index.ts"),
  "@patterkit/ops": resolve(root, "packages/ops/src/index.ts"),
  "@wildwinter/expr": resolve(expr, "packages/expr/src/index.ts"),
  "@wildwinter/scoperegistry": resolve(expr, "packages/scoperegistry/src/index.ts"),
  "@wildwinter/expr-editor/styles.css": resolve(expr, "packages/expr-editor/src/styles.css"),
  "@wildwinter/expr-editor": resolve(expr, "packages/expr-editor/src/index.ts"),
  "@patterkit/patterpad-surface/surface": resolve(root, "packages/patterpad-surface/web/surface.ts"),
  "@patterkit/patterpad-surface/views": resolve(root, "packages/patterpad-surface/web/views.ts"),
  "@patterkit/patterpad-surface/styles.css": resolve(root, "packages/patterpad-surface/web/styles.css"),
  "@patterkit/patterpad-surface/theme.css": resolve(root, "packages/patterpad-surface/web/theme.css"),
};

// Heavy node-only deps that `@patterkit/ops` pulls in for report (exceljs) / pack (jszip) / the readable
// script export (pdfkit, docx). They are NOT on this app's hot path (load / play / write), so keep them
// external in the Node main bundle - they load from node_modules at runtime if ever reached.
const nodeExternal = ["exceljs", "jszip", "pdfkit", "docx", "@wildwinter/simple-vc-lib", "ws"];

// The workspace packages, which MUST be bundled from source (via the alias), not externalized. See the
// `build.externalizeDeps` note in the main config below.
const workspacePkgs = ["@patterkit/core", "@patterkit/model", "@patterkit/ops", "@patterkit/runtime", "@patterkit/patterpad-surface"];

export default defineConfig({
  main: {
    resolve: { alias },
    // electron-vite 5 AUTO-externalizes everything in package.json `dependencies` (build.externalizeDeps
    // defaults on) - a behaviour change from v2, which bundled the aliased workspace packages. Left as-is,
    // `@patterkit/*` leak into out/main as runtime imports resolving to each package's `dist/`, which the
    // release build never compiles, so the packaged app dies at LAUNCH with ERR_MODULE_NOT_FOUND. Exclude
    // the workspace packages so the alias bundles them from source (matching the pre-upgrade behaviour);
    // real third-party deps stay externalized and load from node_modules.
    build: {
      externalizeDeps: { exclude: workspacePkgs },
      rollupOptions: { external: nodeExternal },
    },
  },
  preload: {
    resolve: { alias },
    // Emit the preload as CommonJS (.cjs), not ESM - a SANDBOXED preload (sandbox: true, see
    // src/main/index.ts) must be CJS. The bridge uses only `electron`, so nothing here needs ESM.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          // Four windows: the editor shell, the interactive play window, the detached search tool, and the
          // detached coverage results window.
          index: resolve(root, "packages/patterpad/src/renderer/index.html"),
          play: resolve(root, "packages/patterpad/src/renderer/play/index.html"),
          search: resolve(root, "packages/patterpad/src/renderer/search/index.html"),
          coverage: resolve(root, "packages/patterpad/src/renderer/coverage/index.html"),
        },
      },
    },
  },
});
