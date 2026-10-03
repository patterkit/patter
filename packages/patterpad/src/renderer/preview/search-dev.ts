// DEV-ONLY preview of the search WINDOW (stubs window.patterSearch). Boots in property-usage mode so the
// new mode can be eyeballed; the Text / Status modes return small canned lists too. See dev.ts.
import type { SearchEntry } from "../../shared/api.js";

const contentHits: SearchEntry[] = [
  { id: "scn_tavern", kind: "scene", name: "The Tavern", gameId: "the-tavern", location: ["The Tavern"], sceneId: "scn_tavern" },
  { id: "L_greet", kind: "beat", text: "What'll it be, stranger?", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
];
const propertyHits: SearchEntry[] = [
  { id: "sn_check", kind: "snippet", text: "if @gold >= 10", location: ["The Tavern", "Bar"], sceneId: "scn_tavern" },
  { id: "sn_reward", kind: "snippet", text: "on enter: set @gold = @gold + 5", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
  { id: "L_purse", kind: "beat", text: "You have {@gold} gold.", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
];
const statusHits: SearchEntry[] = [
  { id: "L_greet", kind: "beat", text: "What'll it be, stranger?", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
];
const tagHits: SearchEntry[] = [
  { id: "L_greet", kind: "beat", text: "What'll it be, stranger?", location: ["The Tavern", "Intro"], sceneId: "scn_tavern" },
  { id: "sn_barks", kind: "snippet", text: "A patron mutters into their ale.", location: ["The Tavern", "Bar"], sceneId: "scn_tavern" },
];

// Open suggestions from an editor's returned file (the Suggestions tab): one plain rewrite, one out of date,
// a speaker + direction change, and a cut. Deciding one removes it, as the real list would.
let suggestions = [
  { id: "sg_1", anchor: "L_greet", sceneId: "scn_tavern", sceneName: "The Tavern", author: "Sam", ts: "2026-10-04T09:00:00Z", baseline: "What'll it be, stranger?", proposed: "What'll it be, friend?", handoff: "H-7Q2K", stale: [] as string[] },
  { id: "sg_2", anchor: "L_work", sceneId: "scn_tavern", sceneName: "The Tavern", author: "Sam", ts: "2026-10-04T09:05:00Z", baseline: "Aye - rats in the cellar.", proposed: "Rats. Big ones. In the cellar.", handoff: "H-7Q2K", stale: ["the text"] },
  { id: "sg_3", anchor: "L_intim", sceneId: "scn_tavern", sceneName: "The Tavern", author: "Jo", ts: "2026-10-04T10:00:00Z", baseline: "...fine, fine.", proposed: "...fine, fine.", proposedCharacter: "PLAYER", baselineCharacter: "BARKEEP", proposedDirection: "sighing", baselineDirection: "", handoff: "H-7Q2K", stale: [] as string[] },
  { id: "sg_4", anchor: "T_lean", sceneId: "scn_tavern", sceneName: "The Tavern", author: "Sam", ts: "2026-10-04T10:30:00Z", baseline: "You lean across the bar and murmur about the cellar.", proposed: "You lean across the bar and murmur about the cellar.", proposedCut: true, handoff: "H-7Q2K", stale: [] as string[] },
  { id: "sg_5", anchor: "L_secret", sceneId: "scn_tavern", sceneName: "The Tavern", author: "Ian", ts: "2026-10-02T10:30:00Z", baseline: "...so you DO know.", proposed: "...so you do know.", stale: [] as string[] },
];

const stub = {
  suggestions: async (filter: { handoff?: string }) => suggestions.filter((g) => !filter.handoff || g.handoff === filter.handoff),
  handoffs: async () => [{ id: "H-7Q2K", recipient: "Sam", createdAt: "2026-10-03T12:00:00Z", createdBy: "Ian" }],
  decideSuggestions: async (decisions: Array<{ id: string; accept: boolean }>) => {
    const ids = new Set(decisions.map((d) => d.id));
    suggestions = suggestions.filter((g) => !ids.has(g.id));
    return { ok: true, results: decisions.map((d) => ({ id: d.id, outcome: d.accept ? "accepted" : "rejected" })) };
  },
  info: async () => ({ mode: (new URLSearchParams(location.search).get("mode") ?? "property") as "property", pinned: true, hasProject: true, voiced: true, query: "@gold", theme: { colour: "system" as const, font: "newsreader" as const } }),
  search: async (q: string) => (q.trim() ? contentHits : []),
  propertyUsage: async (q: string) => (q.trim() ? propertyHits.filter((e) => !q.includes(" ") || e.text!.toLowerCase().includes(q.split(/\s+/)[1]!.toLowerCase())) : []),
  replacePreview: async (opts: { query: string; replacement: string }) => {
    const hits = opts.query.trim()
      ? contentHits.filter((e) => e.text?.toLowerCase().includes(opts.query.toLowerCase()))
          .map((e) => ({ id: e.id, sceneId: e.sceneId, location: e.location, before: e.text!, after: e.text!.replaceAll(opts.query, opts.replacement) }))
      : [];
    return { hits, scenes: new Set(hits.map((h) => h.sceneId)).size };
  },
  replaceApply: async () => ({ ok: true, count: 1, scenes: 1 }),
  linesByStatus: async (_status: string, _recording: boolean) => statusHits,
  statuses: async (recording: boolean) => (recording
    ? [{ name: "missing", colour: 0 }, { name: "recorded", colour: 4 }]
    : [{ name: "stub", colour: 0 }, { name: "final", colour: 9 }]),
  tagUsage: async (_tag: string) => tagHits,
  tags: async () => [{ name: "barked", count: 4 }, { name: "tutorial", count: 2 }, { name: "whisper", count: 1 }],
  jump: (e: SearchEntry) => console.log("jump", e.id),
  setPin: (on: boolean) => console.log("setPin", on),
  close: () => console.log("close"),
  onMode: () => undefined,
  onSeed: () => undefined,
  onProject: () => undefined,
  onPin: () => undefined,
  onTheme: () => undefined,
};
(window as unknown as { patterSearch: unknown }).patterSearch = stub;
void import("../search/search.js");
