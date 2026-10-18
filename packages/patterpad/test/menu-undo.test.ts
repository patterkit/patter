// Edit ▸ Undo and Redo always went to the main window, whichever window had the focus, so Cmd+Z in the
// detached Search, Coverage or Play window undid the main window's scene (patterkit
// design/patterpad-undo.md, "Where Cmd+Z goes"). Another window gets its own text undo, as Select All
// already did; the main window still decides for itself.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MenuItemConstructorOptions } from "electron";

const state = vi.hoisted(() => ({ template: [] as unknown[], focused: null as unknown }));

vi.mock("electron", () => ({
  app: { getPath: () => "/home", getVersion: () => "0.0.0", isPackaged: true, name: "Patterpad" },
  shell: { openExternal: vi.fn() },
  Menu: { buildFromTemplate: (t: unknown[]) => { state.template = t; return {}; }, setApplicationMenu: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => state.focused },
}));
vi.mock("@wildwinter/app-shell/updater", () => ({ manualCheckForUpdates: vi.fn() }));

const { applyMenu } = await import("../src/main/menu.js");

const fakeWindow = () => ({ webContents: { send: vi.fn(), undo: vi.fn(), redo: vi.fn(), selectAll: vi.fn() } });

function editItem(label: string): MenuItemConstructorOptions {
  const edit = (state.template as MenuItemConstructorOptions[]).find((m) => m.label === "Edit")!;
  return (edit.submenu as MenuItemConstructorOptions[]).find((i) => i.label === label)!;
}
const click = (item: MenuItemConstructorOptions): void =>
  (item.click as unknown as () => void)();

describe("Edit ▸ Undo and Redo", () => {
  const main = fakeWindow();
  beforeEach(() => {
    vi.clearAllMocks();
    applyMenu(main as never, [], {} as never, {} as never);
  });

  it("in the main window, hand the choice to the main window's renderer", () => {
    state.focused = main;
    click(editItem("Undo"));
    click(editItem("Redo"));
    expect(main.webContents.send.mock.calls).toEqual([["menu", "undo"], ["menu", "redo"]]);
    expect(main.webContents.undo).not.toHaveBeenCalled();
  });

  it("in another window, undo that window's own text and leave the scene alone", () => {
    const search = fakeWindow();
    state.focused = search;
    click(editItem("Undo"));
    click(editItem("Redo"));
    expect(search.webContents.undo).toHaveBeenCalledTimes(1);
    expect(search.webContents.redo).toHaveBeenCalledTimes(1);
    expect(main.webContents.send).not.toHaveBeenCalled();
  });
});
