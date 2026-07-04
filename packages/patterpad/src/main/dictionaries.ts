// Spell-check dictionaries (#177). The built-in en-US / en-GB Hunspell pairs (.aff + .dic) ship as app
// resources under a permissive SCOWL license; authors can IMPORT their own Hunspell pair, stored
// per-machine in userData (NOT in the project - so a ~1 MB dictionary never bloats the repo). The main
// process serves the raw aff/dic text to the renderer, which builds the live nspell engine.

import { app } from "electron";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import nspell from "nspell";

/** A dictionary the author can spell-check against: a built-in language or an imported Hunspell pair. */
export interface DictionaryInfo { id: string; label: string; builtin: boolean }
/** The raw Hunspell bytes (UTF-8 text) for an engine to load. */
export interface DictionaryData { aff: string; dic: string }

// Built-ins ship in app resources (electron-builder `extraResources`); imports live under userData.
const builtinDir = (): string =>
  app.isPackaged ? join(process.resourcesPath, "dictionaries") : join(app.getAppPath(), "resources", "dictionaries");
const userDir = (): string => join(app.getPath("userData"), "dictionaries");

const BUILTINS: readonly DictionaryInfo[] = [
  { id: "en-US", label: "English (US)", builtin: true },
  { id: "en-GB", label: "English (UK)", builtin: true },
];
const isBuiltin = (id: string): boolean => BUILTINS.some((b) => b.id === id);

/** The display label an imported dictionary was saved with (falls back to its id). */
function importedLabel(id: string): string {
  try { const t = readFileSync(join(userDir(), id, "label"), "utf8").trim(); return t || id; } catch { return id; }
}

/** Every available dictionary: the built-ins first, then imported pairs (alphabetical). */
export function listDictionaries(): DictionaryInfo[] {
  const imported: DictionaryInfo[] = [];
  try {
    const dir = userDir();
    if (existsSync(dir)) {
      for (const id of readdirSync(dir)) {
        if (existsSync(join(dir, id, "index.aff")) && existsSync(join(dir, id, "index.dic"))) {
          imported.push({ id, label: importedLabel(id), builtin: false });
        }
      }
    }
  } catch { /* no userData dictionaries yet */ }
  imported.sort((a, b) => a.label.localeCompare(b.label));
  return [...BUILTINS, ...imported];
}

/** The aff/dic text for a dictionary id (built-in or imported), or null if it isn't installed - e.g. a
 *  project picked a custom language this machine hasn't imported (the renderer shows a quiet notice). */
export function readDictionary(id: string): DictionaryData | null {
  const dir = isBuiltin(id) ? join(builtinDir(), id) : join(userDir(), id);
  const affPath = join(dir, "index.aff"), dicPath = join(dir, "index.dic");
  if (!existsSync(affPath) || !existsSync(dicPath)) return null;
  return { aff: readFileSync(affPath, "utf8"), dic: readFileSync(dicPath, "utf8") };
}

/** Import a Hunspell pair (already-read paths) to userData under `id`, after validating it loads in
 *  nspell. Built-in ids and bad pairs are rejected. */
export function importDictionary(affPath: string, dicPath: string, id: string, label: string): { ok: true; info: DictionaryInfo } | { ok: false; error: string } {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) return { ok: false, error: "Dictionary id must be letters / digits / - / _ and start with a letter." };
  if (isBuiltin(id)) return { ok: false, error: `'${id}' is a built-in dictionary.` };
  let aff: string, dic: string;
  try { aff = readFileSync(affPath, "utf8"); dic = readFileSync(dicPath, "utf8"); } catch { return { ok: false, error: "Could not read the chosen .aff / .dic files." }; }
  try { if (typeof nspell(aff, dic).correct !== "function") throw new Error("invalid"); } catch { return { ok: false, error: "That isn't a valid Hunspell .aff / .dic pair." }; }
  try {
    const dir = join(userDir(), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.aff"), aff, "utf8");
    writeFileSync(join(dir, "index.dic"), dic, "utf8");
    writeFileSync(join(dir, "label"), label.trim() || id, "utf8");
    return { ok: true, info: { id, label: label.trim() || id, builtin: false } };
  } catch { return { ok: false, error: "Could not save the dictionary." }; }
}

/** Remove an imported dictionary (built-ins can't be removed). */
export function removeDictionary(id: string): { ok: boolean; error?: string } {
  if (isBuiltin(id)) return { ok: false, error: "Built-in dictionaries can't be removed." };
  try { rmSync(join(userDir(), id), { recursive: true, force: true }); return { ok: true }; } catch { return { ok: false, error: "Could not remove the dictionary." }; }
}
