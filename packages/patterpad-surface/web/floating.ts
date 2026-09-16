// The floating-layer lifecycle (a body-appended element, show / follow / click-away / exit) is the
// shell's now (ui-review-2026-09, finding 5): this file was lifted whole into `@wildwinter/app-shell/floating`,
// with `followOnScroll` inlined there. The `./floating.js` import path stays for the cue picker, the slash
// menu, the action menu and the spell-check menu; positioning is still each caller's.
export { createFloating, type Floating } from "@wildwinter/app-shell/floating";
