// ---------------------------------------------------------------------------
// Patter extensions in the inspector and Project Settings (patterkit design/proposals/
// patter-storylet-extensions.md, "Tier 1: fields", "Where fields go" and "Claims on
// host fields"): an extension's own fields for a node, drawn by the shell's value rows
// (every type a manifest declares, records, maps and lists included), in a section
// captioned with the extension's name after the node's Game Data; a claimed gameData
// field drawn with the extension's label, help and values; and the project's own
// values in a section of Project Settings.
//
// A value commits as typed: one transaction on the node's `ext` in the scene's
// document (the surface's setExtensionValue), so the scene's history undoes it and a
// save writes the shard. The checks are the toolkit's, as validation's are, so a row
// and the problems bar never disagree.
// ---------------------------------------------------------------------------

import { el } from "./dom.js";
import { extensionFold, isRecordMap, recordMapSummary, valueRows } from "@wildwinter/app-shell/value-rows";
import type { ValueAdapter, ValueDecl, ValueRows } from "@wildwinter/app-shell/value-rows";
import { effectiveClaim, entryProblems, pickLists, valueProblems } from "@wildwinter/toolkit/extensions";
import type { ClaimDecl, TargetDecl, TypeDecl } from "@wildwinter/toolkit/extensions";
import type { ExtensionDto, ExtensionFieldDto, ExtensionNodeDto, Problem } from "../../shared/api.js";
import { takenLine } from "../../shared/extensions.js";

/** What the inspector asks of its host for Patter extensions. */
export interface ExtensionHandlers {
  /** The extensions the project takes and has a sound manifest for. */
  extensions: () => readonly ExtensionDto[];
  /** Set (or clear, with `undefined`) one field of a node's entry in an extension, by the node's id. */
  setExtensionValue: (id: string, extension: string, field: string, value: unknown) => void;
  /** The sentence for an extension whose data here somebody else holds ("Locked by bob."), or null. */
  extensionLock: (extension: string) => string | null;
  /** The nodes a reference or a map key may name, and the name of one held outside the choices. */
  extensionAdapter: () => ValueAdapter;
  /** Open (or bring forward) the fields window on a node, where a map of records is edited as a grid
   *  (Pattershot's brief, H1). Absent: such a map is drawn in place, as any other field. */
  openFields?: (kind: string, id: string) => void;
}

/** The rows, kept across the inspector's redraws (it rebuilds its whole stack), so a value typed into a row
 *  keeps its focus and caret. Swept at the end of each redraw, beside the game-data rows. */
const rowCache = valueRows();
export function sweepExtensionRows(): void { rowCache.sweep(); inspectorFold.sweep(); }

/** A toolkit message as a sentence. */
const sentence = (message: string): string => `${message.charAt(0).toUpperCase()}${message.slice(1)}.`;

/** "a, b, or c", with the Oxford comma. */
const orList = (xs: readonly string[]): string =>
  xs.length <= 2 ? xs.join(" or ") : `${xs.slice(0, -1).join(", ")}, or ${xs[xs.length - 1]}`;

/** The adapter's answer to "does this node exist?", as the toolkit's checks take it. */
const existsOf = (adapter: ValueAdapter) => (kind: string, id: string): boolean =>
  adapter.nodes(kind).some((n) => n.id === id) || adapter.label?.(kind, id) !== undefined;

/** The adapter for one extension's rows: the project's nodes, and that extension's project lists for a pick's
 *  `list` sources, read off its project entry (the toolkit's `pickLists`). */
export function extensionScoped(adapter: ValueAdapter, extension: ExtensionDto, projectEntry = extension.projectValues): ValueAdapter {
  const project = { fields: extension.targets["project"]?.fields ?? [] } as unknown as TargetDecl;
  return { ...adapter, list: pickLists(project, projectEntry) };
}

/**
 * The problems a row says that the shell's rows don't say themselves, by field: a required field not set, and
 * every warning (a stage since renamed, a field the extension no longer declares). Only for a node that has an
 * entry: validation checks only entries, and a node that sets nothing is fine.
 */
