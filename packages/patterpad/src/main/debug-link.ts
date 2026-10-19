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
// The server itself (loopback, the Origin rule, one game at a time, the hello gate, the build judged, and
// pushBundle) is the family's, app-shell's live-link (family parity item 14); this file is Patterpad's
// protocol plugged into it.
//
// Which flow the editor follows (the most recent, or one picked in the editor, and the hand-over when the
// followed flow closes) is shared/debug-follow.ts, which the browser preview's fake link drives too.

import type { DebugStatus } from "../shared/api.js";
import { createFlowFollower, type DebugFrame } from "../shared/debug-follow.js";
import { isLocalOrigin } from "@wildwinter/app-shell/util";
import { createLiveLinkServer } from "@wildwinter/app-shell/live-link";

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
   *  and re-hellos with the new build; until then the pill shows stale. */
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
  // The status pushes only once a game has said hello: before that it is "listening", and nothing the
  // follower shows has changed.
  let pushStatus = (): void => {};
  const follower = createFlowFollower({ onFrame: deps.onFrame, onChange: () => pushStatus() });

  const server = createLiveLinkServer({
    port: deps.port ?? DEFAULT_PORT,
    currentBuildHash: deps.currentBuildHash,
    onStatus: deps.onStatus,
    protocol: (link) => {
      pushStatus = link.pushStatus;
      return {
        hello: ({ msg }) => {
          // The trail clears first, so a re-hello (after a live bundle refresh) that keeps a flow's last
          // frame puts the playhead back on it.
          deps.onReset();
          follower.hello(Array.isArray(msg.flows) ? msg.flows.filter((f): f is string => typeof f === "string") : []);
        },
        message: (msg) => {
          switch (msg.t) {
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
        },
        reset: () => follower.clear(),
        describe: () => follower.view(),
      };
    },
  });

  return {
    isOn: () => server.isOn(),
    status: () => server.status(),
    follow(flowId: string | null): void { follower.follow(flowId); },
    pushBundle: (build, data) => server.pushBundle(build, data),
    start: () => server.start(),
    stop: () => server.stop(),
  };
}
