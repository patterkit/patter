// ---------------------------------------------------------------------------
// The playable-HTML export: a single self-contained `.html` file that plays the story in any browser -
// the Patterplay runtime, the compiled bundle (every locale), and the player UI all inlined, with no
// external references. These asserts lock the self-containment contract; the player logic itself is the
// runtime's, exercised by the conformance corpus.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadProject, runExportFull, runExportHtml, runExportWeb } from "../src/index.js";
import { PLAYABLE_RUNTIME_JS } from "../src/playable-runtime.js";

const fixtureDir = fileURLToPath(new URL("./fixture", import.meta.url));
const tourDir = fileURLToPath(new URL("../../../examples/projects/tour.patter", import.meta.url));

describe("runExportHtml", () => {
  const html = runExportHtml(loadProject(fixtureDir));

  it("is a complete HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("inlines the runtime and the bundle so it needs no network", () => {
    expect(html).toContain("window.Patterplay");      // the runtime UMD defines it
    expect(html).toContain("window.PATTER_BUNDLE=");   // the compiled story, inlined
    // The source string is embedded (so the page reads even when the shipped bundle is IDs-only).
    expect(html).toContain("Welcome.");
  });

  it("embeds the source language only - one locale, no switcher", () => {
    const m = html.match(/<script>window\.PATTER_BUNDLE=([\s\S]*?);<\/script>/)!;
    const bundle = JSON.parse(m[1]!);
    expect(bundle.locales.included).toEqual([bundle.locales.default]);
    expect(Object.keys(bundle.strings)).toEqual([bundle.locales.default]);
    expect(html).not.toContain('id="lang"'); // no language picker in a source-only reader
  });

  it("references nothing external - no src/href URLs, no http(s)", () => {
    expect(html).not.toMatch(/\bsrc=/);
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("escapes < inside the embedded bundle JSON so it can't break out of the <script>", () => {
    // canonicalStringify -> every '<' becomes the < escape; no raw '<' can appear in the data block.
    const data = html.match(/<script>window\.PATTER_BUNDLE=([\s\S]*?);<\/script>/)![1]!;
    expect(data).not.toContain("<");
  });

  it("titles the page from the project name", () => {
    expect(html).toContain("<title>The Tavern</title>");
  });
});

// The page inlines a SNAPSHOT of the runtime (playable-runtime.ts, regenerated from the built UMD). This
// guards that the snapshot is current enough to PLAY a real project - notably that it knows every beat kind
// the compiler emits. A stale blob once returned undefined for the gameEvent beat, hard-crashing the page on
// a choice ("Cannot read properties of undefined (reading 'type')"). Drives the same loop PLAYER_JS runs.
describe("playable HTML: the inlined runtime can play a real project end to end", () => {
  interface PlayStep { type: string; options?: Array<{ id: string; eligible?: boolean }> }
  interface PlayFlow { advance: () => PlayStep | undefined; choose: (id: string) => void }

  it("plays the Patter tour (with its gameEvent beat) without a missing step", () => {
    const full = runExportFull(loadProject(tourDir));
    const def = full.locales?.default ?? Object.keys(full.strings)[0] ?? "en";
    const bundle = { ...full, locales: { default: def, included: [def] }, strings: { [def]: full.strings[def] ?? {} } };
    // Load the inlined UMD the way the generated page does (it defines the global `Patterplay`).
    const Patterplay = new Function(`${PLAYABLE_RUNTIME_JS}\n; return Patterplay;`)() as { Engine: new (b: unknown) => { openFlow: (id: string, o: unknown) => PlayFlow } };
    const startScene = (bundle as { start?: { scene?: string } }).start?.scene ?? Object.keys((bundle as { scenes: Record<string, unknown> }).scenes)[0]!;
    const flow = new Patterplay.Engine(bundle).openFlow("main", { scene: startScene });

    const kinds = new Set<string>();
    const run = (): PlayStep => {
      for (let i = 0; i < 1000; i++) {
        const step = flow.advance();
        expect(step, "advance() must always return a step (a stale runtime blob returns undefined)").toBeDefined();
        kinds.add(step!.type);
        if (step!.type === "choice" || step!.type === "end") return step!;
      }
      throw new Error("did not reach a stop");
    };

    let stop = run();
    for (let picks = 0; stop.type === "choice" && picks < 12; picks++) {
      const opts = stop.options ?? [];
      const pick = opts.find((o) => o.eligible !== false) ?? opts[0];
      if (!pick) break;
      flow.choose(pick.id);
      stop = run();
    }
    expect(kinds.has("gameEvent")).toBe(true); // the tour shows off a Game Event beat - it must play, not crash
  });
});

describe("runExportWeb (the Publish-for-Web split)", () => {
  const out = runExportWeb(loadProject(fixtureDir));

  it("splits the same page into a harness + refreshed story/player", () => {
    // The harness links the other three files and carries NO inlined engine or story.
    expect(out.indexHtml).toContain('<link rel="stylesheet" href="style.css" />');
    expect(out.indexHtml).toContain('<script src="story.js"></script>');
    expect(out.indexHtml).toContain('<script src="patterplay.js"></script>');
    expect(out.indexHtml).not.toContain("window.Patterplay");
    expect(out.indexHtml).not.toContain("PATTER_BUNDLE");
    // The story loads BEFORE the player (patterplay.js reads window.PATTER_BUNDLE as it starts).
    expect(out.indexHtml.indexOf("story.js")).toBeLessThan(out.indexHtml.indexOf("patterplay.js"));
    // The refreshed halves carry the engine + the story as a plain assignment (file:// safe, no fetch).
    expect(out.storyJs.startsWith("window.PATTER_BUNDLE=")).toBe(true);
    expect(out.patterplayJs).toContain("window.Patterplay");
  });

  it("renders the SAME page as the single-file publish, just de-inlined", () => {
    const single = runExportHtml(loadProject(fixtureDir));
    // The visible markup (title, stage, controls, bar) is shared - strip both to their body shells.
    for (const marker of ['<main id="stage">', 'id="restart"', 'id="speed"']) {
      expect(out.indexHtml).toContain(marker);
      expect(single).toContain(marker);
    }
  });
});
