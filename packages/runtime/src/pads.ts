// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): the pause after a line or text beat, `padAfter`, in
// seconds. A beat without its own takes the nearest `padAfterDefault` above it (snippet, then each group,
// innermost first, then block, then scene), else the project's, else DEFAULT_PAD_AFTER. A cut-in needs a
// line to cut in with: a beat can be negative only when the very next beat in its snippet is a line or text
// beat. So a snippet's last line or text beat (what follows the seam isn't certain) and one followed by a game
// event (a cut-in can't cross the event) are clamped to zero.
//
// Like the tag index, the resolution depends only on where a beat sits, so it is worked out ONCE per bundle
// into a flat `beat id -> pad` index. An option's prompt is the head of its option's run: it resolves through
// the option, and is never clamped (its reply is certain).
// ---------------------------------------------------------------------------

import { DEFAULT_PAD_AFTER } from "@patterkit/model";
import type { Beat, Bundle, CompiledGroup, CompiledSnippet } from "@patterkit/model";

/** A beat's own `padAfter` (when it sets one) and its resolved one (always). */
export interface BeatPad {
  own?: number;
  resolved: number;
}

const spoken = (b: Beat): boolean => b.kind === "line" || b.kind === "text";

export function buildPadIndex(bundle: Bundle): Map<string, BeatPad> {
  const index = new Map<string, BeatPad>();
  const set = (beat: Beat, inherited: number, clamp: boolean): void => {
    const own = beat.kind === "gameEvent" ? undefined : beat.padAfter;
    let resolved = own ?? inherited;
    if (clamp && resolved < 0) resolved = 0;
    index.set(beat.id, own !== undefined ? { own, resolved } : { resolved });
  };
  const visit = (node: CompiledGroup | CompiledSnippet, inherited: number): void => {
    const def = node.padAfterDefault ?? inherited;
    if (node.type === "group") {
      if (node.prompt) set(node.prompt, def, false);
      for (const child of node.children) visit(child, def);
      return;
    }
    const beats = node.beats ?? [];
    beats.forEach((b, i) => {
      const next = beats[i + 1];
      if (spoken(b)) set(b, def, !(next && spoken(next)));
    });
  };
  const projectDefault = bundle.padAfterDefault ?? DEFAULT_PAD_AFTER;
  for (const scene of Object.values(bundle.scenes)) {
    const sceneDefault = scene.padAfterDefault ?? projectDefault;
    for (const block of scene.blocks) {
      const blockDefault = block.padAfterDefault ?? sceneDefault;
      for (const child of block.children) visit(child, blockDefault);
    }
  }
  return index;
}
