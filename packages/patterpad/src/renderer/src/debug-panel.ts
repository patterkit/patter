// Live debug link control (#181): the bottom-right chip that controls the localhost server an external
// Patterplay game streams its cursor into. The chip itself (the coloured "connect" icon that toggles the
// link, the copiable ws:// address, the four states and their tips) is the shell's `mountLinkStatus`
// (ui-review-2026-09, finding 27): Storyletter's live-link.ts was this file character for character.
// What is Patterpad's is the flow picker, shown when a game reports more than one live flow, and the
// bridge the chip toggles through. The playhead itself still rides the play:mark path.
//
// The picker is a button in the chip naming the flow followed, which opens the shell's anchored popover
// (the one Project settings' colour swatches use) holding a menu in the editor's action-menu vocabulary:
// a tick column, sentence-case captions, a separator. "Most recent" heads it; below, the flows grouped by
// prefix (debug-flows.ts), each with its current scene in a second, quieter column. It re-renders in
// place while open, as flows open, close, and move between scenes.

import type { DebugStatus } from "../../shared/api.js";
import { el, iconNode, mountLinkStatus } from "@wildwinter/app-shell";
import { openPopover } from "@wildwinter/app-shell/context-menu";
import { groupFlows, shortFlowName } from "./debug-flows.js";

export interface DebugLink {
  /** Show / hide the control (shown when a project is open). Re-queries the current status when shown. */
  setVisible(on: boolean): void;
  /** Toggle the link on / off (the Play-menu command + the icon click route here). */
  toggle(): void;
}

export interface DebugLinkOptions {
  /** A scene's display name by id, for the picker; undefined shows the id. */
  sceneName: (sceneId: string) => string | undefined;
}

type Connected = Extract<DebugStatus, { state: "connected" }>;

export function mountDebugLink(opts: DebugLinkOptions): DebugLink {
  const trigger = el("button", "linkstatus-flow");
  trigger.type = "button"; trigger.hidden = true;
  trigger.setAttribute("aria-haspopup", "menu");
  const chip = mountLinkStatus(document.body, {
    // The word beside the plug, as Storyletter's chip has it: a bare icon in the corner said nothing to
    // anyone who had not already met it. Capitalised as the Play menu shows it (house style rule 19).
    label: "Live Link",
    // Start when off or failed, stop otherwise. The reply is applied HERE rather than returned, so the
    // flow picker follows it as well as the chip.
    onToggle: (current) => {
      const next = current.state === "off" || current.state === "error" ? window.patter.debugStart() : window.patter.debugStop();
      void next.then(apply);
    },
    lead: [trigger],
  });

  let shown: Connected | null = null;          // the status the picker draws, while it has one to draw
  let menu: HTMLElement | null = null;         // the open popover's menu, re-rendered as the status moves
  let closeMenu: (() => void) | null = null;

  const choose = (flow: string | null): void => { closeMenu?.(); window.patter.debugFollow(flow); };

  /** One menu row: the tick column, the label, and an optional second column. */
  const row = (label: string, ticked: boolean, onPick: () => void, extra?: { scene?: string | null; tip?: string; following?: boolean }): HTMLElement => {
    const b = el("button", "action-mi action-run flowpick-row");
    b.type = "button"; b.setAttribute("role", "menuitemradio"); b.setAttribute("aria-checked", String(ticked));
    const check = el("span", "action-check"); if (ticked) check.append(iconNode("tick", 12));
    const name = el("span", `flowpick-name${extra?.following ? " is-following" : ""}`, label);
    b.append(check, name);
    if (extra?.scene) b.append(el("span", "flowpick-scene", extra.scene));
    if (extra?.tip) b.dataset["tip"] = extra.tip;
    b.addEventListener("click", onPick);
    return b;
  };

  const renderMenu = (s: Connected): void => {
    if (!menu) return;
    const items: HTMLElement[] = [
      row("Most recent", s.mostRecent, () => choose(null), { tip: "Follow whichever flow moved last" }),
      el("div", "action-sep"),
    ];
    for (const g of groupFlows(s.flows, s.scenes, opts.sceneName)) {
      if (g.prefix !== null) items.push(el("div", "action-head", g.prefix));
      for (const r of g.rows) {
        items.push(row(r.label, !s.mostRecent && r.id === s.following, () => choose(r.id), { scene: r.scene, tip: r.id, following: r.id === s.following }));
      }
    }
    menu.replaceChildren(...items);
  };

  const openMenu = (): void => {
    if (!shown) return;
    openPopover(trigger, (close) => {
      closeMenu = close;
      menu = el("div", "flowpick");
      menu.setAttribute("role", "menu");
      renderMenu(shown!);
      return menu;
    }, () => { menu = null; closeMenu = null; trigger.classList.remove("open"); });
    trigger.classList.add("open");
  };
  // A second click on the button closes the menu. The popover closes itself on any press outside it,
  // the button included, before the click lands; this listener is registered first, so it sees the
  // press while the menu is still open and the click knows not to open it again.
  let pressedWhileOpen = false;
  window.addEventListener("pointerdown", (e) => { pressedWhileOpen = menu !== null && trigger.contains(e.target as Node); }, true);
  trigger.addEventListener("click", () => {
    if (pressedWhileOpen) { pressedWhileOpen = false; closeMenu?.(); return; }
    if (menu) closeMenu?.(); else openMenu();
  });

  const renderTrigger = (s: Connected): void => {
    const name = s.following ? shortFlowName(s.following) : "";
    const parts: HTMLElement[] = [];
    if (s.mostRecent) parts.push(el("span", "flowpick-mode", "Most recent"));
    if (name) parts.push(el("span", "flowpick-current", name));
    trigger.replaceChildren(...parts, iconNode("dropdown", 12));
    trigger.dataset["tip"] = s.following
      ? (s.mostRecent ? `Following the most recent flow, ${s.following}` : `Following ${s.following}`)
      : "Which live flow the editor follows";
  };

  const apply = (s: DebugStatus): void => {
    chip.apply(s);
    // Flow picker only when a game is connected with more than one live flow.
    if (s.state === "connected" && s.flows.length > 1) {
      shown = s;
      renderTrigger(s);
      trigger.hidden = false;
      renderMenu(s);
    } else {
      shown = null;
      closeMenu?.();
      trigger.hidden = true;
    }
  };

  window.patter.onDebugStatus(apply);

  return {
    setVisible(on: boolean): void { chip.setVisible(on); if (on) void window.patter.debugStatus().then(apply); else closeMenu?.(); },
    toggle(): void { chip.toggle(); },
  };
}
