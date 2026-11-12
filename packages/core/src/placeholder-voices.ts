// ---------------------------------------------------------------------------
// Placeholder Speech's voices: curated lists of Google's voices per accent, in two tiers, and the default voice
// a character gets from a hash of their name. Standard is the default tier: plain voices that sound like the
// stand-in the speech is. HD (Google's Chirp 3 HD voices) is a tier a project opts into: better delivery, billed
// at a higher rate on the user's own Google account. Either way the speech is a placeholder, and is marked so.
//
// FROZEN ONCE SHIPPED. A default is the name's hash taken modulo a list's length, so adding, removing, or
// reordering a voice changes characters' defaults and remakes their lines in every project. A new accent or tier
// gets a new list; an existing list never changes. Before shipping a new list, check every name and gender
// against Google's voices.list (https://texttospeech.googleapis.com/v1/voices) with a key.
// ---------------------------------------------------------------------------

import { fnv32 } from "@wildwinter/toolkit"; // FNV-1a, unsigned 32-bit: stable across tools and versions

export type VoiceGender = "female" | "male";
/** Which of Google's voices a project draws on: `standard` (the default) or `hd` (Chirp 3 HD, opted into). */
export type PlaceholderTier = "standard" | "hd";
export interface PlaceholderVoice { name: string; gender: VoiceGender }
export interface PlaceholderAccent { code: string; label: string; voices: readonly PlaceholderVoice[] }

const v = (name: string, gender: VoiceGender): PlaceholderVoice => ({ name, gender });

/** The accents on offer, in the order the settings page lists them. */
export const PLACEHOLDER_ACCENTS: readonly PlaceholderAccent[] = [
  { code: "en-GB", label: "English (British)", voices: [
    v("en-GB-Standard-A", "female"), v("en-GB-Standard-B", "male"), v("en-GB-Standard-C", "female"),
    v("en-GB-Standard-D", "male"), v("en-GB-Standard-F", "female") ] },
  { code: "en-US", label: "English (American)", voices: [
    v("en-US-Standard-A", "male"), v("en-US-Standard-B", "male"), v("en-US-Standard-C", "female"),
    v("en-US-Standard-D", "male"), v("en-US-Standard-E", "female"), v("en-US-Standard-F", "female"),
    v("en-US-Standard-G", "female"), v("en-US-Standard-H", "female"), v("en-US-Standard-I", "male"),
    v("en-US-Standard-J", "male") ] },
  { code: "en-AU", label: "English (Australian)", voices: [
    v("en-AU-Standard-A", "female"), v("en-AU-Standard-B", "male"), v("en-AU-Standard-C", "female"),
    v("en-AU-Standard-D", "male") ] },
  { code: "en-IN", label: "English (Indian)", voices: [
    v("en-IN-Standard-A", "female"), v("en-IN-Standard-B", "male"), v("en-IN-Standard-C", "male"),
    v("en-IN-Standard-D", "female") ] },
  { code: "de-DE", label: "German", voices: [
    v("de-DE-Standard-A", "female"), v("de-DE-Standard-B", "male"), v("de-DE-Standard-C", "female"),
    v("de-DE-Standard-D", "male"), v("de-DE-Standard-E", "male"), v("de-DE-Standard-F", "female") ] },
  { code: "fr-FR", label: "French", voices: [
    v("fr-FR-Standard-A", "female"), v("fr-FR-Standard-B", "male"), v("fr-FR-Standard-C", "female"),
    v("fr-FR-Standard-D", "male"), v("fr-FR-Standard-E", "female") ] },
  { code: "es-ES", label: "Spanish (Spain)", voices: [
    v("es-ES-Standard-A", "female"), v("es-ES-Standard-B", "male"), v("es-ES-Standard-C", "female"),
    v("es-ES-Standard-D", "female") ] },
  { code: "it-IT", label: "Italian", voices: [
    v("it-IT-Standard-A", "female"), v("it-IT-Standard-B", "female"), v("it-IT-Standard-C", "male"),
    v("it-IT-Standard-D", "male") ] },
  { code: "sv-SE", label: "Swedish", voices: [
    v("sv-SE-Standard-A", "female"), v("sv-SE-Standard-B", "female"), v("sv-SE-Standard-C", "female"),
    v("sv-SE-Standard-D", "male"), v("sv-SE-Standard-E", "male") ] },
  { code: "ja-JP", label: "Japanese", voices: [
    v("ja-JP-Standard-A", "female"), v("ja-JP-Standard-B", "female"), v("ja-JP-Standard-C", "male"),
    v("ja-JP-Standard-D", "male") ] },
];

