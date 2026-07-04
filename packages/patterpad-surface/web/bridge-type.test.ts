// ---------------------------------------------------------------------------
// The PM node NAME is the authority for a chunk's model `type` - never `raw`.
// A group / snippet / block node whose `raw` lost its `type` (e.g. the schema
// default "{}") must still come back as the right discriminant, or the
// structural validator mis-reads an empty GROUP as an empty SNIPPET and shows
// "this snippet is empty" on a container.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { patterSchema as S } from "../src/schema.js";
import { docToScene } from "../src/bridge.js";

describe("bridge stamps type from the node name (not raw)", () => {
  it("an empty group with default raw round-trips as type:'group'", () => {
    // A group node with no children and `raw: "{}"` (the schema default - the type lost).
    const group = S.nodes.group.create({ raw: "{}" }, []);
    const block = S.nodes.block.create({ raw: JSON.stringify({ id: "B_1", type: "block", name: "M" }) }, [group]);
    const doc = S.nodes.doc.create({ raw: JSON.stringify({ id: "S_1", type: "scene", name: "S" }) }, [block]);

    const { scene } = docToScene(doc);
    const child = scene.blocks[0].children[0];
    expect(child.type).toBe("group");
    expect((child as { children?: unknown[] }).children).toEqual([]);
  });

  it("an empty snippet with default raw round-trips as type:'snippet'", () => {
    const snippet = S.nodes.snippet.create({ raw: "{}", jump: "" }, []);
    const block = S.nodes.block.create({ raw: JSON.stringify({ id: "B_1", type: "block", name: "M" }) }, [snippet]);
    const doc = S.nodes.doc.create({ raw: JSON.stringify({ id: "S_1", type: "scene", name: "S" }) }, [block]);

    const { scene } = docToScene(doc);
    expect(scene.blocks[0].children[0].type).toBe("snippet");
  });
});
