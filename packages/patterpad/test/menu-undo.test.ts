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

describe("view extensions in the menus", () => {
  const main = fakeWindow();
  const sheet = fakeWindow();
  const opened: string[] = [];
  const views = {
    offers: [
      { extension: "shot", view: "sheet", name: "Performance sheet", extensionName: "Shot", installed: true },
      { extension: "probe", view: "inspect", name: "Probe view", extensionName: "Probe", installed: false, why: "Probe isn't installed on this machine." },
    ],
    open: (e: string, v: string) => { opened.push(`open ${e}/${v}`); },
    install: (e: string) => { opened.push(`install ${e}`); },
    isView: (w: unknown) => w === sheet,
  };
  const menu = (label: string): MenuItemConstructorOptions[] =>
    ((state.template as MenuItemConstructorOptions[]).find((m) => m.label === label)!.submenu as MenuItemConstructorOptions[]);
  beforeEach(() => {
    vi.clearAllMocks();
    opened.length = 0;
    applyMenu(main as never, [], {} as never, {} as never, [], { hasProject: true, enabled: true, language: "en-US", dictionaries: [] }, false, false, false, false, false, false, views);
  });

  it("send a view window's Undo and Redo to the editor, whose journal holds its edits", () => {
    state.focused = sheet;
    click(editItem("Undo"));
    click(editItem("Redo"));
    expect(main.webContents.send.mock.calls).toEqual([["menu", "undo"], ["menu", "redo"]]);
    expect(sheet.webContents.undo).not.toHaveBeenCalled();
  });

  it("put Add Extension beside Project Settings", () => {
    const file = menu("File").map((i) => i.label);
    expect(file[file.indexOf("Project Settings…") + 1]).toBe("Add Extension…");
    click(menu("File").find((i) => i.label === "Add Extension…")!);
    expect(main.webContents.send.mock.calls).toEqual([["menu", "add-extension"]]);
  });

  it("list the project's views in the Window menu, one not installed here disabled with why, and its Install item", () => {
    const items = menu("Window");
    const sheetItem = items.find((i) => i.label === "Performance sheet")!;
    const probeItem = items.find((i) => i.label === "Probe view")!;
    expect(sheetItem.enabled).toBe(true);
    expect(probeItem).toMatchObject({ enabled: false, sublabel: "Probe isn't installed on this machine." });
    click(sheetItem);
    click(items.find((i) => i.label === "Install Probe on This Machine…")!);
    expect(opened).toEqual(["open shot/sheet", "install probe"]);
    // With no views on offer, the stock Window menu.
    applyMenu(main as never, [], {} as never, {} as never);
    expect((state.template as MenuItemConstructorOptions[]).some((m) => m.role === "windowMenu")).toBe(true);
  });
});