// Chirp 3 HD: the same 30 voices in every accent on offer (checked with voices.list, 2026-11-12: 14 female, 16
// male, each `<code>-Chirp3-HD-<Name>`, natural rate 24 kHz), in Google's alphabetical order.
const HD_VOICES: ReadonlyArray<readonly [string, VoiceGender]> = [
  ["Achernar", "female"], ["Achird", "male"], ["Algenib", "male"], ["Algieba", "male"], ["Alnilam", "male"],
  ["Aoede", "female"], ["Autonoe", "female"], ["Callirrhoe", "female"], ["Charon", "male"], ["Despina", "female"],
  ["Enceladus", "male"], ["Erinome", "female"], ["Fenrir", "male"], ["Gacrux", "female"], ["Iapetus", "male"],
  ["Kore", "female"], ["Laomedeia", "female"], ["Leda", "female"], ["Orus", "male"], ["Puck", "male"],
  ["Pulcherrima", "female"], ["Rasalgethi", "male"], ["Sadachbia", "male"], ["Sadaltager", "male"], ["Schedar", "male"],
  ["Sulafat", "female"], ["Umbriel", "male"], ["Vindemiatrix", "female"], ["Zephyr", "female"], ["Zubenelgenubi", "male"],
];

/** The HD tier's accents: the same accents as Standard, in the same order, each with the Chirp 3 HD voices. */
export const PLACEHOLDER_HD_ACCENTS: readonly PlaceholderAccent[] = PLACEHOLDER_ACCENTS.map((a) => ({
  code: a.code, label: a.label, voices: HD_VOICES.map(([name, gender]) => v(`${a.code}-Chirp3-HD-${name}`, gender)),
}));

const accentsFor = (tier: PlaceholderTier | undefined): readonly PlaceholderAccent[] => (tier === "hd" ? PLACEHOLDER_HD_ACCENTS : PLACEHOLDER_ACCENTS);

/** The accent for a code in a tier (Standard when absent), or undefined when it isn't one on offer. */
export function placeholderAccent(code: string | undefined, tier?: PlaceholderTier): PlaceholderAccent | undefined {
  const want = code?.replace(/_/g, "-").toLowerCase();
  return want === undefined ? undefined : accentsFor(tier).find((a) => a.code.toLowerCase() === want);
}

/** The tier a voice belongs to, from its name: `hd` for a Chirp 3 HD voice, `standard` for a Standard one,
 *  undefined for any other Google voice (a name set by hand, taken as given). */
export function placeholderVoiceTier(voice: string): PlaceholderTier | undefined {
  if (/-Chirp3-HD-/.test(voice)) return "hd";
  if (/-Standard-/.test(voice)) return "standard";
  return undefined;
}

/** The accent a project's main language implies: an exact match (`en-GB`), else the first accent on offer for
 *  that language, so a bare `en` is British English (Ian, 2026-11-10), changeable in settings. Undefined for a
 *  language with no accent on offer. */
export function accentForLanguage(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const exact = placeholderAccent(locale);
  if (exact) return exact.code;
  const lang = locale.split(/[-_]/)[0]!.toLowerCase();
  const same = PLACEHOLDER_ACCENTS.filter((a) => a.code.split("-")[0]!.toLowerCase() === lang);
  return same[0]?.code;
}

/** The voice a character gets with none chosen: a hash of their name picks from the accent's voices; when
 *  their gender is male or female (any case) and that pick is the other, the pick moves within that gender's
 *  voices. Characters whose pick already fits keep it, so setting a gender changes only the voices that were
 *  wrong. The tier's lists are its own, so an HD default is not the Standard one made HD. Undefined when the
 *  accent isn't one on offer. */
export function defaultPlaceholderVoice(name: string, accent: string | undefined, gender?: string, tier?: PlaceholderTier): string | undefined {
  const voices = placeholderAccent(accent, tier)?.voices;
  if (!voices?.length) return undefined;
  const h = fnv32(name);
  const pick = voices[h % voices.length]!;
  const want = gender?.trim().toLowerCase();
  if ((want !== "male" && want !== "female") || pick.gender === want) return pick.name;
  const fitting = voices.filter((x) => x.gender === want);
  return fitting.length ? fitting[h % fitting.length]!.name : pick.name;
}

/** A voice's name in words, for the Cast editor: "Female, English (British) 2" for a Standard voice, "Female,
 *  English (British) HD: Aoede" for an HD one (Google's own name, as the voice table and the docs use it). Falls
 *  back to the raw name. */
export function describePlaceholderVoice(voice: string): string {
  for (const a of PLACEHOLDER_ACCENTS) {
    const sameGender = (g: VoiceGender): PlaceholderVoice[] => a.voices.filter((x) => x.gender === g);
    const found = a.voices.find((x) => x.name === voice);
    if (found) {
      const n = sameGender(found.gender).indexOf(found) + 1;
      return `${found.gender === "female" ? "Female" : "Male"}, ${a.label} ${n}`;
    }
  }
  for (const a of PLACEHOLDER_HD_ACCENTS) {
    const found = a.voices.find((x) => x.name === voice);
    if (found) return `${found.gender === "female" ? "Female" : "Male"}, ${a.label} HD: ${voice.slice(voice.lastIndexOf("-") + 1)}`;
  }
  return voice;
}
