// @vitest-environment jsdom
// Patter extensions in the inspector and Project Settings (renderer/src/extension-rows.ts), on the
// conformance suite's probe manifest: a section per extension for each level that has fields, the shell's
// rows for every type (help, value help and "default (x)" included), a reference's choices and a held
// node named from the project's index, a pick over the cast and the extension's own project lists, commits
// to the surface, a claimed gameData field drawn as the
// extension presents it, locks, the inline problems validation would raise, the Settings section, and
// where a problem about an extension goes.

import { describe, it, expect, beforeEach } from "vitest";
import probeText from "../../../conformance/fixtures/probe.extension.json?raw";
import { parseManifest } from "@wildwinter/toolkit/extensions";
import type { ProjectFile, GameDataField } from "@patterkit/model";
import type { InspectorContext } from "@patterkit/patterpad-surface/surface";
import { renderInspector, type InspectorHandlers } from "./src/inspector.js";
import { extensionAdapter, extensionScoped, fieldProblems, inspectorFold, mountProjectSection, problemSettingsSection, renamedStage } from "./src/extension-rows.js";
import { extensionProblemLine, problemLineFor, type ExtensionProblemContext } from "./src/problem-copy.js";
import { extensionDtos } from "../shared/extensions.js";
import type { ExtensionDto, Problem } from "../shared/api.js";

const manifest = parseManifest(probeText);
const probe = (settings: Record<string, string> = { deliveryField: "mood" }, projectValues?: Record<string, unknown>): ExtensionDto[] => extensionDtos(
  { project: { id: "proj_t", name: "T" }, extensions: { probe: { version: "1.1.0", settings } } } as unknown as ProjectFile,
  new Map([["probe", manifest]]),
  projectValues ? new Map([["probe", { entries: { project: { proj_t: projectValues } } }]]) : new Map(),
)!;

const noop = (): void => {};
const adapter = extensionAdapter({
  cast: ["ANNA", "BEN"],
  scenes: [{ id: "scn_a", name: "Harbour", blocks: [{ id: "b_dock", name: "Dock" }] }, { id: "scn_b", name: "Street", blocks: [] }],
  openScene: "scn_a",
  openNodes: (kind) => (kind === "line" ? [{ id: "L_bell", label: "ANNA: Ring it." }, { id: "L_reply", label: "BEN: Aye." }] : []),
  index: { line: [{ id: "L_far", label: "BEN: Over here!", scene: "scn_b" }, { id: "L_gone_here", label: "old", scene: "scn_a" }] },
});

function handlersWith(over: Partial<InspectorHandlers> = {}): InspectorHandlers {
  return {
    reveal: noop, editNote: noop, hasNotes: () => false,
    editCondition: noop, editGameId: noop, editGroupProps: noop, editJump: noop,
    editEffects: noop, condPreview: () => document.createElement("span"), effectsPreview: () => document.createElement("span"),
    jumpLabel: () => "", setJumpMode: noop, setTags: noop,
    gameDataFields: () => [], setGameData: noop, sceneProps: () => [], editSceneProps: noop,
    writingStatuses: () => [], lineStatus: () => null, setLineStatus: noop,
    recordingStatuses: () => [], recordingStatus: () => null, setRecordingStatus: noop,
    audioFoldersOn: () => false, recordingFolderStatus: () => null, playRecording: noop,
    scratchStatus: () => null, recordScratch: noop, scratchStale: () => false,
    needsRerecord: () => false, setNeedsRerecord: noop,
    qualifiers: () => [], setQualifier: noop,
    projectPadAfter: () => 0.6, setPadAfter: noop, setPadAfterDefault: noop,
    extensions: () => probe(), setExtensionValue: noop, extensionLock: () => null, extensionAdapter: () => adapter,
    ...over,
  };
}
const ctx = (...levels: unknown[]): InspectorContext => ({ levels }) as InspectorContext;
const draw = (h: InspectorHandlers, ...levels: unknown[]): HTMLElement => { const host = document.createElement("div"); renderInspector(host, ctx(...levels), h); return host; };
const sections = (host: HTMLElement): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(".insp-ext-section")];
const rowOf = (host: ParentNode, caption: string): HTMLElement | undefined =>
  [...host.querySelectorAll<HTMLElement>(".insp-ext-section .shell-fieldrow")].find((r) => r.querySelector(".shell-fieldrow-label")?.textContent === caption);

