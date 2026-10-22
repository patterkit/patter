// The EXTENSIONS window (patterkit design/extensions-window.md): what the open project takes and what this machine
// has installed, drawn by the shell's `extensionsPanel`. Main builds the rows and sends them again whenever they
// change; every button only says what was clicked. Add, Install and Remove are project steps, so main hands them to
// the editor, where undo lives; Uninstall is this machine's, and main asks and does it.
import "@patterkit/patterpad-surface/theme.css";
import "@wildwinter/app-shell/tooltip.css";
import "@wildwinter/app-shell/controls.css";
import "@wildwinter/app-shell/extensions-window.css";
import "./extensions.css";
import "@patterkit/patterpad-surface/fonts.css";

import { extensionsPanel, initTooltips, pinButton, toolWindowHead } from "@wildwinter/app-shell";
import "@wildwinter/app-shell/tool-window.css";
import { applyTheme } from "../src/apply-theme.js";
import type { ExtensionsWinState } from "../../shared/api.js";

initTooltips();

const api = window.patterExtensions!;
const host = document.getElementById("ext-host")!;
const panel = extensionsPanel({
  add: () => api.add(),
  install: (id) => api.install(id),
  remove: (id) => api.remove(id),
  uninstall: (id, version) => api.uninstall(id, version),
});
host.append(panel.el);
const render = (state: ExtensionsWinState): void => panel.render({ ...state, app: "Patterpad" });

const pin = pinButton({ pinned: true, onToggle: (on) => api.setPin(on) });
document.body.prepend(toolWindowHead({ title: "Extensions", pin, onClose: () => api.close() }));
api.onPin((on) => pin.set(on));
api.onTheme((t) => applyTheme(t));
// A state can land before the boot info does: the newer one wins.
let fresh = false;
api.onState((state) => { fresh = true; render(state); });
// A different project under the window: it lists the old one's until it reads the rows again.
api.onProject(() => { void api.info().then((info) => render(info.state)); });

void (async () => {
  const info = await api.info();
  applyTheme(info.theme);
  pin.set(info.pinned);
  if (!fresh) render(info.state);
})();
