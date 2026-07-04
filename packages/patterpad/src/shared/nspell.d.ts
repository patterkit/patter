// Ambient types for `nspell` (the MIT Hunspell-compatible spell-checker, #177) - it ships no types.
// Lives in src/shared so BOTH the node tsconfig (main, for import validation) and the web tsconfig
// (renderer, for the live engine) pick it up.
declare module "nspell" {
  interface NSpell {
    /** True when the word is spelled correctly. */
    correct(word: string): boolean;
    /** Ranked correction suggestions for a (mis)spelled word. */
    suggest(word: string): string[];
    /** Add a word to the runtime dictionary (returns this for chaining). */
    add(word: string, model?: string): NSpell;
    /** Remove a word from the runtime dictionary. */
    remove(word: string): NSpell;
  }
  function nspell(aff: string | Buffer, dic: string | Buffer): NSpell;
  function nspell(dictionary: { aff: string | Buffer; dic: string | Buffer }): NSpell;
  export default nspell;
}
