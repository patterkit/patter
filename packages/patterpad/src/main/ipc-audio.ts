// Audio messages: the Audio Folders index and playback, Placeholder Speech, and in-app scratch recording.
// Moved out of main/index.ts's registerIpc; what the handlers need from the rest of the main process comes in
// through `registerAudioIpc`.

import { ipcMain, systemPreferences, Menu, type BrowserWindow } from "electron";
import * as project from "./project.js";
import * as speech from "./placeholder-speech.js";

/** What these handlers read and call from the rest of the main process. */
export interface AudioIpcContext {
  readonly win: BrowserWindow | null;
  refreshMenu(): void;
}

export function registerAudioIpc(c: AudioIpcContext): void {
  // Audio Folders index (#206): the renderer pulls the current snapshot on load, then receives pushes as
  // the folders change on disk. The indexer lives in the main process (off the event loop).
  ipcMain.handle("audio:current", () => project.audioCurrentSnapshot());
  // Playback (#206 P3): the resolved audio bytes for a beat, for both the inspector play button and the
  // play window's "Play with audio" (the renderer wraps them in a Blob).
  ipcMain.handle("audio:read", (_e, beatId: string) => project.audioBytesForBeat(beatId));
  // Scratch recording (#224): write an in-app take's WAV bytes into the scratch folder (the watcher then
  // picks it up). recording:setMode strips the native menu while recording so accelerators can't fire
  // behind the blocking overlay (restored when it ends).
  // Placeholder Speech: the settings page's key picker and status, the Cast editor's Hear, the menu's Make
  // Now and the inspector's Make again, a voice change's lines, and the writer moving off a line.
  ipcMain.handle("speech:chooseKey", () => (c.win ? speech.chooseKeyFile(c.win) : null));
  ipcMain.handle("speech:keyStatus", (_e, keyFile: string) => speech.keyStatus(String(keyFile ?? "")));
  ipcMain.handle("speech:hear", (_e, voice: string, text: string) => speech.hear(String(voice), String(text)));
  ipcMain.handle("speech:make", (_e, req: speech.SpeechRequestScope & { force?: boolean }) => speech.makeNow(req ?? {}));
  ipcMain.handle("speech:count", (_e, req: speech.SpeechRequestScope) => speech.countToMake(req ?? {}));
  ipcMain.handle("speech:accent", () => speech.accentInUse() ?? null);
  ipcMain.handle("speech:tier", () => speech.tierInUse());
  ipcMain.on("speech:nudge", () => speech.nudge());
  ipcMain.handle("speech:deletedTakes", () => speech.takesForDeletedLines());
  ipcMain.handle("speech:removeDeletedTakes", () => speech.removeTakesForDeletedLines());
  ipcMain.handle("audio:saveScratch", (_e, beatId: string, bytes: Uint8Array) => project.saveScratchAudio(beatId, bytes));
  // macOS gates the mic behind TCC: check (and if undecided, ask) BEFORE the renderer opens the stream,
  // so a denied state surfaces as a clear message instead of a silently-silent recording. Not-darwin
  // platforms have no such gate. Needs the audio-input hardened-runtime entitlement in packaged builds.
  ipcMain.handle("audio:micAccess", async () => {
    if (process.platform !== "darwin") return true;
    const status = systemPreferences.getMediaAccessStatus("microphone");
    if (status === "granted") return true;
    if (status === "not-determined") return systemPreferences.askForMediaAccess("microphone");
    return false; // denied or restricted - only the user can flip it, in System Settings
  });
  ipcMain.handle("recording:setMode", (_e, on: boolean) => { if (on) Menu.setApplicationMenu(null); else c.refreshMenu(); });
  project.onAudioSnapshot((snap) => { if (c.win && !c.win.isDestroyed()) c.win.webContents.send("audio:index", snap); });
}
