// Live debug link (#181) - the editor-side server.
//
// A localhost WebSocket server in the main process that a running Patterplay game connects to and streams
// its story position into. Incoming frames for the followed flow are forwarded to the renderer's EXISTING
// playhead path (the same `play:mark` the in-app Play window uses), so the editor follows the live cursor
// like a debugger. The editor drives the game in two ways: it pushes a freshly compiled bundle (`bundle`)
// after a save, or when a game says hello on an older build, and it asks the game to start a block
// (`play`, Play in game).
//
// Wire protocol `patterplay/debug@1` (mirrors @patterkit/play-helpers' createDebugLink):
//   hello : { t:"hello", v, build, project?, flows? }   - verified, seeds the flow list
//   frame : { t:"frame", flow, sceneId, beatId, type, choiceId? } - a choice frame sent again with
//           `choiceId` set names the option taken, which the editor marks
//   flow  : { t:"flowOpen" | "flowClose", flow }
//   bundle: { t:"bundle", v:1, build, data }   - SERVER -> client: live bundle refresh. `data` is the
//           full .patterc JSON; the client picks the tier itself (strings-only vs full hot swap) by
//           comparing structure hashes, applies it, and re-hellos with the new build.
//   play  : { t:"play", v:1, id, sceneId, blockId, takeOver, build? } - SERVER -> client: Play in game,
//           start this block now (takeOver: interrupt what's playing; what it stops is the game's to
//           decide, and Patterstage stops everything on that director). `build` is the
//           project's bundle hash, so a game still on an older bundle can answer "staleBuild".
//   played: { t:"played", id, started, reason?, detail? } - the game's answer. Any reason passes
//           through; shared/play-in-game.ts has the plain words for the ones we know.

//
// The server itself (loopback, the Origin rule, one game at a time, the hello gate, the build judged, and
// pushBundle) is the family's, app-shell's live-link (family parity item 14); this file is Patterpad's
// protocol plugged into it.
//
// Which flow the editor follows (the most recent, or one picked in the editor, and the hand-over when the
// followed flow closes) is shared/debug-follow.ts, which the browser preview's fake link drives too.

import type { DebugStatus, PlayInGameAnswer } from "../shared/api.js";
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
  /** Send the status again: the published bundle changed, so the unpublished marker may have. */
  refreshStatus(): void;
  /** The build the connected game last said it runs; null with no game. */
  gameBuild(): string | null;
  /** Play in game: ask the connected game to start a block now, and resolve with its answer. Resolves
   *  `noGame` when nothing is connected and `noAnswer` when the game says nothing in time. When the game
   *  isn't on the project's current build (a save whose push is still waiting, a game that connected
   *  behind), the push goes now and the request waits for the game to take it, so it isn't refused as
   *  stale for a save the writer has just made. `cantPush` when the story can't be compiled to send. */
  playInGame(req: { sceneId: string; blockId: string; takeOver: boolean }): Promise<PlayInGameAnswer>;
}

export interface DebugServerDeps {
  /** The project's current compiled bundle hash, recomputed at handshake to detect a stale running build. */
  currentBuildHash: () => string | null;
  /** Compile the current bundle and push it now, cancelling a push still waiting on its debounce. False
   *  when there was nothing to push (the story doesn't compile mid-edit). A game that says hello on an
   *  older build is sent one through this, once per connection. */
  pushNow?: () => boolean;
  /** The published bundle's hash, for the unpublished marker. */
  publishedBuildHash?: () => string | null;
  /** Forward a followed-flow frame to the editor playhead. */
  onFrame: (f: DebugFrame) => void;
  /** Clear the editor's visited trail (a game (re)connected and a fresh run begins, or the game that was
   *  moving the playhead went away). */
  onReset: () => void;
  /** Push the latest status to the renderer panel. */
  onStatus: (s: DebugStatus) => void;
  port?: number;
  /** How long to wait for a game's answer, and for a just-pushed bundle to land first (ms). */
  playTimeoutMs?: number;
}

