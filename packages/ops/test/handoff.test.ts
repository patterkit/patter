// ---------------------------------------------------------------------------
// Editable-script handoff records (handoff.ts): the markers that tie a returned document's lines back to
// the record, reading records from the project, and carrying open ones through a .patterpack.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { HANDOFF_SCHEMA } from "@patterkit/model";
import type { HandoffFile } from "@patterkit/model";
import {
  runInit, applyWrites, loadProject, runValidate, runPack, runUnpack, runUnpackMerge,
  markerLength, issueMarkerCodes, formatMarker, readMarker, newHandoffId,
  readHandoffs, readHandoff, handoffWrite, handoffPath, HANDOFF_DIR,
} from "../src/index.js";

/** A deterministic stand-in for Math.random (a small LCG). */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function record(id: string, extra: Partial<HandoffFile> = {}): HandoffFile {
  return {
    schema: HANDOFF_SCHEMA, id, createdAt: "2026-10-03T10:00:00Z", createdBy: "Ian", format: "docx",
    range: { scenes: ["s1"] }, options: { notes: "editor", status: false, cast: false },
    lines: { K7Q2M: { id: "L1", kind: "line", character: "Mara", baseline: "We're closed." } },
    skeleton: [{ kind: "scene", node: "s1", text: "The Tavern" }, { kind: "box", marker: "K7Q2M" }],
    ...extra,
  };
}

function project(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "patter-handoff-")), "game");
  applyWrites(runInit({ dir, name: "Handoff Game" }).writes);
  return dir;
}

