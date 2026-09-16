// Live debug link control (#181): the bottom-right chip that controls the localhost server an external
// Patterplay game streams its cursor into. The chip itself (the coloured "connect" icon that toggles the
// link, the copiable ws:// address, the four states and their tips) is the shell's `mountLinkStatus`
// (ui-review-2026-09, finding 27): Storyletter's live-link.ts was this file character for character.
// What is Patterpad's is the flow picker, shown when a game reports more than one live flow, and the
// bridge the chip toggles through. The playhead itself still rides the play:mark path.

import type { DebugStatus } from "../../shared/api.js";
import { el, mountLinkStatus } from "@wildwinter/app-shell";

export interface DebugLink {
  /** Show / hide the control (shown when a project is open). Re-queries the current status when shown. */
  setVisible(on: boolean): void;
  /** Toggle the link on / off (the Play-menu command + the icon click route here). */
  toggle(): void;
}

export function mountDebugLink(): DebugLink {
  const flow = el("select", "linkstatus-flow"); flow.hidden = true;
  const chip = mountLinkStatus(document.body, {
    // Start when off or failed, stop otherwise. The reply is applied HERE rather than returned, so the
    // flow picker follows it as well as the chip.
    onToggle: (current) => {
      const next = current.state === "off" || current.state === "error" ? window.patter.debugStart() : window.patter.debugStop();
      void next.then(apply);
    },
    lead: [flow],
  });

  const apply = (s: DebugStatus): void => {
    chip.apply(s);
    // Flow picker only when a game is connected with more than one live flow.
    if (s.state === "connected" && s.flows.length > 1) {
      flow.replaceChildren(...s.flows.map((f) => { const o = el("option", undefined, f); o.value = f; o.selected = f === s.following; return o; }));
      flow.dataset["tip"] = "Which live flow the editor follows";
      flow.hidden = false;
    } else flow.hidden = true;
  };

  flow.addEventListener("change", () => window.patter.debugFollow(flow.value));
  window.patter.onDebugStatus(apply);

  return {
    setVisible(on: boolean): void { chip.setVisible(on); if (on) void window.patter.debugStatus().then(apply); },
    toggle(): void { chip.toggle(); },
  };
}