// Opened, so every field draws; the fold itself is "the inspector's fold" below.
beforeEach(() => { inspectorFold.setOpen("probe", true); });

describe("extension sections in the inspector", () => {
  it("draws one per level that the extension has fields for, captioned with its name, after Game Data", () => {
    const host = draw(handlersWith(),
      { kind: "leaf", beat: "prose", id: "T_1" },
      { kind: "leaf", beat: "gameEvent", id: "E_1" },
      { kind: "snippet", id: "sn_1" },
      { kind: "group", id: "o_1", role: "option", labelParts: ["Option"], label: "Option" },
      { kind: "group", id: "g_1", role: "sequence", labelParts: ["Sequence"], label: "Sequence" },
      { kind: "block", id: "b_dock", name: "Dock", address: "dock" },
      { kind: "scene", id: "scn_a", name: "Harbour", address: "harbour" },
    );
    // text, gameEvent, snippet, option, block, scene: not the plain sequence group.
    expect(sections(host).map((s) => s.closest(".insp-level")!.className.replace("insp-level insp-", ""))).toEqual(["leaf", "leaf", "snippet", "group", "block", "scene"]);
    expect(sections(host).every((s) => s.querySelector(".insp-gd-cap")?.textContent === "Probe")).toBe(true);
    expect(rowOf(host, "style")).toBeTruthy();
    expect(rowOf(host, "icon")).toBeTruthy();
    expect(rowOf(host, "theme")).toBeTruthy();
  });

  it("draws none when the project takes no extension", () => {
    expect(sections(draw(handlersWith({ extensions: () => [] }), { kind: "leaf", beat: "line", id: "L_1" }))).toEqual([]);
  });

  it("draws every type on a line: help, value help, defaults, records, maps, lists", () => {
    const host = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: {
      tone: "tense", marks: ["night"], cue: { sound: "bell", gain: 0.5 }, perf: { ANNA: { expression: "frown" } },
      beats: [{ id: "b1", at: 1 }], words: ["salt"],
    } } });
    expect(rowOf(host, "Note")?.querySelector(".shell-fieldrow-purpose")?.textContent).toBe("A line for the crew.");
    expect(rowOf(host, "weight")?.querySelector("input")?.placeholder).toBe("default (1)");
    expect(rowOf(host, "tone")?.querySelector(".shell-fieldrow-valuehelp")?.textContent).toBe("Clipped.");
    const cue = rowOf(host, "cue")!;
    expect([...cue.querySelectorAll(".shell-fieldrow-label")].map((l) => l.textContent)).toEqual(["cue", "sound", "gain"]);
    const perf = rowOf(host, "perf")!;
    expect(perf.textContent).toContain("ANNA");
    // A map keyed by cast offers the members it doesn't hold yet.
    expect([...perf.querySelectorAll<HTMLOptionElement>(".shell-valuerow-key option")].map((o) => o.textContent)).toEqual(["Add...", "BEN"]);
    expect(rowOf(host, "beats")?.textContent).toContain("b1");
    expect(rowOf(host, "words")?.querySelector("input")?.value).toBe("salt");
  });

  it("offers the open scene's nodes for a reference, and names one held in another scene from the index", () => {
    const host = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { next: "L_far" } } });
    const sel = rowOf(host, "next")!.querySelector("select")!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(["default (none)", "ANNA: Ring it.", "BEN: Aye.", "BEN: Over here! (Street)"]);
    expect(sel.value).toBe("L_far");
    // One the open scene no longer has reads as gone, though the index (read before the edit) still lists it.
    const gone = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { next: "L_gone_here" } } });
    expect([...rowOf(gone, "next")!.querySelectorAll("option")].pop()?.textContent).toBe("L_gone_here (gone)");
  });

  it("commits a value to the node, one call per change, and clears it with undefined", () => {
    const set: Array<[string, string, string, unknown]> = [];
    const h = handlersWith({ setExtensionValue: (id, x, f, v) => { set.push([id, x, f, v]); } });
    const host = draw(h, { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { note: "a" } } });
    const note = rowOf(host, "Note")!.querySelector("input")!;
    note.value = "Ring it twice.";
    note.dispatchEvent(new Event("input", { bubbles: true }));
    const sel = rowOf(host, "next")!.querySelector("select")!;
    sel.value = "L_reply";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(set).toEqual([["L_bell", "probe", "note", "Ring it twice."], ["L_bell", "probe", "next", "L_reply"], ["L_bell", "probe", "next", undefined]]);
  });

  it("disables an extension's rows where its data is locked, and says by whom", () => {
    const host = draw(handlersWith({ extensionLock: (x) => (x === "probe" ? "Locked by bob." : null) }),
      { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { note: "a", perf: { ANNA: {} } } } });
    const sec = sections(host)[0]!;
    expect(sec.querySelector(".insp-ext-lock")?.textContent).toBe("Locked by bob.");
    expect([...sec.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select, textarea")].every((c) => c.disabled)).toBe(true);
    expect(sec.querySelector(".shell-valuerow-add")?.childElementCount ?? 0).toBe(0); // no Add... on a locked map
  });

  it("disables the rows of a node with no id to write to", () => {
    const host = draw(handlersWith(), { kind: "snippet", id: null });
    expect(rowOf(host, "weight")?.querySelector("input")?.disabled).toBe(true);
  });

  it("says the problems validation would: a renamed stage, a required field, and a key it no longer declares", () => {
    const host = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { act: "opening", cue: { gain: 0.5 }, zzz: 1 } } });
    // One sentence for a renamed stage, not the shell's "not one of the stages" as well.
    expect(rowOf(host, "act")?.querySelector(".shell-fieldrow-problem")?.textContent).toBe("“opening” has been renamed “setup” by Probe. Pick “setup” to update it.");
    expect(rowOf(host, "sound")?.querySelector(".shell-fieldrow-problem")?.textContent).toBe("Required.");
    const undeclared = sections(host)[0]!.querySelector<HTMLElement>(".insp-ext-undeclared")!;
    expect(undeclared.textContent).toBe("zzz1");
    expect(undeclared.querySelector("input")).toBeNull();
    expect(undeclared.dataset["tip"]).toContain("not a field this extension declares");
    // A top-level required field, on a node that has an entry; none on a node that sets nothing.
    const fields = [{ name: "who", type: "text", required: true }, { name: "x", type: "text" }];
    expect(fieldProblems(fields, { x: "a" }).get("who")).toBe("\"who\" is required and not set.");
    expect(fieldProblems(fields, undefined).size).toBe(0);
  });

  it("draws a claimed gameData field with the extension's label, help and value help, and its problem", () => {
    const fields: GameDataField[] = [{ name: "mood", type: "enum", values: ["calm", "tense", "hostile"] } as GameDataField];
    const set: unknown[] = [];
    const h = handlersWith({ gameDataFields: (k) => (k === "line" ? fields : []), setGameData: (_id, _k, v) => { set.push(v); } });
    const host = draw(h, { kind: "leaf", beat: "line", id: "L_1", gameData: { mood: "hostile" } });
    const row = host.querySelector<HTMLElement>(".insp-gd-section:not(.insp-ext-section) .insp-gd-row")!;
    expect(row.querySelector(".shell-fieldrow-label")?.textContent).toBe("Delivery");
    expect(row.querySelector(".shell-fieldrow-purpose")?.textContent).toBe("The line's delivery, as the probe reads it.");
    expect(row.querySelector(".shell-fieldrow-problem")?.textContent).toBe("Probe reads this as calm or tense, so it doesn't know “hostile”.");
    // Still the gameData field: its own values, and a change goes to setGameData.
    const sel = row.querySelector("select")!;
    expect([...sel.options].map((o) => o.value)).toEqual(["", "calm", "tense", "hostile"]);
    sel.value = "calm"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(set).toEqual(["calm"]);
    // The claim follows the setting: with the default, `delivery`, the mood field is the project's own.
    const plain = draw(handlersWith({ gameDataFields: () => fields, extensions: () => probe({}) }), { kind: "leaf", beat: "line", id: "L_1", gameData: { mood: "hostile" } });
    expect(plain.querySelector(".insp-gd-row .shell-fieldrow-label")?.textContent).toBe("mood");
  });

  it("draws and checks a claim that lists no values through the gameData field's own (toolkit's effectiveClaim)", () => {
    // The probe's claim with its values left out, and value help for one the field doesn't declare.
    const open = JSON.parse(probeText) as { targets: { patter: { line: { claims: Record<string, unknown>[] } } } };
    const claim = open.targets.patter.line.claims[0]!;
    delete claim.values;
    claim.valueHelp = { calm: "Unhurried.", whisper: "Barely there." };
    const openProbe = extensionDtos(
      { project: { id: "proj_t", name: "T" }, extensions: { probe: { version: "1.1.0", settings: { deliveryField: "mood" } } } } as unknown as ProjectFile,
      new Map([["probe", parseManifest(JSON.stringify(open))]]), new Map(),
    )!;
    const fields: GameDataField[] = [{ name: "mood", type: "enum", values: ["calm", "tense", "hostile"] } as GameDataField];
    const drawn = (mood: string): HTMLElement => draw(handlersWith({ gameDataFields: (k) => (k === "line" ? fields : []), extensions: () => openProbe }),
      { kind: "leaf", beat: "line", id: "L_1", gameData: { mood } }).querySelector<HTMLElement>(".insp-gd-section:not(.insp-ext-section) .insp-gd-row")!;
    // A value the field declares is fine, drawn with the claim's label and help over the field's values.
    const row = drawn("hostile");
    expect(row.querySelector(".shell-fieldrow-label")?.textContent).toBe("Delivery");
    expect(row.querySelector(".shell-fieldrow-purpose")?.textContent).toBe("The line's delivery, as the probe reads it.");
    expect(row.querySelector(".shell-fieldrow-problem")?.textContent ?? "").toBe("");
    expect([...row.querySelector("select")!.options].map((o) => o.value)).toEqual(["", "calm", "tense", "hostile"]);
    // One it doesn't is refused in the field's words (after the shell's own word on it).
    expect(drawn("shouty").querySelector(".shell-fieldrow-problem")?.textContent).toBe("Probe reads this as calm, tense, or hostile, so it doesn't know “shouty”.");
  });
});

