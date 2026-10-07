// Shared DOM helpers for the renderer. `el` is the shell's (@wildwinter/app-shell): its signature is a
// superset of the positional one this file once defined (tag, class, text), so every call here reads the
// same, and the two factories cannot drift. Kept as a module so the seventeen files that import from it
// need not change.
//
// The anchored-panel lifecycle and the small controls (`iconBtn`, `labelled`, `moveItem`, `tagChips`,
// `stageChips`) that once lived here are the shell's too (ui-review-2026-09, finding 3).

export { el } from "@wildwinter/app-shell";
