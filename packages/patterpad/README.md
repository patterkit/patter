# @patterkit/patterpad

Patterpad: the desktop app. An **Electron** shell that embeds the script-editing surface
([`@patterkit/patterpad-surface`](../patterpad-surface)) over the shared **`@patterkit/ops`** core,
so the editor, the CLI, and CI behave identically by construction ("one core, many front-ends",
Patterpad.md §9).

This is the **M0 vertical slice** (Patterpad.md §11): _open a project → edit a scene → save → play._
It proves the whole spine end-to-end before the navigator / inspector / settings breadth is built.

## Shape

```
src/
  main/index.ts      Node main process: app lifecycle, window, native dialogs, IPC wiring.
  main/project.ts    The project session: @patterkit/ops integration (open/read/save/play/create/validate).
  main/store.ts      userData store: open-where-you-left-off, recents, first-run identity.
  main/menu.ts       The native app menu (File/Edit/Run); items relay commands to the renderer.
  preload/index.ts   The narrow contextBridge: exposes window.patter (shared/api.ts) only.
  renderer/          The UI (no Node). First-run identity, welcome screen, the project workspace.
  shared/api.ts      The IPC contract, shared by preload + renderer.
test/                Headless proofs (run under the repo vitest): spine, project session, store.
```

- **Files are the truth.** The renderer never touches disk; it asks the main process, which loads /
  writes the canonical shards through `@patterkit/ops` (`loadProject`, `runPlay`, `runInit`). Saves go
  through `@wildwinter/simple-vc-lib` `writeTextFiles`: lock-aware checkout-on-write for Perforce /
  Plastic, a plain write for git / none: falling back to a direct write if the VC layer is absent.
- **The surface is embedded, not forked.** `mountSurface` is the same component the dev harness uses.
- **No built `dist/`.** The monorepo consumes its packages from TypeScript source via aliases;
  `electron.vite.config.ts` mirrors the root tsconfig/vitest aliases so main + renderer bundle from
  source.

## Run it

From the **repo root**:

```bash
npm install                      # installs electron + electron-vite + electron-builder (downloads the Electron binary)
npm run dev -w @patterkit/patterpad
```

On first run it asks for your name (it tags edits in a project's history), then shows a **welcome
screen**: open a project, create a new one (`runInit`), open a recent, or open the bundled
**`examples/tavern`** (also under **File ▸ Open / New / Open Recent**). It reopens your last project on
the next launch, on the scene you left. In a project: pick a scene in the left rail, edit it in the
surface, **File ▸ Save** (⌘/Ctrl-S) writes the canonical shards back (stamping your name into the
edit-trail), **Run ▸ Play** (F5) opens a separate **play window**: walk the script with **Step** (one
beat) or **Continue** (run to the next choice / the end), choices are buttons, and the **current line
is marked in the editor** as it plays, leaving a **visited trail** of the beats it passed through.

> If a previous install skipped the Electron binary (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`), re-run
> `npm install` without that flag (or `node node_modules/electron/install.js`) before `npm run dev`.

## Verify without launching

```bash
npx vitest run packages/patterpad                       # the data spine (open/read/save/play)
npx tsc --noEmit -p packages/patterpad/tsconfig.web.json   # renderer + surface types
npx tsc --noEmit -p packages/patterpad/tsconfig.node.json  # main + preload types (needs electron installed)
npm run build -w @patterkit/patterpad                   # bundles all three processes to out/
```

**Preview the UI without Electron.** `src/renderer/preview/` runs the *real* renderer in a plain
browser against a stubbed `window.patter` (`preview.vite.config.ts`), so the shell layout / CSS /
states can be eyeballed without a GUI launch: the editor mounts the real tavern script:

```bash
node node_modules/vite/bin/vite.js --config packages/patterpad/preview.vite.config.ts
#   /              -> the project workspace
#   /?view=welcome -> the welcome screen
#   /?view=firstrun-> the first-run identity dialog
#   /play.html     -> the interactive play window
```

## Done (M0)

- Open / create / recent projects + open-where-you-left-off (userData store).
- First-run identity (name/email), stored in userData.
- Lock-aware save via `simple-vc-lib`, with a plain-write fallback.
- Embed the surface; per-scene edit; save; play.
- **Live validation** (`runValidate`) in a **bottom problems bar** (count + ‹ › prev/next nav): runs
  on open + after save; stepping or clicking a problem jumps to its node in the surface (`revealNode`).
- **Detail inspector** (right pane): the caret's container stack, leaf → snippet → group(s) → block,
  most-specific at the top: driven by the surface's new `onSelect`. Shows a line's character /
  direction / gameData, a snippet's condition / jump / effects, a group's selector / condition, a
  block's name; a header click jumps to that node. Read view for M0 (per-field editors are M1).
- **Slide / pin / full-bleed:** both side panes slide to 0 (editor goes full-bleed), toggled from the
  topbar or the **View menu** (Show Scenes ⌘1 / Show Inspector ⌘2); the open/closed state is the pin,
  remembered per user in the session store.
- **Native app menus** (File: New/Open/Open Recent/Save · Edit: PM-correct undo/redo + clipboard ·
  Run: Play), top-level commands live where people expect them, not in-window chrome.
- **Edit-trail:** each save stamps the author (first-run identity) + timestamp into the scene's
  `.patterx` authoring shard (`edits[sceneId]`).
- **Interactive play in a separate window** over the runtime Engine: **Step** (one `flow.advance()`)
  and **Continue** (the new runtime `flow.advanceToStop()`: collect every beat to the next choice / the
  end), choices are buttons, restart at the end. A **per-line step marker** in the editor follows the
  walk and leaves a **visited trail** (muted gutter dots) of what the playhead passed through; both
  clear on reset. The app **quits when all windows close** (no window-less macOS process).

## Not yet (the designed shape is Patterpad.md §4/§6; the current chrome is provisional)

- **Inspector per-field editing**: M0 inspector is a read view; editing conditions / effects / gameData
  inline (beyond the surface's existing jump / condition / selector affordances) is M1.
- **Transient pane "peek"**: panes slide/pin/full-bleed now; an auto-reveal of the inspector on
  selection (when unpinned) is a later nicety.
- Step marker follows play at line granularity already; the engine-link stretch (§6) reuses it.
- Edit-trail is per **scene** for now (who last saved it); per-beat granularity is a follow-up.
- Branches polish (M1), production / export (M2), collaboration (M3), localisation (M4).
- A clean split of surface-component CSS from app-shell CSS.
- The GUI itself is unverified here (no display in CI): launch with `npm run dev`.