export function fieldProblems(fields: readonly ExtensionFieldDto[], entry: Record<string, unknown> | undefined, adapter?: ValueAdapter): Map<string, string> {
  const out = new Map<string, string>();
  if (entry === undefined) return out;
  const target = { fields } as unknown as TargetDecl;
  const found = entryProblems(target, entry, adapter
    ? { exists: existsOf(adapter), ...(adapter.list ? { list: (name: string) => adapter.list!(name) } : {}) } : {});
  for (const p of found) {
    if (p.code !== "required" && p.severity !== "warning") continue;
    if (p.path.includes(".") || p.path.includes("[")) continue; // a part's own row says it
    out.set(p.path, [out.get(p.path), sentence(p.message)].filter(Boolean).join(" "));
  }
  return out;
}

/** What a value would get wrong in a field, as sentences ("" when it's fine): the toolkit's checks with the
 *  project's nodes and lists, as a row checks what's typed into it. A view extension's write is held to it. */
export function valueProblem(decl: ExtensionFieldDto, value: unknown, adapter: ValueAdapter): string {
  return valueProblems(decl as unknown as TypeDecl, value, {
    exists: existsOf(adapter), ...(adapter.list ? { list: (name: string) => adapter.list!(name) } : {}),
  }).filter((p) => p.severity === "error").map((p) => sentence(`${p.message} (${decl.name}${p.path === "" ? "" : p.path.startsWith("[") ? p.path : `.${p.path}`})`)).join(" ");
}

/** A quality value naming a stage the manifest has since renamed: the old name and the stage it is now. */
export function renamedStage(decl: ExtensionFieldDto, value: unknown): { from: string; to: string } | undefined {
  if (decl.type !== "quality" || typeof value !== "string" || decl.stages?.includes(value)) return undefined;
  const to = decl.renamedStages?.[value];
  return to !== undefined && decl.stages?.includes(to) ? { from: value, to } : undefined;
}

/** The one sentence a renamed stage's row says. */
export const renamedStageSentence = (from: string, to: string, extension: string): string =>
  `“${from}” has been renamed “${to}” by ${extension}. Pick “${to}” to update it.`;

/** The extension claiming a gameData field of this node kind, when one does: its decl for it. */
export function claimOn(extensions: readonly ExtensionDto[], kind: string, field: string): { extension: ExtensionDto; decl: ExtensionFieldDto } | undefined {
  for (const extension of extensions) {
    const claim = extension.targets[kind]?.claims.find((c) => c.field === field);
    if (claim) return { extension, decl: claim.decl };
  }
  return undefined;
}

/** The host's side of a claim: the gameData field's own declaration, which gives the values, stages and default
 *  a claim leaves out. */
export interface ClaimHost { readonly type?: string; readonly values?: readonly string[]; readonly stages?: readonly string[]; readonly default?: unknown }

/** A claim as the inspector draws and checks its field: the claim over the gameData field's declaration
 *  (the toolkit's `effectiveClaim`), so a claim that lists no values takes the field's. */
export function effectiveClaimDecl(claim: { decl: ExtensionFieldDto }, host: ClaimHost): ExtensionFieldDto {
  return effectiveClaim(claim.decl as unknown as ClaimDecl, host) as unknown as ExtensionFieldDto;
}

/** What a claim says about a gameData value it refuses, as a sentence; "" when fine. Checked over the gameData
 *  field's declaration (`host`), so a claim with no values of its own checks against the field's. */
export function claimProblem(claim: { extension: ExtensionDto; decl: ExtensionFieldDto }, value: unknown, host: ClaimHost = {}): string {
  if (value === undefined) return "";
  return valueProblems(effectiveClaimDecl(claim, host) as unknown as TypeDecl, value)
    .filter((p) => p.severity === "error")
    .map((p) => (p.code === "not-a-value" || p.code === "not-a-stage") && p.options?.length && typeof value === "string"
      ? `${claim.extension.name} reads this as ${orList(p.options)}, so it doesn't know “${value}”.`
      : `As ${claim.extension.name} reads it, ${p.message}.`)
    .join(" ");
}

