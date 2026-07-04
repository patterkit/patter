// The Estimating editor (Project Settings > Estimating tab, spec §13). Replaces a still-guesswork scene's
// actual (placeholder) line count with an estimate in the production report: a default number, overridable
// by scene tags, applied to any scene whose every beat sits at or below a threshold writing status. Off by
// default. `value()` returns the config for the save round-trip. See design/proposals/estimating.md.

import type { EstimatingConfig, WritingStatusDecl } from "@patterkit/model";
import { el, iconBtn, labelled } from "./dom.js";
import { focusNewRow } from "./settings-list.js";

export interface EstimatingHandle { value(): EstimatingConfig; }

export function mountEstimating(host: HTMLElement, initial: EstimatingConfig, ladder: WritingStatusDecl[]): EstimatingHandle {
  const state: EstimatingConfig = {
    enabled: initial.enabled ?? false,
    defaultLines: initial.defaultLines ?? 20,
    ...(initial.thresholdStatus ? { thresholdStatus: initial.thresholdStatus } : {}),
    tagEstimates: initial.tagEstimates ? structuredClone(initial.tagEstimates) : [],
  };
  const rungs = ladder.map((s) => s.name);

  // The enable toggle: everything below is greyed (but still editable) until it's on.
  const enable = el("input") as HTMLInputElement; enable.type = "checkbox"; enable.checked = state.enabled;
  const toggle = el("label", "settings-toggle");
  const label = el("span"); label.append(document.createTextNode("Enable estimating"));
  const desc = el("small", undefined, "Replace a still-guesswork scene's line count with an estimate in the production report."); label.append(desc);
  toggle.append(enable, label);

  const config = el("div", "est-config");
  enable.addEventListener("change", () => { state.enabled = enable.checked; config.classList.toggle("est-off", !state.enabled); });

  // Threshold: a scene is estimated only when its every beat is at or below this rung.
  const threshold = el("select", "insp-select") as HTMLSelectElement;
  for (const r of rungs) threshold.append(new Option(r, r));
  threshold.value = state.thresholdStatus && rungs.includes(state.thresholdStatus) ? state.thresholdStatus : (rungs[0] ?? "");
  threshold.addEventListener("change", () => { state.thresholdStatus = threshold.value; });
  config.append(labelled("Estimate scenes up to status", threshold));
  config.append(el("small", "settings-fieldnote", "A scene is estimated only when every one of its beats sits at or below this status (an unset beat counts as the lowest)."));

  // Default estimate (lines).
  const def = el("input", "gd-input est-num") as HTMLInputElement; def.type = "number"; def.min = "0"; def.value = String(state.defaultLines);
  def.addEventListener("input", () => { state.defaultLines = Math.max(0, Math.round(Number(def.value) || 0)); });
  config.append(labelled("Default estimate (lines)", def));

  // Tag estimates: a scene carrying a mapped tag uses that number instead of the default (largest wins).
  config.append(el("p", "settings-note", "Tag estimates override the default for scenes carrying that tag (e.g. cutscene, conversation). If a scene has several mapped tags, the largest wins."));
  const tagList = el("div", "gd-fieldlist est-tags");
  const renderTags = (): void => {
    tagList.replaceChildren();
    const tags = state.tagEstimates ?? (state.tagEstimates = []);
    if (!tags.length) tagList.append(el("p", "gd-empty", "No tag estimates."));
    else tags.forEach((t, i) => {
      const row = el("div", "est-tag-row");
      const tag = el("input", "gd-input est-tag") as HTMLInputElement;
      tag.type = "text"; tag.placeholder = "<tag>"; tag.spellcheck = false; tag.value = t.tag;
      tag.addEventListener("input", () => { t.tag = tag.value; });
      const lines = el("input", "gd-input est-num") as HTMLInputElement;
      lines.type = "number"; lines.min = "0"; lines.value = String(t.lines);
      lines.addEventListener("input", () => { t.lines = Math.max(0, Math.round(Number(lines.value) || 0)); });
      const acts = el("div", "gd-acts");
      acts.append(iconBtn("✕", "remove tag estimate", () => { tags.splice(i, 1); renderTags(); }, false, true));
      row.append(tag, lines, acts);
      tagList.append(row);
    });
  };
  renderTags();
  const add = el("button", "gd-add", "+ Add tag estimate"); add.type = "button";
  add.addEventListener("click", () => { (state.tagEstimates ??= []).push({ tag: "", lines: state.defaultLines }); renderTags(); focusNewRow(tagList); });
  config.append(el("div", "est-tags-label", "Tag estimates"), tagList, add);

  config.classList.toggle("est-off", !state.enabled);
  host.replaceChildren(toggle, config);

  return {
    value(): EstimatingConfig {
      const tags = (state.tagEstimates ?? []).filter((t) => t.tag.trim()).map((t) => ({ tag: t.tag.trim(), lines: t.lines }));
      return {
        enabled: state.enabled,
        defaultLines: state.defaultLines,
        ...(state.thresholdStatus ? { thresholdStatus: state.thresholdStatus } : {}),
        ...(tags.length ? { tagEstimates: tags } : {}),
      };
    },
  };
}
