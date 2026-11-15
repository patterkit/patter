// The Extensions window's and view extensions' messages: add, remove, update and uninstall an extension, and a view's write of the project's own values for its extension.
// Moved out of main/index.ts's registerIpc; what the handlers need from the rest of the main process comes in
// through `registerExtensionsIpc`.

import { ipcMain, type BrowserWindow } from "electron";
import { frontForModal, pinToolWindow, type defineToolWindows } from "@wildwinter/app-shell/tool-window";
import * as project from "./project.js";
import type { createViewExtensions } from "./views.js";
import type { createStore, ToolWindowName } from "./store.js";
import type { ExtensionsWinInfo, ExtensionsWinState } from "../shared/api.js";

/** What these handlers read and call from the rest of the main process. */
export interface ExtensionsIpcContext {
  readonly win: BrowserWindow | null;
  readonly views: ReturnType<typeof createViewExtensions>;
  readonly store: ReturnType<typeof createStore>;
  readonly windows: ReturnType<typeof defineToolWindows<ToolWindowName>>;
  openExtensionsWindow(focus?: string): void;
  projectChanged(): void;
  extensionsState(): Promise<ExtensionsWinState>;
}

export function registerExtensionsIpc(c: ExtensionsIpcContext): void {
  // View extensions: the Extensions window's Add, Remove from Project and Uninstall, and a view's write of the
  // project's own values for its extension. While one of them asks, the editor comes in front of the pinned
  // windows, the Extensions window among them, so its question is never hidden under one.
  ipcMain.handle("extensions:open", (_e, focus?: unknown) => { c.openExtensionsWindow(typeof focus === "string" ? focus : undefined); });
  ipcMain.handle("extensions:add", async (_e, expect?: unknown) => {
    const release = c.win ? frontForModal(c.win) : () => {};
    const r = await c.views.add(typeof expect === "string" ? expect : undefined).finally(release);
    // The open scene reloads whether or not its data was rewritten: it opened with the extension's data held
    // back, untaken, and now takes it. Views installed alone leave the project as it was.
    if (r?.ok && !r.installedOnly) { c.win?.webContents.send("replace:applied"); c.projectChanged(); }
    return r;
  });
  ipcMain.handle("extensions:remove", async (_e, id: unknown) => {
    if (typeof id !== "string") return null;
    const release = c.win ? frontForModal(c.win) : () => {};
    const r = await c.views.remove(id).finally(release);
    // Its data shards stay, but the open scene's data for it is now another extension's leftovers: reload it.
    if (r?.ok) { c.win?.webContents.send("replace:applied"); c.projectChanged(); }
    return r;
  });
  ipcMain.handle("extensions:update", async (_e, id: unknown) => {
    if (typeof id !== "string") return null;
    const release = c.win ? frontForModal(c.win) : () => {};
    const r = await c.views.upgrade(id).finally(release);
    if (r?.ok && !r.installedOnly) { c.win?.webContents.send("replace:applied"); c.projectChanged(); }
    return r;
  });
  ipcMain.handle("extWin:info", async (): Promise<import("../shared/api.js").ExtensionsWinInfo> => ({
    state: await c.extensionsState(), pinned: c.store.window("extensions").pinned(), theme: c.store.read().theme,
  }));
  // Add, Install and Remove are project steps, so they go through the editor, where undo lives.
  const toEditor = (cmd: string): void => { if (c.win && !c.win.isDestroyed()) c.win.webContents.send("menu", cmd); };
  ipcMain.handle("extWin:add", () => { toEditor("add-extension"); });
  ipcMain.handle("extWin:install", (_e, id: unknown) => { if (typeof id === "string") toEditor(`add-extension:${id}`); });
  ipcMain.handle("extWin:remove", (_e, id: unknown) => { if (typeof id === "string") toEditor(`remove-extension:${id}`); });
  // Update… is a project step when a project is open (the editor runs it); with none, only this machine changes.
  ipcMain.handle("extWin:update", async (_e, id: unknown) => {
    if (typeof id !== "string") return;
    if (project.currentRoot() !== null) { toEditor(`update-extension:${id}`); return; }
    const release = c.win ? frontForModal(c.win) : () => {};
    await c.views.upgrade(id).finally(release);
  });
  // Uninstall is this machine's, not the project's: no undo step, so main does it.
  ipcMain.handle("extWin:uninstall", async (_e, id: unknown, version: unknown) => {
    if (typeof id !== "string" || typeof version !== "string") return;
    const release = c.win ? frontForModal(c.win) : () => {};
    await c.views.uninstall(id, version).finally(release);
  });
  ipcMain.handle("extWin:setPin", (_e, on: boolean) => {
    c.store.window("extensions").setPinned(on);
    pinToolWindow(c.windows.get("extensions"), c.win, on);
  });
  ipcMain.handle("extWin:close", () => { c.windows.get("extensions")?.close(); });
  ipcMain.handle("views:open", async (_e, extension: unknown, view: unknown) => {
    if (typeof extension === "string" && typeof view === "string") await c.views.open(extension, view);
  });
  ipcMain.handle("extensions:writeProject", async (_e, extension: string, entry: Record<string, unknown>, label: string) => {
    if (typeof extension !== "string" || typeof label !== "string" || !entry || typeof entry !== "object") return { ok: false, error: "That isn't a write." };
    const r = await project.saveProjectExtensionValues(extension, entry, label);
    if (r.ok) c.projectChanged();
    return r;
  });
}
