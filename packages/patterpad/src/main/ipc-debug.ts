// The Live Link's messages: start, stop and follow the debug server, and ask a connected game to play a block.
// Moved out of main/index.ts's registerIpc; what the handlers need from the rest of the main process comes in
// through `registerDebugIpc`.

import { ipcMain } from "electron";
import type { DebugServer } from "./debug-link.js";

/** What these handlers read and call from the rest of the main process. */
export interface DebugIpcContext {
  readonly debugServer: DebugServer | null;
  ensureDebugServer(): DebugServer;
  refreshMenu(): void;
}

export function registerDebugIpc(c: DebugIpcContext): void {
  // Live debug link (#181): a localhost WS server an external game streams its cursor into. Frames for the
  // followed flow reuse the SAME play:mark path the in-app Play window uses, so the editor follows the live
  // playhead; the editor also pushes bundles to it and asks it to play a block (debug-link.ts).
  ipcMain.handle("debug:start", () => { c.ensureDebugServer().start(); c.refreshMenu(); return c.ensureDebugServer().status(); });
  ipcMain.handle("debug:stop", () => { c.ensureDebugServer().stop(); c.refreshMenu(); return c.ensureDebugServer().status(); });
  ipcMain.handle("debug:status", () => c.ensureDebugServer().status());
  ipcMain.handle("debug:follow", (_e, flowId: string | null) => { c.ensureDebugServer().follow(typeof flowId === "string" ? flowId : null); });
  ipcMain.handle("debug:play-in-game", (_e, sceneId: unknown, blockId: unknown, takeOver: unknown) => {
    if (typeof sceneId !== "string" || typeof blockId !== "string") return { started: false, reason: "invalid" };
    if (!c.debugServer) return { started: false, reason: "noGame" };
    return c.debugServer.playInGame({ sceneId, blockId, takeOver: takeOver === true });
  });
}
