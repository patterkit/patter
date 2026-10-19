// The action-text plugin (patterkit design/proposals/action-text.md). In a dialogue scene (a line naming a
// character, an option's prompt included), with the project's "Localise text lines in dialogue scenes" off,
// every text beat is action: a direction for whoever stages the scene, never shown to the player. A node
// decoration marks each one `kind-action`, so the stylesheet sets it apart as a screenplay sets a direction.
// An option's prompt is always shown text. The host pushes the setting; the scene's kind follows its cues.

import { Plugin, PluginKey, type EditorState, type Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { Node as PMNode } from "prosemirror-model";
import { BEAT_TYPES, cueText, editsInsideTextblocks } from "../src/zoneutil.js";

interface ActionState {
  /** The project localises a dialogue scene's text (so nothing is action). */
  localise: boolean;
  /** The scene is a dialogue scene. */
  dialogue: boolean;
  decos: DecorationSet;
}

export const actionTextKey = new PluginKey<ActionState>("patterActionText");
const SET_LOCALISE = "patterActionTextLocalise";

/** A dialogue scene: some line, a prompt's included, names a character. */
function isDialogue(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === "line") { if (cueText(node).trim()) found = true; return false; }
    return !BEAT_TYPES.has(node.type.name);
  });
  return found;
}

/** One node decoration per action text beat: a snippet's prose, never an option prompt's. */
function build(doc: PMNode, action: boolean): DecorationSet {
  if (!action) return DecorationSet.empty;
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "optionprompt") return false;
    if (!BEAT_TYPES.has(node.type.name)) return true;
    if (node.type.name === "prose") decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "kind-action" }));
    return false;
  });
  return DecorationSet.create(doc, decos);
}

const stateFor = (doc: PMNode, localise: boolean): ActionState => {
  const dialogue = isDialogue(doc);
  return { localise, dialogue, decos: build(doc, !localise && dialogue) };
};

export function actionTextPlugin(localise = false): Plugin<ActionState> {
  return new Plugin<ActionState>({
    key: actionTextKey,
    state: {
      init: (_config, state) => stateFor(state.doc, localise),
      apply: (tr, prev, _old, state) => {
        const set = tr.getMeta(SET_LOCALISE) as boolean | undefined;
        if (set !== undefined) return stateFor(state.doc, set);
        if (!tr.docChanged) return prev;
        // Typing can name a scene's first speaker, or clear its last: the kind is checked on every change, and
        // only typing that leaves it as it was is mapped.
        const dialogue = isDialogue(state.doc);
        if (dialogue === prev.dialogue && editsInsideTextblocks(tr)) return { ...prev, decos: prev.decos.map(tr.mapping, tr.doc) };
        return { localise: prev.localise, dialogue, decos: build(state.doc, !prev.localise && dialogue) };
      },
    },
    props: { decorations: (state) => actionTextKey.getState(state)?.decos },
  });
}

/** A transaction that hands the plugin the project's "Localise text lines in dialogue scenes" setting. */
export function setLocaliseDialogueText(state: EditorState, localise: boolean): Transaction {
  return state.tr.setMeta(SET_LOCALISE, localise);
}
