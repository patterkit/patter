// The updater's download watchdog (#33): a download that hangs WITHOUT erroring - the failure that
// left a Windows user "downloading in the background" all day - must be killed after the stall
// window and retried, and must give up (loudly, in state) after the attempt budget. Everything here
// drives the real updater module against a scripted electron-updater: each downloadUpdate call takes
// the next behaviour from a queue ("hang" until cancelled / "succeed" / "fail"), and time is fake.

import { describe, it, expect, vi, beforeEach } from "vitest";

type Handler = (...args: unknown[]) => void;

const H = vi.hoisted(() => {
  const handlers = new Map<string, Handler[]>();
  class FakeCancellationToken {
    cancelled = false;
    onCancel: (() => void) | null = null;
    cancel(): void { this.cancelled = true; this.onCancel?.(); }
  }
  const state = {
    handlers,
    tokens: [] as FakeCancellationToken[],
    // Per-call script for downloadUpdate: "hang" rejects only when the watchdog cancels its token;
    // "fail" rejects immediately; "succeed" resolves and fires update-downloaded.
    downloadScript: [] as ("hang" | "fail" | "succeed")[],
    downloadCalls: 0,
    emit(event: string, ...args: unknown[]): void { for (const h of handlers.get(event) ?? []) h(...args); },
    reset(): void { handlers.clear(); state.tokens = []; state.downloadScript = []; state.downloadCalls = 0; },
  };
  const autoUpdater = {
    autoDownload: true, autoInstallOnAppQuit: false, disableDifferentialDownload: false,
    logger: null as unknown,
    on(event: string, h: Handler) { const list = handlers.get(event) ?? []; list.push(h); handlers.set(event, list); },
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate(token: FakeCancellationToken): Promise<string[]> {
      state.downloadCalls += 1;
      state.tokens.push(token);
      const behaviour = state.downloadScript.shift() ?? "hang";
      if (behaviour === "fail") return Promise.reject(new Error("network reset"));
      if (behaviour === "succeed") {
        return new Promise((resolve) => { setTimeout(() => { state.emit("update-downloaded", { version: "9.9.9" }); resolve([]); }, 1000); });
      }
      return new Promise((_resolve, reject) => { token.onCancel = () => reject(new Error("cancelled")); });
    },
    quitAndInstall: vi.fn(),
  };
  return { state, autoUpdater, FakeCancellationToken };
});

vi.mock("electron", () => ({
  app: { getPath: () => require("node:os").tmpdir(), isPackaged: false, getVersion: () => "0.0.0" },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { once: () => undefined, removeListener: () => undefined },
}));
vi.mock("electron-updater", () => ({
  default: { autoUpdater: H.autoUpdater, CancellationToken: H.FakeCancellationToken },
}));

const STALL_MS = 3 * 60 * 1000;
const RETRY_DELAY_MS = 15 * 1000;

describe("updater download watchdog (#33)", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    H.state.reset();
    vi.resetModules();
    await import("../src/main/updater.js"); // registers the real handlers against the fake autoUpdater
  });

  it("kills a download that reports no progress, retries, and the retry can succeed", async () => {
    H.state.downloadScript = ["hang", "succeed"];
    H.state.emit("update-available", { version: "9.9.9" });
    expect(H.state.downloadCalls).toBe(1);

    // Progress keeps it alive: advance close to the stall window, feed a tick, advance again.
    await vi.advanceTimersByTimeAsync(STALL_MS - 30_000);
    H.state.emit("download-progress", { percent: 10, transferred: 1, total: 10, bytesPerSecond: 1 });
    await vi.advanceTimersByTimeAsync(STALL_MS - 30_000);
    expect(H.state.tokens[0]!.cancelled).toBe(false); // never STALL_MS quiet yet

    // Now go silent past the stall window: the watchdog must cancel and, after the delay, retry.
    await vi.advanceTimersByTimeAsync(STALL_MS + 60_000);
    expect(H.state.tokens[0]!.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 2_000);
    expect(H.state.downloadCalls).toBe(2);

    // Second attempt is scripted to succeed; update-downloaded must stop the watchdog for good.
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(STALL_MS * 3);
    expect(H.state.tokens.length).toBe(2); // no further attempts after success
  });

  it("stops after three attempts, then a fresh update-available starts a new cycle", async () => {
    H.state.downloadScript = ["hang", "fail", "hang"];
    H.state.emit("update-available", { version: "9.9.9" });

    await vi.advanceTimersByTimeAsync(STALL_MS + 60_000);   // attempt 1 stalls
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1_000); // attempt 2 fails fast
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS + 1_000); // attempt 3 starts, hangs
    expect(H.state.downloadCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(STALL_MS + 60_000);   // attempt 3 stalls: budget exhausted
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 10);
    expect(H.state.downloadCalls).toBe(3); // gave up - no fourth attempt this cycle

    // The next background check cycle re-offers the update; a fresh budget begins.
    H.state.downloadScript = ["succeed"];
    H.state.emit("update-available", { version: "9.9.9" });
    expect(H.state.downloadCalls).toBe(4);
  });

  it("ignores a duplicate update-available while a download is already running", async () => {
    H.state.downloadScript = ["hang"];
    H.state.emit("update-available", { version: "9.9.9" });
    H.state.emit("update-available", { version: "9.9.9" });
    expect(H.state.downloadCalls).toBe(1);
  });
});
