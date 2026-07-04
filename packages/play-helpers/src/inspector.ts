/// <reference lib="dom" />
// ---------------------------------------------------------------------------
// A live @patter property inspector for the browser: a small DOM panel that
// watches AND edits a running Engine's shared @patter properties. Type-aware
// editors (bool / number / text / enum / flags), a reset-to-default per row, and
// a poll that refreshes values WITHOUT clobbering the field you're editing.
//
// The JS parity of the Unity PatterStateWindow / Godot PatterStatePanel. Those
// use a PatterDebug registry because the editor window is separate from the game;
// here the game runs in-process, so you just pass the engine directly:
//
//   const inspector = createPropertyInspector(engine, { container: document.body });
//   // ...later: inspector.destroy();
// ---------------------------------------------------------------------------

import type { Engine, PropertyRow } from "@patterkit/runtime";
import type { PropertyValue } from "./properties.js";

export interface PropertyInspectorOptions {
  /** Where to mount the panel. If omitted, append the returned `el` yourself. */
  container?: HTMLElement;
  /** Panel heading. Default "Runtime state". */
  title?: string;
  /** Live-refresh interval in ms; 0 disables polling (call `refresh()` yourself). Default 250. */
  pollMs?: number;
}

export interface PropertyInspector {
  /** The panel root (already inside `container` if you passed one). */
  readonly el: HTMLElement;
  /** Re-read every property and update the editors, skipping the field you're editing. */
  refresh(): void;
  /** Stop polling and remove the panel from the DOM. */
  destroy(): void;
}

const STYLE_ID = "pp-inspector-style";
const CSS = `
.pp-insp{font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#15201e;background:#f4efe6;border:1px solid #cfc7b8;border-radius:10px;padding:.6rem .7rem;max-width:22rem;box-shadow:0 6px 20px rgba(21,32,30,.12)}
.pp-insp h4{margin:0 0 .4rem;font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5c6b62}
.pp-insp-empty{color:#8a9691;font-style:italic}
.pp-insp-row{display:flex;align-items:center;gap:.4rem;margin:.18rem 0}
.pp-insp-ref{flex:0 0 8rem;font-family:ui-monospace,monospace;font-size:.78rem;color:#214f4b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pp-insp-ctl{flex:1;min-width:0;display:flex}
.pp-insp-ctl input[type=text],.pp-insp-ctl input[type=number],.pp-insp-ctl select{width:100%;box-sizing:border-box;font:inherit;padding:.15rem .3rem;border:1px solid #cfc7b8;border-radius:6px;background:#fff;color:inherit}
.pp-insp-reset{flex:0 0 auto;border:1px solid #cfc7b8;background:#fff;border-radius:6px;cursor:pointer;color:#5c6b62;width:1.6rem;height:1.6rem;line-height:1;padding:0}
.pp-insp-reset:disabled{opacity:.35;cursor:default}
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(s);
}

/** Value equality that also handles flags arrays (order-sensitive, like the stored value). */
function sameValue(a: PropertyValue | undefined, b: PropertyValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => x === b[i]);
  return a === b;
}

export function createPropertyInspector(engine: Engine, opts: PropertyInspectorOptions = {}): PropertyInspector {
  const doc = opts.container?.ownerDocument ?? document;
  injectStyle(doc);

  const el = doc.createElement("div");
  el.className = "pp-insp";
  const heading = doc.createElement("h4");
  heading.textContent = opts.title ?? "Runtime state";
  const list = doc.createElement("div");
  el.append(heading, list);

  const rowRefreshers: Array<() => void> = [];

  const buildRow = (row: PropertyRow): void => {
    const r = doc.createElement("div");
    r.className = "pp-insp-row";
    const label = doc.createElement("span");
    label.className = "pp-insp-ref";
    label.textContent = row.ref;
    label.title = row.ref;
    const ctl = doc.createElement("div");
    ctl.className = "pp-insp-ctl";
    const reset = doc.createElement("button");
    reset.className = "pp-insp-reset";
    reset.type = "button";
    reset.textContent = "↺"; // ↺
    reset.title = "Reset to default";
    r.append(label, ctl, reset);
    list.appendChild(r);

    // `read` pushes the live engine value into the editor, but never while that editor has focus
    // (so it can't wipe what you're typing). `syncReset` disables the ↺ when the value is the default.
    let read: () => void;
    const commit = (v: PropertyValue): void => { engine.setProperty(row.ref, v); syncReset(); };
    const focused = (node: Element): boolean => doc.activeElement === node;
    function syncReset(): void { reset.disabled = sameValue(engine.getProperty(row.ref), row.default); }
    reset.addEventListener("click", () => { engine.setProperty(row.ref, row.default); read(); syncReset(); });

    if (row.type === "boolean") {
      const cb = doc.createElement("input");
      cb.type = "checkbox";
      cb.addEventListener("change", () => commit(cb.checked));
      ctl.appendChild(cb);
      read = () => { if (!focused(cb)) cb.checked = engine.getProperty(row.ref) === true; };
    } else if (row.type === "number") {
      const inp = doc.createElement("input");
      inp.type = "number";
      inp.addEventListener("change", () => commit(Number(inp.value)));
      ctl.appendChild(inp);
      read = () => { if (!focused(inp)) inp.value = String(engine.getProperty(row.ref) ?? ""); };
    } else if (row.type === "enum") {
      const sel = doc.createElement("select");
      for (const v of row.values ?? []) {
        const o = doc.createElement("option");
        o.value = v; o.textContent = v;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => commit(sel.value));
      ctl.appendChild(sel);
      read = () => { if (!focused(sel)) sel.value = String(engine.getProperty(row.ref) ?? ""); };
    } else if (row.type === "flags") {
      const inp = doc.createElement("input");
      inp.type = "text";
      inp.placeholder = "comma, separated, flags";
      inp.addEventListener("change", () => commit(inp.value.split(",").map((s) => s.trim()).filter((s) => s.length > 0)));
      ctl.appendChild(inp);
      read = () => { if (!focused(inp)) { const v = engine.getProperty(row.ref); inp.value = Array.isArray(v) ? v.join(", ") : ""; } };
    } else {
      // string (and any unrecognised type) -> a text field
      const inp = doc.createElement("input");
      inp.type = "text";
      inp.addEventListener("change", () => commit(inp.value));
      ctl.appendChild(inp);
      read = () => { if (!focused(inp)) inp.value = String(engine.getProperty(row.ref) ?? ""); };
    }

    read();
    syncReset();
    rowRefreshers.push(() => { read(); syncReset(); });
  };

  // Properties are fixed for a bundle, so build the rows once; polling just refreshes their values.
  const props = engine.listProperties();
  if (props.length === 0) {
    const empty = doc.createElement("div");
    empty.className = "pp-insp-empty";
    empty.textContent = "No @patter properties.";
    list.appendChild(empty);
  } else {
    for (const row of props) buildRow(row);
  }

  const refresh = (): void => { for (const fn of rowRefreshers) fn(); };

  opts.container?.appendChild(el);
  const pollMs = opts.pollMs ?? 250;
  let timer: ReturnType<typeof setInterval> | undefined;
  if (pollMs > 0) timer = setInterval(refresh, pollMs);

  return {
    el,
    refresh,
    destroy() { if (timer !== undefined) clearInterval(timer); el.remove(); },
  };
}
