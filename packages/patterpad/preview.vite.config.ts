// DEV-ONLY Vite config to preview the renderer UI in a plain browser (no Electron), via the stub in
// src/renderer/preview/dev.ts. Mirrors the source aliases the Electron renderer uses. Not used by the
// app build (that's electron.vite.config.ts).
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url)); // repo root
const expr = resolve(root, "../expr");                         // sibling expr repo

const alias: Record<string, string> = {
  "@patterkit/model": resolve(root, "packages/model/src/index.ts"),
  "@patterkit/core": resolve(root, "packages/core/src/index.ts"),
  "@patterkit/dialect": resolve(root, "packages/dialect/src/index.ts"),
  "@wildwinter/expr": resolve(expr, "packages/expr/src/index.ts"),
  "@wildwinter/scoperegistry": resolve(expr, "packages/scoperegistry/src/index.ts"),
  "@wildwinter/expr-editor/styles.css": resolve(expr, "packages/expr-editor/src/styles.css"),
  "@wildwinter/expr-editor": resolve(expr, "packages/expr-editor/src/index.ts"),
  "@patterkit/patterpad-surface/surface": resolve(root, "packages/patterpad-surface/web/surface.ts"),
  "@patterkit/patterpad-surface/views": resolve(root, "packages/patterpad-surface/web/views.ts"),
  "@patterkit/patterpad-surface/styles.css": resolve(root, "packages/patterpad-surface/web/styles.css"),
  "@patterkit/patterpad-surface/theme.css": resolve(root, "packages/patterpad-surface/web/theme.css"),
};

export default defineConfig({
  root: resolve(root, "packages/patterpad/src/renderer/preview"),
  resolve: { alias },
  server: { fs: { allow: [root] } },
});
