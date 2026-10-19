// ---------------------------------------------------------------------------
// Speaker labels (design/proposals/qualified-speaker-labels.md) in ops: the speaker pattern
// (`speaker:pattern`) and a character's own label with a qualifier (`speaker:<NAME>:<gameId>`) are
// project-level strings beside `cast:` and `qualifier:`, exported only when the lines use a qualifier,
// and only for a pair a writer overrode; they round-trip through JSON, PO, and Excel; the playable page
// shows the runtime's label rather than building one; and a merge keeps both sides' labels.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Engine } from "@patterkit/runtime";
import {
  loadProject, extractLoc, applyLoc, applyWrites, catalogToJson, jsonToCatalog, catalogToPo, poToCatalog,
  catalogToXlsx, xlsxToCatalog, runExportHtml, runExportFull, runMerge,
} from "../src/index.js";
import type { LocCatalog } from "../src/index.js";
import { SPEAKER_PATTERN_NOTE } from "../src/localisation.js";
import { PLAYABLE_RUNTIME_JS } from "../src/playable-runtime.js";

type Obj = Record<string, unknown>;

/** PLAYER thinks (V.O.), with a label of their own; TAM speaks off-screen (O.S.), following the pattern; TAM
 *  also has a label for the radio that no line uses. `qualified: false` drops every qualifier from the lines. */
function makeProject(opts: { qualified?: boolean; project?: Obj; enStrings?: Obj } = {}): string {
  const qualified = opts.qualified ?? true;
  const dir = mkdtempSync(join(tmpdir(), "patter-labels-"));
  for (const d of ["scenes", "loc/en", "loc/fr"]) mkdirSync(join(dir, d), { recursive: true });
  const w = (p: string, o: unknown) => writeFileSync(join(dir, p), JSON.stringify(o));

  w("game.patterproj", {
    schema: "patter/project@0", project: { id: "lab", name: "Labels" },
    locales: { default: "en", all: ["en", "fr"] },
    cast: [
      { name: "PLAYER", displayName: "You", gender: "neuter", qualifierLabels: { vo: "Your thoughts" } },
      { name: "TAM", displayName: "Tam", qualifierLabels: { radio: "Tam, on the radio" } },
    ],
    ...opts.project,
  });
  const q = (gameId: string) => (qualified ? { qualifier: gameId } : {});
  w("scenes/one.patterflow", { schema: "patter/flow@0", scene: {
    id: "s1", type: "scene", name: "Night", blocks: [
      { id: "b1", type: "block", name: "Door", children: [
        { id: "n1", type: "snippet", beats: [
          { id: "L1", kind: "line", character: "PLAYER", ...q("vo") },
          { id: "L2", kind: "line", character: "TAM", ...q("os") },
          { id: "L3", kind: "line", character: "TAM" },
        ] },
      ] },
    ] } });
  w("loc/en/one.patterloc", { schema: "patter/strings@0", scene: "s1", locale: "en", default: true,
    strings: { L1: "Is anyone there?", L2: "Open up.", L3: "Hello." } });
  if (opts.enStrings) w("loc/en/_project.patterloc", { schema: "patter/strings@0", scene: "@project", locale: "en", default: true, strings: opts.enStrings });
  return dir;
}

const byId = (c: LocCatalog) => Object.fromEntries(c.entries.map((e) => [e.id, e]));