describe("markers", () => {
  it("are long enough that codes in use fill at most a thousandth of the space", () => {
    expect(markerLength(1)).toBe(3);
    expect(markerLength(30)).toBe(3);    // 32^3 = 32,768
    expect(markerLength(33)).toBe(4);
    expect(markerLength(1000)).toBe(4);  // 32^4 = 1,048,576
    expect(markerLength(1049)).toBe(5);
  });

  it("are issued distinct, all valid, and printed as [#CODE]", () => {
    const codes = issueMarkerCodes(500, seeded(1));
    expect(new Set(codes).size).toBe(500);
    for (const code of codes) {
      expect(code).toHaveLength(markerLength(500) + 1);
      expect(readMarker(formatMarker(code))).toEqual({ code, valid: true });
    }
  });

  it("read leniently: spacing, a missing #, lower case, and the Crockford look-alikes", () => {
    const [code] = issueMarkerCodes(1, seeded(2));
    const lower = code!.toLowerCase();
    for (const text of [`[#${code}]`, `[ # ${lower} ]`, `[${code}]`, `  once only  [#${code}]  `]) {
      expect(readMarker(text)).toEqual({ code, valid: true });
    }
    // O reads as 0, and I or L as 1.
    const withDigits = issueMarkerCodes(400, seeded(3)).find((c) => c.includes("0") && c.includes("1"))!;
    expect(readMarker(`[#${withDigits.replace(/0/g, "O").replace(/1/g, "l")}]`)).toEqual({ code: withDigits, valid: true });
  });

  it("catch a single mistyped character, unless the two differ by exactly 31 (0 for Z)", () => {
    for (const code of issueMarkerCodes(40, seeded(4))) {
      for (let i = 0; i < code.length; i++) {
        for (const c of ALPHABET) {
          if (c === code[i]) continue;
          const typo = code.slice(0, i) + c + code.slice(i + 1);
          const blind = i < code.length - 1 && Math.abs(ALPHABET.indexOf(c) - ALPHABET.indexOf(code[i]!)) === 31;
          if (!blind) expect(readMarker(`[#${typo}]`)!.valid, `${code} -> ${typo}`).toBe(false);
        }
      }
    }
  });

  it("catch two neighbours swapped", () => {
    for (const code of issueMarkerCodes(40, seeded(5))) {
      const body = code.slice(0, -1);
      for (let i = 0; i + 1 < body.length; i++) {
        const a = body[i]!, b = body[i + 1]!;
        if (a === b || Math.abs(ALPHABET.indexOf(a) - ALPHABET.indexOf(b)) === 31) continue;
        const swapped = body.slice(0, i) + b + a + body.slice(i + 2) + code.slice(-1);
        expect(readMarker(`[#${swapped}]`)!.valid, `${code} -> ${swapped}`).toBe(false);
      }
    }
  });

  it("are absent from text with none, and a non-alphabet character is damage", () => {
    expect(readMarker("once only")).toBeUndefined();
    expect(readMarker("[#K7U2M]")).toEqual({ code: "K7U2M", valid: false }); // U is not in the alphabet
  });

  it("handoff ids avoid ones already taken", () => {
    const first = newHandoffId([], seeded(6));
    expect(first).toMatch(/^H-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(newHandoffId([first], seeded(6))).not.toBe(first);
  });
});

describe("handoff records in the project", () => {
  it("a project with no handoffs folder has none", () => {
    expect(readHandoffs(project())).toEqual({ handoffs: [], issues: [] });
  });

  it("reads every record, oldest first, and names one that won't parse", () => {
    const dir = project();
    applyWrites([handoffWrite(dir, record("H-BBBB", { createdAt: "2026-10-04T00:00:00Z" })), handoffWrite(dir, record("H-AAAA"))]);
    writeFileSync(join(dir, HANDOFF_DIR, "H-DAMG.json"), "{ not json");
    const { handoffs, issues } = readHandoffs(dir);
    expect(handoffs.map((h) => h.id)).toEqual(["H-AAAA", "H-BBBB"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("H-DAMG.json");
    expect(readHandoff(dir, "H-AAAA")!.lines["K7Q2M"]!.baseline).toBe("We're closed.");
    expect(readHandoff(dir, "H-NONE")).toBeUndefined();
  });

  it("a record in the project is not reported as a stray file", () => {
    const dir = project();
    applyWrites([handoffWrite(dir, record("H-AAAA"))]);
    expect(runValidate(loadProject(dir)).orphans).toEqual([]);
  });
});

describe("handoff records in a .patterpack", () => {
  it("carries open records and leaves closed ones at home", async () => {
    const dir = project();
    applyWrites([handoffWrite(dir, record("H-OPEN")), handoffWrite(dir, record("H-DONE", { closed: true }))]);
    const zip = await JSZip.loadAsync(await runPack(dir));
    expect(zip.file("handoffs/H-OPEN.json")).not.toBeNull();
    expect(zip.file("handoffs/H-DONE.json")).toBeNull();
    const manifest = JSON.parse(await zip.file("patter.manifest.json")!.async("string"));
    expect(manifest.handoffs).toEqual(["handoffs/H-OPEN.json"]);
  });

  it("a project with no handoffs packs exactly as before (no manifest entry)", async () => {
    const zip = await JSZip.loadAsync(await runPack(project()));
    const manifest = JSON.parse(await zip.file("patter.manifest.json")!.async("string"));
    expect(manifest.handoffs).toBeUndefined();
  });

  it("extract writes the records with the shards", async () => {
    const dir = project();
    applyWrites([handoffWrite(dir, record("H-OPEN"))]);
    const out = join(mkdtempSync(join(tmpdir(), "patter-handoff-out-")), "restored");
    const { shards } = await runUnpack(await runPack(dir), out);
    applyWrites(shards);
    expect(readFileSync(handoffPath(out, "H-OPEN"), "utf8")).toBe(readFileSync(handoffPath(dir, "H-OPEN"), "utf8"));
  });

  it("merge takes a record the project lacks, and adds the other side's reimports to one it has", async () => {
    const sent = project();
    const base = await runPack(sent);

    // The recipient reimported an editor's file against H-OPEN, and exported a handoff of their own.
    const theirs = join(mkdtempSync(join(tmpdir(), "patter-handoff-theirs-")), "game");
    applyWrites((await runUnpack(base, theirs)).shards);
    const reimport = { at: "2026-10-05T09:00:00Z", by: "Jo", fileHash: "abc", counts: { changed: 3, unchanged: 9, stale: 0, comments: 2, problems: 0 } };
    applyWrites([handoffWrite(theirs, record("H-OPEN", { imports: [reimport] })), handoffWrite(theirs, record("H-JOJO"))]);

    // Ours has H-OPEN with no reimports.
    applyWrites([handoffWrite(sent, record("H-OPEN"))]);
    const res = await runUnpackMerge(await runPack(theirs), base, sent);
    expect(res.handoffs).toEqual(["handoffs/H-JOJO.json", "handoffs/H-OPEN.json"]);
    applyWrites(res.writes);
    expect(readHandoff(sent, "H-JOJO")).toBeDefined();
    expect(readHandoff(sent, "H-OPEN")!.imports).toEqual([reimport]);

    // Merging the same pack again changes nothing more.
    const again = await runUnpackMerge(await runPack(theirs), base, sent);
    expect(again.handoffs).toBeUndefined();
  });

  it("a record we closed stays closed when a pack brings it back open", async () => {
    const sent = project();
    applyWrites([handoffWrite(sent, record("H-OPEN"))]);
    const base = await runPack(sent);
    const theirs = join(mkdtempSync(join(tmpdir(), "patter-handoff-theirs-")), "game");
    applyWrites((await runUnpack(base, theirs)).shards);
    // Closed records aren't packed, so a close can only travel while the record is still open on the
    // packing side. Ours is the side that closes here; theirs still has it open.
    applyWrites([handoffWrite(sent, record("H-OPEN", { closed: true }))]);
    const res = await runUnpackMerge(await runPack(theirs), base, sent);
    expect(res.handoffs).toBeUndefined(); // ours already closed, nothing new from theirs
    expect(existsSync(handoffPath(sent, "H-OPEN"))).toBe(true);
    expect(readHandoff(sent, "H-OPEN")!.closed).toBe(true);
  });
});

