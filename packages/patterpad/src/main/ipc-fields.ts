// The Fields window's messages: the editor sends what it should show and applies what it edits; main only relays.
// Moved out of main/index.ts's registerIpc; what the handlers need from the rest of the main process comes in
// through `registerFieldsIpc`.

import { ipcMain, type BrowserWindow } from "electron";
import { pinToolWindow, type defineToolWindows } from "@wildwinter/app-shell/tool-window";
import type { createStore, ToolWindowName } from "./store.js";
import type { FieldsWinState } from "../shared/api.js";

/** What these handlers read and call from the rest of the main process. */
export interface FieldsIpcContext {
  fieldsState: FieldsWinState;
  readonly win: BrowserWindow | null;
  readonly store: ReturnType<typeof createStore>;
  readonly windows: ReturnType<typeof defineToolWindows<ToolWindowName>>;
}

export function registerFieldsIpc(c: FieldsIpcContext): void {
  // Fields window: the editor sends what it should show and applies what it edits; main only relays.
  ipcMain.handle("fields:open", () => { c.windows.open("fields"); });
  ipcMain.on("fields:state", (_e, state: import("../shared/api.js").FieldsWinState) => {
    c.fieldsState = state;
    const w = c.windows.get("fields");
    if (w && !w.isDestroyed()) w.webContents.send("fieldsWin:state", state);
  });
  ipcMain.handle("fieldsWin:info", (): import("../shared/api.js").FieldsWinInfo => ({
    state: c.fieldsState, pinned: c.store.window("fields").pinned(), follow: c.store.read().fieldsFollow, theme: c.store.read().theme,
  }));
  ipcMain.handle("fieldsWin:commit", (_e, id: string, extension: string, field: string, value: unknown) => {
    if (typeof id !== "string" || typeof extension !== "string" || typeof field !== "string") return;
    if (c.win && !c.win.isDestroyed()) c.win.webContents.send("fields:commit", id, extension, field, value);
  });
  ipcMain.handle("fieldsWin:setFollow", (_e, on: boolean) => {
    c.store.setFieldsFollow(on === true);
    if (c.win && !c.win.isDestroyed()) c.win.webContents.send("fields:follow", on === true);
  });
  ipcMain.handle("fieldsWin:setPin", (_e, on: boolean) => {
    c.store.window("fields").setPinned(on);
    pinToolWindow(c.windows.get("fields"), c.win, on);
  });
  ipcMain.handle("fieldsWin:close", () => { c.windows.get("fields")?.close(); });
}
