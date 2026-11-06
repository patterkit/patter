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
//   play  : { t:"play", v:1, id, sceneId, blockId, takeOver, build? } - EDITOR -> game: Play in game.
//           The writer asked the running game to start that block now (`takeOver`: stop what the
//           speakers are doing first). `build` is the editor's bundle hash, so a game still on an
//           older bundle can answer "staleBuild". Pass an `onPlay` handler; it answers with
//           `link.replyPlay(id, result)`, then or later. With no handler the link answers
//           { started:false, reason:"unhandled" } itself.
//   played: { t:"played", id, started, reason?, detail? } - game -> editor: the answer to `play`.
//           `reason` is a short code (any string passes through; Patterpad has plain words for
//           busy, unknownBlock, staleBuild, unhandled, and Patterstage's own); `detail` says more.
//
// The link is loopback-only on the editor side (127.0.0.1), so there's no pairing
// token - only processes on the same machine can reach it. The client never throws
// into the game loop - a missing/closed editor just means frames go nowhere.
//
// It reconnects (the rule Storylets' live link shares): until the game closes it, a
// socket that closes or never opens is tried again after 1 s, doubling to 10 s, and
// back to 1 s once a hello goes. Each new socket says hello again with the build and
// the open flows. One line is logged when an open link is lost and one when it's
// back; a link that never opened logs nothing. Frames are queued only while the
// first socket connects: after any attempt fails, nothing queues until a socket is
// open. The editor closes a game it replaced (another game connected) with code
// 4000, and that one doesn't retry, so two games don't take turns. Wire it up after
// each advance()/choose():
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
  addEventListener(type: "open" | "error", listener: () => void): void;
  /** The close event's `code` says why: 4000 is the editor replacing this game with another. */
  addEventListener(type: "close", listener: (ev?: { code?: number }) => void): void;
  /** Incoming editor messages (live bundle refresh). Optional so a bare-bones send-only socket still fits. */
  addEventListener(type: "message", listener: (ev: { data: unknown }) => void): void;
}
type DebugSocketCtor = new (url: string) => DebugSocketLike;

/** The editor asked the running game to play a block now (Play in game). Ids are the bundle's. */
export interface PlayRequest {
  /** Echo it in `replyPlay` so the editor can match the answer to its request. */
  id: string;
  sceneId: string;
  blockId: string;
  /** Stop what the speakers are doing first, rather than turn the request down as busy. */
  takeOver: boolean;
  /** The editor's bundle hash, when it sent one: a game on another build can answer "staleBuild". */
  build?: string;
}

/** The game's answer to a `PlayRequest`. */
export interface PlayResult {
  started: boolean;
  /** Why it didn't start, as a short code: "busy", "unknownBlock", "staleBuild", or the game's own. */
  reason?: string;
  /** More, in plain words (which speaker is busy, which block was missing). */
  detail?: string;
}

/** The `reason` the link answers with when nothing handles `play`. */
const PLAY_UNHANDLED = "unhandled";

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
  /** Play in game: the writer asked the game to start a block now. Answer with `link.replyPlay(req.id,
   *  result)`, in the handler or later (an answer after the editor stopped waiting is ignored). Without a
   *  handler the link answers `{ started: false, reason: "unhandled" }`. Never called with malformed
   *  payloads. */
  onPlay?: (req: PlayRequest) => void;
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
  /** Answer a `play` request (see `onPlay`). Safe to call at any time; a no-op once the link is closed. */
  replyPlay(id: string, result: PlayResult): void;
  /** Close the link. */
  close(): void;
  /** What the link is doing: `connecting`, `connected`, or `closed`. From inside a running game "the editor
   *  is not listening" and "I never attached" look the same, and this tells them apart. */
  readonly state: "connecting" | "connected" | "closed";
  /** The build the link handshakes with (the bundle's content hash), as `setBuild` last left it. */
  readonly build: string;
  /** The address the link dials. */
  readonly url: string;
}