// Pattershot's brief, "extension fields folded" (F1 to F9): an extension's section folded to the fields the node
// sets, by the shell's extensionFold.
describe("the inspector's fold", () => {
  beforeEach(() => { inspectorFold.setOpen("probe", false); });
  const line = (ext?: Record<string, unknown>): unknown => ({ kind: "leaf", beat: "line", id: "L_bell", ...(ext ? { ext: { probe: ext } } : {}) });
  const shown = (host: HTMLElement): string[] =>
    [...host.querySelectorAll<HTMLElement>(".insp-ext-section .shell-fold-body > .shell-fieldrow > .shell-fieldrow-label")].map((l) => l.textContent ?? "");
  const cap = (host: HTMLElement): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".insp-ext-section .insp-gd-cap")!;

  it("is folded to the caption alone where a node sets nothing, defaults included", () => {
    const host = draw(handlersWith(), line({ marks: [], perf: {} }));
    expect(shown(host)).toEqual([]);
    expect(cap(host).textContent).toBe("Probe");
    expect(cap(host).getAttribute("aria-expanded")).toBe("false");
  });

  it("shows only the set fields, counted in the caption, and opens to every field on a click", () => {
    const host = draw(handlersWith(), line({ tone: "tense", perf: { ANNA: { expression: "frown" } } }));
    expect(shown(host)).toEqual(["tone", "perf"]);
    expect(cap(host).textContent).toBe("Probe (2 set)");
    cap(host).click();
    expect(shown(host).length).toBeGreaterThan(2);
    expect(inspectorFold.isOpen("probe")).toBe(true);
    // Open stays open on the next node.
    expect(shown(draw(handlersWith(), line())).length).toBeGreaterThan(2);
  });

  it("keeps a row cleared while folded until the author leaves the node", () => {
    expect(shown(draw(handlersWith(), line({ tone: "tense" })))).toEqual(["tone"]);
    expect(shown(draw(handlersWith(), line({})))).toEqual(["tone"]);   // cleared: redrawn, still there
    const other = { kind: "leaf", beat: "line", id: "L_reply" };
    draw(handlersWith(), other);
    expect(shown(draw(handlersWith(), line({})))).toEqual([]);           // left and back: gone
  });

  it("leaves Project Settings unfolded", () => {
    const x = probe().find((e) => e.id === "probe")!;
    const host = document.createElement("div");
    mountProjectSection(host, { extension: x, adapter, locked: null, onChange: noop });
    expect(host.querySelector(".shell-fold")).toBeNull();
    expect(host.querySelectorAll(".shell-fieldrow").length).toBeGreaterThan(0);
  });
});

