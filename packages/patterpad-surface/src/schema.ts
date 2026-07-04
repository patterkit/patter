// ---------------------------------------------------------------------------
// The ProseMirror schema for the ZONE model (patterpad-zone-model.md). Each line
// is built from the zones the cursor occupies and steps through:
//
//   line  (dialogue) -> cue [paren?] say     (character / direction? / content)
//   prose (free text)-> say                  (content only)
//   gameEvent        -> atom                 (opaque; slash-inserted, no cursor)
//
// A snippet's jump is NOT a beat: it is the snippet's terminal routing, carried
// as a snippet ATTR and rendered as bottom-right chrome (web/views.ts). So the
// cursor never lands "on" a jump, and a new line is never created above it.
//
// cue / paren / say are textblocks (the zones), so "the cursor is in a zone" and
// "what a key does at a zone boundary" are first-class - which is exactly how the
// keystroke spec is written.
//
// Lossless round-trip (unchanged principle from before the re-model): every
// structural node carries a `raw` attr (the original Patter object minus the
// parts rebuilt from the tree). character/direction live in the cue/paren zones
// and bridge to LineBeat.character/.direction (flow); say-zone text bridges to
// the locale string keyed by beat id. Opaque groups still ride as `rawnode`.
// ---------------------------------------------------------------------------

import { Schema } from "prosemirror-model";

export const patterSchema = new Schema({
  nodes: {
    // The scene. `raw` = the scene minus `blocks`.
    doc: { content: "block+", attrs: { raw: { default: "{}" } } },

    // A block. `raw` = the block minus `children`. `chunk*` (not `chunk+`): a block may
    // be genuinely EMPTY - the surface then shows a ghost-snippet placeholder (a faint
    // dashed bubble + a "+") so there is always somewhere to start, without forcing a
    // real bubble into the model (groups §1 / D1).
    block: { content: "chunk*", attrs: { raw: { default: "{}" } }, toDOM: () => ["div", { class: "block" }, 0] },

    // A snippet = a bubble: zero or more beats. Its terminal jump is a snippet-
    // level value (`jump` attr: a JSON Jump object, or "" for none), not a beat,
    // so it never sits in the editable flow. `raw` = the snippet minus `beats` and
    // `jump`. (Zero beats + a jump = a pure-jump bubble.)
    snippet: {
      group: "chunk", content: "beat*", attrs: { raw: { default: "{}" }, jump: { default: "" } },
      toDOM: () => ["div", { class: "bubble" }, 0],
    },

    // A group: the recursive, conditional container (selector / condition / -
    // for a choice option - secretUntilEligible, carried in `raw`). Its children
    // are chunks (snippets and nested groups), so the tree nests arbitrarily. A
    // choice OPTION (a choice's direct child) additionally leads with an
    // `optionprompt` (the choice text, spec §5 / groups §13.10). Rendered as a
    // rail container (web/views.ts).
    group: {
      group: "chunk", content: "optionprompt? chunk*", attrs: { raw: { default: "{}" } },
      toDOM: () => ["div", { class: "group-rail" }, 0],
    },

    // A choice option's PROMPT (groups §13.10): the option's choice text, a single
    // dialogue (line) or text beat, tied to the option and edited inline as a cell.
    // Not a chunk - it never drags / wraps and the chunk machinery ignores it.
    optionprompt: {
      // `(line | prose)?` not `line | prose`: a required line/prose slot is illegal (PM can't
      // auto-generate an id-bearing beat). In practice the bridge / seeding always fill it.
      content: "(line | prose)?",
      toDOM: () => ["div", { class: "option-prompt" }, 0],
    },

    // Opaque passthrough for a chunk the surface does not model yet (a future
    // node type). Real groups are the `group` node above; this is the graceful
    // fallback so unknown content still round-trips.
    rawnode: {
      group: "chunk", atom: true, attrs: { json: { default: "{}" } },
      toDOM: (node) => ["div", { class: "rawnode", contenteditable: "false" }, `⋯ ${String((JSON.parse(node.attrs.json) as { type?: string }).type ?? "node")}`],
    },

    // --- beats (the line types) ---------------------------------------------
    // Dialogue: a character cue, an optional direction, and the spoken content.
    line: {
      group: "beat", content: "cue paren? say", attrs: { id: {}, raw: { default: "{}" } },
      toDOM: () => ["div", { class: "beat kind-line" }, 0],
    },
    // Free text / narration: content only.
    prose: {
      group: "beat", content: "say", attrs: { id: {}, raw: { default: "{}" } },
      toDOM: () => ["div", { class: "beat kind-prose" }, 0],
    },
    // Game event: an opaque engine instruction (details via a separate UI). No cursor.
    gameEvent: {
      group: "beat", atom: true, attrs: { id: {}, raw: { default: "{}" } },
      toDOM: () => ["div", { class: "beat kind-gameEvent", contenteditable: "false" }, "⚙"],
    },

    // --- zones (textblocks the cursor occupies) -----------------------------
    // Only the spoken / narration CONTENT (the say zone) is formattable. The cue (a speaker name) and
    // the paren (a performance direction) are plain - `marks: ""` forbids strong / em there; the bridge
    // maps the say's marks to / from the <b><i><bi> tags in the stored string.
    cue: { content: "text*", marks: "", toDOM: () => ["span", { class: "zone cue" }, 0] },
    paren: { content: "text*", marks: "", toDOM: () => ["span", { class: "zone paren" }, 0] },
    say: { content: "text*", marks: "strong em", toDOM: () => ["span", { class: "zone say" }, 0] },

    text: {},
  },
  // Inline formatting (project-gated, §formatting). Only two marks - bold and italic; bold+italic is
  // simply both on a range. toDOM renders the effect (the author never sees the markup); parseDOM lets
  // a paste of real <b>/<i>/<strong>/<em> come in as marks too.
  marks: {
    strong: { parseDOM: [{ tag: "strong" }, { tag: "b" }, { style: "font-weight=bold" }], toDOM: () => ["strong", 0] },
    em: { parseDOM: [{ tag: "em" }, { tag: "i" }, { style: "font-style=italic" }], toDOM: () => ["em", 0] },
  },
});
