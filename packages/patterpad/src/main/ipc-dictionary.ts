// Spelling dictionaries: the installed ones, the project's words, and the Review menu's spelling settings.
// Moved out of main/index.ts's registerIpc; what the handlers need from the rest of the main process comes in
// through `registerDictionaryIpc`.

import { ipcMain } from "electron";
import * as project from "./project.js";
import * as dictionaries from "./dictionaries.js";

/** What these handlers read and call from the rest of the main process. */
export interface DictionaryIpcContext {
  importDictionaryDialog(): Promise<{ ok: boolean; error?: string; canceled?: boolean; info?: dictionaries.DictionaryInfo }>;
  refreshMenu(): void;
}

export function registerDictionaryIpc(c: DictionaryIpcContext): void {
  ipcMain.handle("dict:list", () => dictionaries.listDictionaries());
  ipcMain.handle("dict:read", (_e, id: string) => dictionaries.readDictionary(id));
  ipcMain.handle("dict:import", () => c.importDictionaryDialog());
  ipcMain.handle("dict:remove", (_e, id: string) => dictionaries.removeDictionary(id));
  ipcMain.handle("dict:addWord", (_e, word: string) => project.addDictionaryWord(word));
  ipcMain.handle("dict:addIgnore", (_e, word: string) => project.addIgnoreWord(word));
  // Review ▸ Spelling toggle / dictionary pick: persist, then rebuild the menu so its check / tick updates.
  ipcMain.handle("dict:set", async (_e, patch: { enabled?: boolean; language?: string }) => { const r = await project.setDictionary(patch); c.refreshMenu(); return r; });
}