interface RowsFor {
  extension: ExtensionDto;
  kind: string;
  /** The node's id, or null when there is none to write to (the rows are drawn but disabled). */
  id: string | null;
  entry: Record<string, unknown> | undefined;
  adapter: ValueAdapter;
  locked: string | null;
  commit: (field: string, value: unknown) => void;
  /** Read-only: drawn, nothing editable. */
  readOnly?: boolean;
  /** The row cache: the inspector's, or a Settings section's own, so neither's sweep disposes the other's. */
  cache: ValueRows;
  /** The fields window's opener: a map of records is then a summary with an Edit button (H3). */
  openFields?: () => void;
}

/** One extension's parts for one node: the lock line, a row per field, a heading per group, and any key the
 *  node holds that the extension doesn't declare, read-only. The inspector folds them (`extensionSections`);
 *  Project Settings draws them all (`extensionRows`). */
function extensionParts(o: RowsFor): { fields: readonly ExtensionFieldDto[]; lead: HTMLElement[]; row: (decl: ExtensionFieldDto) => HTMLElement; group: (name: string) => HTMLElement; tail: HTMLElement[] } {
  const fields = o.extension.targets[o.kind]?.fields ?? [];
  // A project's own rows read its lists as they stand in the entry being edited, not as last saved.
  const adapter = extensionScoped(o.adapter, o.extension, o.kind === "project" ? o.entry ?? {} : o.extension.projectValues);
  const problems = fieldProblems(fields, o.entry, adapter);
  const lead = o.locked ? [el("p", "insp-ext-lock", o.locked)] : [];
  const disabled = o.id === null || o.locked !== null || o.readOnly === true;
  const row = (decl: ExtensionFieldDto): HTMLElement => {
    if (o.openFields && isRecordMap(decl as unknown as ValueDecl)) return recordMapSummaryRow(decl, o.entry?.[decl.name], adapter, problems.get(decl.name), o.id === null, o.openFields);
    // A stage the extension has since renamed says so, alone: not also the shell's "not one of the stages".
    const renamed = renamedStage(decl, o.entry?.[decl.name]);
    const problem = problems.get(decl.name);
    return o.cache.row(`${o.extension.id}\u0000${o.kind}\u0000${o.id ?? ""}\u0000${decl.name}`, {
      decl: decl as unknown as ValueDecl,
      value: o.entry?.[decl.name],
      adapter,
      disabled,
      ...(o.readOnly ? {} : { onCommit: (v: unknown) => { if (!disabled) o.commit(decl.name, v); } }),
      ...(renamed ? { replaceProblem: renamedStageSentence(renamed.from, renamed.to, o.extension.name) }
        : problem ? { problem } : {}),
      className: "insp-row insp-gd-row", labelClassName: "insp-key", controlClassName: "insp-gd-input",
    });
  };
  const declared = new Set(fields.map((f) => f.name));
  const tail: HTMLElement[] = [];
  for (const [k, v] of Object.entries(o.entry ?? {})) {
    if (declared.has(k)) continue;
    const r = el("div", "insp-row insp-ext-undeclared");
    r.append(el("span", "insp-key insp-gd", k), el("span", "insp-val insp-mono", typeof v === "string" ? v : JSON.stringify(v)));
    const said = problems.get(k);
    if (said) r.dataset["tip"] = said; // the shell's tooltip, never a native title
    tail.push(r);
  }
  return { fields, lead, row, group: (name) => el("div", "insp-ext-group", name), tail };
}

/**
 * A map of records in the inspector (Pattershot's brief, H3): too big for the column, so a line per key, the
 * record's set values, and an Edit button that opens the fields window, where it is edited as a grid. With no
 * keys, the Edit button alone. A problem inside it is said here too, so the inspector still shows it's there.
 */
