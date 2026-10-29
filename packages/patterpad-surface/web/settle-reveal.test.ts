// @vitest-environment jsdom
// A reveal on a scene's first load lands where it meant to (settle-reveal.ts). jsdom lays nothing out, so the
// page is faked: a scroller whose node sits at a position the test controls. The first scroll aims at the
// estimated page; then the blocks above "draw" taller and push the node down, as content-visibility's real
// heights do. The settle pass must centre it again; a reveal the author has moved on from must be left alone.
import { describe, it, expect } from "vitest";
import { settleReveal, nearCentre } from "./settle-reveal.js";

/** A 600px-high scroller holding a node whose page offset is `nodeAt`; scrollIntoView centres it. */
function page(nodeAt: { y: number }) {
  const box = document.createElement("div");
  Object.defineProperty(box, "clientHeight", { value: 600 });
  Object.defineProperty(box, "scrollHeight", { value: 10000 });
  box.style.overflowY = "auto";
  box.getBoundingClientRect = () => ({ top: 0, height: 600, bottom: 600, left: 0, right: 800, width: 800, x: 0, y: 0, toJSON: () => ({}) });
  const node = document.createElement("p");
  box.append(node);
  document.body.append(box);
  let scrolls = 0;
  node.getBoundingClientRect = () => {
    const top = nodeAt.y - box.scrollTop;
    return { top, height: 40, bottom: top + 40, left: 0, right: 800, width: 800, x: 0, y: top, toJSON: () => ({}) };
  };
  node.scrollIntoView = () => { scrolls++; box.scrollTop = Math.max(0, nodeAt.y - 280); };
  return { box, node, scrolls: () => scrolls };
}

/** Run queued frames until none are left (bounded), with a clock that moves 16ms a frame. */
function frames() {
  const queue: Array<() => void> = [];
  let t = 0;
  return {
    frame: (fn: () => void) => { queue.push(fn); },
    now: () => t,
    run: (beforeEach?: (n: number) => void) => {
      for (let n = 0; queue.length && n < 200; n++) { beforeEach?.(n); t += 16; queue.shift()!(); }
    },
  };
}

describe("settling a reveal", () => {
  it("centres the node again once the page above it has drawn at its real height", () => {
    const at = { y: 3000 };
    const { box, node, scrolls } = page(at);
    node.scrollIntoView();                       // the first scroll, aimed at the estimated page
    expect(nearCentre(node, box)).toBe(true);
    const f = frames();
    settleReveal(node, () => true, f.frame, f.now);
    f.run((n) => { if (n === 0) at.y = 4800; }); // the blocks above draw taller: the node moves down
    expect(scrolls()).toBe(2);
    expect(nearCentre(node, box)).toBe(true);
  });

  it("leaves a reveal that landed alone", () => {
    const at = { y: 3000 };
    const { node, scrolls } = page(at);
    node.scrollIntoView();
    const f = frames();
    settleReveal(node, () => true, f.frame, f.now);
    f.run();
    expect(scrolls()).toBe(1);
  });

  it("gives up once the author has moved on", () => {
    const at = { y: 3000 };
    const { box, node, scrolls } = page(at);
    node.scrollIntoView();
    const f = frames();
    let wanted = true;
    settleReveal(node, () => wanted, f.frame, f.now);
    f.run((n) => { if (n === 0) { at.y = 4800; wanted = false; } });
    expect(scrolls()).toBe(1);
    expect(nearCentre(node, box)).toBe(false);
  });
});
