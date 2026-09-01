// Stable, immutable, opaque ids. The generator is @wildwinter/toolkit's: it is
// fifteen lines of rejection-sampled base-36 with no domain knowledge at all,
// and it existed here and in the other family character for character.
//
// Re-exported from here so nothing that imports it has to move.
export { newId } from "@wildwinter/toolkit";