function recordMapSummaryRow(decl: ExtensionFieldDto, value: unknown, adapter: ValueAdapter, problem: string | undefined, noNode: boolean, open: () => void): HTMLElement {
  const row = el("div", "shell-fieldrow insp-row insp-gd-row insp-ext-summary");
  const label = el("span", "shell-fieldrow-label insp-key", decl.label ?? decl.name);
  const body = el("div", "shell-fieldrow-body");
  const lines = recordMapSummary(decl as unknown as ValueDecl, value, adapter);
  if (lines.length) body.append(el("div", "insp-ext-summary-lines", ...lines.map((l) => el("div", "insp-ext-summary-line", l))));
  const edit = el("button", "btn insp-ext-edit", "Edit");
  edit.type = "button";
  edit.dataset["tip"] = `Edit ${decl.label ?? decl.name} in the Fields window`;
  edit.disabled = noNode;
  edit.addEventListener("click", open);
  body.append(edit);
  const inner = value === undefined ? [] : valueProblems(decl as unknown as TypeDecl, value, {
    exists: existsOf(adapter), ...(adapter.list ? { list: (name: string) => adapter.list!(name) } : {}),
  }).filter((p) => p.severity === "error" && p.path !== "");
  const words = [problem, inner.length ? "Something in here needs a fix: Edit shows where." : undefined].filter(Boolean).join(" ");
  if (words) { body.append(el("p", "shell-fieldrow-problem", words)); row.classList.add("has-problem"); }
  row.append(label, body);
  return row;
}

/** One extension's rows for one node, every field: its fields in the manifest's order, a heading wherever the
 *  manifest's group changes, then any key the node holds that the extension doesn't declare. */
function extensionRows(o: RowsFor): HTMLElement[] {
  const parts = extensionParts(o);
  const out: HTMLElement[] = [...parts.lead];
  let group: string | undefined;
  for (const decl of parts.fields) {
    if (decl.group !== undefined && decl.group !== group) { group = decl.group; out.push(parts.group(group)); }
    out.push(parts.row(decl));
  }
  return [...out, ...parts.tail];
}

/** The inspector's fold, kept across its redraws: each extension's section stays folded or open, as the author
 *  left it, from node to node (the shell's extensionFold; Pattershot's brief, F4). */
export const inspectorFold = extensionFold();

/**
 * The inspector's sections for a node: one per extension declaring fields for its kind, each captioned with the
 * extension's name and drawn after the node's Game Data. Folded to the fields the node sets until the author
 * opens it (the caption is the disclosure, and counts what's set). Empty when no extension targets the kind.
 */
export function extensionSections(kind: string, id: string | null, ext: Record<string, Record<string, unknown>> | undefined, h: ExtensionHandlers): HTMLElement[] {
  const all = h.extensions();
  if (!all.length) return [];
  const adapter = h.extensionAdapter();
  const out: HTMLElement[] = [];
  for (const extension of all) {
    if (!(extension.targets[kind]?.fields.length)) continue;
    const entry = ext?.[extension.id];
    const parts = extensionParts({
      extension, kind, id, entry, adapter, locked: h.extensionLock(extension.id), cache: rowCache,
      commit: (field, value) => { if (id) h.setExtensionValue(id, extension.id, field, value); },
      ...(h.openFields ? { openFields: () => { if (id) h.openFields!(kind, id); } } : {}),
    });
    out.push(inspectorFold.section({
      extension: extension.id, caption: extension.name, node: `${kind}\u0000${id ?? ""}`,
      fields: parts.fields as unknown as ValueDecl[], entry,
      row: (decl) => parts.row(decl as unknown as ExtensionFieldDto),
      group: parts.group, lead: parts.lead, tail: parts.tail,
      className: "insp-gd-section insp-ext-section", captionClassName: "insp-gd-cap",
    }));
  }
  return out;
}

// --- Project Settings ---------------------------------------------------------------------------------

/** The extensions with a section in Project Settings: those declaring fields for the project. */
export const settingsExtensions = (extensions: readonly ExtensionDto[] | undefined): ExtensionDto[] =>
  (extensions ?? []).filter((x) => (x.targets["project"]?.fields.length ?? 0) > 0);

/** The Settings section's id for an extension. */
export const settingsSectionId = (id: string): string => `ext-${id}`;

export interface ProjectSectionOptions {
  extension: ExtensionDto;
  adapter: ValueAdapter;
  /** The sentence when somebody else holds the extension's `_project.patterextension`, else null. */
  locked: string | null;
  /** Called with the project's whole entry each time a value changes, buffered until Save. */
  onChange: (entry: Record<string, unknown>) => void;
}

