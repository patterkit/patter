// Live debug link (#181): which of a running game's flows the editor follows.
//
// A game can run several flows at once (a conversation, a bark, ambient chatter), opening and closing
// all the time; Patterstage reports each performance as a flow of its own. This is the follow state for
// that, kept apart from the socket so the server (main/debug-link.ts) and the browser preview's fake
// link drive the one implementation, and so it can be tested without a socket.
//
// Two modes:
// - Most recent (the default): the editor moves to whichever flow sent the last frame. With one flow
//   it's the same as following that flow, and with several it's the mode that keeps up with the game.
//   An "end" frame doesn't count: a flow finishing isn't something to watch, and its close follows.
// - A chosen flow: picked in the editor's flow picker. Frames from other flows are kept (each flow's
//   last frame, so its scene shows in the picker and following it later jumps at once) but don't move
//   the editor. When the chosen flow closes, the choice is spent and following goes back to most recent.
//
// The hand-over: when the followed flow closes, following moves to the flow with the newest frame and
// shows that frame at once, rather than leaving the view where the closed flow left it.

/** A position frame for one flow. `choiceId` is set on a choice frame sent again with the option taken. */
export interface DebugFrame { flow: string; sceneId: string | null; beatId: string | null; type: string; choiceId?: string }

/** What the editor shows of the follow state. */
export interface FollowView {
  /** The live flows, in the order they opened. */
  flows: string[];
  /** The flow the editor follows, or null when none is live. */
  following: string | null;
  /** True when following the most recent flow, false when following a flow picked in the editor. */
  mostRecent: boolean;
  /** Each live flow's current scene id (from its last frame), or null before its first frame. */
  scenes: Record<string, string | null>;
}

export interface FlowFollower {
  /** A handshake (or a re-handshake after a live bundle refresh) listing the flows the game has open.
   *  Flows it doesn't list are dropped; the ones it does keep their last frame. */
  hello(flows: string[]): void;
  flowOpen(flow: string): void;
  flowClose(flow: string): void;
  frame(f: DebugFrame): void;
  /** Follow a chosen flow, or the most recent one with null. An unknown flow is ignored. */
  follow(flow: string | null): void;
  /** The game went away: forget every flow, and go back to most recent. */
  clear(): void;
  view(): FollowView;
}

export interface FlowFollowerDeps {
  /** Show a frame of the followed flow in the editor. */
  onFrame: (f: DebugFrame) => void;
  /** Something the view shows changed (the flows, the one followed, the mode, or a flow's scene). */
  onChange: () => void;
}

export function createFlowFollower(deps: FlowFollowerDeps): FlowFollower {
  const flows = new Set<string>();
  // Each live flow's last frame, ordered oldest to newest by when it last moved (a frame re-inserts its
  // flow at the end), so the newest is the last entry. An "end" frame updates its flow in place.
  const last = new Map<string, DebugFrame>();
  let following: string | null = null;
  let mostRecent = true;

  /** The flow with the newest frame, else the first flow to open, else none. */
  const newest = (): string | null => {
    const moved = [...last.keys()].filter((f) => flows.has(f));
    return moved.length ? moved[moved.length - 1]! : flows.size ? [...flows][0]! : null;
  };

  /** Follow `id` and show where it is now, if it has said. */
  const setFollowing = (id: string | null): void => {
    following = id;
    const f = id ? last.get(id) : undefined;
    if (f) deps.onFrame(f);
  };

  return {
    hello(list: string[]): void {
      flows.clear();
      for (const f of list) flows.add(f);
      for (const f of [...last.keys()]) if (!flows.has(f)) last.delete(f);
      if (!mostRecent && (following == null || !flows.has(following))) mostRecent = true;
      setFollowing(mostRecent ? newest() : following);
      deps.onChange();
    },
    flowOpen(flow: string): void {
      if (flows.has(flow)) return;
      flows.add(flow);
      if (following == null) setFollowing(flow);
      deps.onChange();
    },
    flowClose(flow: string): void {
      if (!flows.has(flow)) return;
      flows.delete(flow); last.delete(flow);
      if (following === flow) {
        mostRecent = true; // a chosen flow that ends is a spent choice
        setFollowing(newest());
      }
      deps.onChange();
    },
    frame(f: DebugFrame): void {
      let changed = false;
      if (!flows.has(f.flow)) { flows.add(f.flow); changed = true; }
      const prev = last.get(f.flow);
      if (f.type === "end" && prev) last.set(f.flow, f);      // in place: finishing isn't moving
      else { last.delete(f.flow); last.set(f.flow, f); }      // to the end: this flow moved last
      if (!prev || prev.sceneId !== f.sceneId) changed = true; // its scene in the picker
      if (following == null || (mostRecent && following !== f.flow && f.type !== "end")) { following = f.flow; changed = true; }
      if (f.flow === following) deps.onFrame(f);
      if (changed) deps.onChange();
    },
    follow(flow: string | null): void {
      if (flow === null) { mostRecent = true; setFollowing(newest()); deps.onChange(); return; }
      if (!flows.has(flow)) return;
      mostRecent = false;
      setFollowing(flow);
      deps.onChange();
    },
    clear(): void {
      flows.clear(); last.clear(); following = null; mostRecent = true;
    },
    view(): FollowView {
      const scenes: Record<string, string | null> = {};
      for (const f of flows) scenes[f] = last.get(f)?.sceneId ?? null;
      return { flows: [...flows], following, mostRecent, scenes };
    },
  };
}