describe("a pick", () => {
  const shot = parseManifest(JSON.stringify({
    schema: "wildwinter/extension@0", id: "shot", name: "Shot", version: "1.0.0",
    targets: { patter: {
      line: { fields: [{ name: "to", label: "To", type: "pick", from: [{ words: ["all"] }, { to: "cast" }, { list: "pointsOfInterest" }] }] },
      project: { fields: [{ name: "pointsOfInterest", label: "Points of interest", type: "list", of: { type: "text" } }] },
    } },
  }));
  const shots = (poi: string[]): ExtensionDto[] => extensionDtos(
    { project: { id: "proj_t", name: "T" }, extensions: { shot: { version: "1.0.0" } } } as unknown as ProjectFile,
    new Map([["shot", shot]]),
    new Map([["shot", { entries: { project: { proj_t: { pointsOfInterest: poi } } } }]]),
  )!;
  const options = (row: HTMLElement): string[] =>
    [...row.querySelector("select")!.querySelectorAll("option")].map((o) => o.textContent ?? "");

  it("offers its words, the cast and the extension's project list in the inspector, and checks against them", () => {
    const seen: unknown[] = [];
    const h = handlersWith({ extensions: () => shots(["Gate", "BEN"]), setExtensionValue: (_id, _x, _f, v) => seen.push(v) });
    const host = draw(h, { kind: "leaf", beat: "line", id: "L_bell", ext: { shot: { to: "BEN" } } });
    const row = rowOf(host, "To")!;
    expect(options(row)).toEqual(["auto", "all", "ANNA", "BEN", "Gate"]);
    expect(row.querySelector(".shell-fieldrow-problem")?.textContent).toContain("a cast member and an entry of the list");
    const sel = row.querySelector("select")!;
    sel.value = "Gate"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(seen).toEqual(["Gate"]);
  });

  it("says a value no source holds is missing, and reads the project's lists as Settings holds them, before Save", () => {
    const host = draw(handlersWith({ extensions: () => shots(["Gate"]) }), { kind: "leaf", beat: "line", id: "L_bell", ext: { shot: { to: "Well" } } });
    expect(options(rowOf(host, "To")!)).toContain("Well (missing)");
    expect(rowOf(host, "To")!.querySelector(".shell-fieldrow-problem")?.textContent).toContain("not one of its choices");
    const [x] = shots(["Gate"]);
    expect(extensionScoped(adapter, x!).list!("pointsOfInterest")).toEqual(["Gate"]);
    expect(extensionScoped(adapter, x!, { pointsOfInterest: ["Well"] }).list!("pointsOfInterest")).toEqual(["Well"]);
    expect(extensionScoped(adapter, x!).list!("nowhere")).toBeUndefined();
  });
});

