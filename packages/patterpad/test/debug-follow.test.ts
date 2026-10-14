// The live debug link's follow state (shared/debug-follow.ts) without a socket: the cases the end-to-end
// tests in debug-link.test.ts can't reach easily, a re-handshake and the order a flow's frames keep.

import { describe, it, expect } from "vitest";
import { createFlowFollower, type DebugFrame } from "../src/shared/debug-follow.js";

function follower() {
  const shown: DebugFrame[] = [];
  let changes = 0;
  const f = createFlowFollower({ onFrame: (x) => shown.push(x), onChange: () => { changes++; } });
  const frame = (flow: string, beatId: string | null, type = "line", sceneId: string | null = "scn"): void => f.frame({ flow, sceneId, beatId, type });
  return { f, shown, frame, changes: () => changes };
}

describe("the follow state", () => {
  it("starts in most-recent mode, following the first flow listed until one moves", () => {
    const { f } = follower();
    f.hello(["a", "b"]);
    expect(f.view()).toEqual({ flows: ["a", "b"], following: "a", mostRecent: true, scenes: { a: null, b: null } });
  });

  it("keeps a flow's last frame through a re-handshake that lists it, and shows it again", () => {
    const { f, shown, frame } = follower();
    f.hello(["a", "b"]);
    frame("b", "b1");
    frame("a", "a1");
    f.follow("b");
    shown.length = 0;
    f.hello(["b"]);                       // a live bundle refresh re-hellos; "a" has gone
    expect(f.view()).toMatchObject({ flows: ["b"], following: "b", mostRecent: false });
    expect(shown).toEqual([{ flow: "b", sceneId: "scn", beatId: "b1", type: "line" }]);
  });

  it("drops a chosen flow a re-handshake doesn't list, and goes back to most recent", () => {
    const { f, frame } = follower();
    f.hello(["a", "b"]);
    frame("a", "a1");
    frame("b", "b1");
    f.follow("a");
    f.hello(["b"]);
    expect(f.view()).toMatchObject({ following: "b", mostRecent: true });
  });

  it("an end frame doesn't make its flow the newest, so a hand-over skips past it", () => {
    const { f, shown, frame } = follower();
    f.hello(["a", "b", "c"]);
    frame("a", "a1");
    frame("b", "b1");
    frame("c", "c1");                     // followed
    frame("a", null, "end", null);        // a finishes, still open
    shown.length = 0;
    f.flowClose("c");
    expect(f.view().following).toBe("b");
    expect(shown).toEqual([{ flow: "b", sceneId: "scn", beatId: "b1", type: "line" }]);
  });

  it("pushes a change for a flow's new scene but not for a step inside the same one", () => {
    const { f, frame, changes } = follower();
    f.hello(["a"]);
    const before = changes();
    frame("a", "a1", "line", "s1");
    frame("a", "a2", "line", "s1");
    expect(changes()).toBe(before + 1);
    frame("a", "a3", "line", "s2");
    expect(changes()).toBe(before + 2);
  });

  it("ignores a chosen flow it doesn't know, and clear() forgets everything", () => {
    const { f, frame } = follower();
    f.hello(["a"]);
    frame("a", "a1");
    f.follow("nope");
    expect(f.view()).toMatchObject({ following: "a", mostRecent: true });
    f.follow("a");
    f.clear();
    expect(f.view()).toEqual({ flows: [], following: null, mostRecent: true, scenes: {} });
  });
});
