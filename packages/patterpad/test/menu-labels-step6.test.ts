// The hands-on fixes review, Q20: File ▸ New Scene makes an Untitled scene at once (no dialog, so no "…",
// and the same key), the kits' gallery is its own item, and View ▸ Show Navigator is the shell's own label.

import { describe, it, expect, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

const state = vi.hoisted(() => ({ template: [] as unknown[] }));

vi.mock("electron", () => ({
  app: { getPath: () => "/home", getVersion: () => "0.0.0", isPackaged: true, name: "Patterpad" },
  shell: { openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown[]) => { state.template = t; return {}; }, setApplicationMenu: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null },
}));
vi.mock("@wildwinter/app-shell/updater", () => ({ manualCheckForUpdates: vi.fn() }));

const { applyMenu } = await import("../src/main/menu.js");
const { PANE_MENU } = await import("@wildwinter/app-shell/menu");

const win = { webContents: { send: vi.fn() } };
const spelling = { hasProject: true, enabled: true, language: "en-GB", dictionaries: [] };
function menu(label: string): MenuItemConstructorOptions[] {
  applyMenu(win as never, [], { nav: true, inspector: true } as never, {} as never, [], spelling);
  return (state.template as MenuItemConstructorOptions[]).find((m) => m.label === label)!.submenu as MenuItemConstructorOptions[];
}

describe("the scene labels (Q20)", () => {
  it("File ▸ New Scene has no ellipsis and keeps its key; the kits are New Scene from Kit…", () => {
    const file = menu("File");
    expect(file.find((i) => i.label === "New Scene")).toMatchObject({ accelerator: "Shift+CmdOrCtrl+N" });
    expect(file.some((i) => i.label === "New Scene…")).toBe(false);
    file.find((i) => i.label === "New Scene")!.click!({} as never, undefined, {} as never);
    expect(win.webContents.send).toHaveBeenLastCalledWith("menu", "new-scene");
    file.find((i) => i.label === "New Scene from Kit…")!.click!({} as never, undefined, {} as never);
    expect(win.webContents.send).toHaveBeenLastCalledWith("menu", "new-scene-kit");
  });

  it("View ▸ Show Navigator is the shell's label", () => {
    const view = menu("View");
    expect(view.some((i) => i.label === "Show Scenes")).toBe(false);
    expect(view.find((i) => i.label === PANE_MENU.showNav.label)).toBeDefined();
    expect(PANE_MENU.showNav.label).toBe("Show Navigator");
  });
});
