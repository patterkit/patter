// Live debug link (#181) - the editor-side server.
//
// A localhost WebSocket server in the main process that a running Patterplay game connects to and streams
// its story position into. Observe-only: the editor never drives the game. Incoming frames for the
// followed flow are forwarded to the renderer's EXISTING playhead path (the same `play:mark` the in-app
// Play window uses), so the editor follows the live cursor like a debugger.
//
// Wire protocol `patterplay/debug@1` (mirrors @patterkit/play-helpers' createDebugLink):
//   hello : { t:"hello", v, build, project?, token?, flows? }   - verified, seeds the flow list
//   frame : { t:"frame", flow, sceneId, beatId, type, choiceId? }
//   flow  : { t:"flowOpen" | "flowClose", flow }
//   bundle: { t:"bundle", v:1, build, data }   - SERVER -> client: live bundle refresh. `data` is the
//           full .patterc JSON; the client picks the tier itself (strings-only vs full hot swap) by
//           comparing structure hashes, applies it, and re-hellos with the new build.

import { WebSocketServer, type WebSocket } from "ws";
import type { DebugStatus } from "../shared/api.js";

const DEFAULT_PORT = 4471;

/** A position frame for one flow. */
export interface DebugFrame { flow: string; sceneId: string | null; beatId: string | null; type: string; choiceId?: string }

export interface DebugServer {
  start(): void;
  stop(): void;
  status(): DebugStatus;
  /** Follow a different flow's cursor (re-points the single editor playhead). */
  follow(flowId: string): void;
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
  const flows = new Set<string>();
  const lastFrame = new Map<string, DebugFrame>(); // per-flow last position, so following a flow jumps at once
  let following: string | null = null;
  let authed = false; // a hello must land before any frame is honoured (so we have the build/flow context)
  let clientBuild: string | null = null; // the build the game reported (last hello) - gates pushBundle

  const status = (): DebugStatus => {
    if (!wss) return { state: "off" };
    if (!client || !connected) return { state: "listening", port };
    return { state: "connected", port, project: connected.project, build: connected.build, flows: [...flows], following };
  };
  const push = (): void => deps.onStatus(status());

  const setFollowing = (id: string | null): void => {
    following = id;
    const f = id ? lastFrame.get(id) : undefined;
    if (f) deps.onFrame(f); // jump the playhead to where that flow is right now
  };

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
        flows.clear(); lastFrame.clear();
        for (const f of Array.isArray(msg.flows) ? msg.flows : []) if (typeof f === "string") flows.add(f);
        following = flows.size ? [...flows][0]! : null;
        deps.onReset(); push();
        break;
      }
      case "flowOpen": {
        if (typeof msg.flow === "string") { flows.add(msg.flow); if (following == null) following = msg.flow; push(); }
        break;
      }
      case "flowClose": {
        if (typeof msg.flow === "string") {
          flows.delete(msg.flow); lastFrame.delete(msg.flow);
          if (following === msg.flow) following = flows.size ? [...flows][0]! : null;
          push();
        }
        break;
      }
      case "frame": {
        if (typeof msg.flow !== "string") break;
        const frame: DebugFrame = {
          flow: msg.flow,
          sceneId: typeof msg.sceneId === "string" ? msg.sceneId : null,
          beatId: typeof msg.beatId === "string" ? msg.beatId : null,
          type: typeof msg.type === "string" ? msg.type : "",
          choiceId: typeof msg.choiceId === "string" ? msg.choiceId : undefined,
        };
        flows.add(frame.flow); lastFrame.set(frame.flow, frame);
        if (following == null) { following = frame.flow; push(); }
        if (frame.flow === following) deps.onFrame(frame);
        break;
      }
    }
  };

  return {
    isOn: (): boolean => wss !== null,
    status,
    follow(flowId: string): void { if (flows.has(flowId)) { setFollowing(flowId); push(); } },
    pushBundle(build: string, data: string): void {
      if (!client || !authed) return;       // nothing connected / handshaken
      if (clientBuild === build) return;    // the game already runs this exact build
      try { client.send(JSON.stringify({ t: "bundle", v: 1, build, data })); } catch { /* socket went away */ }
    },
    start(): void {
      if (wss) return;
      try {
        // Bind to loopback only: only processes on this machine can reach it (no pairing token needed).
        wss = new WebSocketServer({ host: "127.0.0.1", port }, () => push()); // push "listening" once actually bound
      } catch (e) { deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) }); wss = null; return; }
      wss.on("error", (e) => { deps.onStatus({ state: "error", message: e instanceof Error ? e.message : String(e) }); });
      wss.on("connection", (ws) => {
        // One game at a time: a new connection replaces the old.
        if (client) { try { client.close(); } catch { /* gone */ } }
        client = ws; connected = null; authed = false; clientBuild = null; flows.clear(); lastFrame.clear(); following = null;
        ws.on("message", (data) => handleMessage(data.toString()));
        ws.on("close", () => { if (client === ws) { client = null; connected = null; authed = false; clientBuild = null; flows.clear(); lastFrame.clear(); following = null; push(); } });
        ws.on("error", () => { /* a flaky client shouldn't crash the editor */ });
        push();
      });
    },
    stop(): void {
      try { client?.close(); } catch { /* gone */ }
      client = null; connected = null; authed = false; clientBuild = null; flows.clear(); lastFrame.clear(); following = null;
      const s = wss; wss = null;
      try { s?.close(); } catch { /* already closing */ }
      push();
    },
  };
}