export function createDebugServer(deps: DebugServerDeps): DebugServer {
  // The status pushes only once a game has said hello: before that it is "listening", and nothing the
  // follower shows has changed.
  let pushStatus = (): void => {};
  // Whether the game has put the editor's playhead anywhere since the last reset: when it goes away, the
  // playhead it left clears, as it does when the Play window closes. One it never moved (the writer's own
  // Play run) is left alone.
  let drove = false;
  const follower = createFlowFollower({ onFrame: (f) => { drove = true; deps.onFrame(f); }, onChange: () => pushStatus() });
  const playTimeout = deps.playTimeoutMs ?? 5000;
  // Play in game requests awaiting the game's answer, by id. An answer after the timeout finds nothing.
  const pending = new Map<string, (a: PlayInGameAnswer) => void>();
  let nextPlayId = 1;
  const answerAll = (a: PlayInGameAnswer): void => { for (const done of [...pending.values()]) done(a); };

  const server = createLiveLinkServer({
    port: deps.port ?? DEFAULT_PORT,
    currentBuildHash: deps.currentBuildHash,
    ...(deps.publishedBuildHash ? { publishedBuildHash: deps.publishedBuildHash } : {}),
    onStaleHello: () => { deps.pushNow?.(); },
    onStatus: deps.onStatus,
    protocol: (link) => {
      pushStatus = link.pushStatus;
      return {
        hello: ({ msg }) => {
          // The trail clears first, so a re-hello (after a live bundle refresh) that keeps a flow's last
          // frame puts the playhead back on it.
          deps.onReset();
          drove = false;
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
            case "played": {
              if (typeof msg.id !== "string") break;
              pending.get(msg.id)?.({
                started: msg.started === true,
                ...(typeof msg.reason === "string" && msg.reason !== "" ? { reason: msg.reason } : {}),
                ...(typeof msg.detail === "string" && msg.detail !== "" ? { detail: msg.detail } : {}),
              });
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
        reset: () => {
          follower.clear(); answerAll({ started: false, reason: "noGame" });
          if (drove) { drove = false; deps.onReset(); } // the game went away: its playhead goes with it
        },
        describe: () => follower.view(),
      };
    },
  });

  return {
    isOn: () => server.isOn(),
    status: () => server.status(),
    follow(flowId: string | null): void { follower.follow(flowId); },
    pushBundle: (build, data) => server.pushBundle(build, data),
    refreshStatus: () => server.pushStatus(),
    gameBuild: () => server.gameBuild(),
    async playInGame(req) {
      if (server.status().state !== "connected") return { started: false, reason: "noGame" };
      const build = deps.currentBuildHash();
      // The game isn't on this build: a save's push may still be waiting out its debounce, or the game
      // connected on an older bundle. Push now, then give the game the chance to apply it and re-hello.
      if (build !== null && server.gameBuild() !== build) {
        if (deps.pushNow && !deps.pushNow()) return { started: false, reason: "cantPush" };
        const deadline = Date.now() + playTimeout;
        while (server.status().state === "connected" && server.gameBuild() !== build && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 50));
        }
        if (server.status().state !== "connected") return { started: false, reason: "noGame" };
      }
      const id = `play-${nextPlayId++}`;
      return new Promise<PlayInGameAnswer>((resolve) => {
        const timer = setTimeout(() => done({ started: false, reason: "noAnswer" }), playTimeout);
        function done(a: PlayInGameAnswer): void { clearTimeout(timer); pending.delete(id); resolve(a); }
        pending.set(id, done);
        const sent = server.send({
          t: "play", v: 1, id, sceneId: req.sceneId, blockId: req.blockId, takeOver: req.takeOver,
          ...(build ? { build } : {}),
        });
        if (!sent) done({ started: false, reason: "noGame" });
      });
    },
    start: () => server.start(),
    stop: () => server.stop(),
  };
}
