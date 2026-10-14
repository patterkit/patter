// Live debug link (#181) - the editor-side server.
//
// A localhost WebSocket server in the main process that a running Patterplay game connects to and streams
// its story position into. Observe-only: the editor never drives the game. Incoming frames for the
// followed flow are forwarded to the renderer's EXISTING playhead path (the same `play:mark` the in-app
// Play window uses), so the editor follows the live cursor like a debugger.
//
// Wire protocol `patterplay/debug@1` (mirrors @patterkit/play-helpers' createDebugLink):
//   hello : { t:"hello", v, build, project?, token?, flows? }   - verified, seeds the flow list
//   frame : { t:"frame", flow, sceneId, beatId, type, choiceId? } - a choice frame sent again with
//           `choiceId` set names the option taken, which the editor marks
//   flow  : { t:"flowOpen" | "flowClose", flow }
//   bundle: { t:"bundle", v:1, build, data }   - SERVER -> client: live bundle refresh. `data` is the
//           full .patterc JSON; the client picks the tier itself (strings-only vs full hot swap) by
//           comparing structure hashes, applies it, and re-hellos with the new build.

//
// Which flow the editor follows (the most recent, or one picked in the editor, and the hand-over when the
// followed flow closes) is shared/debug-follow.ts, which the browser preview's fake link drives too.

import { WebSocketServer, type WebSocket } from "ws";
import type { DebugStatus } from "../shared/api.js";
import { createFlowFollower, type DebugFrame } from "../shared/debug-follow.js";
import { isLocalOrigin } from "@wildwinter/app-shell/util";

const DEFAULT_PORT = 4471;

/**
 * Whether a connection's `Origin` header belongs to a client on this machine: the family's one rule,
 * now the app-shell's, so Patterpad and Storyletter cannot drift. Binding to loopback keeps other
 * machines out but not web pages, which can dial `ws://127.0.0.1:4471` from any browser. Accepted: no
 * Origin (Unity, Godot, Node), or a literal loopback host with or without a scheme (Unreal's
 * libwebsockets sends the bare address; a browser game on a local dev server sends its page). Refused:
 * every other site, and `null`. Re-exported so the tests and any caller keep their import.
 */
export { isLocalOrigin };

export type { DebugFrame };

export interface DebugServer {
  start(): void;
  stop(): void;
  status(): DebugStatus;
  /** Follow a chosen flow's cursor (re-points the single editor playhead), or the most recent flow's
   *  with null. */
  follow(flowId: string | null): void;
  isOn(): boolean;
  /** Live bundle refresh: push a freshly compiled bundle to the connected game. No-op when nothing is
   *  connected / handshaken, or when the client already runs this exact build. The client applies it
   *  and re-hellos with the new build, which updates the match/stale pill on its own. */
  pushBundle(build: string, data: string): void;
}

export interface DebugServerDeps {
  /** The project's current compiled bundle hash, recomputed at handshake to detect a stale running build. */
  currentBuildHash: () => string | null;
  /** Forward a followed-flow frame to the editor playhead. */
  onFrame: (f: DebugFrame) => void;
  /** Clear the editor's visited trail (a game (re)connected, a fresh run begins). */
  onReset: () => void;
  /** Push the latest status to the renderer panel. */
  onStatus: (s: DebugStatus) => void;
  port?: number;
}

export function createDebugServer(deps: DebugServerDeps): DebugServer {
  const port = deps.port ?? DEFAULT_PORT;
  let wss: WebSocketServer | null = null;
  let client: WebSocket | null = null;
  let connected: { project?: string; build: "match" | "stale" | "unknown" } | null = null;
  let authed = false; // a hello must land before any frame is honoured (so we have the build/flow context)
  let clientBuild: string | null = null; // the build the game reported (last hello) - gates pushBundle

  const status = (): DebugStatus => {
    if (!wss) return { state: "off" };
    if (!client || !connected) return { state: "listening", port };
    return { state: "connected", port, project: connected.project, build: connected.build, ...follower.view() };
  };
  const push = (): void => deps.onStatus(status());
  // Pushes only once handshaken: before that the status is "listening" and nothing it shows has changed.
  const follower = createFlowFollower({ onFrame: deps.onFrame, onChange: () => { if (connected) push(); } });

  const handleMessage = (raw: string): void => {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.t !== "hello" && !authed) return; // ignore everything until the handshake gives us the build/flows
    switch (msg.t) {
      case "hello": {
        authed = true;
        clientBuild = typeof msg.build === "string" ? msg.build : null;
        const current = deps.currentBuildHash();
        const build = current == null ? "unknown" : msg.build === current ? "match" : "stale";
        connected = { project: typeof msg.project === "string" ? msg.project : undefined, build };
        // The trail clears first, so a re-hello (after a live bundle refresh) that keeps a flow's last
        // frame puts the playhead back on it.
        deps.onReset();
        follower.hello(Array.isArray(msg.flows) ? msg.flows.filter((f): f is string => typeof f === "string") : []);
        break;
      }
      case "flowOpen": {
        if (typeof msg.flow === "string") follower.flowOpen(msg.flow);
        break;
      }
      case "flowClose": {
        if (typeof msg.flow === "string") follower.flowClose(msg.flow);
        break;
      }
      case "frame": {
        if (typeof msg.flow !== "string") break;
        follower.frame({
          flow: msg.flow,
          sceneId: typeof msg.sceneId === "string" ? msg.sceneId : null,
          beatId: typeof msg.beatId === "string" ? msg.beatId : null,
          type: typeof msg.type === "string" ? msg.type : "",
          choiceId: typeof msg.choiceId === "string" ? msg.choiceId : undefined,
        });
        break;
      }
    }
  };

  return {
    isOn: (): boolean => wss !== null,
    status,
    follow(flowId: string | null): void { follower.follow(flowId); },
    pushBundle(build: string, data: string): void {
      if (!client || !authed) return;       // nothing connected / handshaken
      if (clientBuild === build) return;    // the game already runs this exact build
      try { client.send(JSON.stringify({ t: "bundle", v: 1, build, data })); } catch { /* socket went away */ }
    },
    start(): void {
      if (wss) return;
      try {
        // Bind to loopback only: only processes on this machine can reach it (no pairing token needed).
        wss = new WebSocketServer({ host: "127.0.0.1", port, verifyClient: (info: { origin?: string }) => isLocalOrigin(info.origin) }, () => push()); // push "listening" once actually bound
      } catch (e) { deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) }); wss = null; return; }
      wss.on("error", (e) => { deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) }); });
      wss.on("connection", (ws) => {
        // One game at a time: a new connection replaces the old.
        if (client) { try { client.close(); } catch { /* gone */ } }
        client = ws; connected = null; authed = false; clientBuild = null; follower.clear();
        ws.on("message", (data) => handleMessage(data.toString()));
        ws.on("close", () => { if (client === ws) { client = null; connected = null; authed = false; clientBuild = null; follower.clear(); push(); } });
        ws.on("error", () => { /* a flaky client shouldn't crash the editor */ });
        push();
      });
    },
    stop(): void {
      try { client?.close(); } catch { /* gone */ }
      client = null; connected = null; authed = false; clientBuild = null; follower.clear();
      const s = wss; wss = null;
      try { s?.close(); } catch { /* already closing */ }
      push();
    },
  };
}
