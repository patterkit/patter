// A small playable vignette for the player, built to show off the flow model:
//
//   - block-as-a-run    : "open" / "well_seq" / "farewell" each play several
//                         snippets in order (gather), not pick-one.
//   - call-return tunnel: "toll" is a shared block CALLED from two places (the
//                         opening and the well); it runs, then returns to the
//                         next snippet in the caller. The toll # makes the
//                         return visible.
//   - jumps             : open -> menu, the well loop back to menu, leave -> farewell.
//   - gather            : either farewell option runs its line, then both
//                         continue to the shared closing line.
//   - conditional run-group: the "wet" group only appears once you've looked in
//                         the well.
//
// One scene, navigated entirely by jumps. Interpolation shows @name and the
// live @bell_tolls counter.

import type { ProjectFile, Scene, LocaleFile, Snippet, Group } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "demo", name: "The Curfew Bell" },
  locales: { default: "en", all: ["en"] },
  voiced: false,
  properties: [
    { name: "name", type: "string", shared: true, default: "Mara" },
    { name: "bell_tolls", type: "number", shared: true, default: 0 },
  ],
  cast: [{ name: "WATCHMAN" }, { name: "BELL" }],
};

// tiny builders to keep the tree readable
const line = (id: string, beat: string, character: string, jump?: Snippet["jump"]): Snippet =>
  ({ id, type: "snippet", beats: [{ id: beat, kind: "line", character }], ...(jump ? { jump } : {}) });
const text = (id: string, beat: string, jump?: Snippet["jump"]): Snippet =>
  ({ id, type: "snippet", beats: [{ id: beat, kind: "text" }], ...(jump ? { jump } : {}) });
const goto = (id: string, jump: Snippet["jump"]): Snippet => ({ id, type: "snippet", jump });

const square: Scene = {
  id: "square", type: "scene", name: "The Square",
  blocks: [
    // A block is a RUN: these three snippets play in order.
    { id: "open", type: "block", name: "Arrival", children: [
      text("oa", "T_open1"),                                                       // gather ->
      line("ob", "L_watch", "WATCHMAN", { to: "toll", mode: "call" }),             // CALL the bell, return ->
      text("oc", "T_open2", { to: "menu", mode: "jump" }),                         // runs AFTER the toll returns
    ] },

    // The shared tunnel. Called from "open" and from the well; it returns each time.
    { id: "toll", type: "block", name: "The Bell", children: [
      { id: "ot", type: "snippet",
        onEnter: [{ kind: "set", target: "@bell_tolls", value: "@bell_tolls + 1" }],
        beats: [{ id: "L_bell", kind: "line", character: "BELL" }] },                // no jump -> returns
    ] },

    // The hub. A conditional run-group, then a choice that loops back / leaves.
    { id: "menu", type: "block", name: "The Square", children: [
      { id: "wet", type: "group", condition: "seen('well_seq')", children: [         // run-group, gated by a visit count
        text("wt", "T_wet"),
      ] } as Group,
      { id: "pick", type: "group", selector: "choice", children: [
        { id: "opt_well", type: "group", prompt: { id: "CT_well", kind: "text" }, children: [{ id: "opt_well_c", type: "snippet", jump: { to: "well_seq", mode: "jump" } }] },
        { id: "opt_leave", type: "group", prompt: { id: "CT_leave", kind: "text" }, children: [{ id: "opt_leave_c", type: "snippet", jump: { to: "farewell", mode: "jump" } }] },
      ] } as Group,
    ] },

    // A RUN reached by the well option: line -> CALL the bell -> text -> loop back.
    { id: "well_seq", type: "block", name: "The Well", children: [
      { id: "w1", type: "snippet", beats: [{ id: "L_well", kind: "line", character: "WATCHMAN" }] },
      goto("w2", { to: "toll", mode: "call" }),                                      // bell tolls again
      text("w3", "T_well2", { to: "menu", mode: "jump" }),                           // loop to the hub
    ] },

    // GATHER: either option runs its own line, then both continue to the close.
    { id: "farewell", type: "block", name: "Leaving", children: [
      { id: "bye", type: "group", selector: "choice", children: [
        { id: "opt_wave", type: "group", prompt: { id: "CT_wave", kind: "text" }, children: [
          { id: "opt_wave_c", type: "snippet", beats: [{ id: "L_wave", kind: "line", character: "WATCHMAN" }] } ] },  // no jump -> gather
        { id: "opt_slip", type: "group", prompt: { id: "CT_slip", kind: "text" }, children: [
          { id: "opt_slip_c", type: "snippet", beats: [{ id: "T_slip", kind: "text" }] } ] },                        // no jump -> gather
      ] } as Group,
      text("close", "T_close", { to: "END", mode: "jump" }),                         // the gather target
    ] },
  ],
};

const en: LocaleFile = {
  schema: "patter/strings@0", scene: "square", locale: "en",
  strings: {
    T_open1: "The market square lies empty at dusk.",
    L_watch: "Evening, {@name}. Mind the curfew bell.",
    L_bell: "DONG - the curfew bell tolls. (toll #{@bell_tolls})",
    T_open2: "Its echo fades, and the square falls still again.",
    T_wet: "Cold well-water still beads along your sleeve.",
    CT_well: "Look into the old well",
    CT_leave: "Leave the square",
    L_well: "You lean over the cold lip of the old well. The dark below breathes up at you.",
    T_well2: "You step back, the water's chill still on your skin.",
    CT_wave: "Wave to the watchman",
    CT_slip: "Slip away quietly",
    L_wave: "You raise a hand; the watchman returns the smallest of nods.",
    T_slip: "You melt into the shadow of the well-house, unseen.",
    T_close: "And so {@name} leaves the square to the bell and the dark.",
  },
};

export const demoInput = { project, scenes: [square], locales: [en] };
