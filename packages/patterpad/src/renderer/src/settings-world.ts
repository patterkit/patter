// Project Settings ▸ Game scopes (#159; matched to Storyletter's host-scopes.ts by Ian's ruling of
// 2026-10-28, patterkit design/hands-on-fixes-code-review-2026-10.md section 4). The game's own scopes the
// story reads (`@world`, `@player`, ...), written to ProjectFile.scopeRegistry, with the coverage drivers
// that feed them below (ProjectFile.coverageDrivers).
//
// @world comes first and behaves as it always has: its token is fixed, it can't be removed, and an empty
// one is no scope at all. Every other scope is the author's to add, name, remove, and declare either
// property by property or opaque ("Any name, unchecked": a scope with no declarations). Each scope carries
// a scope-level "Read-only to the story" switch (`writable: false`), the default for its properties; a
// property's own Read-only box still says the same of that one property.
//
// A scope renamed here is a rename, not a scope removed and another added: value() says so in
// `scopeRenames` (the token it was saved under -> the new one), and the save carries every reference to it
// (conditions, effects, `{@scope.x}` in strings) in the same batch, one undo step (main project.ts). A
// stage renamed on one of its qualities is kept under the token the scope was SAVED with, since the save
// carries stage renames first, while the scenes still say the old token.
//
// Where the game has a shared scopes folder (`game-scopes/`), these are the game's scopes and live in its
// `game.scopes.json` (the main process writes that first, then the project's synced copy); the tab says
// so, and edits exactly the same rows either way. A scope removed here goes from that file too.

import type { HostScopeRegistry, HostScopeDecl, PropertyType, ScalarValue, CoverageDriver } from "@patterkit/model";
import { el } from "./dom.js";
import type { StageRenameDto } from "../../shared/api.js";
import { iconBtn, labelled, labelledToggle, moveItem, tagChips, stageChips, bindPropertyName, bindPropertyRef, defaultControl, dupGuard, expandableRow,
  firstIllegalPropertyName, focusNewRow, PROPERTY_NAME_HINT, PROPERTY_TYPES, revalidatePropertyRefs } from "@wildwinter/app-shell";

