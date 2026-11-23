import test from "node:test";
import assert from "node:assert/strict";
import { loadNodeGraph, saveNodeGraph } from "./node_graph";

test("node graph round-trip keeps draft nodes and strips transient UI flags", async () => {
  const result = await saveNodeGraph(
    [{ id: "p_draft", type: "pattern", position: { x: 12, y: 34 }, data: { kind: "pattern", alias: "" }, hidden: false } as any],
    [{ id: "e_1", source: "p_draft", target: "i_1", data: { ruleId: "r1" } }]
  );
  assert.equal(result.ok, true);
  const graph = await loadNodeGraph();
  assert.equal(graph?.nodes.length, 1);
  assert.equal(graph?.nodes[0].id, "p_draft");
  assert.equal(graph?.edges[0].target, "i_1");
  assert.equal((graph?.nodes[0] as any).selected, undefined);
});
