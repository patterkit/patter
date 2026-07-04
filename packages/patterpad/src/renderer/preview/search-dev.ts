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

const stub = {
  info: async () => ({ mode: "property" as const, pinned: true, hasProject: true, voiced: true, query: "@gold" }),
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
};
(window as unknown as { patterSearch: unknown }).patterSearch = stub;
void import("../search/search.js");
