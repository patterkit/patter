// ---------------------------------------------------------------------------
// Line padding (design/proposals/line-padding.md): the pause after a line or text beat, `padAfter`, in
// seconds. A beat without its own takes the nearest `padAfterDefault` above it (snippet, then each group,
// innermost first, then block, then scene), else the project's, else DEFAULT_PAD_AFTER. A snippet's last
// line or text beat can't be cut in on (what follows the seam isn't certain), so a negative value there is
// clamped to zero. A negative pause before a game event is fine: the event starts as the line ends.
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
/** A pause value as a bundle holds it: a number, or nothing (anything else, which validation refuses, inherits). */
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function buildPadIndex(bundle: Bundle): Map<string, BeatPad> {
  const index = new Map<string, BeatPad>();
  const set = (beat: Beat, inherited: number, clamp: boolean): void => {
    const own = beat.kind === "gameEvent" ? undefined : num(beat.padAfter);
    let resolved = own ?? inherited;
    if (clamp && resolved < 0) resolved = 0;
    index.set(beat.id, own !== undefined ? { own, resolved } : { resolved });
  };
  const visit = (node: CompiledGroup | CompiledSnippet, inherited: number): void => {
    const def = num(node.padAfterDefault) ?? inherited;
    if (node.type === "group") {
      if (node.prompt) set(node.prompt, def, false);
      for (const child of node.children) visit(child, def);
      return;
    }
    const beats = node.beats ?? [];
    let last = -1;
    beats.forEach((b, i) => { if (spoken(b)) last = i; });
    beats.forEach((b, i) => { if (spoken(b)) set(b, def, i === last); });
  };
  const projectDefault = num(bundle.padAfterDefault) ?? DEFAULT_PAD_AFTER;
  for (const scene of Object.values(bundle.scenes)) {
    const sceneDefault = num(scene.padAfterDefault) ?? projectDefault;
    for (const block of scene.blocks) {
      const blockDefault = num(block.padAfterDefault) ?? sceneDefault;
      for (const child of block.children) visit(child, blockDefault);
    }
  }
  return index;
}
