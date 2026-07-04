// Dev harness for the editing surface. It mounts the framework-neutral `mountSurface` (surface.ts)
// against a fixture and adds throwaway dev chrome the real app won't use: the live round-trip source
// pane, and the theme / font / formatting toggles. The surface itself owns the editor; this file owns
// only the harness scaffolding.

// Self-hosted web fonts (@fontsource), so the harness works offline. The app bundles its own; the
// active set is chosen by data-font (theme.css).
import "@fontsource/newsreader/400.css";
import "@fontsource/newsreader/400-italic.css";
import "@fontsource/newsreader/600.css";
import "@fontsource/newsreader/700.css";
import "@fontsource/literata/400.css";
import "@fontsource/literata/400-italic.css";
import "@fontsource/literata/600.css";
import "@fontsource/literata/700.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/400-italic.css";
import "@fontsource/source-serif-4/600.css";
import "@fontsource/source-serif-4/700.css";
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/400-italic.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource-variable/inter";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";

import { mountSurface } from "./surface.js";
import { remeasureCues } from "./views.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

const sourceEl = document.querySelector<HTMLElement>("#source")!;
const editorEl = document.querySelector<HTMLElement>("#editor")!;
const hintbarEl = document.querySelector<HTMLElement>("#hintbar")!;

// Mount the surface against the fixture; the source pane mirrors the round-trip on every change.
const surface = mountSurface({
  editor: editorEl,
  hintbar: hintbarEl,
  flowSource,
  locSource,
  formatting: true,
  castSeed: ["BARKEEP", "ANNA", "BO"],
  showTitle: true,
  onChange: (api) => {
    const { flow, loc } = api.getSource();
    sourceEl.textContent = `// tavern.patterflow\n${flow}\n// tavern.patterloc\n${loc}`;
  },
});
// Dev affordance: expose the surface handle so the play marker / pointer can be driven from the console.
(window as unknown as { __surface: unknown }).__surface = surface;

// TEMP, in-session theme preview (not persisted): cycle follow-system -> light -> dark. A throwaway
// dev affordance so the dark palette can be eyeballed without changing the OS.
const themeBtn = document.querySelector<HTMLButtonElement>("#theme-toggle");
if (themeBtn) {
  const modes = ["system", "paper", "mist", "slate", "night"] as const;
  let mode = 0;
  const applyTheme = (): void => {
    const m = modes[mode]!;
    if (m === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = m;
    themeBtn.textContent = `theme: ${m}`;
  };
  themeBtn.addEventListener("click", () => { mode = (mode + 1) % modes.length; applyTheme(); });
  applyTheme();
}

// Font-theme toggle: cycle the named sets (theme.css) for testing; the real picker is future Patterpad.
const fontBtn = document.querySelector<HTMLButtonElement>("#font-toggle");
if (fontBtn) {
  const fonts = ["newsreader", "literata", "source", "script"] as const;
  let fi = 0;
  const applyFontTheme = (): void => {
    const f = fonts[fi]!;
    document.documentElement.dataset.font = f;
    fontBtn.textContent = `font: ${f}`;
    // The cue width (-> dialogue hang point) shifts with the face/size; remeasure once applied and
    // again when the new face has loaded.
    requestAnimationFrame(remeasureCues);
    if (document.fonts) void document.fonts.ready.then(remeasureCues);
  };
  fontBtn.addEventListener("click", () => { fi = (fi + 1) % fonts.length; applyFontTheme(); });
  applyFontTheme();
}

// Formatting toggle (stands in for the project setting). Off strips existing bold / italic.
const fmtBtn = document.querySelector<HTMLButtonElement>("#format-toggle");
if (fmtBtn) {
  const applyFmt = (): void => { fmtBtn.textContent = `format: ${surface.isFormatting() ? "on" : "off"}`; };
  fmtBtn.addEventListener("click", () => { surface.setFormatting(!surface.isFormatting()); applyFmt(); });
  applyFmt();
}
