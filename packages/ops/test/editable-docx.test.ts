// ---------------------------------------------------------------------------
// The editable script export (editable-docx.ts): one boxed table per editable line with its marker, the
// readable script's structure around it, a spacer between consecutive boxes, bookmarks only on headings a
// jump points at (each with its own id), and a handoff record that matches the document line for line.
// The reader (step 6) tests the round trip; this reads the XML directly.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { cpSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { canonicalStringify, parseSource } from "@patterkit/core";
import type { AuthoringFile } from "@patterkit/model";
import { loadProject, applyWrites, exportEditableScript, readHandoff, readMarker, formatMarker, runScriptDoc } from "../src/index.js";

const fixture = fileURLToPath(new URL("../../../test-fixtures/tavern-example.patter", import.meta.url));

/** A deterministic stand-in for Math.random (a small LCG). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

function tavern(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-editable-")), "tavern.patter");
  cpSync(fixture, dir, { recursive: true });
  // A note for the editor on the greeting, and one for VO that the default export leaves out.
  const path = join(dir, "authoring/tavern.patterx");
  const af = parseSource(readFileSync(path, "utf8")) as AuthoringFile;
  writeFileSync(path, canonicalStringify({ ...af, documentation: { L_greet: [{ type: "editor", text: "He's tired, not rude." }, { type: "vo", text: "Low and slow." }] } }));
  return dir;
}

async function xmlOf(docx: Buffer): Promise<{ body: string; header: string }> {
  const zip = await JSZip.loadAsync(docx);
  const header = await Promise.all(Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).map((n) => zip.file(n)!.async("string")));
  return { body: await zip.file("word/document.xml")!.async("string"), header: header.join("") };
}

const decode = (s: string): string => s.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const text = (xml: string): string => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => decode(m[1]!)).join("");

describe("exportEditableScript", async () => {
  const dir = tavern();
  const loaded = loadProject(dir);
  const result = await exportEditableScript(loaded, { by: "Ian", recipient: "Sam", now: "2026-10-03T12:00:00Z", random: seeded(7) });
  const { body, header } = await xmlOf(result.docx);
  const editable = runScriptDoc(loaded).elements.filter((e) => e.kind === "line" || e.kind === "narration" || e.kind === "option");

  it("boxes every editable line once, each beside its own valid marker", () => {
    const tables = body.split("<w:tbl>").slice(1);
    expect(tables).toHaveLength(editable.length);
    const markers = tables.map((t) => readMarker(text(t))!);
    expect(markers.every((m) => m.valid)).toBe(true);
    expect(new Set(markers.map((m) => m.code)).size).toBe(editable.length);
  });

  it("records every box in the handoff, with the line's id and its text exactly as stored", () => {
    const h = result.handoff;
    expect(Object.keys(h.lines)).toHaveLength(editable.length);
    expect(Object.values(h.lines).map((l) => l.id)).toEqual(editable.map((e) => e.id));
    const greet = Object.values(h.lines).find((l) => l.id === "L_greet")!;
    expect(greet).toEqual({ id: "L_greet", kind: "line", character: "BARKEEP", baseline: "What'll it be, stranger?" });
    // The skeleton lists the whole document in order: boxes by marker, context rows by node.
    expect(h.skeleton.filter((r) => r.kind === "box")).toHaveLength(editable.length);
    expect(h.skeleton[0]).toMatchObject({ kind: "scene" });
    expect(h).toMatchObject({ createdBy: "Ian", recipient: "Sam", createdAt: "2026-10-03T12:00:00Z", options: { notes: "editor", status: false, cast: false } });
  });

  it("separates consecutive boxes with a spacer paragraph, so they stay separate tables in Google Docs", () => {
    expect(body).not.toMatch(/<\/w:tbl>\s*<w:tbl>/);
  });

  it("puts the handoff id in the page header", () => {
    expect(text(header)).toContain(`Handoff ${result.handoff.id}`);
    expect(text(header)).toContain("Please keep the grey [#…] markers");
  });

  it("explains itself on a front page", () => {
    const all = text(body);
    expect(all).toContain("How to edit this script");
    expect(all).toContain("Change the words inside the shaded boxes.");
    expect(all).toContain("How to read the structure");
    expect(all).toContain("Exported for Sam by Ian on 3 October 2026.");
  });

  it("bookmarks only headings a jump in the export points at, each with its own id", () => {
    const starts = [...body.matchAll(/<w:bookmarkStart\b[^>]*>/g)].map((m) => m[0]);
    const ids = starts.map((s) => /w:id="(\d+)"/.exec(s)![1]);
    expect(new Set(ids).size).toBe(ids.length);
    const names = starts.map((s) => /w:name="([^"]+)"/.exec(s)![1]);
    const jumps = runScriptDoc(loaded).elements.filter((e) => e.kind === "jump").map((e) => (e as { to: string }).to);
    const headings = new Set(runScriptDoc(loaded).elements.filter((e) => e.kind === "scene" || e.kind === "block").map((e) => e.id));
    const expected = [...new Set(jumps.filter((t) => headings.has(t)))].map((t) => `pk_${t}`).sort();
    expect([...names].sort()).toEqual(expected);
    for (const n of names) expect(body).toContain(`w:anchor="${n}"`); // and something links to each
  });

  it("uses only Georgia, Arial, and Courier New", () => {
    const fonts = new Set([...body.matchAll(/w:ascii="([^"]+)"/g)].map((m) => m[1]));
    expect([...fonts].every((f) => ["Georgia", "Arial", "Courier New"].includes(f!))).toBe(true);
  });

  it("shows the editor's notes and not the VO ones", () => {
    const all = text(body);
    expect(all).toContain("Note: He's tired, not rude.");
    expect(all).not.toContain("Low and slow.");
  });

  it("plans the handoff record as its only write", () => {
    expect(result.writes).toHaveLength(1);
    applyWrites(result.writes);
    expect(readHandoff(dir, result.handoff.id)).toEqual(result.handoff);
  });

  it("a scene range exports only those scenes, and a jump out of it says so", async () => {
    const r = await exportEditableScript(loaded, { by: "Ian", scenes: ["scn_tavern"], random: seeded(8) });
    expect(r.handoff.range.scenes).toEqual(["scn_tavern"]);
    const all = text((await xmlOf(r.docx)).body);
    expect(all).toContain("(not in this document)");
  });

  it("a second export gets a different handoff id from any already in the project", async () => {
    const again = await exportEditableScript(loadProject(dir), { by: "Ian", random: seeded(7) });
    expect(again.handoff.id).not.toBe(result.handoff.id);
  });

  it("prints markers as [#CODE]", () => {
    const first = Object.keys(result.handoff.lines)[0]!;
    expect(text(body)).toContain(formatMarker(first));
  });
});
