// DEV-ONLY preview of the EXTENSIONS window: stubs window.patterExtensions with sample rows (a project taking
// Pattershot, which needs Patterstage, and Probe, whose views aren't installed here; and an old install that no
// project here takes). Each click is logged; Uninstall drops the version so the redraw can be seen.
import type { ExtensionsWinState, PatterExtensionsApi } from "../../shared/api.js";

let state: ExtensionsWinState = {
  hasProject: true,
  rows: [
    { id: "lights", name: "Lights", inProject: false, views: ["Lighting cues"], installed: ["0.9.0"], needsInstall: false, requiredBy: [] },
    { id: "pattershot", name: "Pattershot", inProject: true, pinned: "0.4.0", views: ["Performance sheet"], installed: ["0.3.0", "0.4.0"], needsInstall: false, requiredBy: [] },
    { id: "patterstage", name: "Patterstage", inProject: true, pinned: "0.5.1", views: [], installed: [], needsInstall: false, requiredBy: ["Pattershot"] },
    { id: "probe", name: "Probe", inProject: true, pinned: "1.0.0", views: ["Probe view"], installed: [], needsInstall: true, requiredBy: [] },
  ],
  ...(new URL(location.href).searchParams.get("focus") ? { focus: new URL(location.href).searchParams.get("focus")! } : {}),
};
let onState: ((s: ExtensionsWinState) => void) | undefined;

const stub: PatterExtensionsApi = {
  info: async () => ({ state, pinned: true, theme: { colour: "system", font: "newsreader" } }),
  add: () => console.log("add"),
  install: (id) => console.log("install", id),
  remove: (id) => console.log("remove", id),
  uninstall: (id, version) => {
    console.log("uninstall", id, version);
    state = { ...state, rows: state.rows.map((r) => (r.id === id ? { ...r, installed: r.installed.filter((v) => v !== version) } : r)) };
    onState?.(state);
  },
  update: (id) => console.log("update", id),
  setPin: (on) => console.log("setPin", on),
  close: () => console.log("close"),
  onState: (handler) => { onState = handler; },
  onProject: () => undefined,
  onPin: () => undefined,
  onTheme: () => undefined,
};
(window as unknown as { patterExtensions: unknown }).patterExtensions = stub;
void import("../extensions/extensions.js");
