/// <reference lib="dom" />
// ---------------------------------------------------------------------------
// The bundle inspector's VIEW, for the web: a read-only panel over
// `describeBundle`, in the same visual grammar as the live property inspector.
//
// The other three runtimes hang their view off an imported asset - a Unity
// CustomEditor, an Unreal details customisation, a Godot EditorInspectorPlugin.
// JS has no asset pipeline, so there is no inspector to extend and the summary
// function IS the surface. This exists because "the function is the surface"
// leaves the JS side without the thing the other three give you for free: a
// place to LOOK at a bundle. A drop-in page can now do
//
//   const panel = createBundleInspector(bundle, { container: document.body });
//   // ...later: panel.destroy();
//
// Read-only on purpose. The live inspector edits because a running game has
// state worth changing; this describes an artefact, and there is nothing here a
// reader could sensibly write to.
// ---------------------------------------------------------------------------

import { describeBundle } from "@patterkit/runtime";
import type { Bundle } from "@patterkit/model";
import type { BundleDescription, PropertySummary } from "@patterkit/runtime";

export interface BundleInspectorOptions {
  /** Where to mount the panel. If omitted, append the returned `el` yourself. */
  container?: HTMLElement;
  /** Panel heading. Default "Bundle". */
  title?: string;
  /** Sections open on mount. Default: identity and addresses, the two an
   *  integrator reaches for first; the rest are a click away. */
  open?: BundleSection[];
}

export type BundleSection = "identity" | "addresses" | "hostScopes" | "properties" | "gameData" | "counts";

export interface BundleInspector {
  /** The panel root (already inside `container` if you passed one). */
  readonly el: HTMLElement;
  /** The description the panel is showing, for a caller that wants the data too. */
  readonly description: BundleDescription;
  /** Remove the panel from the DOM. */
  destroy(): void;
}

const STYLE_ID = "pp-bundle-style";
// Deliberately the property inspector's palette and metrics: the two panels are
// often on the same page, and a second look-and-feel would read as a second tool.
const CSS = `
.pp-bundle{font:13px/1.4 ui-sans-serif,system-ui,sans-serif;color:#15201e;background:#f4efe6;border:1px solid #cfc7b8;border-radius:10px;padding:.6rem .7rem;max-width:26rem;box-shadow:0 6px 20px rgba(21,32,30,.12)}
.pp-bundle h4{margin:0 0 .4rem;font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#5c6b62}
.pp-bundle details{border-top:1px solid #e3dccf;padding:.3rem 0}
.pp-bundle details:first-of-type{border-top:0}
.pp-bundle summary{cursor:pointer;font-weight:600;color:#214f4b;list-style:none}
.pp-bundle summary::-webkit-details-marker{display:none}
.pp-bundle summary::before{content:"\\25B8";display:inline-block;width:1rem;color:#8a9691}
.pp-bundle details[open]>summary::before{content:"\\25BE"}
.pp-bundle-count{color:#8a9691;font-weight:400}
.pp-bundle-row{display:flex;gap:.4rem;margin:.16rem 0 .16rem 1rem}
.pp-bundle-key{flex:0 0 8rem;color:#5c6b62}
.pp-bundle-val,.pp-bundle-addr{font-family:ui-monospace,monospace;font-size:.78rem;color:#214f4b;word-break:break-all}
.pp-bundle-sub{margin-left:2rem}
.pp-bundle-empty{color:#8a9691;font-style:italic;margin-left:1rem}
.pp-bundle-warn{color:#8a3a2f;font-weight:600}
.pp-bundle-tag{font-size:.7rem;color:#5c6b62;border:1px solid #cfc7b8;border-radius:5px;padding:0 .25rem;margin-left:.3rem}
`;

function injectStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const s = doc.createElement("style");
  s.id = STYLE_ID;
  s.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(s);
}

const el = (doc: Document, tag: string, cls?: string, text?: string): HTMLElement => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** One "key: value" line. */
function row(doc: Document, key: string, value: string, valueClass = "pp-bundle-val"): HTMLElement {
  const r = el(doc, "div", "pp-bundle-row");
  r.append(el(doc, "span", "pp-bundle-key", key), el(doc, "span", valueClass, value));
  return r;
}

/** A property line: the name, its type, and whether the HOST must supply a value.
 *  "no default" is the part an integrator is actually scanning for. */
function propertyRow(doc: Document, p: PropertySummary): HTMLElement {
  const r = el(doc, "div", "pp-bundle-row");
  r.append(el(doc, "span", "pp-bundle-key pp-bundle-addr", p.name));
  const meta = el(doc, "span", "pp-bundle-val", p.type);
  if (!p.hasDefault) meta.append(el(doc, "span", "pp-bundle-tag", "no default"));
  r.append(meta);
  return r;
}

function section(doc: Document, name: BundleSection, label: string, count: number | null, open: boolean): HTMLDetailsElement {
  const d = doc.createElement("details");
  d.dataset["section"] = name;
  d.open = open;
  const s = doc.createElement("summary");
  s.textContent = label;
  if (count !== null) s.append(el(doc, "span", "pp-bundle-count", ` ${count}`));
  d.append(s);
  return d;
}

/**
 * Build a read-only panel describing a compiled bundle: what it is, what game
 * code may call on it, and what the host must supply.
 */
