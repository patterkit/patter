// The debug link's wire behaviour, pinned where it matters: which flows the editor is told about.
//
// `flowOpened` is the host's job and nothing could check it (patter's engine emits no trace, so the
// link only ever knows what the host tells it). A game that opened a flow and forgot to announce it
// left the editor's follow list short - and the omission SURVIVED a reconnect, because the hello
// carries the link's own flow set. Reported from the Storylet Studio side, 2026-08-29.

import { describe, it, expect } from "vitest";
import { createDebugLink } from "../src/debug.js";

/** A WebSocket stand-in that records what the link sends, and can be reconnected. */
function fakeSocket() {
  const sent: Record<string, unknown>[] = [];
  let onOpen: (() => void) | null = null;
  class Sock {
    readyState = 1;
    constructor(public url: string) { setTimeout(() => onOpen?.(), 0); }
    addEventListener(type: string, fn: () => void): void { if (type === "open") { onOpen = fn; fn(); } }
    send(raw: string): void { sent.push(JSON.parse(raw)); }
    close(): void { this.readyState = 3; }
  }
  return { Sock: Sock as unknown as ConstructorParameters<typeof Object>[0], sent };
}

const kinds = (sent: Record<string, unknown>[]): string[] => sent.map((m) => String(m["t"]));

describe("the debug link tells the editor which flows exist", () => {
  it("announces a flow the host observes but never opened", () => {
    const { Sock, sent } = fakeSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.observe("barkeep", "s1", "L1", "line");
    expect(kinds(sent)).toEqual(["hello", "flowOpen", "frame"]);
    expect(sent[1]).toMatchObject({ t: "flowOpen", flow: "barkeep" });
  });

  it("announces it once, not on every step", () => {
    const { Sock, sent } = fakeSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.observe("barkeep", "s1", "L1", "line");
    link.observe("barkeep", "s1", "L2", "line");
    link.observe("barkeep", "s1", "L3", "line");
    expect(kinds(sent).filter((k) => k === "flowOpen")).toHaveLength(1);
  });

  it("carries a self-announced flow in the NEXT hello, which is what a reconnect re-reads", () => {
    // The editor clears its list on a hello and repopulates from `flows`, so a flow that only ever
    // existed as a frame used to vanish on reconnect until its next step.
    const { Sock, sent } = fakeSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.observe("barkeep", "s1", "L1", "line");
    link.setBuild("b2"); // re-hellos
    const hellos = sent.filter((m) => m["t"] === "hello");
    expect(hellos).toHaveLength(2);
    expect(hellos[1]!["flows"]).toEqual(["barkeep"]);
  });

  it("still lets the host announce a flow before its first step", () => {
    const { Sock, sent } = fakeSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.flowOpened("barkeep");
    link.observe("barkeep", "s1", "L1", "line");
    expect(kinds(sent)).toEqual(["hello", "flowOpen", "frame"]); // not announced twice
  });

  it("a closed flow announces itself again if it is observed later", () => {
    const { Sock, sent } = fakeSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.observe("barkeep", "s1", "L1", "line");
    link.flowClosed("barkeep");
    link.observe("barkeep", "s1", "L2", "line");
    expect(kinds(sent).filter((k) => k === "flowOpen")).toHaveLength(2);
  });
});
