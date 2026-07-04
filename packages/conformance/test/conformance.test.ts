// ---------------------------------------------------------------------------
// The conformance test: the JS reference runtime passing the parity contract.
//
// 1. Compile the authored fixtures into the portable corpus, and assert it
//    matches the committed `corpus.json` (the artifact ports consume) - a file
//    snapshot, so `vitest -u` regenerates it when fixtures change.
// 2. Replay every case through the RUNTIME-ONLY runners and assert the engine
//    reproduces each hand-authored `expected` / `expectedTranscript`.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { buildCorpus, runExpressionCase, runRuntimeCase, runScriptedCase, runGameDataCase, cases } from "../src/index.js";

const corpus = buildCorpus(cases);
const corpusPath = fileURLToPath(new URL("../corpus.json", import.meta.url));

describe("conformance corpus", () => {
  it("matches the committed portable corpus.json", async () => {
    await expect(JSON.stringify(corpus, null, 2) + "\n").toMatchFileSnapshot(corpusPath);
  });
});

describe("expression cases", () => {
  for (const c of corpus.expressions) {
    it(c.name, () => {
      expect(runExpressionCase(c)).toEqual(c.expected);
    });
  }
});

describe("runtime cases", () => {
  for (const c of corpus.runtime) {
    it(c.name, () => {
      expect(runRuntimeCase(c)).toEqual(c.expectedTranscript);
    });
  }
});

describe("scripted cases (save/load, multi-flow, reset)", () => {
  for (const c of corpus.scripted) {
    it(c.name, () => {
      const actual = runScriptedCase(c);
      c.script.forEach((op, i) => {
        const expected = "expect" in op ? op.expect ?? [] : [];
        expect(actual[i], `op ${i} (${op.op})`).toEqual(expected);
      });
    });
  }
});

describe("gameData cases (merge-at-read defaults)", () => {
  for (const c of corpus.gameData) {
    it(c.name, () => {
      expect(runGameDataCase(c)).toEqual(c.expected);
    });
  }
});