describe("an extension's section of Project Settings", () => {
  it("says what the project takes it at, draws the project's fields, and hands back the whole entry", () => {
    const [x] = probe({ deliveryField: "mood" }, { studio: "Wildwinter" });
    const host = document.createElement("div");
    const seen: Array<Record<string, unknown>> = [];
    mountProjectSection(host, { extension: x!, adapter, locked: null, onChange: (e) => seen.push(e) });
    expect(host.querySelector(".settings-ext-taken")?.textContent).toBe("Taken at 1.1.0. Delivery field: mood.");
    const input = host.querySelector<HTMLInputElement>(".settings-ext-rows input")!;
    expect(input.value).toBe("Wildwinter");
    input.value = "Northwind"; input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen.pop()).toEqual({ studio: "Northwind" });
    input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(seen.pop()).toEqual({});
  });

  it("keeps its rows through inspector redraws while the dialog is open", async () => {
    const [x] = probe({}, { studio: "Wildwinter" });
    const host = document.createElement("div");
    document.body.append(host);
    mountProjectSection(host, { extension: x!, adapter, locked: null, onChange: noop });
    const input = host.querySelector<HTMLInputElement>(".settings-ext-rows input")!;
    input.focus();
    // The inspector redraws (and sweeps its rows) twice while the author is typing in Settings.
    for (let i = 0; i < 2; i++) draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell" });
    input.value = "North"; input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise<void>((r) => queueMicrotask(r));
    expect(host.querySelector(".settings-ext-rows input")).toBe(input);
    expect(document.activeElement).toBe(input);
    host.remove();
  });

  it("is read only where somebody else holds the project's data", () => {
    const [x] = probe();
    const host = document.createElement("div");
    mountProjectSection(host, { extension: x!, adapter, locked: "Locked by bob.", onChange: noop });
    expect(host.querySelector(".insp-ext-lock")?.textContent).toBe("Locked by bob.");
    expect(host.querySelector<HTMLInputElement>(".settings-ext-rows input")!.disabled).toBe(true);
  });
});