/** Patter's own scopes: never a game's. */
const PATTER_OWN = ["patter", "scene", "flow"];
/** The family's other engines' scopes (`@story`): theirs to declare, not the game's. */
const TOKEN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Why `token` can't name a game scope here, or undefined when it can. `others` are the other scopes'
 * tokens. `savedAs` is the token the scope was saved under: a project that declared another engine's
 * scope before the shared folder existed (the play window's advice for `@story`) keeps it, and only a
 * name typed here is held to that rule. The same rules the save checks (main project.ts).
 */
export function scopeTokenProblem(token: string, others: readonly string[], savedAs?: string): string | undefined {
  const t = token.trim();
  if (t === "") return "Give the scope a name, such as player.";
  if (!TOKEN.test(t)) return "A scope's name is letters, digits and _, and doesn't start with a digit.";
  if (t === "world") return "@world is already the first scope.";
  if (PATTER_OWN.includes(t)) return `@${t} is Patter's own scope, so the game can't provide it.`;
  if (others.includes(t)) return `There is already an @${t} scope.`;
  return undefined;
}

/** One scope as the tab edits it. `rows` are kept while the scope is opaque, so turning "Any name" off
 *  again in the same visit brings them back; an opaque scope saves none. */
interface ScopeState {
  token: string;
  /** The token it was saved under when the tab opened; absent for one added here. */
  savedAs?: string;
  writable?: boolean;
  opaque: boolean;
  rows: HostScopeDecl[];
}

/** A coverage driver, tied to the scope it feeds (so it follows that scope's rename), or to a bare token
 *  when no one scope here answers to its ref. */
interface DriverState { scope: ScopeState | string; name: string; kind: CoverageDriver["kind"]; cadence?: CoverageDriver["cadence"]; values: ScalarValue[] }

export interface WorldHandle {
  value(): { scopeRegistry?: HostScopeRegistry; coverageDrivers?: CoverageDriver[]; scopeRenames?: Record<string, string> };
  /** Replace the driver list (used by "Propose from story"). */
  setDrivers(drivers: CoverageDriver[]): void;
  /** The first scope name that can't be used, with why, or null. */
  firstBadScope(): { el: HTMLInputElement; message: string } | null;
  /** The first host scope whose `@token.name` address clashes with another's, or null. */
  firstDuplicate(): HTMLInputElement | null;
  /** The first name no expression could reach, for the Save gate. */
  firstIllegalName(): HTMLInputElement | null;
  /** The stages renamed in place since the tab opened, in order, for the save to carry into the scenes. */
  stageRenames(): StageRenameDto[];
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
  initial: {
    scopeRegistry?: HostScopeRegistry; coverageDrivers?: CoverageDriver[]; onPropose: () => Promise<CoverageDriver[]>; worldFile?: string;
    /** A quality's stages reordered: `note` is a quiet line under them to fill (how many gates it changes). */
    onStageReorder?: (target: { scope: string; name: string }, note: HTMLElement) => void;
  },
): WorldHandle {
  const renames: StageRenameDto[] = [];
  const scopes: ScopeState[] = (initial.scopeRegistry?.scopes ?? []).map((s) => ({
    token: s.token, savedAs: s.token, ...(s.writable !== undefined ? { writable: s.writable } : {}),
    opaque: s.declarations === undefined, rows: structuredClone(s.declarations ?? []),
  }));
  // @world always, first: a project that declares none still gets the row.
  const at = scopes.findIndex((s) => s.token === "world");
  scopes.unshift(at >= 0 ? scopes.splice(at, 1)[0]! : { token: "world", opaque: false, rows: [] });
  const world = scopes[0]!;

  const drivers: DriverState[] = [];
  const driverState = (d: CoverageDriver): DriverState => {
    const m = /^@([A-Za-z_][A-Za-z0-9_]*)\.(.*)$/.exec(d.ref.trim());
    const token = m?.[1] ?? "world";
    const owners = scopes.filter((s) => s.token === token);
    return { scope: owners.length === 1 ? owners[0]! : token, name: m?.[2] ?? d.ref.replace(/^@/, ""), kind: d.kind,
      ...(d.cadence ? { cadence: d.cadence } : {}), values: [...d.values] };
  };
  for (const d of initial.coverageDrivers ?? []) drivers.push(driverState(d));
  const tokenOf = (d: DriverState): string => (typeof d.scope === "string" ? d.scope : d.scope.token.trim());

  // New properties default to READ-ONLY: they're game-owned values the story reads, so the common case is
  // the story can't write them. Uncheck Read-only on the row to let the story set one.
  const newRow = (): HostScopeDecl => ({ name: "", type: "number", writable: false });
  const guard = dupGuard(); // host-scope address (@token.name) uniqueness

  const scopesHost = el("div", "world-scopes host-scopes");
  const driversHost = el("div", "world-drivers");
  const tokenInputs: { input: HTMLInputElement; scope: ScopeState }[] = [];

  const markToken = (input: HTMLInputElement, scope: ScopeState): string | undefined => {
    const problem = scopeTokenProblem(scope.token, scopes.filter((s) => s !== scope).map((s) => s.token.trim()), scope.savedAs);
    input.classList.toggle("illegal", problem !== undefined);
    if (problem !== undefined) input.dataset.tip = problem; else delete input.dataset.tip;
    return problem;
  };

  // ---- one declared property ------------------------------------------------------------------------
  // The default control is the shell's (`defaultControl`, typed: the model holds a real boolean / number).
  // The row itself stays hand-built: a fixed `@token.` prefix, a Read-only axis, a guard keyed on the
  // full address and the driver rows re-checked on every rename are not the shell list's shape.
  const propRow = (scope: ScopeState, p: HostScopeDecl, i: number, redraw: () => void, tokenSpans: HTMLElement[]): HTMLElement => {
    const ref = el("div", "world-ref");
    const name = el("input", "gd-input gd-name") as HTMLInputElement;
    name.type = "text"; name.placeholder = "Property name"; name.value = p.name; name.spellcheck = false;
    name.dataset.tip = PROPERTY_NAME_HINT;
    // Renaming a declaration makes every driver pointing at the old name wrong from that moment, with
    // nothing typed into any of them, so the driver rows are re-checked here rather than on their own input.
    bindPropertyName(name, (v) => { p.name = v; revalidatePropertyRefs(driversHost); }, { hint: PROPERTY_NAME_HINT });
    const tokenSpan = el("span", "world-scope", scope.token);
    tokenSpans.push(tokenSpan);
    ref.append(el("span", "world-at", "@"), tokenSpan, el("span", "world-dot", "."), name);
    guard.track(name, () => `${scope.token.trim()}.${p.name}`);

    const type = el("select", "insp-select gd-type") as HTMLSelectElement;
    // The shell's one type list, in the family's order and words, shared with every property list.
    for (const [v, l] of PROPERTY_TYPES) { const o = el("option", undefined, l) as HTMLOptionElement; o.value = v; if (v === p.type) o.selected = true; type.append(o); }
    type.addEventListener("change", () => {
      p.type = type.value as PropertyType; delete p.default;
      if (p.type === "enum" || p.type === "flags") p.values ??= []; else delete p.values;
      if (p.type === "quality") p.stages ??= []; else delete p.stages;
      redraw();
    });

    // Default on the line (matching Properties); rebuilt in place when enum/flags values change.
    let dflt = defaultControl(p, undefined, { typed: true });
    const refreshDefault = (): void => { const fresh = defaultControl(p, undefined, { typed: true }); dflt.replaceWith(fresh); dflt = fresh; };

    const acts = el("div", "gd-acts");
    acts.append(
      iconBtn("up", "Move up", () => { moveItem(scope.rows, i, -1); redraw(); }, i === 0),
      iconBtn("down", "Move down", () => { moveItem(scope.rows, i, 1); redraw(); }, i === scope.rows.length - 1),
      iconBtn("close", "Delete property", () => { scope.rows.splice(i, 1); redraw(); }, false, true),
    );

    const ro = el("input", "insp-check") as HTMLInputElement;
    ro.type = "checkbox"; ro.checked = p.writable === false;
    ro.addEventListener("change", () => { if (ro.checked) p.writable = false; else delete p.writable; });
    const roLabel = el("label", "shell-labelled gd-shared"); roLabel.dataset.tip = "The story can read this value but not set it. A write is reported as a problem.";
    roLabel.append(ro, el("span", undefined, "Read-only"));

    const details: HTMLElement[] = [roLabel];
    if (p.type === "enum" || p.type === "flags") details.push(labelled("Values", tagChips(p, refreshDefault)));
    // A quality's ladder, IN ORDER: the chips carry movers because position is the meaning here.
    if (p.type === "quality") {
      // A rename is carried into the scenes on save: values are stored by stage name. Only a saved scope
      // has references to carry, and they name it by the token it was saved with.
      const note = el("p", "shell-stage-note");
      const chips = stageChips(p, refreshDefault, {
        onRename: (from, to) => {
          if (p.default === from) p.default = to;
          refreshDefault();
          if (scope.savedAs !== undefined) renames.push({ scope: scope.savedAs, name: p.name.trim(), from, to });
        },
        onReorder: () => initial.onStageReorder?.({ scope: scope.savedAs ?? scope.token, name: p.name.trim() }, note),
      });
      details.push(labelled("Stages (in order)", chips), note);
    }
    // A declaration row, so it carries its name for "Go to definition" to land on. The coverage-driver rows
    // below also use expandableRow and are deliberately NOT stamped: a driver names a property, it does
    // not declare one, and a jump that landed on a driver would be landing on the wrong thing.
    return expandableRow({ line: [ref, type, dflt, acts], details, name: p.name });
  };

  // ---- one scope ------------------------------------------------------------------------------------
  const scopeBlock = (scope: ScopeState, i: number): HTMLElement => {
    const block = el("section", "host-scope");
    const head = el("div", "host-scope-head");
    const tokenSpans: HTMLElement[] = [];
    if (scope === world) {
      head.append(el("h3", "world-cap host-scope-cap", "@world"));
    } else {
      const token = el("input", "gd-input host-scope-token") as HTMLInputElement;
      token.type = "text"; token.value = scope.token; token.placeholder = "Scope name"; token.spellcheck = false;
      token.setAttribute("aria-label", "Scope name");
      token.addEventListener("input", () => {
        scope.token = token.value.trim();
        for (const s of tokenSpans) s.textContent = scope.token;
        for (const t of tokenInputs) markToken(t.input, t.scope);
        guard.check();
        if (scope.opaque) drawProps();
        renderDrivers(); // a driver's scope list names the scopes as they are now
      });
      tokenInputs.push({ input: token, scope });
      markToken(token, scope);
      const remove = iconBtn("close", "Remove scope", () => { scopes.splice(i, 1); renderScopes(); }, false, true);
      head.append(el("h3", "world-cap host-scope-cap", el("span", "world-at", "@"), token), remove);
    }
    block.append(head);

    block.append(labelledToggle("Read-only to the story", {
      checked: scope.writable === false,
      hint: "The story can read every property here but not set one. A write is reported as a problem.",
      onChange: (on) => { if (on) scope.writable = false; else delete scope.writable; },
    }).row);
    // @world is always declared; one saved opaque (by hand, or by another tool) keeps the switch to undo it.
    if (scope !== world || scope.opaque) {
      block.append(labelledToggle("Any name, unchecked", {
        checked: scope.opaque,
        hint: "The game decides what this scope holds, so the story may name any property on it. Turn it off to declare its properties instead.",
        onChange: (on) => { scope.opaque = on; renderScopes(); },
      }).row);
    }

    const listHost = el("div", "host-scope-props");
    const drawProps = (): void => {
      listHost.replaceChildren();
      tokenSpans.length = 0;
      if (scope.opaque) {
        listHost.append(el("p", "settings-note", `Any @${scope.token || "scope"} name is accepted, and nothing checks it.`));
        return;
      }
      const list = el("div", "gd-fieldlist");
      if (!scope.rows.length) list.append(el("p", "empty", `No properties yet. Declare an @${scope.token || "scope"} property for the game to set and your story to read.`));
      else scope.rows.forEach((p, n) => list.append(propRow(scope, p, n, renderScopes, tokenSpans)));
      const add = el("button", "gd-add", "+ Add property") as HTMLButtonElement;
      add.type = "button";
      add.addEventListener("click", () => { scope.rows.push(newRow()); renderScopes(); focusNewRow(scopesHost.querySelectorAll<HTMLElement>(".host-scope")[scopes.indexOf(scope)]?.querySelector<HTMLElement>(".gd-fieldlist") ?? null); });
      listHost.append(list, add);
    };
    drawProps();
    block.append(listHost);
    return block;
  };

  const renderScopes = (): void => {
    guard.reset();
    tokenInputs.length = 0;
    scopesHost.replaceChildren(...scopes.map((s, i) => scopeBlock(s, i)));
    guard.check();
    // Adding, deleting, renaming or reordering a declaration or a scope changes what the drivers below may
    // point at, and every one of those paths comes through here.
    renderDrivers();
  };

  // ---- coverage driver rows ----------------------------------------------------------------------
  const driverRow = (d: DriverState, i: number): HTMLElement => {
    const refWrap = el("div", "world-ref");
    // The scope it feeds, from the scopes above as they are now; a token no scope here answers to stays
    // offered, so a driver is never silently moved onto another scope.
    const scopeSel = el("select", "insp-select world-driver-scope") as HTMLSelectElement;
    scopeSel.setAttribute("aria-label", "Scope");
    const named = scopes.filter((s) => s.token.trim() !== "");
    for (const s of named) {
      const o = el("option", undefined, s.token) as HTMLOptionElement;
      o.value = String(scopes.indexOf(s)); if (d.scope === s) o.selected = true; scopeSel.append(o);
    }
    if (typeof d.scope === "string") {
      const o = el("option", undefined, d.scope) as HTMLOptionElement; o.value = "raw"; o.selected = true; scopeSel.append(o);
    }
    scopeSel.addEventListener("change", () => { if (scopeSel.value !== "raw") d.scope = scopes[Number(scopeSel.value)]!; renderDrivers(); });
    const ref = el("input", "gd-input gd-name") as HTMLInputElement;
    ref.type = "text"; ref.placeholder = "Property name"; ref.value = d.name; ref.spellcheck = false;
    refWrap.append(el("span", "world-at", "@"), scopeSel, el("span", "world-dot", "."), ref);
    // Bound AFTER the input is in the tree: the shell attaches its datalist as a SIBLING, which is a
    // no-op while the input has no parent, and the failure is invisible (no autocomplete, no error).
    // A REFERENCE, not a declaration, so it takes the other rule: case is fine (expressions fold every
    // reference), but a hyphen, a space, a leading digit or a keyword can never match any declaration -
    // and neither can a name nobody declared. That last one is the point: a driver aimed at a property
    // that does not exist feeds a value nobody reads, the gated branches it was meant to exercise stay
    // unexercised, and the coverage report shows them as never hit, which reads as "this content is
    // unreachable" rather than "that name is a typo". Declare-then-reference is the ruling, so this
    // blocks Save; the declared names are offered as a datalist to keep that from being pedantic. An
    // opaque scope takes any name.
    const token = tokenOf(d);
    bindPropertyRef(ref, (v) => { d.name = v.trim().replace(/^@+/, ""); }, {
      known: () => {
        const s = typeof d.scope === "string" ? undefined : d.scope;
        if (s === undefined || s.opaque) return [ref.value.trim().replace(/^@+/, "")];
        return s.rows.map((r) => r.name).filter(Boolean);
      },
      scope: token,
      hint: `The @${token} property this driver feeds. Declare it above first.`,
    });

    const values = el("input", "gd-input world-driver-values") as HTMLInputElement;
    values.type = "text"; values.placeholder = "49, 50, 51"; values.value = valuesText(d.values);
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
      iconBtn("up", "Move up", () => { moveItem(drivers, i, -1); renderDrivers(); }, i === 0),
      iconBtn("down", "Move down", () => { moveItem(drivers, i, 1); renderDrivers(); }, i === drivers.length - 1),
      iconBtn("close", "Delete driver", () => { drivers.splice(i, 1); renderDrivers(); }, false, true),
    );

    syncCadence();
    return expandableRow({ line: [refWrap, values, acts], details: [labelled("When", kind), cadenceWrap] });
  };

  const renderDrivers = (): void => {
    // A driver whose scope was removed keeps the token it named, rather than moving onto another scope.
    for (const d of drivers) if (typeof d.scope !== "string" && !scopes.includes(d.scope)) d.scope = d.scope.token.trim() || "world";
    driversHost.replaceChildren();
    const list = el("div", "gd-fieldlist");
    if (!drivers.length) list.append(el("p", "empty", "No drivers. Coverage will flag any branch gated on a game scope as needing an input."));
    else drivers.forEach((d, i) => list.append(driverRow(d, i)));
    driversHost.append(list);
    const actions = el("div", "world-driver-actions");
    const add = el("button", "gd-add", "+ Add driver") as HTMLButtonElement;
    add.type = "button";
    add.addEventListener("click", () => { drivers.push({ scope: world, name: "", kind: "recurring", cadence: "sometimes", values: [] }); renderDrivers(); focusNewRow(driversHost.querySelector<HTMLElement>(".gd-fieldlist")); });
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
  host.append(el("p", "settings-note", "Values your game owns and your story reads, such as @world.time or @player.hp. Each starts at its default until the game sets it."));
  // With a game scopes folder, say where these live: the shared file every tool in the game reads.
  if (initial.worldFile) {
    host.append(el("p", "settings-note", `Shared with the game's other tools: saved to ${initial.worldFile}, and a copy kept in this project so it still works on its own. Removing a scope here removes it from that file too. Renaming one renames it there, but not in the other tools' projects: update those where they use it.`));
  }
  host.append(scopesHost);
  const addScope = el("button", "gd-add host-scope-add", "+ Add scope") as HTMLButtonElement;
  addScope.type = "button";
  addScope.addEventListener("click", () => {
    scopes.push({ token: "", opaque: false, rows: [] });
    renderScopes();
    tokenInputs[tokenInputs.length - 1]?.input.focus();
  });
  host.append(addScope);
  host.append(el("h3", "world-cap", "Coverage drivers"));
  host.append(el("p", "settings-note", "Values the coverage test feeds these properties so gated branches run. Propose them from the story, then adjust."));
  host.append(driversHost);
  renderScopes();

  const handle: WorldHandle = {
    stageRenames: () => [...renames],
    value() {
      const out = [];
      const scopeRenames: Record<string, string> = {};
      for (const s of scopes) {
        const token = s.token.trim();
        if (!token) continue;
        if (s.savedAs !== undefined && s.savedAs !== token) scopeRenames[s.savedAs] = token;
        const writable = s.writable !== undefined ? { writable: s.writable } : {};
        if (s.opaque) { out.push({ token, ...writable }); continue; }
        const declarations: HostScopeDecl[] = [];
        for (const r of s.rows) {
          const name = r.name.trim();
          if (!name) continue;
          const decl: HostScopeDecl = { name, type: r.type };
          if (r.default !== undefined) decl.default = r.default;
          if ((r.type === "enum" || r.type === "flags") && r.values?.length) decl.values = [...r.values];
          if (r.type === "quality" && r.stages?.length) decl.stages = [...r.stages];
          if (r.writable === false) decl.writable = false;
          if (r.purpose) decl.purpose = r.purpose;
          declarations.push(decl);
        }
        // An empty @world is no scope at all, as it always was.
        if (s === world && declarations.length === 0 && s.writable === undefined) continue;
        out.push({ token, ...writable, declarations });
      }
      const cleanDrivers = drivers
        .filter((d) => d.name.trim() && tokenOf(d) && d.values.length)
        .map((d): CoverageDriver => ({
          ref: `@${tokenOf(d)}.${d.name.trim()}`, kind: d.kind, ...(d.kind === "recurring" ? { cadence: d.cadence ?? "sometimes" } : {}), values: [...d.values],
        }));
      return {
        scopeRegistry: out.length ? { version: initial.scopeRegistry?.version ?? 1, scopes: out } : undefined,
        coverageDrivers: cleanDrivers.length ? cleanDrivers : undefined,
        ...(Object.keys(scopeRenames).length ? { scopeRenames } : {}),
      };
    },
    setDrivers(next) { drivers.splice(0, drivers.length, ...next.map(driverState)); renderDrivers(); },
    firstBadScope: () => {
      for (const t of tokenInputs) {
        const message = markToken(t.input, t.scope);
        if (message !== undefined) return { el: t.input, message };
      }
      return null;
    },
    firstDuplicate: () => guard.firstDuplicate(),
    firstIllegalName: () => firstIllegalPropertyName(host),
  };
  return handle;
}
