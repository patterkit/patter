// The PatterKit wordmark, as inline SVG.
//
// It lived inside `updater-dialog.ts`, which drew the About box as a side job.
// About is the shell's now (`showAbout`), and the shell takes the wordmark as
// MARKUP from the app rather than knowing any product's brand, which is the one
// part of an About box that genuinely cannot be shared. So it lives here.
//
// Inline rather than a file so the text renders in the app's own Newsreader and
// the word colours follow the theme. The leaf marks keep the fixed brand teal and
// ember, which stay readable on every palette, exactly as the website footer's
// mark does; the geometry is the site's.

export const PATTERKIT_WORDMARK =
  '<svg viewBox="0 0 820 220" role="img" aria-label="PatterKit" xmlns="http://www.w3.org/2000/svg">' +
  '<g transform="translate(40,30) scale(0.98)">' +
  '<g transform="translate(36.7,6) rotate(270 50 50)"><path fill="#57a294" d="M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z"/></g>' +
  '<g transform="translate(3.3,56) rotate(90 50 50)"><path fill="#d2603e" d="M50 8 C64 30 78 48 78 64 A28 28 0 1 1 22 64 C22 48 36 30 50 8 Z"/></g></g>' +
  '<text x="232" y="150" font-family="Newsreader, Georgia, serif" font-weight="500" font-size="120" letter-spacing="-2" fill="var(--ink)">Patter<tspan fill="var(--accent)">Kit</tspan></text>' +
  "</svg>";
