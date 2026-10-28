// Where focus goes back to after a dialog opened from a part of the window that redraws itself (the hands-on
// fixes review, focus after dialogs). The inspector rebuilds after every commit, so the button that opened a
// dialog is gone by the time the dialog closes, and app-shell's dialog frame would fall back past it. This
// remembers WHICH control it was (its kind and its place among its kind in the host) and finds the one the
// redraw put in its place, for the frame's `returnFocus`.

/** A `returnFocus` for a dialog opened from `opener` inside `host`: the opener while it's still in the page,
 *  else the control in the same place among the same kind in `host` now, else null (the frame then goes on
 *  to its own fallbacks). */
export function returnToTwin(host: HTMLElement, opener: Element | null): () => HTMLElement | null {
  if (!(opener instanceof HTMLElement) || !host.contains(opener)) return () => null;
  const kind = (e: Element): string => `${e.tagName}.${[...e.classList].sort().join(".")}`;
  const mine = kind(opener);
  const peers = (): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(opener.tagName)].filter((e) => kind(e) === mine);
  const place = peers().indexOf(opener);
  return () => {
    if (opener.isConnected) return opener;
    const now = peers();
    return now[place] ?? now[now.length - 1] ?? null;
  };
}
