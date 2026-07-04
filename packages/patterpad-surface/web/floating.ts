// A tiny floating-layer helper shared by every popup / menu (cuepopup, slashmenu,
// actionmenu). They all hand-rolled the same scaffolding: a body-appended div, display
// toggling, a scroll/resize follower to stay glued to the caret/anchor, and (some) a
// click-away dismiss. This centralizes that lifecycle so each component keeps only its own
// content + key handling. Positioning stays the caller's job (it differs per popup): pass a
// `reposition` closure to show(); the follower re-runs it on scroll & resize until close().

import { followOnScroll } from "./anchor.js";
import { closeWithExit } from "./exit.js";

export interface Floating {
  /** The floating element. Build content into it; it is appended to <body>, hidden until show(). */
  readonly el: HTMLElement;
  /** Show el and keep `reposition` glued to the anchor on scroll/resize. Safe to call repeatedly
   *  (e.g. on every re-render): the follower is attached once. */
  show(reposition: () => void): void;
  /** While open, dismiss (call `onOutside`) on a pointer-down outside el - and outside anything
   *  `isInside` accepts (a second flyout, an anchor button). Idempotent (arms once). */
  dismissOnOutside(onOutside: () => void, isInside?: (target: Node) => boolean): void;
  /** Hide el, clear its children, and tear down the scroll follower + any outside listener. */
  close(): void;
  isOpen(): boolean;
}

export function createFloating(className: string): Floating {
  const el = document.createElement("div"); el.className = className; el.style.display = "none";
  document.body.appendChild(el);
  let open = false;
  let detach: (() => void) | null = null;
  let outside: ((e: MouseEvent) => void) | null = null;
  let closeToken = 0; // bumped on every show/close so a stale exit teardown can't clobber a reopen

  const close = (): void => {
    if (!open) return;
    open = false;
    detach?.(); detach = null; // stop following + dismissing immediately; it is on its way out
    if (outside) { document.removeEventListener("mousedown", outside, true); outside = null; }
    const myToken = ++closeToken;
    // Play the exit, THEN hide + clear. The element is REUSED, so a reopen during the fade must win:
    // show() bumps closeToken, and this guard abandons the stale teardown.
    closeWithExit(el, () => {
      if (myToken !== closeToken) return;
      el.style.display = "none"; el.replaceChildren(); el.classList.remove("closing");
    });
  };

  const show = (reposition: () => void): void => {
    closeToken++; el.classList.remove("closing"); // cancel any in-flight exit, undo its class
    open = true; el.style.display = "block"; reposition();
    detach ??= followOnScroll(reposition);
  };

  const dismissOnOutside = (onOutside: () => void, isInside?: (target: Node) => boolean): void => {
    if (outside) return; // already armed
    outside = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (!el.contains(t) && !(isInside?.(t) ?? false)) onOutside();
    };
    document.addEventListener("mousedown", outside, true);
  };

  return { el, show, dismissOnOutside, close, isOpen: () => open };
}
