import { ReactFlow, Background, Controls, MiniMap, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const nodes: Node[] = [
  { id: "source", position: { x: 80, y: 120 }, data: { label: "Incoming address" }, type: "input" },
  { id: "inbox", position: { x: 360, y: 120 }, data: { label: "Virtual inbox" } },
];
const edges: Edge[] = [{ id: "source-inbox", source: "source", target: "inbox", animated: true }];

export function NodeEditor() {
  return (
    <div style={{ flex: 1, minHeight: 500, background: "#080808" }}>
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background color="#333" />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
}
