// The view windows in Patterpad's main process (views.ts): one window per view, however quickly it's asked
// for twice, none opened for a project that has gone meanwhile, and every window of a view the project no
// longer offers closed when the offers are worked out again (an Add Extension undone).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseManifest } from "@wildwinter/toolkit/extensions";

const shell = vi.hoisted(() => ({ opened: [] as { closed: boolean; window: unknown }[], resolveDelay: 0, installed: true }));

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp", isPackaged: true },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock("@wildwinter/app-shell/tool-window", () => ({ savedWindowRect: () => ({ width: 1, height: 1 }), rescueToolWindow: vi.fn(), pinToolWindow: vi.fn() }));
vi.mock("@wildwinter/app-shell/view-host", () => ({
  readExtensionPackage: vi.fn(), installExtensionPackage: vi.fn(),
  resolveInstalled: async () => {
    await new Promise((r) => setTimeout(r, shell.resolveDelay));
    return shell.installed ? { installed: { id: "shot", version: "0.3.0", root: "/x", manifest: MANIFEST } } : { installed: null, why: "Shot isn't installed on this machine." };
  },
  openViewWindow: () => {
    const v = { closed: false, window: { isDestroyed: () => v.closed, focus: vi.fn() }, meta: { window: shell.opened.length + 1 }, close: () => { v.closed = true; } };
    shell.opened.push(v);
    return v;
  },
}));

const MANIFEST = parseManifest(JSON.stringify({
  schema: "wildwinter/extension@0", id: "shot", name: "Shot", version: "0.3.0",
  targets: { patter: { line: { fields: [{ name: "camera", type: "text" }] } } },
  views: [{ id: "sheet", name: "Performance sheet", entry: "view/sheet.js", element: "shot-sheet" }],
}));

const { createViewExtensions } = await import("../src/main/views.js");

function make() {
  let taken = [{ id: "shot", pin: "0.3.0", manifest: MANIFEST }];
  const views = createViewExtensions({
    dir: "/tmp/views", editor: () => ({}) as never, root: () => "/p", taken: () => taken,
    slice: () => ({ bounds: () => undefined, remember: vi.fn(), pinned: () => true, setPinned: vi.fn() }),
    tell: async () => {}, flushEditor: async () => {}, take: vi.fn(), refreshMenu: vi.fn(),
  });
  return { views, untake: () => { taken = []; } };
}

describe("view windows", () => {
  beforeEach(() => { shell.opened.length = 0; shell.resolveDelay = 0; shell.installed = true; });

  it("opens one window for two quick asks", async () => {
    const { views } = make();
    shell.resolveDelay = 10;
    await Promise.all([views.open("shot", "sheet"), views.open("shot", "sheet")]);
    expect(shell.opened).toHaveLength(1);
    await views.open("shot", "sheet"); // open already: brought forward, not opened again
    expect(shell.opened).toHaveLength(1);
  });

  it("opens none for a project that closed while it was on its way", async () => {
    const { views } = make();
    shell.resolveDelay = 10;
    const on = views.open("shot", "sheet");
    views.closeAll();
    await on;
    expect(shell.opened).toHaveLength(0);
  });

  it("closes a view the project no longer offers here when the offers are worked out again", async () => {
    const { views, untake } = make();
    await views.update();
    await views.open("shot", "sheet");
    expect(shell.opened[0]!.closed).toBe(false);
    await views.update(); // still offered and installed: stays
    expect(shell.opened[0]!.closed).toBe(false);
    untake(); // Add Extension undone
    await views.update();
    expect(shell.opened[0]!.closed).toBe(true);
    expect(views.isView(shell.opened[0]!.window as never)).toBe(false);
  });
});
