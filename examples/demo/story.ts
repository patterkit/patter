// The shared "API demo" flow - deliberately small, but it exercises the runtime
// surface every Patterplay port must support: a spoken line (with a resolved
// character name), a narrated text beat, a choice with two options, an effect that
// sets a property, and `{@ref}` interpolation reading that property back. Every
// runtime's demo plays THIS same flow, so they can be compared side by side.

import type { ProjectFile, Scene, LocaleFile } from "@patterkit/model";

const project: ProjectFile = {
  schema: "patter/project@0",
  project: { id: "demo", name: "Patter API Demo" },
  locales: { default: "en", all: ["en"] },
  properties: [{ name: "gold", type: "number", shared: true, default: 0 }],
  cast: [{ name: "GUIDE", displayName: "Guide" }],
};

const demo: Scene = {
  id: "demo", type: "scene", name: "Demo",
  blocks: [
    { id: "start", type: "block", name: "Start", children: [
      { id: "s_intro", type: "snippet", beats: [
        { id: "L_welcome", kind: "line", character: "GUIDE" },
        { id: "T_fork", kind: "text" },
      ], jump: { to: "fork" } },
    ] },

    // A choice: two option groups, each with a prompt + content, both gathering to "outro".
    { id: "fork", type: "block", name: "Fork", children: [
      { id: "g_fork", type: "group", selector: "choice", children: [
        { id: "opt_left", type: "group", prompt: { id: "C_left", kind: "text" }, children: [
          { id: "left_c", type: "snippet",
            onEnter: [{ kind: "set", target: "@gold", value: "@gold + 5" }],   // an effect
            beats: [{ id: "L_found", kind: "line", character: "GUIDE" }],
            jump: { to: "outro" } },
        ] },
        { id: "opt_right", type: "group", prompt: { id: "C_right", kind: "text" }, children: [
          { id: "right_c", type: "snippet",
            beats: [{ id: "L_empty", kind: "line", character: "GUIDE" }],
            jump: { to: "outro" } },
        ] },
      ] },
    ] },

    { id: "outro", type: "block", name: "Outro", children: [
      { id: "s_outro", type: "snippet", beats: [{ id: "T_leave", kind: "text" }], jump: { to: "END" } },
    ] },
  ],
};

const en: LocaleFile = {
  schema: "patter/strings@0", scene: "demo", locale: "en",
  strings: {
    L_welcome: "Welcome, traveller.",
    T_fork: "The road forks ahead.",
    C_left: "Take the left path",
    C_right: "Take the right path",
    L_found: "You find a pouch of 5 gold!",
    L_empty: "The path is quiet and empty.",
    T_leave: "You walk on, {@gold} gold the richer.",
  },
};

export const demoInput = { project, scenes: [demo], locales: [en] };
