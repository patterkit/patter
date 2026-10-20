// DEV-ONLY preview of the FIELDS window: stubs window.patterFields over a BroadcastChannel to the editor's
// preview tab (dev.ts), which plays main's part. Open index.html in one tab and fields.html in another.
import type { FieldsWinState, PatterFieldsApi } from "../../shared/api.js";

const channel = new BroadcastChannel("patterpad-fields-preview");
let onState: ((s: FieldsWinState) => void) | undefined;
const empty: FieldsWinState = { hasProject: true, node: null, readOnly: false, readOnlyWhy: "", grids: [], hint: "Open the editor preview in another tab." };
channel.onmessage = (e: MessageEvent<{ t: string; state?: FieldsWinState }>) => {
  if (e.data.t === "state" && e.data.state) onState?.(e.data.state);
};

const stub: PatterFieldsApi = {
  info: async () => ({ state: empty, pinned: true, follow: true, theme: { colour: "system", font: "newsreader" } }),
  commit: (id, extension, field, value) => { channel.postMessage({ t: "commit", id, extension, field, value }); },
  setFollow: (on) => { channel.postMessage({ t: "follow", on }); },
  setPin: (on) => console.log("setPin", on),
  close: () => console.log("close"),
  onState: (handler) => { onState = handler; channel.postMessage({ t: "hello" }); },
  onProject: () => undefined,
  onPin: () => undefined,
  onTheme: () => undefined,
};
(window as unknown as { patterFields: unknown }).patterFields = stub;
void import("../fields/fields.js");
