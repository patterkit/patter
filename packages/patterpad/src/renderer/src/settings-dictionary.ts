// The Dictionary tab (Project Settings, #177): turn spell-check on/off, pick the language (a built-in or
// an imported Hunspell pair, with Import… / Remove), and maintain the project's custom word list. The
// imported dictionaries themselves live per-machine (the Import/Remove callbacks route through the main
// process); only the chosen language id + the word list travel with the project.

import type { DictionaryInfo } from "../../shared/api.js";
import { el, iconBtn } from "./dom.js";
import { focusNewRow } from "./settings-list.js";

/** Display order: alphabetical (case-insensitive), blanks last so a freshly-added empty row sits at the
 *  bottom (where it's focused). Returns source indices, so edits / deletes map back to the array. */
function alphaOrder(arr: string[]): number[] {
  return arr.map((_, i) => i).sort((a, b) => {
    const x = arr[a]!.trim(), y = arr[b]!.trim();
    if (!x && !y) return 0; if (!x) return 1; if (!y) return -1;
    return x.localeCompare(y, undefined, { sensitivity: "base" });
  });
}

export interface DictionaryValue { dictionaryLanguage: string; dictionaryWords: string[]; dictionaryIgnore: string[]; dictionaryEnabled: boolean }
export interface DictionaryHandle { value(): DictionaryValue }

export interface DictionaryOpts {
  language: string;
  words: string[];
  /** Words the author chose to Ignore (right-click ▸ Ignore) - persisted, removable here. */
  ignore: string[];
  enabled: boolean;
  dictionaries: DictionaryInfo[];
  /** Open the native importer (main process); resolves with the new dictionary on success. */
  onImport: () => Promise<{ ok: boolean; error?: string; info?: DictionaryInfo }>;
  /** Remove an imported dictionary (main process). */
  onRemove: (id: string) => Promise<{ ok: boolean; error?: string }>;
}

export function mountDictionary(host: HTMLElement, opts: DictionaryOpts): DictionaryHandle {
  let dicts = [...opts.dictionaries];
  let language = opts.language;
  let enabled = opts.enabled;
  const words = [...opts.words];
  const ignore = [...opts.ignore];

  const selected = (): DictionaryInfo | undefined => dicts.find((d) => d.id === language);

  const render = (): void => {
    host.replaceChildren();

    // On/off.
    const toggle = el("label", "settings-toggle");
    const cb = el("input") as HTMLInputElement; cb.type = "checkbox"; cb.checked = enabled;
    cb.addEventListener("change", () => { enabled = cb.checked; });
    const span = el("span"); span.append(document.createTextNode("Spell-check"));
    const small = el("small", undefined, "Underline misspelled words and report them in the problems panel."); span.append(small);
    toggle.append(cb, span);
    host.append(toggle);

    // Language picker + Import / Remove.
    host.append(el("div", "gd-statuscap", "Dictionary"));
    host.append(el("p", "settings-note", "The language to check spelling against - your source language. Import your own Hunspell dictionary (.dic + .aff) to add another; imported dictionaries are kept on this computer."));
    const row = el("div", "dict-lang-row");
    const sel = el("select", "insp-select") as HTMLSelectElement;
    for (const d of dicts) {
      const o = el("option", undefined, d.builtin ? d.label : `${d.label} (imported)`) as HTMLOptionElement;
      o.value = d.id; if (d.id === language) o.selected = true; sel.append(o);
    }
    if (!selected()) { // a project picked a custom language this machine hasn't imported
      const o = el("option", undefined, `${language} - not installed`) as HTMLOptionElement; o.value = language; o.selected = true; sel.append(o);
    }
    sel.addEventListener("change", () => { language = sel.value; render(); });
    row.append(sel);

    const importBtn = el("button", "gd-add", "Import…"); importBtn.type = "button";
    importBtn.addEventListener("click", () => { void doImport(); });
    row.append(importBtn);

    const cur = selected();
    if (cur && !cur.builtin) {
      const removeBtn = el("button", "gd-add dict-remove", "Remove"); removeBtn.type = "button";
      removeBtn.addEventListener("click", () => { void doRemove(cur.id); });
      row.append(removeBtn);
    }
    host.append(row);
    const err = el("p", "settings-note dict-error"); err.hidden = true; host.append(err);

    // A compact, alphabetical, scrollable word list: one thin `.wordrow` (word + ✕) per entry. Sorting is
    // by source index (so edit / delete map back); it re-sorts on add / delete, not mid-typing.
    const wordList = (arr: string[], removeTip: string): HTMLElement => {
      const list = el("div", "gd-fieldlist wordlist");
      for (const idx of alphaOrder(arr)) {
        const wordrow = el("div", "wordrow");
        const input = el("input", "gd-input gd-name") as HTMLInputElement;
        input.type = "text"; input.value = arr[idx]!; input.spellcheck = false; input.placeholder = "<word>";
        input.addEventListener("input", () => { arr[idx] = input.value; });
        wordrow.append(input, iconBtn("✕", removeTip, () => { arr.splice(idx, 1); render(); }, false, true));
        list.append(wordrow);
      }
      return list;
    };

    // Project word list.
    host.append(el("div", "gd-statuscap", "Project dictionary"));
    host.append(el("p", "settings-note", "Words to always accept in this project - character names, places, invented terms. Shared with everyone who opens the project."));
    const list = wordList(words, "remove word");
    host.append(list);
    const add = el("button", "gd-add", "+ Add word"); add.type = "button";
    add.addEventListener("click", () => { words.push(""); render(); focusNewRow(host.querySelector(".wordlist")); });
    host.append(add);

    // Ignored words: tokens silenced via right-click ▸ Ignore. Distinct from the word list above (not
    // vocabulary, just "stop flagging this"); shown here so a persisted ignore can be reviewed / removed.
    if (ignore.length) {
      host.append(el("div", "gd-statuscap", "Ignored words"));
      host.append(el("p", "settings-note", "Words you chose to Ignore on a spelling flag. They stay ignored across sessions; remove one to start flagging it again."));
      host.append(wordList(ignore, "stop ignoring"));
    }

    async function doImport(): Promise<void> {
      const r = await opts.onImport();
      if (r.ok && r.info) {
        if (!dicts.some((d) => d.id === r.info!.id)) dicts.push(r.info);
        dicts.sort((a, b) => Number(b.builtin) - Number(a.builtin) || a.label.localeCompare(b.label));
        language = r.info.id;
        render();
      } else if (r.error && r.error !== "canceled") {
        err.textContent = r.error; err.hidden = false;
      }
    }
    async function doRemove(id: string): Promise<void> {
      const r = await opts.onRemove(id);
      if (r.ok) {
        dicts = dicts.filter((d) => d.id !== id);
        if (language === id) language = dicts[0]?.id ?? "en-US";
        render();
      } else if (r.error) { err.textContent = r.error; err.hidden = false; }
    }
  };
  render();

  return { value: () => ({ dictionaryLanguage: language, dictionaryWords: words.map((w) => w.trim()).filter(Boolean), dictionaryIgnore: ignore.map((w) => w.trim()).filter(Boolean), dictionaryEnabled: enabled }) };
}
