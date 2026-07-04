// DEV-ONLY preview of the play WINDOW (stubs window.patterPlay with a canned event tape). See dev.ts.
type Ev =
  | { t: "step"; step: { kind: string; id: string; text?: string; character?: string; direction?: string } }
  | { t: "choice"; options: Array<{ id: string; text: string; character?: string; eligible: boolean }> }
  | { t: "end" };

// A tiny multilingual tape so the #195 play-language switcher can be exercised in the dev preview.
// `fr` translates the prose / lines; the unprovided strings fall back like the real `<Untranslated>` path.
const tapes: Record<string, Ev[]> = {
  en: [
    { t: "step", step: { kind: "text", id: "T1", text: "The tavern is dim, thick with pipe-smoke and the smell of spilled ale." } },
    { t: "step", step: { kind: "line", id: "L1", character: "BARKEEP", text: "What'll it be, stranger?" } },
    { t: "step", step: { kind: "line", id: "L2", character: "BARKEEP", direction: "wiping a glass", text: "We don't get many new faces down this way." } },
    { t: "choice", options: [
      { id: "opt_work", text: "Ask about work", eligible: true },
      { id: "opt_intimidate", text: "Threaten him for coin", eligible: false },
      { id: "opt_leave", text: "Leave", eligible: true },
    ] },
    { t: "step", step: { kind: "text", id: "T2", text: "You ask whether there's honest work to be had." } },
    { t: "step", step: { kind: "line", id: "L3", character: "BARKEEP", text: "Aye, rats in the cellar. Big ones. Two gold if you clear them out." } },
    { t: "end" },
  ],
  fr: [
    { t: "step", step: { kind: "text", id: "T1", text: "La taverne est sombre, épaisse de fumée de pipe et d'une odeur de bière renversée." } },
    { t: "step", step: { kind: "line", id: "L1", character: "TAVERNIER", text: "Qu'est-ce que ce sera, étranger ?" } },
    { t: "step", step: { kind: "line", id: "L2", character: "TAVERNIER", direction: "essuyant un verre", text: "On ne voit pas souvent de nouveaux visages par ici." } },
    { t: "choice", options: [
      { id: "opt_work", text: "Demander du travail", eligible: true },
      { id: "opt_intimidate", text: "Le menacer pour de l'or", eligible: false },
      { id: "opt_leave", text: "Partir", eligible: true },
    ] },
    { t: "step", step: { kind: "text", id: "T2", text: "Vous demandez s'il y a du travail honnête à faire." } },
    { t: "step", step: { kind: "line", id: "L3", character: "TAVERNIER", text: "Ouais, des rats dans la cave. Des gros. Deux pièces d'or si tu t'en débarrasses." } },
    { t: "end" },
  ],
};

let locale = "en";
let events: Ev[] = tapes.en!;
let i = 0;
const stub = {
  start: async () => { i = 0; events = tapes[locale] ?? tapes.en!; },
  step: async () => {
    const ev = events[i];
    if (!ev || ev.t === "end") return { steps: [], stop: "end" };
    if (ev.t === "choice") return { steps: [], stop: "choice", options: ev.options };
    i++; return { steps: [ev.step], stop: "continue" };
  },
  toStop: async () => {
    const steps: unknown[] = [];
    for (;;) {
      const ev = events[i];
      if (!ev || ev.t === "end") return { steps, stop: "end" };
      if (ev.t === "choice") return { steps, stop: "choice", options: ev.options };
      steps.push(ev.step); i++;
    }
  },
  choose: async () => { i++; }, // step past the choice event
  mark: () => undefined,
  resetMarks: () => undefined,
  onRestart: () => undefined,
  info: async () => ({ address: "the_tavern.intro", pinned: true, audio: true, captions: true, locales: ["en", "fr", "de"], locale, defaultLocale: "en" }),
  audioBytes: async () => null, // no real clips in the preview -> Continue fakes pacing at ~150 wpm
  setPin: () => undefined,
  setLocale: async (l: string) => { locale = l; },
  setClosedCaptions: async () => undefined,
  onStale: () => undefined,
  onRefreshed: () => undefined,
};
(window as unknown as { patterPlay: unknown }).patterPlay = stub;
void import("../play/play.js");
