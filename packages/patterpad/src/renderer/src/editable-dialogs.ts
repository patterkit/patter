// The editable script dialogs (patterkit/design/proposals/editable-script-handoff.md §9): Review ▸ Export
// Editable Script… and Review ▸ Reimport Editable Script…. Built on the shell's dialog frame in code, so
// there is no static markup for the preview harness to mirror.
//
// Export opens on its one big choice, This scene or Whole project, each with its line count, and remembers
// the last pick. Reimport plans first (nothing is written), shows what the file holds, re-plans when an
// option changes, and only writes when the person chooses how.

import { dialogFrame, metaLine, toast, labelledToggle } from "@wildwinter/app-shell";
import { plural } from "@wildwinter/app-shell/util";
import { landed } from "./results.js";
import type { EditableExportRequest, EditableImportRequest, EditableImportSummary } from "../../shared/api.js";
import { el } from "./dom.js";

export interface EditableDialogContext {
  /** The open scene, if any ("This scene" is unavailable without one). */
  sceneId: string | null;
  sceneName?: string;
  /** Run work under the publish progress strip. */
  withJob<T>(label: string, work: () => Promise<T>): Promise<T>;
  /** Save the open scene first, so what's exported or compared is current. */
  save(): Promise<void>;
  /** Show a line of the script: the problems list's "Go to". */
  goTo(sceneId: string, anchor: string): Promise<void>;
  /** A path, shown relative to the project. */
  rel(path: string | undefined): string | undefined;
}

const RANGE_KEY = "patterpad.editable.range";
const remembered = (): "scene" | "project" => {
  try { return localStorage.getItem(RANGE_KEY) === "scene" ? "scene" : "project"; } catch { return "project"; }
};
const remember = (r: "scene" | "project"): void => { try { localStorage.setItem(RANGE_KEY, r); } catch { /* private window */ } };


/** A checkbox row in the settings style: the family's `labelledToggle` (ruling C), a label and a small
 *  explanation underneath. */
function toggleRow(label: string, hint: string, checked = false): { row: HTMLElement; input: HTMLInputElement } {
  return labelledToggle(label, { checked, hint });
}

/** Review ▸ Export Editable Script…: choose the range and options, then save the .docx in main. */
export async function openEditableExport(ctx: EditableDialogContext): Promise<void> {
  await ctx.save();
  const counts = await window.patter.editableLineCounts(ctx.sceneId);
  let range: "scene" | "project" = ctx.sceneId ? remembered() : "project";

  const frame = dialogFrame({
    title: "Export editable script",
    sub: "A copy of the script an editor can change in Word, Google Docs, or OnlyOffice, and send back.",
    className: "editable-dialog",
  });

  // The range: first, and the biggest thing in the dialog.
  const seg = el("div", "seg editable-range");
  seg.setAttribute("role", "tablist");
  const option = (value: "scene" | "project", label: string, lines: number, enabled: boolean): HTMLButtonElement => {
    const b = el("button", "seg-opt");
    b.type = "button"; b.setAttribute("role", "tab"); b.disabled = !enabled;
    b.append(el("span", "editable-range-label", label), el("span", "editable-range-count", plural(lines, "line")));
    b.addEventListener("click", () => { range = value; paint(); });
    return b;
  };
  const sceneBtn = option("scene", ctx.sceneName ? `This scene: ${ctx.sceneName}` : "This scene", counts.scene, !!ctx.sceneId);
  const projectBtn = option("project", "Whole project", counts.project, true);
  if (!ctx.sceneId) sceneBtn.dataset.tip = "Open a scene to export just that one";
  seg.append(sceneBtn, projectBtn);
  const paint = (): void => {
    sceneBtn.classList.toggle("on", range === "scene"); sceneBtn.setAttribute("aria-selected", String(range === "scene"));
    projectBtn.classList.toggle("on", range === "project"); projectBtn.setAttribute("aria-selected", String(range === "project"));
  };
  paint();

  const recipientLabel = el("label", "editable-field");
  const recipient = el("input", "field"); recipient.type = "text"; recipient.placeholder = "Optional: shown on the front page";
  recipientLabel.append(el("span", "editable-field-label", "Who it's for"), recipient);

  const allNotes = toggleRow("Include all notes", "Every classed note, not only the ones for editors.");
  const status = toggleRow("Show writing status", "Each line's status beside its box.");
  const cast = toggleRow("Add a cast page", "The speaking characters, with their notes, before the script.");

  frame.body.append(seg, recipientLabel, allNotes.row, status.row, cast.row);

  const cancel = el("button", "btn", "Cancel"); cancel.type = "button";
  const go = el("button", "btn primary", "Export…"); go.type = "button";
  cancel.addEventListener("click", () => frame.close());
  go.addEventListener("click", async () => {
    remember(range);
    const req: EditableExportRequest = {
      range, ...(range === "scene" && ctx.sceneId ? { sceneId: ctx.sceneId } : {}),
      ...(recipient.value.trim() ? { recipient: recipient.value.trim() } : {}),
      notes: allNotes.input.checked ? "all" : "editor", status: status.input.checked, cast: cast.input.checked,
    };
    frame.close();
    const res = await ctx.withJob("Exporting the editable script…", () => window.patter.exportEditable(req));
    if (res.ok) toast(`Editable script exported\n${ctx.rel(res.path) ?? ""}\nHandoff ${res.handoffId ?? ""}`, "ok");
    else if (!res.canceled) landed({ ok: false, ...(res.error ? { error: res.error } : {}) }, "Couldn't export the editable script");
  });
  frame.actions.append(cancel, go);
  frame.open();
  (range === "scene" ? sceneBtn : projectBtn).focus();
}