const OPEN = 1; // WebSocket.OPEN
/** The editor closed this game because another connected: don't retry. */
const REPLACED = 4000;
/** The retry's first wait and its longest, in ms. */
const RETRY_FIRST = 1000;
const RETRY_MAX = 10000;

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
  let dropped = false;     // an attempt has failed or closed: queue nothing until a socket opens
  let wasOpen = false;     // a socket has been open, so losing it is worth a line
  let lost = false;        // logged as lost, waiting to log it back
  let wait = RETRY_FIRST;
  let retry: ReturnType<typeof setTimeout> | null = null;

  const flush = (): void => {
    if (!sock || sock.readyState !== OPEN) return;
    for (const m of queue) { try { sock.send(m); } catch { /* socket went away */ } }
    queue = [];
  };
  // Queue only while there is a socket that is connecting or open. Once the editor is gone (or never
  // answered), the socket is dropped and a message has nowhere to go, so it is dropped too: queueing it
  // anyway grew the queue by one string per step for the rest of a game that shipped with the link wired
  // in, which is exactly the build the docs say this is safe in.
  const post = (msg: object): void => {
    if (closed || !sock || sock.readyState > OPEN) return;
    if (dropped && sock.readyState !== OPEN) return;
    queue.push(JSON.stringify(msg));
    flush();
  };

  if (!Ctor) {
    // No WebSocket available (old Node, no impl passed) - degrade to a silent no-op link.
    return { flowOpened() {}, observe() {}, flowClosed() {}, setBuild() {}, replyPlay() {}, close() { closed = true; }, state: "closed", build, url };
  }

  const replyPlay = (id: string, result: PlayResult): void => {
    post({
      t: "played", id, started: result.started === true,
      ...(typeof result.reason === "string" ? { reason: result.reason } : {}),
      ...(typeof result.detail === "string" ? { detail: result.detail } : {}),
    });
  };

  const sendHello = (): void => {
    const hello = JSON.stringify({ t: "hello", v: 1, build, project: opts.project, flows: [...flows] });
    try { sock?.send(hello); wait = RETRY_FIRST; } catch { /* race: closed immediately */ }
  };

  const connect = (): void => {
    retry = null;
    if (closed) return;
    let s: DebugSocketLike;
    try { s = new Ctor(url); } catch { sock = null; return; } // malformed URL etc. - never throw into the game
    sock = s;
    s.addEventListener("open", () => {
      if (sock !== s) return;
      wasOpen = true;
      if (lost) { lost = false; console.info(`[patterplay] Live Link is back (${url}).`); }
      // Handshake first, so the editor can verify the build + seed the flow list before frames arrive.
      sendHello();
      flush();
    });
    // Editor -> game: a live bundle refresh, or Play in game. Validate the shape here so the host's
    // handlers never see a malformed payload; everything else the editor might send is ignored.
    s.addEventListener("message", (ev: { data: unknown }) => {
      if (typeof ev.data !== "string") return;
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(ev.data) as Record<string, unknown>; } catch { return; }
      if (msg === null || typeof msg !== "object") return;
      if (msg.t === "bundle") {
        if (opts.onBundle && typeof msg.build === "string" && typeof msg.data === "string") {
          opts.onBundle({ build: msg.build, data: msg.data });
        }
      } else if (msg.t === "play") {
        const req = parsePlayRequest(msg);
        if (!req) return;
        if (!opts.onPlay) { replyPlay(req.id, { started: false, reason: PLAY_UNHANDLED }); return; }
        try { opts.onPlay(req); } catch { /* never throw into the socket: the editor times out */ }
      }
    });
    s.addEventListener("error", () => { /* editor not listening - the close that follows retries */ });
    s.addEventListener("close", (ev?: { code?: number }) => {
      if (sock !== s) return;
      sock = null; queue = []; dropped = true;
      if (closed) return;
      if (ev?.code === REPLACED) { closed = true; console.info(`[patterplay] Live Link: another game took the editor's link (${url}).`); return; }
      if (wasOpen && !lost) { lost = true; console.info(`[patterplay] Live Link lost (${url}); retrying.`); }
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, RETRY_MAX);
    });
  };
  connect();

  return {
    flowOpened(flowId: string): void { flows.add(flowId); post({ t: "flowOpen", flow: flowId }); },
    flowClosed(flowId: string): void { flows.delete(flowId); post({ t: "flowClose", flow: flowId }); },
    observe(flowId: string, sceneId: string | null, beatId: string | null, type: string, choiceId?: string): void {
      // A flow reports itself. `flowOpened` is the host's job and nothing could check it, so a game
      // that opened a flow and forgot to announce it left the editor's list short - and the omission
      // survived a reconnect, because the hello sends this set. Observing a flow we have not seen
      // announces it first, which makes the host's call a courtesy (it lists the flow before its
      // first step) rather than something to remember.
      if (!flows.has(flowId)) { flows.add(flowId); post({ t: "flowOpen", flow: flowId }); }
      post({ t: "frame", flow: flowId, sceneId, beatId, type, choiceId });
    },
    replyPlay,
    setBuild(next: string): void {
      if (closed || next === build) return;
      build = next;
      if (sock && sock.readyState === OPEN) sendHello(); // re-handshake: the editor re-reads the build
    },
    close(): void {
      closed = true; queue = [];
      if (retry) { clearTimeout(retry); retry = null; }
      try { sock?.close(); } catch { /* already gone */ }
      sock = null;
    },
    // Between attempts there's no socket, but the link is still trying: connecting.
    get state() { return closed ? "closed" : sock && sock.readyState === OPEN ? "connected" : sock || retry ? "connecting" : "closed"; },
    get build() { return build; },
    url,
  };
}

/** A `play` message's fields, or null when it isn't a well-formed request. */
function parsePlayRequest(msg: Record<string, unknown>): PlayRequest | null {
  const { id, sceneId, blockId } = msg;
  if (typeof id !== "string" || id === "" || typeof sceneId !== "string" || sceneId === ""
    || typeof blockId !== "string" || blockId === "") return null;
  return {
    id, sceneId, blockId, takeOver: msg.takeOver === true,
    ...(typeof msg.build === "string" && msg.build !== "" ? { build: msg.build } : {}),
  };
}