describe("speaker labels in the localisation catalogue", () => {
  const catalog = extractLoc(loadProject(makeProject()), { locale: "fr" });
  const e = byId(catalog);

  it("exports the pattern, with a note that its placeholders are kept and may be reordered", () => {
    expect(e["speaker:pattern"]).toMatchObject({ scene: "@project", source: "{name} ({qualifier})", translation: "", context: { kind: "speaker pattern" } });
    expect(e["speaker:pattern"]!.comments[0]).toBe(SPEAKER_PATTERN_NOTE);
    expect(SPEAKER_PATTERN_NOTE).toContain("{name}");
    expect(SPEAKER_PATTERN_NOTE).toContain("{qualifier}");
  });

  it("exports an overridden pair the lines use, with the character, their gender, and the qualifier as context", () => {
    expect(e["speaker:PLAYER:vo"]).toMatchObject({
      scene: "@project", source: "Your thoughts", translation: "",
      context: { character: "PLAYER", kind: "speaker", gender: "neuter", qualifier: "V.O." },
    });
  });

  it("leaves out a pair nobody overrode, and an override no line uses", () => {
    expect(e["speaker:TAM:os"]).toBeUndefined();
    expect(e["speaker:TAM:radio"]).toBeUndefined();
    expect(Object.keys(e).filter((id) => id.startsWith("speaker:")).sort()).toEqual(["speaker:PLAYER:vo", "speaker:pattern"]);
  });

  it("exports nothing for speaker labels when no line has a qualifier", () => {
    const plain = byId(extractLoc(loadProject(makeProject({ qualified: false }))));
    expect(Object.keys(plain).filter((id) => id.startsWith("speaker:"))).toEqual([]);
  });

  it("takes the pattern's source from the default-language strings, else the project, else the default", () => {
    const own = byId(extractLoc(loadProject(makeProject({ project: { speakerPattern: "{name}, {qualifier}" } }))));
    expect(own["speaker:pattern"]!.source).toBe("{name}, {qualifier}");
    const shard = byId(extractLoc(loadProject(makeProject({ project: { speakerPattern: "{name}, {qualifier}" }, enStrings: { "speaker:pattern": "{name} [{qualifier}]" } }))));
    expect(shard["speaker:pattern"]!.source).toBe("{name} [{qualifier}]");
  });

  it("PO names the pair in its speaker context, with the gender, and carries the note", () => {
    const po = catalogToPo(catalog);
    expect(po).toContain('msgctxt "speaker:PLAYER:vo"');
    expect(po).toContain("#. [speaker PLAYER (V.O.)]");
    expect(po).toContain("#. Gender: neuter");
    expect(po).toContain(`#. ${SPEAKER_PATTERN_NOTE}`);
    expect(po).toContain('msgid "{name} ({qualifier})"');
  });

  it("the pattern and a pair round-trip through JSON, PO, and Excel, and the runtime shows them in French", async () => {
    const translated: LocCatalog = { ...catalog, entries: catalog.entries.map((x) =>
      x.id === "speaker:pattern" ? { ...x, translation: "{qualifier} : {name}" }
        : x.id === "speaker:PLAYER:vo" ? { ...x, translation: "Tes pensées" }
          : x.id === "cast:TAM" ? { ...x, translation: "Tam-FR" }
            : x.id === "qualifier:os" ? { ...x, translation: "H.C." } : x) };
    const viaJson = jsonToCatalog(catalogToJson(translated));
    const viaPo = poToCatalog(catalogToPo(translated));
    const viaXlsx = { ...(await xlsxToCatalog(await catalogToXlsx(translated))), locale: "fr" };
    for (const back of [viaJson, viaPo, viaXlsx]) {
      expect(byId(back)["speaker:pattern"]).toMatchObject({ scene: "@project", translation: "{qualifier} : {name}" });
      expect(byId(back)["speaker:PLAYER:vo"]).toMatchObject({ scene: "@project", translation: "Tes pensées" });
    }

    for (const back of [viaJson, viaPo, viaXlsx]) {
      const work = makeProject();
      applyWrites(applyLoc(loadProject(work), back, { now: "2026-10-14T00:00:00Z" }).writes);
      const again = loadProject(work);
      const fr = byId(extractLoc(again, { locale: "fr" }));
      expect(fr["speaker:pattern"]!.translation).toBe("{qualifier} : {name}");
      expect(fr["speaker:PLAYER:vo"]!.translation).toBe("Tes pensées");

      const flow = new Engine(runExportFull(again), { locale: "fr" }).openFlow("main", { scene: "s1" });
      expect(flow.advance()).toMatchObject({ id: "L1", speakerLabel: "Tes pensées" });
      expect(flow.advance()).toMatchObject({ id: "L2", speakerLabel: "H.C. : Tam-FR" });
      expect(flow.advance()).toMatchObject({ id: "L3", speakerLabel: "Tam-FR" });
    }
  });
});