export function createBundleInspector(bundle: Bundle, opts: BundleInspectorOptions = {}): BundleInspector {
  const doc = opts.container?.ownerDocument ?? document;
  injectStyle(doc);
  const d = describeBundle(bundle);
  const open = new Set<BundleSection>(opts.open ?? ["identity", "addresses"]);

  const root = el(doc, "div", "pp-bundle");
  root.append(el(doc, "h4", undefined, opts.title ?? "Bundle"));

  // --- identity ------------------------------------------------------------
  const id = section(doc, "identity", d.identity.project || "(unnamed project)", null, open.has("identity"));
  if (d.identity.version) id.append(row(doc, "version", d.identity.version));
  id.append(row(doc, "schema", d.identity.schema));
  id.append(row(doc, "locales", `${d.identity.defaultLocale}${d.identity.locales.length > 1 ? ` (+${d.identity.locales.length - 1})` : ""}`));
  id.append(row(doc, "strings", d.identity.localisation));
  if (d.identity.voiced) id.append(row(doc, "voiced", "yes"));
  if (d.identity.hash) id.append(row(doc, "hash", d.identity.hash));
  // Equal structureHash + a different hash = a text-only edit, which is what makes
  // a live hot-swap safe. Both are shown so an integrator can tell those apart.
  if (d.identity.structureHash) id.append(row(doc, "structure", d.identity.structureHash));
  if (d.identity.sourceDebug) {
    id.append(row(doc, "build", "SOURCE DEBUG - not shippable", "pp-bundle-val pp-bundle-warn"));
  }
  root.append(id);

  // --- addresses -----------------------------------------------------------
  const addr = section(doc, "addresses", "Addresses", d.addresses.length, open.has("addresses"));
  if (!d.addresses.length) addr.append(el(doc, "div", "pp-bundle-empty", "no scenes"));
  for (const a of d.addresses) {
    const r = el(doc, "div", "pp-bundle-row");
    r.append(el(doc, "span", "pp-bundle-key pp-bundle-addr", a.gameId), el(doc, "span", "pp-bundle-val", a.name));
    addr.append(r);
    // Nested, because a block address is scene-scoped: the pair is the address.
    for (const b of a.blocks) {
      const br = el(doc, "div", "pp-bundle-row pp-bundle-sub");
      br.append(el(doc, "span", "pp-bundle-key pp-bundle-addr", b.gameId), el(doc, "span", "pp-bundle-val", b.name));
      addr.append(br);
    }
  }
  root.append(addr);

  // --- host scopes ---------------------------------------------------------
  // Counted in PROPERTIES rather than scopes: the heading says "properties", and a
  // reader comparing it with the rows below should not have to work out which it meant.
  // An opaque scope contributes none, and says so on its own row.
  const hostCount = d.hostScopes.reduce((n, s) => n + s.properties.length, 0);
  const host = section(doc, "hostScopes", "Host properties", hostCount, open.has("hostScopes"));
  if (!d.hostScopes.length) host.append(el(doc, "div", "pp-bundle-empty", "the game supplies nothing"));
  for (const s of d.hostScopes) {
    const head = el(doc, "div", "pp-bundle-row");
    head.append(el(doc, "span", "pp-bundle-key pp-bundle-addr", `@${s.token}`));
    const meta = el(doc, "span", "pp-bundle-val", s.opaque ? "any name, unchecked" : `${s.properties.length} declared`);
    if (!s.writable) meta.append(el(doc, "span", "pp-bundle-tag", "read-only"));
    head.append(meta);
    host.append(head);
    for (const p of s.properties) {
      const pr = propertyRow(doc, p);
      pr.classList.add("pp-bundle-sub");
      host.append(pr);
    }
  }
  root.append(host);

  // --- owned properties ----------------------------------------------------
  const ownedCount = d.properties.patter.length + d.properties.scene.reduce((n, s) => n + s.properties.length, 0);
  const owned = section(doc, "properties", "Story properties", ownedCount, open.has("properties"));
  if (!ownedCount) owned.append(el(doc, "div", "pp-bundle-empty", "none declared"));
  for (const p of d.properties.patter) owned.append(propertyRow(doc, p));
  for (const s of d.properties.scene) {
    owned.append(row(doc, `@scene`, s.gameId, "pp-bundle-val pp-bundle-addr"));
    for (const p of s.properties) {
      const pr = propertyRow(doc, p);
      pr.classList.add("pp-bundle-sub");
      owned.append(pr);
    }
  }
  root.append(owned);

  // --- gameData ------------------------------------------------------------
  if (d.gameData.length) {
    const gd = section(doc, "gameData", "Game data", d.gameData.reduce((n, g) => n + g.fields.length, 0), open.has("gameData"));
    for (const g of d.gameData) {
      gd.append(row(doc, "on", g.kind));
      for (const f of g.fields) {
        const fr = el(doc, "div", "pp-bundle-row pp-bundle-sub");
        fr.append(el(doc, "span", "pp-bundle-key pp-bundle-addr", f.name), el(doc, "span", "pp-bundle-val", f.type));
        gd.append(fr);
      }
    }
    root.append(gd);
  }

  // --- counts --------------------------------------------------------------
  const counts = section(doc, "counts", "Counts", null, open.has("counts"));
  for (const [key, value] of Object.entries(d.counts)) counts.append(row(doc, key, String(value)));
  root.append(counts);

  opts.container?.append(root);
  return {
    el: root,
    description: d,
    destroy() { root.remove(); },
  };
}
