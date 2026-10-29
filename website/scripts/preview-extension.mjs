// ---------------------------------------------------------------------------
// Preview or check an extension's docs in this site, from its working website/ folder.
//
//   node scripts/preview-extension.mjs dev   patterstage=../patterstage/website
//   node scripts/preview-extension.mjs build patterstage=../patterstage/website
//
// or through npm, which is how an extension's own `docs:preview` and `docs:check` call it, with
// the Patter checkout at ../patter or PATTER_ROOT:
//
//   npm --prefix "$PATTER_ROOT/website" run extension:preview -- patterstage=website
//   npm --prefix "$PATTER_ROOT/website" run extension:check -- patterstage=website
//
// A relative folder is taken from where the command was run (npm's INIT_CWD), not from here.
//
//   dev    syncs the folder in, runs the dev server, and re-syncs whenever a file in the folder
//          changes, so a page is written and seen in place. A change to docs.json's sidebar
//          needs the server restarted, as astro.config.mjs reads it once.
//   build  syncs the folder in and builds, which runs check-docs.mjs over the section with
//          Patter's own pages: house style, dead links, sidebar orphans. Exits as the build did.
//
// Either way it removes what it synced when it finishes, so this checkout is left as it was
// found, and nothing it writes is ever tracked (scripts/sync-extensions.mjs says why).
// ---------------------------------------------------------------------------

import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLocal, syncExtensions } from "./sync-extensions.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [mode, ...rest] = process.argv.slice(2);
const usage = "usage: preview-extension.mjs dev|build <id>=<website folder> [<id>=<folder> ...]";
if (mode !== "dev" && mode !== "build") {
  console.error(usage);
  process.exit(2);
}

let local;
try {
  local = parseLocal(rest.flatMap((a) => (a.startsWith("--") ? [a] : ["--local", a])), process.env.INIT_CWD ?? process.cwd());
  if (!local.size) throw new Error(usage);
  await syncExtensions({ local });
} catch (e) {
  console.error(`preview-extension: ${e.message}`);
  process.exit(1);
}

const clean = () => syncExtensions({ clean: true });

const run = (command, args) =>
  new Promise((done) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code, signal) => done(code ?? (signal ? 1 : 0)));
    process.on("SIGINT", () => child.kill("SIGINT"));
    process.on("SIGTERM", () => child.kill("SIGTERM"));
  });

if (mode === "dev") {
  let timer;
  const watchers = [...local.values()].map((dir) =>
    watch(dir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => syncExtensions({ local }).catch((e) => console.error(`preview-extension: ${e.message}`)), 150);
    }),
  );
  const code = await run("npx", ["astro", "dev"]);
  for (const w of watchers) w.close();
  clearTimeout(timer);
  await clean();
  process.exit(code);
} else {
  const code = await run("npm", ["run", "build"]);
  await clean();
  process.exit(code);
}
