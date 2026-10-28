// Edit ▸ Move Up and Move Down (the hands-on fixes review, Q14 and ruling 3): on the surface's own keys
// (Ctrl+Cmd+Up / Down on a Mac, Ctrl+Alt elsewhere), greyed until the renderer says what has focus can
// move, and sent to the renderer, which moves the focused scene or the script's selection.

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

const { applyMenu, setMoveEnabled, moveAccelerator } = await import("../src/main/menu.js");
const { moveCombo } = await import("../../patterpad-surface/web/move.js");
const { keyPlatform } = await import("@wildwinter/app-shell");

const win = { webContents: { send: vi.fn() } };
const spelling = { hasProject: true, enabled: true, language: "en-GB", dictionaries: [] };
function editItem(label: string): MenuItemConstructorOptions {
  applyMenu(win as never, [], {} as never, {} as never, [], spelling);
  const edit = (state.template as MenuItemConstructorOptions[]).find((m) => m.label === "Edit")!;
  return (edit.submenu as MenuItemConstructorOptions[]).find((i) => i.label === label)!;
}

describe("Edit ▸ Move Up / Move Down", () => {
  it("carry the surface's move keys, spelled for Electron", () => {
    expect(moveAccelerator(-1, true)).toBe("Ctrl+Cmd+Up");
    expect(moveAccelerator(1, false)).toBe("Ctrl+Alt+Down");
    // The surface's portable combo on this platform, with its "Mod" (Cmd on a Mac) spelled out.
    const mac = keyPlatform() === "mac";
    for (const dir of [-1, 1] as const) expect(moveAccelerator(dir, mac)).toBe(moveCombo(dir).replace("Mod", "Cmd"));
  });

  it("are greyed until the renderer says the move can happen, and send the command", () => {
    setMoveEnabled({ up: false, down: false });
    expect(editItem("Move Up").enabled).toBe(false);
    expect(setMoveEnabled({ up: true, down: false })).toBe(true);
    expect(setMoveEnabled({ up: true, down: false })).toBe(false); // unchanged: no rebuild
    expect(editItem("Move Up").enabled).toBe(true);
    expect(editItem("Move Down").enabled).toBe(false);
    (editItem("Move Up").click as unknown as () => void)();
    expect(win.webContents.send).toHaveBeenCalledWith("menu", "move-up");
  });
});
