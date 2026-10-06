// ---------------------------------------------------------------------------
// Runtime property setters: read / write `@patter` globals, `@scene` props, or
// a wired foreign scope at runtime - e.g. the game pushing inventory into the
// dialogue, or reading a flag the dialogue set. Thin pass-throughs, plus a batch
// setter for convenience.
//
// They take an Engine or a Flow. Game-wide properties (`@hp`, `@world.x`) go
// through either; `@scene` props belong to a flow, since each flow has its own,
// so they need the Flow: the Engine refuses an `@scene` ref.
// ---------------------------------------------------------------------------

import type { Engine, Flow } from "@patterkit/runtime";

/** A property value the engine accepts (a Patter scalar: number / boolean / string / string[] flags). */
export type PropertyValue = Parameters<Engine["setProperty"]>[1];

/** Where properties are read and written: the Engine (game-wide refs), or a Flow (those plus `@scene`). */
export type PropertyHolder = Engine | Flow;

/** Read a runtime property (`@hp`, a foreign `@world.x`, or with a Flow `@scene.locked`). Undefined when unset. */
export function getProperty(holder: PropertyHolder, ref: string): PropertyValue | undefined {
  return holder.getProperty(ref);
}

/** Set one runtime property. Mirrors `setProperty` on the Engine or Flow, exported for discoverability + symmetry. */
export function setProperty(holder: PropertyHolder, ref: string, value: PropertyValue): void {
  holder.setProperty(ref, value);
}

/** Set many at once, e.g. `setProperties(engine, { "@hp": 10 })` or `setProperties(flow, { "@scene.locked": false })`. */
export function setProperties(holder: PropertyHolder, values: Record<string, PropertyValue>): void {
  for (const [ref, value] of Object.entries(values)) holder.setProperty(ref, value);
}
