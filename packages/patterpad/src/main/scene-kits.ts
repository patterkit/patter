// ---------------------------------------------------------------------------
// Scene kits: what New Scene can start from (storylet-studio design/kit-gallery.md,
// section 7a, approved by the author 2026-09-27). Each lands a scene that plays,
// and each teaches one chapter of the model by using it: a kit is a copied
// starting point, yours the moment it lands, with no reference to the kit left
// in the files.
//
// Pure: it builds the scene and its default-locale strings, and createScene
// (project.ts) writes them. Here rather than in core because only Patterpad
// offers kits; core's planScene is the scaffold another TOOL asks for.
//
// Who speaks: a line must name a member of the project cast (validated), so a
// kit with lines takes the speaker the author chose in New Scene's panel, and
// createScene adds that name to the cast when it is new. Blank has no lines.
// ---------------------------------------------------------------------------

import type { Beat, Group, Scene, Snippet } from "@patterkit/model";
import { newId } from "@patterkit/core";
import type { SceneKitId } from "../shared/api.js";

/** Every kit, in gallery order. Blank first, as at every scale in both apps. */
export const SCENE_KITS = ["blank", "conversation", "hub", "barks", "cutscene"] as const satisfies readonly SceneKitId[];
export type SceneKit = SceneKitId;

/** Whether a kit writes lines, and so needs a speaker from the cast. */
export const kitNeedsSpeaker = (kit: SceneKit): boolean => kit !== "blank";

export interface BuiltScene {
  scene: Scene;
  /** Beat and prompt id -> its text, for the default locale's strings shard. */
  strings: Record<string, string>;
}

/** Build a kit's scene. `speaker` is required by every kit but Blank. */
export function buildSceneKit(kit: SceneKit, name: string, speaker?: string): BuiltScene {
  if (kitNeedsSpeaker(kit) && !speaker?.trim()) throw new Error(`the ${kit} kit needs a speaker`);
  const who = speaker?.trim() ?? "";
  const strings: Record<string, string> = {};
  const words = (id: string, text: string): string => { strings[id] = text; return id; };

  const line = (text: string, direction?: string): Beat =>
    ({ id: words(newId("L"), text), kind: "line", character: who, ...(direction ? { direction } : {}) });
  const narration = (text: string): Beat => ({ id: words(newId("T"), text), kind: "text" });
  const snippet = (beats: Beat[], to?: string): Snippet =>
    ({ id: newId("sn"), type: "snippet", beats, ...(to ? { jump: { to } } : {}) });
  const option = (prompt: string, children: Snippet[], flags: { sticky?: boolean } = {}): Group =>
    ({ id: newId("opt"), type: "group", prompt: { id: words(newId("C"), prompt), kind: "text" }, children, ...flags });
  const choice = (options: Group[]): Group => ({ id: newId("g"), type: "group", selector: "choice", children: options });
  const block = (blockName: string, children: Array<Group | Snippet>, id = newId("blk")) =>
    ({ id, type: "block" as const, name: blockName, children });

  let blocks: Scene["blocks"];
  switch (kit) {
    case "blank":
      blocks = [block("Main", [snippet([narration("A new scene.")], "END")])];
      break;

    // A line, a choice of two answers, and the talk gathering back after either: an option with
    // no jump falls through to whatever follows the choice. The first answer is once-only (the
    // default); the second is sticky, so it would still be offered if the scene came round again.
    case "conversation":
      blocks = [block("Main", [
        snippet([line("You look like you've come a long way.")]),
        choice([
          option("Tell them about the road", [snippet([line("Rough, was it? It always is, this time of year.")])]),
          option("Say nothing", [snippet([narration("You shrug. They let it go.")])], { sticky: true }),
        ]),
        snippet([line("Well. You're here now.")], "END"),
      ])];
      break;

    // The hub: every topic jumps back to the top of the block, so the menu returns after each
    // answer. Topics are once-only, so each drops off the menu once asked; goodbye is sticky, so
    // there is always a way out.
    case "hub": {
      const hub = newId("blk");
      blocks = [block("Talk", [
        snippet([line("What do you want to know?")]),
        choice([
          option("Ask about the town", [snippet([line("Quiet, mostly. Quieter than it was.")], hub)]),
          option("Ask about the work", [snippet([line("There's always work, if you don't mind the hours.")], hub)]),
          option("Say goodbye", [snippet([line("Safe travels.")], "END")], { sticky: true }),
        ]),
      ], hub)];
      break;
    }

    // Barks: one line drawn from four each time the scene plays. Shuffled, so the same line never
    // comes twice in a row; repeating, so it never runs dry; shared, so two characters playing
    // these barks draw from one deck rather than saying the same thing at once.
    case "barks":
      blocks = [block("Main", [
        {
          id: newId("g"), type: "group", selector: "sequence", shared: true,
          options: { order: "shuffle", exhaust: "repeat" },
          children: [
            snippet([line("Keep moving.")]),
            snippet([line("Nothing to see here.")]),
            snippet([line("Mind how you go.")]),
            snippet([line("Long day. Longer night.")]),
          ],
        },
        { id: newId("sn"), type: "snippet", jump: { to: "END" } },
      ])];
      break;

    // A scripted exchange: lines in order, a direction for the actor, and game events carrying
    // the cues the game acts on (the Game Data is the host's to read; Play lists each as it fires).
    case "cutscene":
      blocks = [block("Main", [snippet([
        { id: newId("E"), kind: "gameEvent", gameData: { camera: "wide" } },
        narration("Rain on the harbour. A lamp gutters in the wind."),
        line("You shouldn't have come back.", "quietly, without turning round"),
        { id: newId("E"), kind: "gameEvent", gameData: { animation: "turn-to-face" } },
        line("But since you're here, you might as well hear it."),
        { id: newId("E"), kind: "gameEvent", gameData: { camera: "close-up" } },
      ], "END")])];
      break;
  }

  return { scene: { id: newId("scn"), type: "scene", name, blocks }, strings };
}
