// The exit half of the shared "panel" motion vocabulary (theme.css). Enters are pure CSS - they run
// on insertion / show. Exits can't be: the node has to outlive the close so the animation can play,
// then be torn down. So each popup's close() routes through here instead of removing/hiding directly.
//
// closeWithExit adds `.closing` (CSS swaps the enter keyframe for `--anim-panel-out` / `--anim-backdrop-out`),
// waits for the animation to finish (or a safety timeout), then runs `done` exactly once. When the
// animation resolves to `none` (prefers-reduced-motion, or no rule for this element), the duration reads
// 0 and `done` runs synchronously - no artificial lag.

/** Play the close animation on `el`, then run `done` once. `done` does the real teardown (remove the
 *  node, drop listeners, etc.). Safe under reduced motion (tears down immediately). */
export function closeWithExit(el: HTMLElement, done: () => void): void {
  el.classList.add("closing");
  // getComputedStyle flushes pending style so this reflects the `.closing` rule. "0s" under reduced
  // motion (animation: none) or when no exit rule matches.
  const dur = parseFloat(getComputedStyle(el).animationDuration) || 0; // seconds
  if (dur === 0) { done(); return; }
  let fired = false;
  const finish = (): void => {
    if (fired) return;
    fired = true;
    el.removeEventListener("animationend", onEnd);
    clearTimeout(timer);
    done();
  };
  // Only OUR animation ending counts - inner content (pills, rows) can raise their own animationend.
  const onEnd = (e: AnimationEvent): void => { if (e.target === el) finish(); };
  el.addEventListener("animationend", onEnd);
  const timer = setTimeout(finish, dur * 1000 + 120); // fallback if animationend is missed
}
