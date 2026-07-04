// ---------------------------------------------------------------------------
// Live debug link (#181) - the game-side client.
//
// Streams a running game's story position to Patterpad over a localhost
// WebSocket, so the editor can follow the live cursor like a debugger. It is
// OBSERVE-ONLY: the game stays in control; the editor is a passive mirror.
//
// Wire protocol `patterplay/debug@1` (one JSON object per message):
//   hello : { t:"hello", v:1, build, project?, flows? }           - on connect
//   frame : { t:"frame", flow, sceneId, beatId, type, choiceId? } - per transition
//   flow  : { t:"flowOpen" | "flowClose", flow }                  - lifecycle
//   bundle: { t:"bundle", v:1, build, data }                      - EDITOR -> game: live bundle refresh.
//           `data` is the full .patterc JSON. Pass an `onBundle` handler (or just feed it to
//           `applyLiveBundle`, which picks strings-only vs full hot swap itself), then call
//           `link.setBuild(newHash)` so the editor's match/stale pill updates.
//
// The link is loopback-only on the editor side (127.0.0.1), so there's no pairing
// token - only processes on the same machine can reach it. The client never throws
// into the game loop - a missing/closed editor just means frames go nowhere. Wire
// it up after each advance()/choose():
//
//   const link = createDebugLink({ build: bundle.content.hash });
//   link.flowOpened("main");
//   // ...after each step:
//   link.observe("main", flow.currentScene, step.id ?? null, step.type);
// ---------------------------------------------------------------------------

/** A minimal structural type for a WebSocket implementation (browsers + Node 21+ have a global one). */
export interface DebugSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", listener: () => void): void;
  /** Incoming editor messages (live bundle refresh). Optional so a bare-bones send-only socket still fits. */
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
}
type DebugSocketCtor = new (url: string) => DebugSocketLike;

export interface DebugLinkOptions {
  /** The running bundle's build identity - pass `bundle.content.hash`. Lets the editor detect a stale build. */
  build: string;
  /** Optional project name, shown in the editor's debug panel. */
  project?: string;
  /** Editor WebSocket URL. Default `ws://127.0.0.1:4471`. */
  url?: string;
  /** A WebSocket constructor to use instead of the global one (Node < 21, or tests with `ws`). */
  WebSocket?: DebugSocketCtor;
  /** Live bundle refresh: the editor pushed a freshly compiled bundle. `data` is the .patterc JSON;
   *  hand it (with your current engine + bundle) to `applyLiveBundle`, re-bind your flow handles if it
   *  hot-swapped, then call `link.setBuild(build)`. Never called with malformed payloads. */
  onBundle?: (msg: { build: string; data: string }) => void;
}

export interface DebugLink {
  /** Tell the editor a flow opened (so it can list it in the follow selector). */
  flowOpened(flowId: string): void;
  /** Report the current position of a flow - call after each advance()/choose(). */
  observe(flowId: string, sceneId: string | null, beatId: string | null, type: string, choiceId?: string): void;
  /** Tell the editor a flow closed. */
  flowClosed(flowId: string): void;
  /** After applying a pushed bundle: report the build now running (re-hellos, so the editor's
   *  match/stale pill updates and it stops re-pushing the same bundle). */
  setBuild(build: string): void;
  /** Close the link. */
  close(): void;
}

const OPEN = 1; // WebSocket.OPEN

/**
 * Open a live debug link to Patterpad. Returns a handle whose calls are no-ops once the editor disconnects
 * or if it was never listening - safe to leave wired into a shipping build behind a flag.
 */
export function createDebugLink(opts: DebugLinkOptions): DebugLink {
  const url = opts.url ?? "ws://127.0.0.1:4471";
  const Ctor: DebugSocketCtor | undefined = opts.WebSocket ?? (globalThis as { WebSocket?: DebugSocketCtor }).WebSocket;
  const flows = new Set<string>();
  let queue: string[] = [];
  let sock: DebugSocketLike | null = null;
  let closed = false;
  let build = opts.build; // mutable: setBuild() after a live bundle refresh lands

  const flush = (): void => {
    if (!sock || sock.readyState !== OPEN) return;
    for (const m of queue) { try { sock.send(m); } catch { /* socket went away */ } }
    queue = [];
  };
  const post = (msg: object): void => {
    if (closed) return;
    queue.push(JSON.stringify(msg));
    flush();
  };

  if (!Ctor) {
    // No WebSocket available (old Node, no impl passed) - degrade to a silent no-op link.
    return { flowOpened() {}, observe() {}, flowClosed() {}, setBuild() {}, close() { closed = true; } };
  }

  const sendHello = (): void => {
    const hello = JSON.stringify({ t: "hello", v: 1, build, project: opts.project, flows: [...flows] });
    try { sock?.send(hello); } catch { /* race: closed immediately */ }
  };

  try {
    sock = new Ctor(url);
    sock.addEventListener("open", () => {
      // Handshake first, so the editor can verify the build + seed the flow list before frames arrive.
      sendHello();
      flush();
    });
    // Live bundle refresh: the editor pushed a new bundle. Validate the shape here so the host's
    // handler never sees a malformed payload; everything else the editor might send is ignored.
    sock.addEventListener("message", (ev: { data: unknown }) => {
      if (!opts.onBundle || typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data) as Record<string, unknown>;
        if (msg.t === "bundle" && typeof msg.build === "string" && typeof msg.data === "string") {
          opts.onBundle({ build: msg.build, data: msg.data });
        }
      } catch { /* not for us */ }
    });
    sock.addEventListener("error", () => { /* editor not listening - stay a no-op */ });
    sock.addEventListener("close", () => { sock = null; });
  } catch { sock = null; } // malformed URL etc. - never throw into the game

  return {
    flowOpened(flowId: string): void { flows.add(flowId); post({ t: "flowOpen", flow: flowId }); },
    flowClosed(flowId: string): void { flows.delete(flowId); post({ t: "flowClose", flow: flowId }); },
    observe(flowId: string, sceneId: string | null, beatId: string | null, type: string, choiceId?: string): void {
      post({ t: "frame", flow: flowId, sceneId, beatId, type, choiceId });
    },
    setBuild(next: string): void {
      if (closed || next === build) return;
      build = next;
      if (sock && sock.readyState === OPEN) sendHello(); // re-handshake: the editor re-reads the build
    },
    close(): void { closed = true; queue = []; try { sock?.close(); } catch { /* already gone */ } sock = null; },
  };
}