describe("where a problem about an extension goes", () => {
  const x = probe();
  const p = (over: Partial<Problem>): Problem => ({ category: "extensions", severity: "warning", message: "m", extension: "probe", ...over });
  it("opens the extension's Settings section for the project's own values, its manifest, or its pin", () => {
    expect(problemSettingsSection(p({ file: "/p/extensions/probe/_project.patterextension" }), x)).toBe("ext-probe");
    expect(problemSettingsSection(p({ file: "/p/extensions/probe.extension.json" }), x)).toBe("ext-probe");
    expect(problemSettingsSection(p({ file: "/p/probe.patterproj" }), x)).toBe("ext-probe");
    expect(problemSettingsSection(p({ nodeId: "proj_t" }), x)).toBe("ext-probe");
  });
  it("leaves one about a node in a scene to Go to issue, and one with no section alone", () => {
    expect(problemSettingsSection(p({ file: "/p/extensions/probe/harbour.patterextension", nodeId: "L_bell" }), x)).toBeNull();
    expect(problemSettingsSection(p({ extension: undefined, file: "/p/probe.patterproj" }), x)).toBeNull();
    expect(problemSettingsSection(p({ extension: "other", file: "/p/probe.patterproj" }), x)).toBeNull();
  });
});

describe("a stage the extension has since renamed", () => {
  it("is said once; a value that names no stage at all keeps the shell's sentence alone", () => {
    const renamed = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { act: "opening" } } });
    const said = rowOf(renamed, "act")!.querySelector<HTMLElement>(".shell-fieldrow-problem")!;
    expect(said.hidden).toBe(false);
    expect(said.textContent).not.toContain("not one of the stages");
    const stray = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { act: "finale" } } });
    expect(rowOf(stray, "act")!.querySelector(".shell-fieldrow-problem")?.textContent).toBe("\"finale\" is not one of the stages.");
    const fine = draw(handlersWith(), { kind: "leaf", beat: "line", id: "L_bell", ext: { probe: { act: "turn" } } });
    expect(rowOf(fine, "act")!.querySelector<HTMLElement>(".shell-fieldrow-problem")!.hidden).toBe(true);
  });
  it("is only a quality value the manifest maps to a stage it still has", () => {
    const act = probe()[0]!.targets["line"]!.fields.find((f) => f.name === "act")!;
    expect(renamedStage(act, "opening")).toEqual({ from: "opening", to: "setup" });
    expect(renamedStage(act, "setup")).toBeUndefined();
    expect(renamedStage(act, "finale")).toBeUndefined();
    expect(renamedStage({ ...act, renamedStages: { opening: "gone" } }, "opening")).toBeUndefined();
  });
});

