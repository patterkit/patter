// The live debug link (#181) end to end: the editor-side WebSocket server (main/debug-link.ts) talking to
// the game-side client (@patterkit/play-helpers createDebugLink) over a real localhost socket. Verifies the
// build handshake (match / stale / unknown), per-flow tracking, and that only the FOLLOWED flow forwards.

import { describe, it, expect, afterEach } from "vitest";
import { WebSocket } from "ws";
import { createDebugServer, type DebugFrame, type DebugServer } from "../src/main/debug-link.js";
import { createDebugLink, type DebugSocketLike } from "@patterkit/play-helpers";
import type { DebugStatus } from "../src/shared/api.js";

const WS = WebSocket as unknown as new (url: string) => DebugSocketLike;

let nextPort = 4520; // a fresh port per test avoids collisions
let server: DebugServer | null = null;
afterEach(() => { server?.stop(); server = null; });

interface Harness {
  port: number;
  frames: DebugFrame[];
  statuses: DebugStatus[];
  resets: () => number;
  waitFor: (pred: (s: DebugStatus) => boolean) => Promise<DebugStatus>;
  connected: () => DebugStatus | undefined;
}

async function startServer(buildHash: string | null): Promise<Harness> {
  const port = nextPort++;
  const frames: DebugFrame[] = [];
  const statuses: DebugStatus[] = [];
  let resets = 0;
  const waiters: Array<{ pred: (s: DebugStatus) => boolean; resolve: (s: DebugStatus) => void }> = [];
  server = createDebugServer({
    port,
    currentBuildHash: () => buildHash,
    onFrame: (f) => frames.push(f),
    onReset: () => { resets++; },
    onStatus: (s) => { statuses.push(s); const keep: typeof waiters = []; for (const w of waiters) { if (w.pred(s)) w.resolve(s); else keep.push(w); } waiters.length = 0; waiters.push(...keep); },
  });
  const waitFor = (pred: (s: DebugStatus) => boolean): Promise<DebugStatus> =>
    new Promise((resolve) => { const hit = [...statuses].reverse().find(pred); if (hit) resolve(hit); else waiters.push({ pred, resolve }); });
  server.start();
  await waitFor((s) => s.state === "listening");
  return { port, frames, statuses, resets: () => resets, waitFor, connected: () => statuses.find((s) => s.state === "connected") };
}

async function connect(h: Harness, build: string, flows: string[] = []): Promise<ReturnType<typeof createDebugLink>> {
  const link = createDebugLink({ build, project: "Test", url: `ws://127.0.0.1:${h.port}`, WebSocket: WS });
  for (const f of flows) link.flowOpened(f);
  await h.waitFor((s) => s.state === "connected");
  return link;
}

function waitUntil(pred: () => boolean, timeoutMs = 1500): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = (): void => { if (pred()) return resolve(); if (Date.now() - t0 > timeoutMs) return reject(new Error("timed out")); setTimeout(tick, 5); };
    tick();
  });
}

describe("live debug link", () => {
  it("handshake reports build 'match' when the running build equals the project's", async () => {
    const h = await startServer("HASH_A");
    const link = await connect(h, "HASH_A", ["main"]);
    expect(h.connected()).toMatchObject({ state: "connected", build: "match", project: "Test", flows: ["main"], following: "main" });
    expect(h.resets()).toBeGreaterThan(0); // a fresh run cleared the editor trail
    link.close();
  });

  it("reports 'stale' on a build mismatch, 'unknown' when no project is open", async () => {
    const stale = await startServer("HASH_A");
    (await connect(stale, "HASH_B", ["main"]));
    expect(stale.connected()).toMatchObject({ build: "stale" });
    server?.stop();

    const unknown = await startServer(null);
    (await connect(unknown, "anything", ["main"]));
    expect(unknown.connected()).toMatchObject({ build: "unknown" });
  });

  it("ignores frames that arrive before the handshake (need build/flow context first)", async () => {
    const h = await startServer("H");
    // A raw client that sends a frame WITHOUT a hello first.
    const raw = new WS(`ws://127.0.0.1:${h.port}`);
    await new Promise<void>((res) => raw.addEventListener("open", () => res()));
    raw.send(JSON.stringify({ t: "frame", flow: "main", sceneId: "s", beatId: "b", type: "line" }));
    await new Promise((r) => setTimeout(r, 200));
    expect(h.connected()).toBeUndefined(); // no hello -> never connected
    expect(h.frames).toHaveLength(0);       // pre-handshake frame dropped
    raw.close();
  });

  it("forwards only the FOLLOWED flow's frames, and switching follow replays its last position", async () => {
    const h = await startServer("H");
    const link = await connect(h, "H", ["main", "ambient"]);

    link.observe("main", "scn1", "beatA", "line");
    link.observe("ambient", "scn9", "beatZ", "line"); // not followed -> dropped
    await waitUntil(() => h.frames.length >= 1);
    expect(h.frames).toEqual([{ flow: "main", sceneId: "scn1", beatId: "beatA", type: "line", choiceId: undefined }]);

    server!.follow("ambient");               // its last frame (beatZ) replays at once
    await waitUntil(() => h.frames.length >= 2);
    expect(h.frames[1]).toMatchObject({ flow: "ambient", beatId: "beatZ" });

    link.observe("main", "scn1", "beatB", "line");   // main no longer followed -> dropped
    link.observe("ambient", "scn9", "beatY", "text");
    await waitUntil(() => h.frames.length >= 3);
    expect(h.frames[2]).toMatchObject({ flow: "ambient", beatId: "beatY", type: "text" });
    link.close();
  });

  it("live bundle refresh: pushBundle reaches onBundle, setBuild re-hellos to 'match', and a matching build is never re-pushed", async () => {
    const h = await startServer("HASH_NEW");
    const pushed: Array<{ build: string; data: string }> = [];
    const link = createDebugLink({
      build: "HASH_OLD", project: "Test", url: `ws://127.0.0.1:${h.port}`, WebSocket: WS,
      onBundle: (msg) => { pushed.push(msg); link.setBuild(msg.build); }, // apply + report, like a real host
    });
    link.flowOpened("main");
    await h.waitFor((s) => s.state === "connected" && s.build === "stale"); // the game runs old content

    server!.pushBundle("HASH_NEW", "{\"fake\":\"bundle\"}");
    await waitUntil(() => pushed.length === 1);
    expect(pushed[0]).toEqual({ build: "HASH_NEW", data: "{\"fake\":\"bundle\"}" });

    // The client's re-hello lands: the editor's pill flips to match without any new UI path.
    await h.waitFor((s) => s.state === "connected" && s.build === "match");

    // Pushing the SAME build again is a no-op: the client already runs it.
    server!.pushBundle("HASH_NEW", "{\"fake\":\"bundle\"}");
    await new Promise((r) => setTimeout(r, 150));
    expect(pushed).toHaveLength(1);
    link.close();
  });
});
