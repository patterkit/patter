// Moving things up and down from the keyboard and the Edit menu (the hands-on fixes review, Q14 and ruling 3).
//
// One pair of commands, two things it can move. With focus in the Scenes list, Move Up / Move Down move a
// scene in the project's order (the focused scene row's, else the open scene's); anywhere else they move
// the script's selection (the surface's `moveSelection`). The Edit menu greys each item when it can't do
// anything now, so the renderer works out both directions as focus and selection change and tells main.

/** The scene a move acts on when focus is in the Scenes list: the focused scene row's, else the open
 *  scene's. Null when focus isn't in the list, so the move goes to the script. */
export function sceneMoveTarget(navList: HTMLElement, active: Element | null, openScene: string | null): string | null {
  if (!active || !navList.contains(active)) return null;
  const row = active.closest<HTMLElement>(".nav-item");
  return row?.dataset["id"] ?? openScene;
}

/** Where a scene can go: up unless it's first, down unless it's last. */
export function sceneMoveState(order: readonly string[], id: string): { up: boolean; down: boolean } {
  const i = order.indexOf(id);
  return i < 0 ? { up: false, down: false } : { up: i > 0, down: i < order.length - 1 };
}

/** The menu's state from what has focus: the scene's places in the list, or what the script can move. */
export function moveMenuState(opts: {
  navList: HTMLElement; active: Element | null; openScene: string | null; order: readonly string[];
  canMoveSelection?: (dir: -1 | 1) => boolean;
}): { up: boolean; down: boolean } {
  const scene = sceneMoveTarget(opts.navList, opts.active, opts.openScene);
  if (scene) return sceneMoveState(opts.order, scene);
  const can = opts.canMoveSelection;
  return can ? { up: can(-1), down: can(1) } : { up: false, down: false };
}
