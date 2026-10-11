import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  "@wildwinter/scoperegistry/scopes": resolve(expr, "packages/scoperegistry/src/scopes.ts"), // before the bare package: a key matches as a prefix too
  "@wildwinter/scoperegistry": resolve(expr, "packages/scoperegistry/src/index.ts"),
  "@wildwinter/expr-editor/styles.css": resolve(expr, "packages/expr-editor/src/styles.css"),
  "@wildwinter/expr-editor": resolve(expr, "packages/expr-editor/src/index.ts"),
  "@patterkit/patterpad-surface/surface": resolve(root, "packages/patterpad-surface/web/surface.ts"),
  "@patterkit/patterpad-surface/views": resolve(root, "packages/patterpad-surface/web/views.ts"),
  "@patterkit/patterpad-surface/styles.css": resolve(root, "packages/patterpad-surface/web/styles.css"),
  "@patterkit/patterpad-surface/theme.css": resolve(root, "packages/patterpad-surface/web/theme.css"),
  "@patterkit/patterpad-surface/fonts.css": resolve(root, "packages/patterpad-surface/web/fonts.css"),
};

// Heavy node-only deps that `@patterkit/ops` pulls in for report (exceljs) / pack (jszip) / the readable
// script export (pdfkit, docx). They are NOT on this app's hot path (load / play / write), so keep them
// external in the Node main bundle - they load from node_modules at runtime if ever reached.
const nodeExternal = ["exceljs", "jszip", "pdfkit", "docx", "@wildwinter/simple-vc-lib", "ws"];

// The workspace packages, which MUST be bundled from source (via the alias), not externalized. See the
// `build.externalizeDeps` note in the main config below.
const workspacePkgs = ["@patterkit/core", "@patterkit/model", "@patterkit/ops", "@patterkit/runtime", "@patterkit/patterpad-surface"];

// The app ships only the font files it uses, never whole font packages (patterkit's design/fonts.md).
// The renderer's faces are bundled by Vite from fonts.css as usual. The PDF export's faces are read at run
// time, so this copies just the files ops's script-fonts.json lists into out/fonts, plus the licence of
// every font package either side uses, which the OFL requires to travel with the fonts. main/index.ts
// points ops at out/fonts, and package.json's `build.files` leaves the font packages out of node_modules.
function scriptFonts(): Plugin {
  return {
    name: "patterpad-script-fonts",
    writeBundle() {
      const req = createRequire(resolve(root, "packages/ops/package.json"));
      const faces = JSON.parse(readFileSync(resolve(root, "packages/ops/src/script-fonts.json"), "utf8")) as Record<string, string[]>;
      const out = resolve(root, "packages/patterpad/out/fonts");
      rmSync(out, { recursive: true, force: true });
      const copy = (from: string, to: string): void => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); };
      const pkgOf = (spec: string): string => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");
      const packages = new Set<string>();
      for (const spec of new Set(Object.values(faces).flat())) {
        copy(req.resolve(spec), join(out, spec));
        packages.add(pkgOf(spec));
      }
      const fontsCss = readFileSync(resolve(root, "packages/patterpad-surface/web/fonts.css"), "utf8");
      for (const m of fontsCss.matchAll(/"(@(?:fontsource|ibm)\/[a-z0-9-]+)\//g)) packages.add(m[1]!);
      for (const pkg of packages) {
        const dir = (req.resolve.paths(pkg) ?? []).map((p) => join(p, pkg)).find((d) => existsSync(d));
        const licence = dir && readdirSync(dir).find((f) => /^(licen[cs]e|ofl)/i.test(f));
        if (!dir || !licence) throw new Error(`patterpad-script-fonts: no licence file for ${pkg}`);
        copy(join(dir, licence), join(out, pkg, licence));
      }
    },
  };
}

// The open-source libraries bundled into each part of the app (main, preload, renderer) carry their
// licences with them: MIT, ISC, BSD and Apache-2.0 all ask for the notice to travel with every copy, and a
// bundle keeps none of their files. So each build lists the files it bundled (every chunk's moduleIds) and
// writes their packages' licence and copyright notices to out/licences/<part>.txt, with the shared
// scripts/third-party-notices.mjs (vendored from expr/tooling, the same collector the standalone CLI
// uses). The libraries main leaves external ship in node_modules with their own files. Patter's own
// packages are covered by its LICENSE, copied in beside them.
type NoticesModule = { collectNoticesFromFiles(files: Iterable<string>, opts: { exclude: string[] }): { text: string; packages: unknown[] } };
function bundledNotices(part: string): Plugin {
  const ids = new Set<string>();
  return {
    name: "patterpad-bundled-notices",
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") for (const id of chunk.moduleIds) ids.add(id);
    },
    async writeBundle() {
      const script = pathToFileURL(resolve(root, "scripts/third-party-notices.mjs")).href;
      const { collectNoticesFromFiles } = (await import(script)) as NoticesModule;
      const { text, packages } = collectNoticesFromFiles(ids, { exclude: ["@patterkit/"] });
      const out = resolve(root, "packages/patterpad/out/licences");
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, `${part}.txt`), `Open-source libraries bundled into Patterpad (${part}), and their licences. ${packages.length} packages.\n\n${text}`);
      copyFileSync(resolve(root, "LICENSE"), join(out, "LICENSE"));
    },
  };
}

export default defineConfig({
  main: {
    plugins: [scriptFonts(), bundledNotices("main")],
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
    plugins: [bundledNotices("preload")],
    resolve: { alias },
    // Emit the preload as CommonJS (.cjs), not ESM - a SANDBOXED preload (sandbox: true, see
    // src/main/index.ts) must be CJS. The bridge uses only `electron`, so nothing here needs ESM.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [bundledNotices("renderer")],
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
