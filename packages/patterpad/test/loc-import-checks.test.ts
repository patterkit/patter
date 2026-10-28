// The 2026-10-28 rulings (Q7), in Patterpad: a translated file for one language is refused when another is
// picked; one naming none (an older spreadsheet) imports as the language picked, with a warning; and the import
// result lists the lines skipped and the translations to check, as the CLI prints them.

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSource } from "@patterkit/core";
import type { LocaleFile } from "@patterkit/model";
import * as project from "../src/main/project.js";

const TAVERN = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

/** A private copy of the tavern in English, French and German, open, with French exported as JSON. */
async function frenchExport(): Promise<{ dir: string; catalog: { locale?: string; entries: Array<{ id: string; scene: string; translation: string }> } }> {
  const dir = join(mkdtempSync(join(tmpdir(), "pp-locimport-")), "tavern.patter");
  cpSync(TAVERN, dir, { recursive: true });
  project.openProject(dir);
  project.hydrate();
  const s = project.readSettings()!;
  expect((await project.saveSettings({ ...s, locales: ["en", "fr", "de"] })).ok).toBe(true);
  const exported = await project.locExport("json", "fr");
  return { dir, catalog: JSON.parse(String(exported!.content)) };
}

describe("translation import in Patterpad", () => {
  it("refuses a file for one language when another is picked, and takes the file's own when none is", async () => {
    const { dir, catalog } = await frenchExport();
    catalog.entries.find((e) => e.id === "L_greet")!.translation = "Qu'est-ce que ce sera ?";
    const file = join(dir, "..", "fr.json");
    writeFileSync(file, JSON.stringify(catalog));
    const refused = await project.locImport(file, "de");
    expect(refused).toMatchObject({ ok: false });
    expect(refused.error).toBe("This file is for 'fr', not 'de', so nothing was imported. Choose 'fr' as the language to import it, or check it's the right file.");
    expect(await project.locImport(file)).toMatchObject({ ok: true, locale: "fr", updated: 1 });
  });

  it("imports a file naming no language as the one picked, warned, and lists what it skipped and what to check", async () => {
    const { dir, catalog } = await frenchExport();
    delete catalog.locale;
    catalog.entries.find((e) => e.id === "L_greet")!.translation = "Qu'est-ce que ce sera, {@name} ?";
    catalog.entries.push({ id: "L_gone", scene: "scn_tavern", translation: "Disparu" });
    const file = join(dir, "..", "old.json");
    writeFileSync(file, JSON.stringify(catalog));
    const res = await project.locImport(file, "fr");
    expect(res).toMatchObject({ ok: true, locale: "fr", updated: 1 });
    expect(res.report).toEqual([
      "This file doesn't say which language it's for, so it was imported as 'fr'. Check that's the right language.",
      "Skipped 1 line this project doesn't have, so its translation wasn't imported:",
      "  L_gone in 'The Tavern'",
      "1 translation doesn't match the source's placeholders or formatting. It was imported, but check it:",
      "  L_greet in 'The Tavern': extra {@name}",
    ]);
    const fr = parseSource(readFileSync(join(dir, "loc", "fr", "tavern.patterloc"), "utf8")) as LocaleFile;
    expect(fr.strings).not.toHaveProperty("L_gone");
    expect(fr.strings.L_greet).toBe("Qu'est-ce que ce sera, {@name} ?");
  });
});
