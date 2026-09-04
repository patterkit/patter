// The browser drop-in: ONE classic script, no build step, defining the `Patterplay` global with the
// runtime AND these helpers on it, so a plain page can build an engine, play, and save and load the
// family's save text from a single script tag (and the Storylet Engine's beside it).
//
// Built by this package rather than the runtime because this is the one package that depends on
// both: the runtime cannot bundle the helpers without bundling itself twice. The export names of the
// two do not overlap (pinned by test/browser-drop-in.test.ts), so `export *` from each is exact.
// Asked for by the Storylets side (from-storylets/browser-drop-in-carries-the-helpers, 2026-09-04),
// whose `storyletengine.min.js` took the same shape the same day.
export * from "@patterkit/runtime";
export * from "./index.js";