describe("an extension's problem in the problems bar", () => {
  const ctx: ExtensionProblemContext = {
    extension: (id) => probe().find((x) => x.id === id),
    node: (id) => ({
      L_greet: { kind: "line", label: "BARKEEP: What'll it be, stranger?" },
      T_room: { kind: "text", label: "A low fire spits." },
      b_dock: { kind: "block", label: "Dock" },
      o_stay: { kind: "option", label: "Stay a while" },
    } as Record<string, { kind: string; label: string }>)[id],
  };
  const line = (message: string, detail?: string): string | undefined =>
    extensionProblemLine({ message, extension: "probe", ...(detail ? { detail } : {}) }, ctx);

  it("names the extension, the node in the writer's words, and the field by its label, for each code", () => {
    expect(line("entries.line.L_greet.cue.sound: \"cue.sound\" is required and not set", "required")).toBe("Probe: “What'll it be, stranger?” needs a sound in cue.");
    expect(line("entries.line.L_greet.next: \"next\" names line \"L_x\", which does not exist", "no-such-node")).toBe("Probe: Next on “What'll it be, stranger?” names the line “L_x”, which isn't in the project. Choose another, or clear it.");
    expect(line("entries.line.L_greet.perf.BEN: \"perf.BEN\" is keyed by cast \"BEN\", which does not exist", "no-such-node")).toBe("Probe: BEN in perf on “What'll it be, stranger?” names the cast member “BEN”, which isn't in the project. Choose another, or clear it.");
    expect(line("entries.line.L_greet.weight: \"weight\" should be a number, not text", "wrong-type")).toBe("Probe: Weight on “What'll it be, stranger?” isn't the kind of value Probe expects. Set it again in the inspector.");
    expect(line("entries.line.L_greet.cue.gain: \"cue.gain\" is 2, above the most it may be, 1", "above-max")).toBe("Probe: Gain in cue on “What'll it be, stranger?” is 2, but Probe takes nothing above 1.");
    expect(line("entries.line.L_greet.tone: \"tone\" is \"loud\", which is not one of its values", "not-a-value")).toBe("Probe: Tone on “What'll it be, stranger?” is “loud”, which isn't one of its choices. Pick one in the inspector.");
    expect(line("entries.line.L_greet.act: \"act\" is \"finale\", which is not one of its stages", "not-a-stage")).toBe("Probe: Act on “What'll it be, stranger?” is “finale”, which isn't one of its stages. Pick one in the inspector.");
    expect(line("entries.line.L_greet.act: \"act\" is \"opening\", a stage this extension has since renamed \"setup\"", "renamed-stage")).toBe("Probe: Act on “What'll it be, stranger?” is “opening”, a stage Probe has since renamed “setup”. Pick “setup” to update it.");
    expect(line("entries.line.L_greet.words[1]: \"words[1]\" should be text, not a number", "wrong-type")).toBe("Probe: Item 2 of words on “What'll it be, stranger?” isn't the kind of value Probe expects. Set it again in the inspector.");
    expect(line("entries.line.L_greet.zzz: \"zzz\" is not a field this extension declares; it is kept, and not compiled", "unknown-field")).toBe("Probe: “What'll it be, stranger?” has a value for “zzz”, which Probe doesn't declare any more. It's kept, but your game won't get it.");
    expect(line("entries.block.b_dock.pace: \"pace\" should be a number, not text", "wrong-type")).toBe("Probe: Pace on the block Dock isn't the kind of value Probe expects. Set it again in the inspector.");
    expect(line("entries.text.T_room.style: \"style\" should be text, not a number", "wrong-type")).toBe("Probe: Style on “A low fire spits.” isn't the kind of value Probe expects. Set it again in the inspector.");
    expect(line("entries.option.o_stay.icon: \"icon\" should be text, not a number", "wrong-type")).toBe("Probe: Icon on the option “Stay a while” isn't the kind of value Probe expects. Set it again in the inspector.");
    expect(line("entries.project.proj_t.studio: \"studio\" should be text, not a number", "wrong-type")).toBe("Probe: Studio on the project isn't the kind of value Probe expects. Set it again in the inspector.");
  });

  it("words the pass's own checks: orphans, the wrong scene, the manifest, the pin, and claims", () => {
    expect(line("entries.line.L_gone: an entry for line \"L_gone\", which no longer exists; it is kept, and not compiled", "orphan")).toBe("Probe: There are values for a line that isn't in the project any more. They're kept, but your game won't get them.");
    expect(line("entries.line.L_greet belongs in scene \"scn_b\"'s shard; it's compiled from here all the same")).toBe("Probe: The values for “What'll it be, stranger?” are kept in another scene's file. They're used all the same.");
    expect(extensionProblemLine({ message: "the project takes the Patter extension \"lights\", but has no manifest for it at extensions/lights.extension.json; its data is left as it is, and not compiled", extension: "lights" }, ctx))
      .toBe("This project takes the extension “lights”, but its manifest isn't in the extensions folder. Its data is kept, but your game won't get it.");
    expect(line("the project takes \"probe\" at version 1.0.0, but its manifest is version 1.1.0; run `patter format` to take it (renamed stages are renamed in the data as it does)")).toBe("Probe: The project takes version 1.0.0, but the manifest is version 1.1.0. Run patter format to take the manifest's version.");
    expect(line("the Patter extension \"probe\" claims the line gameData field \"mood\" as enum, but the project declares it as text")).toBe("Probe: It reads the line game data field “mood” as enum, but the project declares it as text. Change the field's type in Project Settings ▸ Game Data so they agree.");
    expect(line("the Patter extension \"probe\" claims the line gameData field \"delivery\", which the project doesn't declare")).toBe("Probe: It reads the line game data field “delivery”, which the project doesn't declare. Add it in Project Settings ▸ Game Data.");
    // A claimed value: the field by the claim's label.
    const claimed: ExtensionProblemContext = { ...ctx, extension: (id) => probe({ deliveryField: "mood" }).find((x) => x.id === id) };
    expect(extensionProblemLine({ message: "line 'L_greet' gameData \"mood\", as the Patter extension \"probe\" claims it: the value is \"hostile\", which is not one of its values", detail: "not-a-value", extension: "probe" }, claimed))
      .toBe("Probe: Delivery on “What'll it be, stranger?” is “hostile”, which isn't one of its choices. Pick one in the inspector.");
  });

  it("words a pick's missing and ambiguous values, and a name two of its sources hold", () => {
    expect(line("entries.line.L_greet.to: \"to\" is \"Gaet\", which is not one of its choices", "not-a-choice")).toBe("Probe: To on “What'll it be, stranger?” is “Gaet”, which isn't one of its choices. Pick one in the inspector.");
    expect(line("entries.line.L_greet.to: \"to\" is \"Gate\", which is a cast member and an entry of the list \"pointsOfInterest\"", "pick-ambiguous"))
      .toBe("Probe: To on “What'll it be, stranger?” is “Gate”, which is a cast member and an entry of the list “pointsOfInterest”, so it's ambiguous. Rename one of them.");
    expect(line("the Patter extension \"probe\": \"Gate\" is a cast member and an entry of the list \"studio\", so a value naming it is ambiguous", "pick-clash"))
      .toBe("Probe: “Gate” is a cast member and an entry of the list “studio”, so a value naming it is ambiguous. Rename one of them.");
  });

  it("shows a shape it doesn't know as it stands, and the bar takes the worded line", () => {
    expect(line("entries.line.L_greet.x: something new", "brand-new")).toBeUndefined();
    const p = { category: "extensions" as const, severity: "error" as const, message: "entries.line.L_greet.cue.sound: \"cue.sound\" is required and not set", detail: "required", extension: "probe" };
    expect(problemLineFor(p, undefined, ctx)).toBe("Probe: “What'll it be, stranger?” needs a sound in cue.");
    expect(problemLineFor({ ...p, detail: "brand-new" }, undefined, ctx)).toBe(p.message);
  });
});
