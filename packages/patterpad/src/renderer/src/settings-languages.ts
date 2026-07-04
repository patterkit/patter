// The Language editor (Project Settings > Language tab): the project's locale list (spec §14). Add /
// remove languages and pick the default. The default is the source language - every string is authored
// in it, and the others are localisation targets. value() returns a clean { localeDefault, locales }.

import { el, iconBtn } from "./dom.js";

export interface LanguagesValue { localeDefault: string; locales: string[]; }
export interface LanguagesHandle { value(): LanguagesValue; }

/** A light BCP-47-ish check: a primary subtag of 2-3 letters, optional `-` script/region subtags. */
const LOCALE_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

export function mountLanguages(host: HTMLElement, initial: LanguagesValue): LanguagesHandle {
  const codes: string[] = [...(initial.locales ?? [])];
  let def = initial.localeDefault || codes[0] || "";

  const row = (code: string): HTMLElement => {
    const r = el("div", "gd-field");
    const top = el("div", "gd-field-top");
    const mark = el("label", "gd-marker");
    const radio = el("input") as HTMLInputElement; radio.type = "radio"; radio.name = "sp-loc-default";
    radio.checked = code === def;
    radio.addEventListener("change", () => { if (radio.checked) { def = code; } });
    mark.append(radio, el("span", undefined, "Default"));
    const name = el("span", "gd-name lang-code", code);
    const del = iconBtn("✕", "remove language", () => {
      const i = codes.indexOf(code); if (i < 0) return;
      codes.splice(i, 1);
      if (def === code) def = codes[0] ?? ""; // default went away -> first remaining becomes the source
      render();
    }, codes.length <= 1); // never remove the last language
    top.append(name, mark, del);
    r.append(top);
    return r;
  };

  const render = (): void => {
    host.replaceChildren();
    const list = el("div", "gd-fieldlist");
    codes.forEach((c) => list.append(row(c)));
    host.append(list);

    const add = el("div", "lang-add");
    const input = el("input", "gd-input") as HTMLInputElement;
    input.type = "text"; input.placeholder = "<add a language, e.g. fr or pt-BR>"; input.spellcheck = false;
    const commit = (): void => {
      const v = input.value.trim();
      input.value = "";
      if (!v) return;
      if (!LOCALE_RE.test(v)) { input.classList.add("invalid"); setTimeout(() => input.classList.remove("invalid"), 1200); return; }
      if (codes.some((c) => c.toLowerCase() === v.toLowerCase())) return; // already present
      codes.push(v); if (!def) def = v; render();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } });
    const btn = el("button", "gd-add", "+ Add language"); btn.type = "button"; btn.addEventListener("click", commit);
    add.append(input, btn);
    host.append(add);
  };
  render();

  return {
    value(): LanguagesValue {
      const locales = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
      const localeDefault = locales.includes(def) ? def : (locales[0] ?? "en");
      return { localeDefault, locales: locales.length ? locales : [localeDefault] };
    },
  };
}
