// The live spell-check engine (#177), renderer-side: nspell runs in-process so the surface can check a
// word and get suggestions synchronously (no IPC per word). The main process serves the dictionary bytes
// (built-in en-US/GB or an imported pair); this builds the engine and folds in the always-allowed words -
// the project's custom dictionary plus the cast names (proper nouns must never read as misspelled).

import nspell from "nspell";

/** A minimal spell-check facade the surface consumes (matches the surface's SpellChecker: check + suggest). */
export interface SpellEngine {
  /** True when the word is correctly spelled (or in the extra-words set). */
  check(word: string): boolean;
  /** Up to a handful of ranked correction suggestions. */
  suggest(word: string): string[];
}

// Hunspell dictionaries store apostrophes as the straight ASCII ' (don't, I'll), but authored prose uses the
// typographic curly ' (U+2019) - and an unmodified curly word never matches. Fold every apostrophe variant to
// the straight form before any lookup so contractions and possessives are checked against the right spelling.
const APOSTROPHES = /[‘’ʼ′`]/g;
const straighten = (word: string): string => word.replace(APOSTROPHES, "'");

/** True when the word is correct, with apostrophe-tolerance: try it as-is, then with apostrophes straightened,
 *  then - for possessives / contractions the dictionary lacks (Eldoria's, what'll) - the stem before the first
 *  apostrophe. The stem fallback only forgives a word whose root is itself a real word, so "teh's" still flags. */
function correctWord(spell: ReturnType<typeof nspell>, word: string): boolean {
  if (spell.correct(word)) return true;
  const flat = straighten(word);
  if (flat !== word && spell.correct(flat)) return true;
  const apos = flat.indexOf("'");
  if (apos > 0) { const stem = flat.slice(0, apos); if (stem.length >= 2 && spell.correct(stem)) return true; }
  return false;
}

/** Build an engine from a dictionary's aff/dic text, allowing `extraWords` (project dictionary + cast).
 *  Words are added case-as-given; nspell also matches their capitalised / all-caps forms. */
export function buildSpellEngine(aff: string, dic: string, extraWords: readonly string[] = []): SpellEngine {
  const spell = nspell(aff, dic);
  for (const w of extraWords) { const t = w.trim(); if (t) spell.add(t); }
  return {
    check: (word) => correctWord(spell, word),
    suggest: (word) => spell.suggest(straighten(word)).slice(0, 7),
  };
}