/** Review ▸ Reimport Editable Script…: pick the file, show what it holds, and import it as chosen. */
export async function openEditableReimport(ctx: EditableDialogContext): Promise<void> {
  const path = await window.patter.pickEditableReturn();
  if (!path) return;
  await ctx.save();

  const name = path.split(/[\\/]/).pop() ?? path;
  const frame = dialogFrame({ title: "Reimport editable script", sub: name, className: "editable-dialog" });
  const summary = el("div", "editable-summary");
  const asLabel = el("label", "editable-field");
  const as = el("input", "field"); as.type = "text";
  asLabel.append(el("span", "editable-field-label", "Edits by"), as);
  asLabel.append(el("small", "editable-field-hint", "Changes made without Track Changes are credited to this name."));
  const quotes = toggleRow("Treat quote style changes as edits", "Off: curly and straight quotes count as the same, as do the two kinds of ellipsis.");
  const error = el("p", "editable-error");
  error.hidden = true;
  frame.body.append(summary, asLabel, quotes.row, error);

  const close = el("button", "btn", "Cancel"); close.type = "button";
  const direct = el("button", "btn", "Import, applying clean changes"); direct.type = "button";
  const asSuggestions = el("button", "btn primary", "Import as suggestions"); asSuggestions.type = "button";
  close.addEventListener("click", () => frame.close());
  frame.actions.append(close, direct, asSuggestions);

  let current: EditableImportSummary | undefined;
  let applying = false; // a re-plan landing during the apply must not repaint and re-enable the buttons
  const request = (isDirect: boolean): EditableImportRequest => ({ ...(as.value.trim() ? { as: as.value.trim() } : {}), strictQuotes: quotes.input.checked, direct: isDirect });
  const plan = async (isDirect = false): Promise<EditableImportSummary> => {
    const s = await window.patter.planEditableImport(path, request(isDirect));
    if (!as.value && s.recipient) as.placeholder = s.recipient;
    return s;
  };
  const paint = (s: EditableImportSummary): void => {
    if (applying) return;
    current = s;
    summary.replaceChildren(...renderSummary(s, ctx, () => frame.close()));
    const canImport = !s.refused && !!s.planId;
    direct.hidden = asSuggestions.hidden = !!s.refused;
    direct.disabled = asSuggestions.disabled = !canImport;
    asLabel.hidden = quotes.row.hidden = !!s.refused;
    close.textContent = s.refused ? "Close" : "Cancel";
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const replan = (): void => { clearTimeout(timer); timer = setTimeout(async () => { timer = undefined; paint(await plan()); }, 250); };
  as.addEventListener("input", replan);
  quotes.input.addEventListener("change", replan);

  const apply = async (isDirect: boolean): Promise<void> => {
    error.hidden = true;
    direct.disabled = asSuggestions.disabled = true;
    applying = true;
    // A re-plan still waiting (a name typed into "Edits by" a moment ago) would be lost: plan afresh then,
    // rather than apply the plan from before the edit.
    const pending = timer !== undefined;
    clearTimeout(timer); timer = undefined;
    const s = isDirect || pending || !current ? await plan(isDirect) : current;
    if (!s.planId) { applying = false; paint(s); return; }
    const res = await window.patter.applyEditableImport(s.planId);
    if (res.ok) {
      frame.close();
      toast(`Imported ${plural(s.counts.changed, "suggestion")} and ${plural(s.counts.comments, "comment")}${isDirect ? ", clean changes applied" : ""}`, "ok");
    } else {
      error.textContent = res.error ?? "The import couldn't be written.";
      error.hidden = false;
      applying = false;
      direct.disabled = asSuggestions.disabled = false;
    }
  };
  asSuggestions.addEventListener("click", () => void apply(false));
  direct.addEventListener("click", () => void apply(true));

  summary.append(el("p", "editable-summary-line", "Reading the file…"));
  frame.open();
  paint(await plan());
  asSuggestions.focus();
}

/** What the file holds: where it came from, the counts, and every problem (warnings first). */
function renderSummary(s: EditableImportSummary, ctx: EditableDialogContext, closeDialog: () => void): Node[] {
  const out: Node[] = [];
  if (s.refused) {
    out.push(el("p", "editable-refused", s.refused));
    return out;
  }
  // The reader's own date order, as the suggestion popover shows it.
  const sent = s.sentAt ? new Date(s.sentAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";
  out.push(el("p", "editable-summary-line", `Handoff ${s.handoffId ?? ""}${s.recipient ? `, sent to ${s.recipient}` : ""}${sent ? ` on ${sent}` : ""}${s.sentBy ? ` by ${s.sentBy}` : ""}.`));
  const c = s.counts;
  const bits = [
    plural(c.changed, "changed line"), `${c.unchanged} unchanged`,
    ...(c.stale ? [`${c.stale} out of date`] : []), plural(c.comments, "comment"),
  ];
  const counts = metaLine(bits); // the drawn separator, not a typed one
  counts.classList.add("editable-counts");
  out.push(counts);
  if (c.changed === 0 && c.comments === 0) out.push(el("p", "editable-summary-line", "Nothing in this file differs from what was sent."));

  const problems = [...s.problems].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
  if (problems.length) {
    const list = el("ul", "editable-problems");
    for (const p of problems) {
      const li = el("li", `editable-problem ${p.severity}`);
      li.append(el("span", "editable-problem-text", p.message));
      if (p.sceneId && p.anchor) {
        const go = el("button", "btn ghost editable-goto", "Go to"); go.type = "button";
        const sceneId = p.sceneId, anchor = p.anchor;
        go.addEventListener("click", () => { closeDialog(); void ctx.goTo(sceneId, anchor); });
        li.append(go);
      }
      list.append(li);
    }
    out.push(list);
  }
  return out;
}
