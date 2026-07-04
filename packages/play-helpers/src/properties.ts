// ---------------------------------------------------------------------------
// Runtime property setters: read / write `@patter` globals, `@scene` props, or
// a wired foreign scope at runtime - e.g. the game pushing inventory into the
// dialogue, or reading a flag the dialogue set. Thin pass-throughs to the
// Engine, plus a batch setter for convenience.
// ---------------------------------------------------------------------------

import type { Engine } from "@patterkit/runtime";

/** A property value the engine accepts (a Patter scalar: number / boolean / string / string[] flags). */
export type PropertyValue = Parameters<Engine["setProperty"]>[1];

/** Read a runtime property (`@hp`, `@scene.locked`, a foreign `@world.x`). Undefined when unset. */
export function getProperty(engine: Engine, ref: string): PropertyValue | undefined {
  return engine.getProperty(ref);
}

/** Set one runtime property. Mirrors `engine.setProperty`, exported here for discoverability + symmetry. */
export function setProperty(engine: Engine, ref: string, value: PropertyValue): void {
  engine.setProperty(ref, value);
}

/** Set many at once, e.g. `setProperties(engine, { "@hp": 10, "@scene.locked": false })`. */
export function setProperties(engine: Engine, values: Record<string, PropertyValue>): void {
  for (const [ref, value] of Object.entries(values)) engine.setProperty(ref, value);
}
