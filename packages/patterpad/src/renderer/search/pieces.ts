// The drawn pieces of the search window: the hint line under the results (what this mode does, and
// the keys that drive it) and a result's location trail. The keys are the shell's hint bar (keycap +
// word per key, drawn platform-true, nothing typed between) and the trail is the shell's breadcrumb
// (drawn chevrons, never "scene › block" typed). Split out of search.ts so they can be tested without
// the window.

import { hintBar, breadcrumb } from "@wildwinter/app-shell";
import type { SearchMode } from "../../shared/api.js";

const MOVE = { keys: "Up Down", label: "Move" };
const JUMP = { keys: "Enter", label: "Jump" };
const CLOSE = { keys: "Esc", label: "Close" };

const lead = (text: string): HTMLElement => {
  const s = document.createElement("span");
  s.className = "swin-hint-lead";
  s.textContent = text;
  return s;
};

/** The hint's children for `mode`: a lead phrase where the mode needs one, then the key bar.
 *  Replace mode is a sentence, not a hint: it has no keys to show. */
export function modeHint(mode: SearchMode): HTMLElement[] {
  switch (mode) {
    case "status": return [lead("Pick a writing status, then type to filter"), hintBar([MOVE, JUMP])];
    case "recording": return [lead("Pick a recording status, then type to filter"), hintBar([MOVE, JUMP])];
    case "tag": return [lead("Pick a tag, then type to filter"), hintBar([MOVE, JUMP])];
    case "property": return [lead("Find where a property is used"), hintBar([MOVE, JUMP])];
    case "replace": return [lead("Replaces dialogue, narration and choice text across every scene. Review, then Replace all.")];
    default: return [hintBar([MOVE, JUMP, CLOSE]), lead("Drag the bar to move this window")];
  }
}

/** A result's location (scene, block) as a breadcrumb trail. The crumbs are plain: the row itself is
 *  the control that goes there. */
export function locationCrumbs(location: string[]): HTMLElement {
  return breadcrumb(location);
}
