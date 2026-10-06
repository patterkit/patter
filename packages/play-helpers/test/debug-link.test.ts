// The debug link's wire behaviour, pinned where it matters: which flows the editor is told about.
//
// `flowOpened` is the host's job and nothing could check it (patter's engine emits no trace, so the
// link only ever knows what the host tells it). A game that opened a flow and forgot to announce it
// left the editor's follow list short - and the omission SURVIVED a reconnect, because the hello
// carries the link's own flow set. Reported from the Storylet Studio side, 2026-08-29.

import { describe, it, expect, vi } from "vitest";
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

describe("a link with no editor on the other end", () => {
  /** A socket that never connects: CONNECTING, then the error and close a refused connection raises. */
  function refusedSocket() {
    const listeners: Record<string, (() => void)[]> = {};
    let sock: { readyState: number } | null = null;
    class Sock {
      readyState = 0;
      constructor(public url: string) { sock = this; }
      addEventListener(type: string, fn: () => void): void { (listeners[type] ??= []).push(fn); }
      send(): void { throw new Error("not open"); }
      close(): void { this.readyState = 3; }
    }
    const refuse = (): void => { sock!.readyState = 3; for (const t of ["error", "close"]) for (const fn of listeners[t] ?? []) fn(); };
    return { Sock: Sock as unknown as ConstructorParameters<typeof Object>[0], refuse };
  }

  it("does no work per step once the connection is refused, so a shipped game does not grow a queue", () => {
    const { Sock, refuse } = refusedSocket();
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    refuse();
    const stringify = vi.spyOn(JSON, "stringify");
    for (let i = 0; i < 100; i++) link.observe("barkeep", "s1", `L${i}`, "line");
    expect(stringify).not.toHaveBeenCalled();
    stringify.mockRestore();
  });

  it("still holds what is sent while connecting, and sends it once the editor answers", () => {
    const sent: Record<string, unknown>[] = [];
    const listeners: Record<string, (() => void)[]> = {};
    let sock: { readyState: number } | null = null;
    class Sock {
      readyState = 0;
      constructor(public url: string) { sock = this; }
      addEventListener(type: string, fn: () => void): void { (listeners[type] ??= []).push(fn); }
      send(raw: string): void { sent.push(JSON.parse(raw)); }
      close(): void { this.readyState = 3; }
    }
    const link = createDebugLink({ build: "b1", WebSocket: Sock as never });
    link.observe("barkeep", "s1", "L1", "line");
    expect(sent).toEqual([]);
    sock!.readyState = 1;
    for (const fn of listeners["open"] ?? []) fn();
    expect(kinds(sent)).toEqual(["hello", "flowOpen", "frame"]);
  });
});
