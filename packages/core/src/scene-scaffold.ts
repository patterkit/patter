// ---------------------------------------------------------------------------
// A stub scene for another tool to hand a writer: Storyletter asks for one when
// a card in a box Patter performs has no scene yet (storylet-studio design,
// Reboot 10). The scene is named after the card, its address pinned to the
// card's gameId, and it follows the pairing rule the game uses: a card with one
// outcome needs no choice (reaching the end reaches it), and a card with
// several gets one option per outcome, labelled with that outcome's gameId in
// its Game Data, so every branch says which outcome it reached.
//
// Here in core rather than ops because it is pure and small: another tool can
// take it without ops' exporters (pdfkit, docx, exceljs). It returns the files
// as PROJECT-RELATIVE paths and canonical content; the caller writes them,
// through its own version-control layer, exactly as Patterpad's New Scene does.
// ---------------------------------------------------------------------------

import type { FlowFile, Group, LocaleFile, Scene, Snippet } from "@patterkit/model";
import { slug } from "./handle.js";
import { newId } from "./ids.js";
import { canonicalStringify } from "./serialize.js";

export interface SceneScaffold {
  /** The scene's name: the card's title. */
  name: string;
  /** The scene's address, pinned: the card's gameId, so the pairing never depends on the name. */
  gameId: string;
  /** The opening narration: the card's purpose, say. A prompt to write the scene when absent. */
  opening?: string;
  /** The card's outcomes: `gameId` labels an option, `title` is its words. */
  outcomes: ReadonlyArray<{ gameId: string; title?: string }>;
}

export interface ScenePlanTarget {
  /** The project's layout (`ProjectFile.layout`); Patter's defaults when absent. */
  layout?: { flow?: string; strings?: string };
  /** The project's default locale: the strings go there. */
  locale: string;
  /** File stems already taken in the flow folder, so the new one doesn't collide. */
  takenStems: ReadonlySet<string>;
}

export interface ScenePlan {
  sceneId: string;
  /** Project-relative paths and canonical content: the flow shard, then its strings. */
  writes: { path: string; content: string }[];
}

const trimSlash = (p: string): string => p.replace(/\/+$/, "");

/** Plan a stub scene for a card. Pure: nothing is read or written. */
export function planScene(target: ScenePlanTarget, scaffold: SceneScaffold): ScenePlan {
  const base = slug(scaffold.gameId) || slug(scaffold.name) || "scene";
  let stem = base;
  for (let n = 2; target.takenStems.has(stem); n++) stem = `${base}-${n}`;

  const strings: Record<string, string> = {};
  const say = (prefix: string, text: string): { id: string; kind: "text" } => {
    const id = newId(prefix);
    strings[id] = text;
    return { id, kind: "text" };
  };

  const opening: Snippet = {
    id: newId("sn"), type: "snippet",
    beats: [say("T", scaffold.opening?.trim() || `Write the scene for "${scaffold.name}" here.`)],
  };
  const children: Array<Group | Snippet> = [opening];
  if (scaffold.outcomes.length <= 1) {
    // One outcome: the scene just ends, and the end reaches it.
    opening.jump = { to: "END" };
  } else {
    children.push({
      id: newId("g"), type: "group", selector: "choice",
      children: scaffold.outcomes.map((o): Group => ({
        id: newId("opt"), type: "group",
        prompt: say("L", o.title?.trim() || o.gameId),
        gameData: { outcome: o.gameId },
        children: [{
          id: newId("sn"), type: "snippet",
          beats: [say("T", "What happens next.")],
          jump: { to: "END" },
        }],
      })),
    } as Group);
  }

  const sceneId = newId("scn");
  const scene: Scene = {
    id: sceneId, type: "scene", name: scaffold.name, gameId: scaffold.gameId,
    blocks: [{ id: newId("blk"), type: "block", name: "Main", children }],
  };
  const flow: FlowFile = { schema: "patter/flow@0", scene };
  const locale: LocaleFile = { schema: "patter/strings@0", scene: sceneId, locale: target.locale, default: true, strings };
  const flowDir = trimSlash(target.layout?.flow ?? "scenes/");
  const stringsDir = trimSlash(target.layout?.strings ?? "loc/");
  return {
    sceneId,
    writes: [
      { path: `${flowDir}/${stem}.patterflow`, content: canonicalStringify(flow) },
      { path: `${stringsDir}/${target.locale}/${stem}.patterloc`, content: canonicalStringify(locale) },
    ],
  };
}