/** An extension's section in Project Settings: what the project takes it at and its settings, read only,
 *  then a row for each project field. The values are the dialog's until Save. */
export function mountProjectSection(host: HTMLElement, o: ProjectSectionOptions): void {
  let entry: Record<string, unknown> = { ...(o.extension.projectValues ?? {}) };
  const rows = el("div", "insp-ext-section settings-ext-rows");
  // Its own rows, not the inspector's: the inspector sweeps its cache on every redraw, which would dispose a
  // row the author is typing in here.
  const cache = valueRows();
  const draw = (): void => {
    rows.replaceChildren(...extensionRows({ cache,
      extension: o.extension, kind: "project", id: o.extension.projectNode, entry: Object.keys(entry).length ? entry : undefined,
      adapter: o.adapter, locked: o.locked,
      commit: (field, value) => {
        const next = { ...entry };
        if (value === undefined) delete next[field]; else next[field] = value;
        entry = next;
        o.onChange(entry);
        draw();
      },
    }));
    cache.sweep();
  };
  host.append(el("p", "settings-note settings-ext-taken", takenLine(o.extension)), rows);
  draw();
}

// --- problems ----------------------------------------------------------------------------------------

/**
 * Where a problem about an extension goes when it isn't about a node in a scene: its section of Project
 * Settings, for one about the project's own values, its manifest, or its entry in the project file. Null when
 * it goes to a node as any problem does, or there is no section to open.
 */
export function problemSettingsSection(p: Problem, extensions: readonly ExtensionDto[] | undefined): string | null {
  if (!p.extension) return null;
  const x = settingsExtensions(extensions).find((e) => e.id === p.extension);
  if (!x) return null;
  const file = p.file ?? "";
  const projectLevel = (p.nodeId !== undefined && p.nodeId === x.projectNode)
    || /\.extension\.json$/.test(file) || /(^|[\\/])_project\.patterextension$/.test(file) || /\.patterproj$/.test(file)
    || /^entries\.project\./.test(p.message);
  return projectLevel ? settingsSectionId(x.id) : null;
}

// --- the adapter ---------------------------------------------------------------------------------------

export interface AdapterSources {
  /** The project's cast. */
  cast: readonly string[];
  /** Every scene, with its blocks. */
  scenes: readonly { id: string; name: string; blocks: readonly { id: string; name: string }[] }[];
  /** The open scene's id, whose nodes come from the editor as they stand. */
  openScene: string | null;
  /** The open scene's nodes of a kind (the surface's nodesOfKind). */
  openNodes: (kind: string) => readonly { id: string; label: string }[];
  /** The rest of the project's nodes, as main read them (OpenedProject.extensionNodes). */
  index?: Record<string, readonly ExtensionNodeDto[]>;
}

/**
 * What a reference or a map key offers, by kind: the cast, every scene and block, and the open scene's other
 * nodes. A node held in another scene is named from the project's index, with its scene; one the project
 * doesn't have is undefined, which the rows show as gone.
 */
export function extensionAdapter(src: AdapterSources): ValueAdapter {
  const sceneName = (id: string | undefined): string => src.scenes.find((s) => s.id === id)?.name ?? id ?? "";
  const nodes = (kind: string): readonly { id: string; label: string }[] => {
    if (kind === "cast") return src.cast.map((c) => ({ id: c, label: c }));
    if (kind === "scene") return src.scenes.map((s) => ({ id: s.id, label: s.name || s.id }));
    if (kind === "block") return src.scenes.flatMap((s) => s.blocks.map((b) => ({ id: b.id, label: src.scenes.length > 1 ? `${b.name || b.id} (${s.name})` : b.name || b.id })));
    return src.openNodes(kind);
  };
  return {
    nodes,
    label: (kind, id) => {
      const held = nodes(kind).find((n) => n.id === id)?.label;
      if (held !== undefined) return held;
      const other = src.index?.[kind]?.find((n) => n.id === id && n.scene !== src.openScene);
      return other ? `${other.label} (${sceneName(other.scene)})` : undefined;
    },
  };
}
