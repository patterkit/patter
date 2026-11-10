// ---------------------------------------------------------------------------
// The Patterplay version, and the one check against it.
//
// An extension (Patterstage, Pattershot) ships apart from Patterplay and never bundles it, so it checks at
// start-up that the Patterplay it finds is one it was built for. Unity's and npm's packages can declare a
// version range, but Unreal's .uplugin and Godot's plugin.cfg can't, so the check that works on every engine
// runs in code: PATTERPLAY_VERSION says what this runtime is, and versionInRange tests it.
// ---------------------------------------------------------------------------

/** This runtime's version, as in its package manifest. Written by `npm run bump:play`; never edit it by hand. */
export const PATTERPLAY_VERSION = "1.0.1";

type Parsed = { core: [string, string, string]; pre: string[] };

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parse(v: string): Parsed | null {
  const m = typeof v === "string" ? SEMVER.exec(v) : null;
  if (!m) return null;
  return { core: [m[1]!, m[2]!, m[3]!], pre: m[4] ? m[4].split(".") : [] };
}

/** Two runs of digits compared as whole numbers of any length: leading zeros dropped, then the longer is larger. */
function compareDigits(x: string, y: string): number {
  x = x.replace(/^0+(?=\d)/, "");
  y = y.replace(/^0+(?=\d)/, "");
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : x < y ? -1 : 1;
}

/** Semantic-version precedence: negative when a comes first, positive when b does, 0 when they're equal. */
function compare(a: Parsed, b: Parsed): number {
  for (let i = 0; i < 3; i++) {
    const c = compareDigits(a.core[i]!, b.core[i]!);
    if (c) return c;
  }
  // A prerelease comes before its release.
  if (!a.pre.length || !b.pre.length) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.min(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]!, y = b.pre[i]!;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    if (xn && yn) {
      const c = compareDigits(x, y);
      if (c) return c;
      continue;
    }
    if (xn !== yn) return xn ? -1 : 1; // a numeric identifier comes before a word
    return x < y ? -1 : 1;
  }
  return a.pre.length - b.pre.length;
}

/**
 * Whether `version` is at least `min` and below `maxExclusive`, by semantic-version precedence (build metadata
 * after `+` is ignored, and a prerelease comes before its release). False when any of the three isn't a version.
 * An extension built for Patterplay 1.x checks `versionInRange(PATTERPLAY_VERSION, "1.0.0", "2.0.0")`.
 */
export function versionInRange(version: string, min: string, maxExclusive: string): boolean {
  const v = parse(version), lo = parse(min), hi = parse(maxExclusive);
  if (!v || !lo || !hi) return false;
  return compare(v, lo) >= 0 && compare(v, hi) < 0;
}
