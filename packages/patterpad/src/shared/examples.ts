// ---------------------------------------------------------------------------
// The worked examples that ship with the app, in the order they are offered.
//
// ONE list, read by the welcome screen, New Project, and Help > Open an
// Example, as Storyletter keeps its own (storylets packages/studio/src/shared/
// examples.ts): two copies of the list would drift. Each is a `.patter` folder
// under the repo's `examples/projects/`, carried into the app by
// `build.extraResources` in package.json, and opened as the writer's own copy
// in a folder they choose, never in place.
// ---------------------------------------------------------------------------

export interface ShippedExample {
  /** The folder under `examples/projects/`, which is what `openExample` takes. */
  file: string;
  name: string;
  /** What it is, as a writer meets it. */
  hint: string;
  /** A word or two drawn beside the name ("Start here"). */
  badge?: string;
  /** A shorter line for a tile, when the hint runs past three lines there. */
  tile?: string;
  /** What it has, as a player meets it, as pills on its tile. */
  features?: readonly string[];
}

export const EXAMPLES: readonly ShippedExample[] = [
  { file: "tour.patter", name: "The Interactive Tour",
    hint: "A friendly guide walks you through Patter by letting you play it: choices, selectors, memory, captions, and what happens under the hood.",
    badge: "Start here",
    tile: "Learn Patter by playing it, with a guide.",
    features: ["Choices", "Memory", "Captions"] },
  { file: "night-ferry.patter", name: "The Night Ferry",
    hint: "One crossing of a dark river, in conversation with the ferryman. Short, finished, and written to be read: a story rather than a lesson.",
    tile: "One crossing, one conversation with the ferryman.",
    features: ["A short story", "Conversation", "Choices that matter"] },
];
