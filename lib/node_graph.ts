import { getItem, setItem } from "./storage";

/**
 * The rule list cannot represent draft nodes (an unconnected condition, a new
 * inbox before it is routed, etc.). Persisting the graph itself keeps those
 * nodes from vanishing on the next load. Rules/folders are still derived from
 * it for the inbox view.
 */
export type StoredNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, any>;
  hidden?: boolean;
};
export type StoredEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  animated?: boolean;
  style?: Record<string, any>;
  markerEnd?: Record<string, any>;
  data?: Record<string, any>;
};
export type StoredGraph = { nodes: StoredNode[]; edges: StoredEdge[] };

const KEY = "uec.nodeGraph.v1";

export async function loadNodeGraph(): Promise<StoredGraph | undefined> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return undefined;
    return {
      nodes: parsed.nodes.filter((node: any) => node && typeof node.id === "string" && node.position && typeof node.position.x === "number" && typeof node.position.y === "number" && node.data && typeof node.data === "object"),
      edges: parsed.edges.filter((edge: any) => edge && typeof edge.id === "string" && typeof edge.source === "string" && typeof edge.target === "string"),
    };
  } catch {
    return undefined;
  }
}

export async function saveNodeGraph(
  nodes: Array<{ id: string; type?: string; position: { x: number; y: number }; data: any; hidden?: boolean }>,
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null; animated?: boolean; style?: any; markerEnd?: any; data?: any }>
): Promise<{ ok: boolean; error?: string }> {
  const graph: StoredGraph = {
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: { x: node.position.x, y: node.position.y },
      data: node.data,
      hidden: Boolean(node.hidden),
    })),
    // Selection/dragging/link-highlight flags are intentionally not persisted.
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle ?? "out",
      targetHandle: edge.targetHandle ?? "in",
      animated: Boolean(edge.animated),
      style: edge.style,
      markerEnd: edge.markerEnd,
      data: edge.data,
    })),
  };
  return setItem(KEY, JSON.stringify(graph));
}
