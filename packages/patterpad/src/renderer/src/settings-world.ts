// The World Properties settings tab (Project Settings ▸ World Properties, #159). Two editors:
//   1. World properties: `@world.*` property declarations: name + type + default + read-only, written to
//      ProjectFile.scopeRegistry as the single `world` scope. These are the game-engine-owned values the
//      story reads (and the runtime self-backs from their defaults when no host binds them). The scope model
//      still supports other host tokens internally, but authors only ever declare @world here.
//   2. Coverage drivers: values the coverage test feeds those properties so world-gated branches get
//      exercised, written to ProjectFile.coverageDrivers. "Propose from story" seeds them from the
//      conditions (proposeCoverageDrivers in ops).
// value() returns a clean { scopeRegistry, coverageDrivers } for the save round-trip (blank rows pruned).

import type { HostScopeRegistry, HostScopeSpec, HostScopeDecl, PropertyType, ScalarValue, CoverageDriver } from "@patterkit/model";
import { el, iconBtn, labelled, moveItem, tagChips } from "./dom.js";
import { dupGuard, expandableRow, focusNewRow } from "./settings-list.js";

const TYPES: Array<[PropertyType, string]> = [
  ["number", "Number"], ["boolean", "True / False"], ["string", "Text"], ["enum", "List"], ["flags", "Flags"],
];

/** A flat host-scope property row, carrying its scope token alongside the declaration (grouped on save). */
interface ScopeRow extends HostScopeDecl { token: string; }

export interface WorldHandle {
  value(): { scopeRegistry?: HostScopeRegistry; coverageDrivers?: CoverageDriver[] };
  /** Replace the driver list (used by "Propose from story"). */
  setDrivers(drivers: CoverageDriver[]): void;
  /** The first host scope whose `@token.name` address clashes with another's, or null. */
  firstDuplicate(): HTMLInputElement | null;
}

/** Parse a comma-separated value pool: `true/false` -> boolean, numeric -> number, else the trimmed string. */
function parseValues(raw: string): ScalarValue[] {
  return raw.split(",").map((s) => s.trim()).filter((s) => s.length).map((s): ScalarValue => {
    if (s === "true") return true;
    if (s === "false") return false;
    const n = Number(s);
    return s !== "" && Number.isFinite(n) && String(n) === s ? n : s;
  });
}
const valuesText = (vals: ScalarValue[]): string => vals.map((v) => String(v)).join(", ");

