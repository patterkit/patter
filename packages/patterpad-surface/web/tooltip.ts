// ---------------------------------------------------------------------------
// A single themed tooltip we control - replacing native `title` rollovers, which
// are unstyled OS chrome and appear on the platform's slow (~1s) delay
// (design-language §4, "coherent to the edges": no stock OS chrome at the seams).
//
// ONE floating bubble, document-DELEGATED: any element carrying a `data-tip`
// attribute gets it - so authors just set `data-tip="..."` anywhere (surface DOM
// or app chrome, since the listener is on `document`), no per-element wiring. The
// bubble anchors above the element (flipping below near the top edge), uses our
// own snappy delay + the shared panel-enter motion, and is SUPPRESSED in Writing
// View. `initTooltips()` is idempotent - safe to call from more than one place.
// ---------------------------------------------------------------------------

// Bold markers: a producer wraps a span in these PRIVATE control chars (U+0002 STX / U+0003 ETX, never
// present in user text) and the renderer turns it into a <strong>. Lets a data-tip bold part of itself
// (a commenter's name, a note's "VO:" / "Loc:" prefix) without any HTML - each segment is still set via
// textContent, so there is no injection risk from user content.
const B_OPEN = "\u0002";
const B_CLOSE = "\u0003";
/** Wrap `s` so it renders bold inside a tooltip (see the marker note above). */
export function tipBold(s: string): string { return `${B_OPEN}${s}${B_CLOSE}`; }

/** Render `text` into `host`, turning `\u0002…\u0003`-marked spans into <strong>; all set as text (safe). */
function renderTip(host: HTMLElement, text: string): void {
  host.textContent = "";
  const re = /\u0002([^\u0003]*)\u0003/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) host.append(text.slice(last, m.index));
    const strong = document.createElement("strong");
    strong.textContent = m[1] ?? "";
    host.append(strong);
    last = m.index + m[0].length;
  }
  if (last < text.length) host.append(text.slice(last));
}

let inited = false;
const SHOW_DELAY = 350; // ms - snappier than the OS title delay, slow enough not to flicker on pass-through
const EDGE = 6;         // viewport inset so the bubble never touches the window edge
const GAP = 7;          // px between the anchor and the bubble

let tip: HTMLDivElement | null = null;
let timer = 0;
let active: HTMLElement | null = null;

function ensureEl(): HTMLDivElement {
  if (tip) return tip;
  const el = document.createElement("div");
  el.className = "tooltip";
  el.setAttribute("role", "tooltip");
  el.hidden = true;
  document.body.appendChild(el);
  tip = el;
  return el;
}

/** Anchor the (already-visible, so measurable) bubble above the element, flipping below near the top. */
function place(anchor: HTMLElement): void {
  const t = ensureEl();
  const r = anchor.getBoundingClientRect();
  const tr = t.getBoundingClientRect();
  let top = r.top - tr.height - GAP;
  if (top < EDGE) top = r.bottom + GAP; // not enough room above -> below
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(EDGE, Math.min(left, window.innerWidth - tr.width - EDGE));
  t.style.left = `${Math.round(left)}px`;
  t.style.top = `${Math.round(top)}px`;
}

function show(anchor: HTMLElement): void {
  const text = anchor.dataset.tip;
  if (!text || document.body.classList.contains("writing-view")) return; // no chrome tooltips in Writing View
  const t = ensureEl();
  // A modal <dialog> (Scene Properties, settings, etc.) renders in the browser TOP LAYER, above every
  // normal-flow element whatever its z-index. If the anchor is inside one, move the bubble into that
  // dialog so it shares the top layer; otherwise keep it on <body>. Re-parenting per show also moves it
  // back out once the modal closes.
  const host: HTMLElement = anchor.closest<HTMLElement>("dialog[open]") ?? document.body;
  if (t.parentElement !== host) host.appendChild(t);
  active = anchor;
  renderTip(t, text);
  t.hidden = false;
  t.classList.remove("show"); void t.offsetWidth; // restart the enter animation
  place(anchor);                                  // measure + position now it has content + is visible
  t.classList.add("show");
}

function hide(): void {
  if (timer) { window.clearTimeout(timer); timer = 0; }
  active = null;
  if (tip) { tip.hidden = true; tip.classList.remove("show"); }
}

function schedule(anchor: HTMLElement): void {
  if (anchor === active) return;
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => show(anchor), SHOW_DELAY);
}

const tipAncestor = (n: EventTarget | null): HTMLElement | null =>
  (n instanceof Element ? n.closest<HTMLElement>("[data-tip]") : null);

/** Wire the one delegated controller. Idempotent. */
export function initTooltips(): void {
  if (inited) return;
  inited = true;

  document.addEventListener("pointerover", (e) => {
    const el = tipAncestor(e.target);
    if (el) schedule(el);
  });
  document.addEventListener("pointerout", (e) => {
    const el = tipAncestor(e.target);
    if (!el) return;
    const to = (e as PointerEvent).relatedTarget;
    if (to instanceof Node && el.contains(to)) return; // still inside the same anchor
    hide();
  });
  // Keyboard parity: reveal on focus, dismiss on blur.
  document.addEventListener("focusin", (e) => { const el = tipAncestor(e.target); if (el) schedule(el); });
  document.addEventListener("focusout", () => hide());
  // It's ANCHORED (not cursor-following), so anything that moves the layout or context dismisses it.
  document.addEventListener("pointerdown", () => hide(), true);
  document.addEventListener("scroll", () => { if (active) hide(); }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  window.addEventListener("blur", () => hide());
}
