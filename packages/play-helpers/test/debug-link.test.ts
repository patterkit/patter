// The debug link's wire behaviour, pinned where it matters: which flows the editor is told about.
//
// `flowOpened` is the host's job and nothing could check it (patter's engine emits no trace, so the
// link only ever knows what the host tells it). A game that opened a flow and forgot to announce it
// left the editor's follow list short - and the omission SURVIVED a reconnect, because the hello
// carries the link's own flow set. Reported from the Storylet Studio side, 2026-08-29.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("the debug link says what it is doing, as on every other runtime", () => {
  it("reports its state, build, and address", () => {
    const { Sock } = fakeSocket();
    const link = createDebugLink({ build: "b1", url: "ws://127.0.0.1:4999", WebSocket: Sock as never });
    expect(link.state).toBe("connected");
    expect(link.url).toBe("ws://127.0.0.1:4999");
    link.setBuild("b2");
    expect(link.build).toBe("b2");
    link.close();
    expect(link.state).toBe("closed");
  });

  it("is closed when there is no WebSocket to dial with", () => {
    vi.stubGlobal("WebSocket", undefined);
    try {
      const link = createDebugLink({ build: "b1" });
      expect(link.state).toBe("closed");
      expect(link.build).toBe("b1");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Play in game: the editor asks the running game to start a block", () => {
  /** A connected socket the test can push editor messages into. */
  function linkedSocket() {
    const sent: Record<string, unknown>[] = [];
    const listeners: Record<string, ((ev?: { data: unknown }) => void)[]> = {};
    class Sock {
      readyState = 1;
      constructor(public url: string) {}
      addEventListener(type: string, fn: (ev?: { data: unknown }) => void): void { (listeners[type] ??= []).push(fn); }
      send(raw: string): void { sent.push(JSON.parse(raw)); }
      close(): void { this.readyState = 3; }
    }
    const fromEditor = (msg: unknown): void => {
      for (const fn of listeners["message"] ?? []) fn({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
    };
    return { Sock: Sock as never, sent, fromEditor };
  }
  const play = { t: "play", v: 1, id: "p1", sceneId: "s1", blockId: "b1", takeOver: true, build: "h2" };
  const played = (sent: Record<string, unknown>[]) => sent.filter((m) => m["t"] === "played");

  it("hands a well-formed request to onPlay, and sends the answer back with its id", () => {
    const { Sock, sent, fromEditor } = linkedSocket();
    const seen: unknown[] = [];
    const link = createDebugLink({ build: "h1", WebSocket: Sock, onPlay: (req) => seen.push(req) });
    fromEditor(play);
    expect(seen).toEqual([{ id: "p1", sceneId: "s1", blockId: "b1", takeOver: true, build: "h2" }]);
    link.replyPlay("p1", { started: false, reason: "busy", detail: "Mara is talking" });
    expect(played(sent)).toEqual([{ t: "played", id: "p1", started: false, reason: "busy", detail: "Mara is talking" }]);
  });

  it("answers unhandled itself when the game has no handler, so the editor isn't left waiting", () => {
    const { Sock, sent, fromEditor } = linkedSocket();
    createDebugLink({ build: "h1", WebSocket: Sock });
    fromEditor(play);
    expect(played(sent)).toEqual([{ t: "played", id: "p1", started: false, reason: "unhandled" }]);
  });

  it("ignores a malformed request rather than calling the handler", () => {
    const { Sock, sent, fromEditor } = linkedSocket();
    const onPlay = vi.fn();
    createDebugLink({ build: "h1", WebSocket: Sock, onPlay });
    fromEditor({ t: "play", id: "p1", sceneId: "s1" });
    fromEditor({ t: "play", id: "", sceneId: "s1", blockId: "b1" });
    fromEditor("not json");
    expect(onPlay).not.toHaveBeenCalled();
    expect(played(sent)).toEqual([]);
  });

  it("reads takeOver as false and leaves build out when they are missing", () => {
    const { Sock, fromEditor } = linkedSocket();
    const onPlay = vi.fn();
    createDebugLink({ build: "h1", WebSocket: Sock, onPlay });
    fromEditor({ t: "play", v: 1, id: "p2", sceneId: "s1", blockId: "b1" });
    expect(onPlay).toHaveBeenCalledWith({ id: "p2", sceneId: "s1", blockId: "b1", takeOver: false });
  });

  it("sends a started answer with no reason", () => {
    const { Sock, sent, fromEditor } = linkedSocket();
    const link = createDebugLink({ build: "h1", WebSocket: Sock, onPlay: (req) => link.replyPlay(req.id, { started: true }) });
    fromEditor(play);
    expect(played(sent)).toEqual([{ t: "played", id: "p1", started: true }]);
  });
});

describe("the debug link reconnects until the game closes it", () => {
  /** Each socket its own listeners, so the test can open, drop, or refuse the one the link is on. */
  function sockets() {
    const all: Array<{ readyState: number; sent: Record<string, unknown>[]; fire(type: string, ev?: unknown): void }> = [];
    class Sock {
      readyState = 0;
      sent: Record<string, unknown>[] = [];
      private listeners: Record<string, ((ev?: unknown) => void)[]> = {};
      constructor(public url: string) { all.push(this); }
      addEventListener(type: string, fn: (ev?: unknown) => void): void { (this.listeners[type] ??= []).push(fn); }
      send(raw: string): void { if (this.readyState !== 1) throw new Error("not open"); this.sent.push(JSON.parse(raw)); }
      close(): void { this.readyState = 3; }
      fire(type: string, ev?: unknown): void { for (const fn of this.listeners[type] ?? []) fn(ev); }
    }
    const last = () => all[all.length - 1]!;
    const open = (): void => { last().readyState = 1; last().fire("open"); };
    const drop = (code = 1006): void => { last().readyState = 3; last().fire("close", { code }); };
    const refuse = (): void => { last().readyState = 3; last().fire("error"); last().fire("close", { code: 1006 }); };
    return { Sock: Sock as never, all, last, open, drop, refuse };
  }

  beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "info").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("retries a refused link after 1 s, doubling to 10 s, logging nothing while it has never opened", () => {
    const s = sockets();
    const link = createDebugLink({ build: "b1", WebSocket: s.Sock });
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      const before = s.all.length;
      s.refuse();
      expect(link.state).toBe("connecting");
      let waited = 0;
      while (s.all.length === before) { vi.advanceTimersByTime(100); waited += 100; }
      waits.push(waited);
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 10000, 10000]);
    expect(console.info).not.toHaveBeenCalled();
    link.close();
  });

  it("says hello again with the build and open flows, resets the wait, and logs lost and back once each", () => {
    const s = sockets();
    const link = createDebugLink({ build: "b1", project: "Test", WebSocket: s.Sock });
    s.open();
    link.flowOpened("main");
    s.drop();
    vi.advanceTimersByTime(1000);
    s.refuse();                                   // the editor isn't back yet: 2 s next
    vi.advanceTimersByTime(2000);
    link.setBuild("b2");                          // a pushed bundle took while it was away
    s.open();
    expect(s.last().sent[0]).toMatchObject({ t: "hello", build: "b2", project: "Test", flows: ["main"] });
    expect(link.state).toBe("connected");
    s.drop();                                     // the hello put the wait back to 1 s
    const before = s.all.length;
    vi.advanceTimersByTime(1000);
    expect(s.all.length).toBe(before + 1);
    expect(vi.mocked(console.info).mock.calls.map((c) => String(c[0]))).toEqual([
      expect.stringContaining("lost"), expect.stringContaining("back"), expect.stringContaining("lost"),
    ]);
    link.close();
  });

  it("queues nothing while a retry connects, so the hello and fresh frames stand in for what was missed", () => {
    const s = sockets();
    const link = createDebugLink({ build: "b1", WebSocket: s.Sock });
    link.observe("main", "s1", "L1", "line");     // the first attempt holds the opening moments
    s.refuse();
    vi.advanceTimersByTime(1000);
    for (let i = 2; i < 50; i++) link.observe("main", "s1", `L${i}`, "line");
    s.open();
    expect(s.last().sent.map((m) => m.t)).toEqual(["hello"]);
    link.observe("main", "s1", "L50", "line");
    expect(s.last().sent.map((m) => m.t)).toEqual(["hello", "frame"]);
    link.close();
  });

  it("stops for good when the editor replaced it with another game (code 4000)", () => {
    const s = sockets();
    const link = createDebugLink({ build: "b1", WebSocket: s.Sock });
    s.open();
    s.drop(4000);
    expect(link.state).toBe("closed");
    vi.advanceTimersByTime(60000);
    expect(s.all.length).toBe(1);
  });

  it("stops retrying once the game closes it", () => {
    const s = sockets();
    const link = createDebugLink({ build: "b1", WebSocket: s.Sock });
    s.refuse();
    link.close();
    vi.advanceTimersByTime(60000);
    expect(s.all.length).toBe(1);
    expect(link.state).toBe("closed");
  });
});
