// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// The cue draws a line's speaker qualifier, `BARKEEP (O.S.)`, from the project's
// list, OUTSIDE the name token: the name (the cue's editable text) is exactly as
// before, so the cast popup's buffer and the bridge never see the qualifier. The
// surface's setters write it, and the keyboard route cycles it.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { TextSelection } from "prosemirror-state";
import { mountSurface, type SurfaceHandle } from "./surface.js";
import { prependLine } from "../src/lines.js";
import { findBeatById, sayStartOf } from "../src/zoneutil.js";
import flowSource from "../test/fixtures/tavern.patterflow?raw";
import locSource from "../test/fixtures/tavern.patterloc?raw";

const QUALIFIERS = [{ gameId: "vo", name: "V.O." }, { gameId: "os", name: "O.S." }];
const withQualifier = flowSource.replace('direction: "wiping a glass" }', 'direction: "wiping a glass", qualifier: "os" }');

function mount(flow = withQualifier): { h: SurfaceHandle; cueOf: (id: string) => HTMLElement } {
  const editor = document.createElement("div");
  document.body.appendChild(editor);
  (editor as unknown as { scrollTo: () => void }).scrollTo = () => undefined; // jsdom has no layout
  Element.prototype.scrollIntoView ??= () => undefined;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  const h = mountSurface({ editor, flowSource: flow, locSource, qualifiers: QUALIFIERS });
  const cueOf = (id: string): HTMLElement => {
    let pos = -1;
    h.view.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === "line" && n.attrs.id === id) { pos = p; return false; } return pos < 0; });
    return (h.view.nodeDOM(pos) as HTMLElement).querySelector(".zone.cue")!;
  };
  return { h, cueOf };
}
const qualText = (cue: HTMLElement): string => {
  const q = cue.querySelector<HTMLElement>(".cue-qual")!;
  return q.hidden ? "" : q.textContent ?? "";
};

describe("the cue draws the speaker qualifier", () => {
  it("shows (O.S.) after the name, outside the name token", () => {
    const { h, cueOf } = mount();
    const cue = cueOf("L_greet2");
    expect(cue.querySelector(".cue-text")?.textContent).toBe("BARKEEP"); // the token is the name alone
    expect(qualText(cue)).toBe("(O.S.)");
    expect(cue.getAttribute("data-qualifier")).toBe("os");
    expect(qualText(cueOf("L_greet"))).toBe(""); // an unqualified line draws nothing
    expect(h.getSource().flow).toMatch(/"qualifier": "os"/); // and the source keeps it
    h.destroy();
  });

  it("repaints as the inspector's setter and the keyboard route change it", () => {
    const { h, cueOf } = mount();
    expect(h.setQualifier("L_greet", "vo")).toBe(true);
    expect(qualText(cueOf("L_greet"))).toBe("(V.O.)");
    expect(h.setQualifier("L_greet", "")).toBe(true);
    expect(qualText(cueOf("L_greet"))).toBe("");
    expect(h.setQualifier("sn_intro_greet", "vo")).toBe(false); // a bubble is not a line
    h.revealNode("L_greet");
    expect(h.cycleQualifier()).toBe(true);
    expect(qualText(cueOf("L_greet"))).toBe("(V.O.)");
    h.destroy();
  });

  it("follows a renamed list, and marks a qualifier the project no longer lists", () => {
    const { h, cueOf } = mount();
    h.setQualifiers([{ gameId: "os", name: "OFF" }]);
    expect(qualText(cueOf("L_greet2"))).toBe("(OFF)");
    h.setQualifiers([{ gameId: "vo", name: "V.O." }]);
    const q = cueOf("L_greet2").querySelector(".cue-qual")!;
    expect(q.textContent).toBe("(os)");
    expect(q.classList.contains("unknown")).toBe(true);
    h.destroy();
  });
});

describe("pressing on the cue", () => {
  // jsdom has no layout: ProseMirror's own mousedown handling asks for the element under the pointer.
  (document as unknown as { elementFromPoint: () => null }).elementFromPoint ??= () => null;
  const press = (el: Element, init: MouseEventInit = {}): void => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ...init }));
  };
  const selectedText = (h: SurfaceHandle): string => {
    const { from, to } = h.view.state.selection;
    return h.view.state.doc.textBetween(from, to);
  };
  const popupShown = (): boolean => [...document.querySelectorAll<HTMLElement>(".cue-ac")].some((e) => e.style.display === "block");

  // The qualifier and the colon are drawn chrome that takes no caret: the browser left the selection where
  // it was, so typing after the press landed somewhere else in the scene.
  it("on the qualifier or the colon selects the speaker, as a press on the name does", () => {
    const { h, cueOf } = mount();
    expect(h.view.state.selection.$from.parent.type.name).not.toBe("cue");
    press(cueOf("L_greet2").querySelector(".cue-qual")!);
    expect(selectedText(h)).toBe("BARKEEP");
    expect(h.view.state.selection.$from.parent.type.name).toBe("cue");
    const at = h.view.state.selection.from;
    press(cueOf("L_greet").querySelector(".cue-colon")!);
    expect(selectedText(h)).toBe("BARKEEP");
    expect(h.view.state.selection.from).toBeLessThan(at); // the line above's speaker, not the one before
    h.destroy();
  });

  // A right-click on a name (or a Ctrl-click, the Mac's right-click) opens the context menu, and the cast
  // popup used to open behind it as the caret moved into the cue.
  it("with a secondary button never raises the cast popup", () => {
    const { h, cueOf } = mount();
    h.view.focus();
    const cue = cueOf("L_greet2");
    const intoCue = (): void => {
      let pos = -1;
      h.view.state.doc.descendants((n, p) => { if (pos < 0 && n.type.name === "cue" && h.view.nodeDOM(p) === cue) pos = p + 1; return pos < 0; });
      h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, pos)));
    };
    press(cue.querySelector(".cue-text")!, { button: 2 });
    intoCue();
    expect(popupShown()).toBe(false);
    press(cue.querySelector(".cue-text")!, { ctrlKey: true });
    intoCue();
    expect(popupShown()).toBe(false);
    // The control: a plain press on the name does raise it.
    press(cue.querySelector(".cue-text")!);
    intoCue();
    expect(popupShown()).toBe(true);
    h.destroy();
  });

  // Review 2026-10: the secondary press was remembered until the next mousedown, so a command picked from
  // the context menu it opened (which brings no keydown or mousedown to the editor) closed the popup on the
  // line it had just added, instead of opening it there.
  it("after a right-click, a command from the menu that adds a dialogue line still raises the popup", () => {
    const { h, cueOf } = mount();
    h.view.focus();
    const addLineAbove = (id: string): void => {
      const $line = h.view.state.doc.resolve(findBeatById(h.view.state.doc, id)!.pos);
      h.view.dispatch(prependLine(h.view.state, $line.before($line.depth))!);
    };
    for (const target of [cueOf("L_greet2").querySelector(".cue-text")!, cueOf("L_greet2").parentElement!.querySelector(".zone.say")!]) {
      press(target, { button: 2 });
      expect(popupShown()).toBe(false);
      addLineAbove("L_greet2");
      expect(h.view.state.selection.$from.parent.type.name).toBe("cue");
      expect(popupShown()).toBe(true);
      h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, sayStartOf(h.view.state.doc, "L_greet2"))));
    }
    h.destroy();
  });
});