describe("the playable page", () => {
  it("shows the runtime's label, never putting a name and a qualifier together itself", () => {
    const html = runExportHtml(loadProject(makeProject()));
    expect(html).toContain("s.speakerLabel || s.characterName");
    expect(html).not.toContain("s.qualifierName || s.qualifier");
  });

  it("the inlined runtime snapshot carries the label on a line step", () => {
    const sandbox: Record<string, unknown> = {};
    runInNewContext(`${PLAYABLE_RUNTIME_JS};this.Patterplay=Patterplay;`, sandbox);
    const { Engine: Inlined } = sandbox.Patterplay as { Engine: new (b: unknown) => { openFlow(n: string, o: unknown): { advance(): Record<string, unknown> } } };
    const flow = new Inlined(runExportFull(loadProject(makeProject()))).openFlow("main", { scene: "s1" });
    expect(flow.advance()).toMatchObject({ id: "L1", speakerLabel: "Your thoughts" });
    expect(flow.advance()).toMatchObject({ id: "L2", speakerLabel: "Tam (O.S.)" });
  });
});

describe("merging the project file", () => {
  const proj = (fields: Obj = {}): Obj => ({ schema: "patter/project@0", project: { id: "p", name: "P" }, locales: { default: "en", all: ["en"] }, ...fields });
  const paths = (r: { conflicts: Array<{ path: string; kind: string }> }) => r.conflicts.map((c) => `${c.path}:${c.kind}`).sort();
  /* eslint-disable @typescript-eslint/no-explicit-any */

  it("two sides each labelling a pair of the same character both land", () => {
    const base = proj({ cast: [{ name: "PLAYER", displayName: "You" }] });
    const r = runMerge(base,
      proj({ cast: [{ name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts" } }] }),
      proj({ cast: [{ name: "PLAYER", displayName: "You", qualifierLabels: { radio: "You, on the radio" } }] }));
    expect(r.conflicts).toEqual([]);
    expect((r.merged as any).cast).toEqual([{ name: "PLAYER", displayName: "You", qualifierLabels: { vo: "Your thoughts", radio: "You, on the radio" } }]);
  });

  it("a label on one side and another field on the other both land; a removed label stays removed", () => {
    const base = proj({ cast: [{ name: "PLAYER", qualifierLabels: { vo: "Your thoughts", os: "You, outside" } }] });
    const r = runMerge(base,
      proj({ cast: [{ name: "PLAYER", qualifierLabels: { vo: "Your thoughts" } }] }),
      proj({ cast: [{ name: "PLAYER", notes: "Second person.", qualifierLabels: { vo: "Your thoughts", os: "You, outside" } }] }));
    expect(r.conflicts).toEqual([]);
    expect((r.merged as any).cast).toEqual([{ name: "PLAYER", notes: "Second person.", qualifierLabels: { vo: "Your thoughts" } }]);
  });

  it("the same pair labelled two ways is a conflict on that pair alone", () => {
    const base = proj({ cast: [{ name: "PLAYER" }] });
    const r = runMerge(base,
      proj({ cast: [{ name: "PLAYER", qualifierLabels: { vo: "Your thoughts" }, actor: "Jo" }] }),
      proj({ cast: [{ name: "PLAYER", qualifierLabels: { vo: "Inner voice" } }] }));
    expect(paths(r)).toEqual(["cast[PLAYER].qualifierLabels.vo:added-both"]);
    expect((r.merged as any).cast[0].actor).toBe("Jo");
  });

  it("a member one side removed and the other labelled stays a conflict over the member", () => {
    const base = proj({ cast: [{ name: "PLAYER" }] });
    const r = runMerge(base, proj({ cast: [] }), proj({ cast: [{ name: "PLAYER", qualifierLabels: { vo: "Your thoughts" } }] }));
    expect(paths(r)).toEqual(["cast[PLAYER]:delete-vs-edit"]);
  });

  it("the speaker pattern merges as one value: one side's change lands, two different ones conflict", () => {
    expect((runMerge(proj(), proj({ speakerPattern: "{name}, {qualifier}" }), proj({ voiced: true })).merged as any).speakerPattern).toBe("{name}, {qualifier}");
    expect(paths(runMerge(proj(), proj({ speakerPattern: "{name}, {qualifier}" }), proj({ speakerPattern: "{name} [{qualifier}]" })))).toEqual(["speakerPattern:both-changed"]);
  });
});
