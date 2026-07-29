// @vitest-environment jsdom
// The updater dialog's live download-progress row (#33): shown only when the prompt asks for it,
// fed by feedUpdaterDownloadProgress while open, and detached the moment the dialog closes so a
// still-running download can never write into a dialog that's gone.

import { describe, it, expect, beforeAll } from "vitest";
import { showUpdaterDialog, feedUpdaterDownloadProgress } from "../src/renderer/src/updater-dialog.js";
import type { UpdaterDownloadProgress } from "../src/shared/api.js";

beforeAll(() => {
  // Older jsdom has no <dialog> methods; the dialog only needs open/close semantics here.
  const proto = window.HTMLDialogElement?.prototype as { showModal?: () => void; close?: () => void } | undefined;
  if (proto && !proto.showModal) {
    proto.showModal = function (this: HTMLDialogElement) { this.setAttribute("open", ""); };
    proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  }
});

const tick = (over: Partial<UpdaterDownloadProgress> = {}): UpdaterDownloadProgress => ({
  percent: 42, transferred: 44_040_192, total: 104_857_600, bytesPerSecond: 2_097_152, version: "9.9.9", ...over,
});

function openDialog(progress: boolean): { dlg: HTMLDialogElement; done: Promise<number> } {
  const done = showUpdaterDialog({ message: "Update available", detail: "Downloading.", buttons: ["OK"], progress });
  const dlg = document.querySelector("dialog.um-dialog") as HTMLDialogElement;
  expect(dlg).toBeTruthy();
  return { dlg, done };
}

describe("updater dialog download progress (#33)", () => {
  it("renders the progress row only when asked, and feeds it live", async () => {
    const { dlg, done } = openDialog(true);
    const bar = dlg.querySelector<HTMLElement>(".um-progress-bar")!;
    const label = dlg.querySelector<HTMLElement>(".um-progress-label")!;
    expect(bar).toBeTruthy();
    expect(label.textContent).toMatch(/Starting download/);

    feedUpdaterDownloadProgress(tick());
    expect(bar.style.width).toBe("42%");
    expect(label.textContent).toBe("42% - 42.0 of 100.0 MB (2.0 MB/s)");

    feedUpdaterDownloadProgress(tick({ percent: 137 })); // clamped
    expect(bar.style.width).toBe("100%");

    dlg.querySelector("button")!.click();
    expect(await done).toBe(0);
  });

  it("stops feeding once the dialog closes (a late tick must not resurrect it)", async () => {
    const { dlg, done } = openDialog(true);
    const bar = dlg.querySelector<HTMLElement>(".um-progress-bar")!;
    feedUpdaterDownloadProgress(tick({ percent: 10 }));
    expect(bar.style.width).toBe("10%");

    dlg.querySelector("button")!.click();
    await done;
    feedUpdaterDownloadProgress(tick({ percent: 90 })); // download still running; dialog gone
    expect(bar.style.width).toBe("10%"); // the detached bar is left alone
    expect(document.querySelector("dialog.um-dialog")).toBeNull();
  });

  it("a plain (non-progress) dialog has no row and ignores ticks", async () => {
    const { dlg, done } = openDialog(false);
    expect(dlg.querySelector(".um-progress-bar")).toBeNull();
    feedUpdaterDownloadProgress(tick()); // must be a no-op, not a throw
    dlg.querySelector("button")!.click();
    await done;
  });
});