export function mountWorld(
  host: HTMLElement,
  initial: { scopeRegistry?: HostScopeRegistry; coverageDrivers?: CoverageDriver[]; onPropose: () => Promise<CoverageDriver[]> },
): WorldHandle {
  // Flatten the registry into editable rows (token carried per row); regrouped on save.
  const scopeRows: ScopeRow[] = [];
  for (const s of initial.scopeRegistry?.scopes ?? []) {
    for (const d of s.declarations ?? []) scopeRows.push({ token: s.token, ...structuredClone(d) });
    if (!s.declarations?.length) scopeRows.push({ token: s.token, name: "", type: "number", writable: false });
  }
  // New world properties default to READ-ONLY: they're game-owned values the story reads, so the common
  // case is the story can't write them. Uncheck Read-only on the row to let the story set one.
  const newScopeRow = (): ScopeRow => ({ token: "world", name: "", type: "number", writable: false });
  const drivers: CoverageDriver[] = structuredClone(initial.coverageDrivers ?? []);
  const guard = dupGuard(); // host-scope address (@token.name) uniqueness

  const scopesHost = el("div", "world-scopes");
  const driversHost = el("div", "world-drivers");

  // ---- host-scope property rows ------------------------------------------------------------------
  const defaultControl = (p: ScopeRow): HTMLElement => {
    if (p.type === "boolean") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      for (const [v, l] of [["", "(unset)"], ["true", "True"], ["false", "False"]] as const) {
        const o = el("option", undefined, l) as HTMLOptionElement; o.value = v;
        if ((v === "true" && p.default === true) || (v === "false" && p.default === false)) o.selected = true; sel.append(o);
      }
      sel.addEventListener("change", () => { if (sel.value === "") delete p.default; else p.default = sel.value === "true"; });
      return sel;
    }
    if (p.type === "enum") {
      const sel = el("select", "insp-select gd-default") as HTMLSelectElement;
      const o0 = el("option", undefined, "(unset)") as HTMLOptionElement; o0.value = ""; sel.append(o0);
      for (const v of p.values ?? []) { const o = el("option", undefined, v) as HTMLOptionElement; o.value = v; if (p.default === v) o.selected = true; sel.append(o); }
      sel.addEventListener("change", () => { if (sel.value === "") delete p.default; else p.default = sel.value; });
      return sel;
    }
    if (p.type === "flags") {
      const s = el("span", "gd-flagnote", "starts empty");
      s.dataset.tip = "A flags property begins with no flags set; turn them on in effects with set_flags().";
      return s;
    }
    const input = el("input", "gd-input gd-default") as HTMLInputElement;
    input.type = p.type === "number" ? "number" : "text"; input.placeholder = "<default (optional)>";
    input.value = p.default == null ? "" : String(p.default);
    input.addEventListener("input", () => { const raw = input.value; if (raw === "") delete p.default; else p.default = (p.type === "number" ? Number(raw) : raw) as ScalarValue; });
    return input;
  };

  const scopeRow = (p: ScopeRow, i: number): HTMLElement => {
    // Every world property is @world: the game owns these values and the story reads them. The scope
    // isn't a user choice, so the row shows a fixed `@world.` and edits only the property name.
    const ref = el("div", "world-ref");
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "<property name>"; name.value = p.name; name.spellcheck = false;
    name.addEventListener("input", () => { p.name = name.value; });
    ref.append(el("span", "world-at", "@"), el("span", "world-scope", "world"), el("span", "world-dot", "."), name);
    guard.track(name, () => `world.${p.name}`);

    const type = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of TYPES) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === p.type) o.selected = true; type.append(o); }
    type.addEventListener("change", () => {
      p.type = type.value as PropertyType; delete p.default;
      if (p.type === "enum" || p.type === "flags") p.values ??= []; else delete p.values;
      renderScopes();
    });

    // Default on the line (matching Properties); rebuilt in place when enum/flags values change.
    let dflt = defaultControl(p);
    const refreshDefault = (): void => { const fresh = defaultControl(p); dflt.replaceWith(fresh); dflt = fresh; };

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move up", () => { moveItem(scopeRows, i, -1); renderScopes(); }, i === 0),
      iconBtn("↓", "move down", () => { moveItem(scopeRows, i, 1); renderScopes(); }, i === scopeRows.length - 1),
      iconBtn("✕", "delete property", () => { scopeRows.splice(i, 1); renderScopes(); }, false, true),
    );

    const ro = el("input", "insp-check") as HTMLInputElement;
    ro.type = "checkbox"; ro.checked = p.writable === false;
    ro.addEventListener("change", () => { if (ro.checked) p.writable = false; else delete p.writable; });
    const roLabel = el("label", "gd-labelled gd-shared"); roLabel.dataset.tip = "Read-only: the story can read this value but not set it (the game owns it). Writing to it is then a validation error.";
    roLabel.append(ro, el("span", undefined, "Read-only"));

    const details: HTMLElement[] = [roLabel];
    if (p.type === "enum" || p.type === "flags") details.push(labelled("Values", tagChips(p, refreshDefault)));
    return expandableRow({ line: [ref, type, dflt, acts], details });
  };

  const renderScopes = (): void => {
    guard.reset();
    scopesHost.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!scopeRows.length) list.append(el("p", "gd-empty", "No world properties yet. Declare an @world property for the game to set and your story to read."));
    else scopeRows.forEach((p, i) => list.append(scopeRow(p, i)));
    scopesHost.append(list);
    guard.check();
    const add = el("button", "gd-add", "+ Add world property") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => { scopeRows.push(newScopeRow()); renderScopes(); focusNewRow(scopesHost.querySelector(".gd-fieldlist")); });
    scopesHost.append(add);
  };

  // ---- coverage driver rows ----------------------------------------------------------------------
  const driverRow = (d: CoverageDriver, i: number): HTMLElement => {
    // Drivers feed @world properties, so `@world.` is fixed chrome and the input holds just the property
    // name; stored back as the full `@world.name` ref.
    const refWrap = el("div", "world-ref");
    const ref = el("input", "gd-input gd-name") as HTMLInputElement;
    ref.type = "text"; ref.placeholder = "property name"; ref.value = d.ref.replace(/^@\w+\./, "").replace(/^@/, ""); ref.spellcheck = false;
    ref.addEventListener("input", () => { const v = ref.value.trim().replace(/^@+/, ""); d.ref = v ? `@world.${v}` : "@world."; });
    refWrap.append(el("span", "world-at", "@"), el("span", "world-scope", "world"), el("span", "world-dot", "."), ref);

    const values = el("input", "gd-input world-driver-values") as HTMLInputElement;
    values.type = "text"; values.placeholder = "values, comma-separated (e.g. 49, 50, 51)"; values.value = valuesText(d.values);
    values.addEventListener("input", () => { d.values = parseValues(values.value); });

    const kind = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of [["recurring", "Recurring"], ["initial", "Initial"]] as const) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === d.kind) o.selected = true; kind.append(o); }

    const cadence = el("select", "insp-select gd-type") as HTMLSelectElement;
    for (const [v, l] of [["rarely", "Rarely"], ["sometimes", "Sometimes"], ["often", "Often"]] as const) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === (d.cadence ?? "sometimes")) o.selected = true; cadence.append(o); }
    cadence.addEventListener("change", () => { d.cadence = cadence.value as CoverageDriver["cadence"]; });
    const cadenceWrap = labelled("Cadence", cadence);
    const syncCadence = (): void => { cadenceWrap.hidden = d.kind !== "recurring"; }; // cadence only applies to recurring
    kind.addEventListener("change", () => { d.kind = kind.value as CoverageDriver["kind"]; syncCadence(); });

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("↑", "move up", () => { moveItem(drivers, i, -1); renderDrivers(); }, i === 0),
      iconBtn("↓", "move down", () => { moveItem(drivers, i, 1); renderDrivers(); }, i === drivers.length - 1),
      iconBtn("✕", "delete driver", () => { drivers.splice(i, 1); renderDrivers(); }, false, true),
    );

    syncCadence();
    return expandableRow({ line: [refWrap, values, acts], details: [labelled("When", kind), cadenceWrap] });
  };

  const renderDrivers = (): void => {
    driversHost.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!drivers.length) list.append(el("p", "gd-empty", "No drivers. Coverage will flag any @world-gated branch as needing an input."));
    else drivers.forEach((d, i) => list.append(driverRow(d, i)));
    driversHost.append(list);
    const actions = el("div", "world-driver-actions");
    const add = el("button", "gd-add", "+ Add driver") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => { drivers.push({ ref: "@world.", kind: "recurring", cadence: "sometimes", values: [] }); renderDrivers(); focusNewRow(driversHost.querySelector(".gd-fieldlist")); });
    const propose = el("button", "gd-add", "Propose from story") as HTMLButtonElement;
    propose.type = "button";
    propose.addEventListener("click", async () => {
      propose.disabled = true;
      try { handle.setDrivers(await initial.onPropose()); } finally { propose.disabled = false; }
    });
    actions.append(add, propose);
    driversHost.append(actions);
  };

  host.replaceChildren();
  host.append(el("h3", "world-cap", "World properties"));
  host.append(el("p", "settings-note", "Properties the game engine owns and your story reads: referenced as @world.name in conditions and effects. The runtime fills them from their defaults until your game sets them."));
  host.append(scopesHost);
  host.append(el("h3", "world-cap", "Coverage drivers"));
  host.append(el("p", "settings-note", "Values the coverage test feeds the host scopes so world-gated branches get exercised. Propose them from your story, then tune."));
  host.append(driversHost);
  renderScopes();
  renderDrivers();

  const handle: WorldHandle = {
    value() {
      // Every world property is @world: collect the named rows into the single world scope.
      const declarations: HostScopeDecl[] = [];
      for (const r of scopeRows) {
        const name = r.name.trim();
        if (!name) continue;
        const decl: HostScopeDecl = { name, type: r.type };
        if (r.default !== undefined) decl.default = r.default;
        if ((r.type === "enum" || r.type === "flags") && r.values?.length) decl.values = [...r.values];
        if (r.writable === false) decl.writable = false;
        declarations.push(decl);
      }
      const scopes: HostScopeSpec[] = declarations.length ? [{ token: "world", declarations }] : [];
      const cleanDrivers = drivers
        .filter((d) => d.ref.replace(/^@world\./, "").trim() && d.values.length)
        .map((d): CoverageDriver => ({
          ref: d.ref.trim(), kind: d.kind, ...(d.kind === "recurring" ? { cadence: d.cadence ?? "sometimes" } : {}), values: [...d.values],
        }));
      return {
        scopeRegistry: scopes.length ? { version: 1, scopes } : undefined,
        coverageDrivers: cleanDrivers.length ? cleanDrivers : undefined,
      };
    },
    setDrivers(next) { drivers.splice(0, drivers.length, ...structuredClone(next)); renderDrivers(); },
    firstDuplicate: () => guard.firstDuplicate(),
  };
  return handle;
}
