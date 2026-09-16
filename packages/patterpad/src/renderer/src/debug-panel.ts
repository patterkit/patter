// Live debug link control (#181). A compact status chip in the bottom-right corner that controls the
// localhost server an external Patterplay game streams its cursor into. It replaces the old modeless card:
// ALL the state collapses to one coloured "connect" icon - click it to toggle the link (off → listening →
// stop) - and when the link is live the copiable ws:// address sits beside it (a flow picker appears too
// when more than one flow is live). The playhead itself still rides the existing play:mark path; this is
// purely the control + status.

import type { DebugStatus } from "../../shared/api.js";
import { el } from "./dom.js";
import { iconNode } from "@wildwinter/app-shell"; // the vocabulary's "connect" (a plug), one source for the suite

export interface DebugLink {
  /** Show / hide the control (shown when a project is open). Re-queries the current status when shown. */
  setVisible(on: boolean): void;
  /** Toggle the link on / off (the Play-menu command + the icon click route here). */
  toggle(): void;
}

export function mountDebugLink(): DebugLink {
  const wrap = el("div", "debuglink"); wrap.hidden = true;
  const flow = el("select", "debuglink-flow") as HTMLSelectElement; flow.hidden = true;
  const url = el("button", "debuglink-url") as HTMLButtonElement; url.type = "button"; url.hidden = true;
  const toggle = el("button", "debuglink-toggle off") as HTMLButtonElement; toggle.type = "button"; toggle.append(iconNode("connect"));
  wrap.append(flow, url, toggle);
  document.body.append(wrap);

  let status: DebugStatus = { state: "off" };

  const tipFor = (s: DebugStatus): string =>
    s.state === "off" ? "Live Link is off. Click to start listening."
    : s.state === "error" ? `Live Link failed (${s.message}). Click to retry.`
    : s.state === "listening" ? "Live Link is listening for a game. Click to stop."
    : `Live Link is connected${s.project ? ` to ${s.project}` : ""}${s.build === "stale" ? " on a different build, so save or rebuild to re-sync" : s.build === "match" ? " and in sync" : ""}. Click to stop.`;

  const render = (): void => {
    const stateClass = (status.state === "off" || status.state === "error") ? "off"
      : status.state === "listening" ? "listening"
      : status.build === "stale" ? "stale" : "live";
    toggle.className = `debuglink-toggle ${stateClass}`;
    toggle.dataset.tip = tipFor(status);
    toggle.setAttribute("aria-label", tipFor(status));

    // The copiable address is meaningful once the server is up (listening or connected).
    if (status.state === "listening" || status.state === "connected") {
      url.textContent = `ws://127.0.0.1:${status.port}`;
      url.dataset.tip = "Click to copy the live link address";
      url.hidden = false;
    } else url.hidden = true;

    // Flow picker only when a game is connected with more than one live flow.
    if (status.state === "connected" && status.flows.length > 1) {
      flow.replaceChildren();
      for (const f of status.flows) { const o = el("option", undefined, f) as HTMLOptionElement; o.value = f; if (f === status.following) o.selected = true; flow.append(o); }
      flow.dataset.tip = "Which live flow the editor follows";
      flow.hidden = false;
    } else flow.hidden = true;
  };

  const apply = (s: DebugStatus): void => { status = s; render(); };

  toggle.addEventListener("click", () => {
    if (status.state === "off" || status.state === "error") void window.patter.debugStart().then(apply);
    else void window.patter.debugStop().then(apply);
  });
  url.addEventListener("click", () => {
    const addr = url.textContent ?? "";
    if (!addr) return;
    void navigator.clipboard.writeText(addr);
    url.classList.add("copied"); setTimeout(() => url.classList.remove("copied"), 1000);
  });
  flow.addEventListener("change", () => window.patter.debugFollow(flow.value));
  window.patter.onDebugStatus(apply);

  return {
    setVisible(on: boolean): void { wrap.hidden = !on; if (on) void window.patter.debugStatus().then(apply); },
    toggle(): void { toggle.click(); },
  };
}
