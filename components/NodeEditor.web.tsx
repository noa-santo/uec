import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type OnConnect,
  type OnEdgesDelete,
  type OnNodesDelete,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AliasRule,
  MatchType,
  loadAliasRules,
  saveAliasRules,
  resolveInbox,
} from "@/lib/alias_rules";
import { collectUnresolvedAddresses, saveUnresolvedAddresses } from "@/lib/email_utils";
import { InboxFolder, loadInboxFolders, saveInboxFolders } from "@/lib/inbox_folders";
import "./node-editor.css";

// ── tiny uid ────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

// ── node data shapes ─────────────────────────────────────────────────────────
type PatternData = {
  kind: "pattern";
  alias: string;
  matchType: MatchType;
  field: "recipient" | "sender" | "subject" | "body";
  enabled: boolean;
};

type InboxData = {
  kind: "inbox";
  name: string;
  outputMode: "static" | "subject" | "sender" | "senderDomain";
};
type LogicData = { kind: "logic"; operator: "and" | "or"; name: string };
type FolderData = { kind: "folder"; name: string; collapsed: boolean; includeCatchAll: boolean };
type NodeData = PatternData | InboxData | FolderData | LogicData;

const MATCH_TYPES: { type: MatchType; label: string }[] = [
  { type: "exact", label: "Exact" },
  { type: "domain", label: "Domain" },
  { type: "prefix", label: "Prefix (+tags)" },
  { type: "contains", label: "Contains" },
  { type: "regex", label: "Regex" },
  { type: "all", label: "Catch all" },
];

type PaletteTab = "conditions" | "logic" | "organization";
type PaletteEntry =
  | { label: string; hint: string; kind: "pattern"; matchType: MatchType }
  | { label: string; hint: string; kind: "logic" }
  | { label: string; hint: string; kind: "inbox" }
  | { label: string; hint: string; kind: "folder" };

const PALETTE_TABS: { id: PaletteTab; label: string }[] = [
  { id: "conditions", label: "Conditions" },
  { id: "logic", label: "Logic" },
  { id: "organization", label: "Inboxes" },
];

const PALETTE: PaletteEntry[] = [
  { kind: "pattern", matchType: "exact", label: "Exact address", hint: "One specific recipient" },
  { kind: "pattern", matchType: "domain", label: "Domain", hint: "Everything @domain.com" },
  { kind: "pattern", matchType: "prefix", label: "Prefix", hint: "Alias plus-tag variants" },
  { kind: "pattern", matchType: "contains", label: "Contains", hint: "Substring in the field" },
  { kind: "pattern", matchType: "regex", label: "Regex", hint: "Advanced pattern" },
  { kind: "pattern", matchType: "all", label: "Catch all", hint: "Unsorted mail" },
  { kind: "logic", label: "AND / OR group", hint: "Combine conditions" },
  { kind: "inbox", label: "Virtual inbox", hint: "Destination for mail" },
  { kind: "folder", label: "Folder", hint: "Group inboxes in the list" },
];

// ── node renderers ────────────────────────────────────────────────────────────
function PatternNode({ data }: NodeProps<Node<PatternData>>) {
  const d = data as PatternData;
  return (
    <div className={`uec-node uec-node-pattern ${d.enabled === false ? "uec-node-disabled" : ""}`}>
      <Handle type="target" position={Position.Left} id="in" />
      <div className="uec-badge">{d.field} · {d.matchType}</div>
      <div className="uec-node-label">{d.alias || <em style={{ color: "#64748b" }}>any address</em>}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function InboxNode({ data }: NodeProps<Node<InboxData>>) {
  const d = data as InboxData;
  return (
    <div className="uec-node uec-node-inbox">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="uec-badge">{d.outputMode === "static" ? "fixed output" : `title from ${d.outputMode}`}</div>
      <div className="uec-node-label">{d.name || <em style={{ color: "#a3e6cb" }}>unnamed inbox</em>}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function LogicNode({ data }: NodeProps<Node<LogicData>>) {
  const d = data as LogicData;
  return <div className="uec-node uec-node-logic"><Handle type="target" position={Position.Left} id="in" /><div className="uec-badge">{d.operator.toUpperCase()}</div><div className="uec-node-label">{d.name || `${d.operator.toUpperCase()} conditions`}</div><Handle type="source" position={Position.Right} id="out" /></div>;
}

function FolderNode({ data }: NodeProps<Node<FolderData>>) {
  const d = data as FolderData;
  return (
    <div className="uec-node uec-node-folder">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="uec-badge">{d.includeCatchAll ? "folder · catch-all inboxes" : "folder · configuration"}</div>
      <div className="uec-node-label">{d.name || "Unnamed folder"}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

const nodeTypes = {
  pattern: PatternNode,
  inbox: InboxNode,
  folder: FolderNode,
  logic: LogicNode,
};

// ── helpers: convert rules ↔ nodes/edges ─────────────────────────────────────
function rulesToGraph(rules: AliasRule[], folders: InboxFolder[] = []) {
  // Each rule = 1 pattern node + 1 inbox node + 1 edge.
  // Multiple rules may share an inbox node if they map to the same name.
  const inboxMap = new Map<string, string>();
  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  rules.forEach((rule, i) => {
    const conditions = rule.conditions?.length ? rule.conditions : [{ alias: rule.alias, matchType: rule.matchType || "exact" as MatchType, field: rule.field || "recipient" as const }];
    const patternIds = conditions.map((condition, conditionIndex) => {
      const id = `p_${rule.id}_${conditionIndex}`;
      nodes.push({ id, type: "pattern", position: { x: 80, y: i * 150 + conditionIndex * 70 + 60 }, data: { kind: "pattern", alias: condition.alias, matchType: condition.matchType || "exact", field: condition.field || "recipient", enabled: rule.enabled } });
      return id;
    });
    const key = rule.inbox.trim().toLowerCase();
    if (!inboxMap.has(key)) {
      const iid = `i_${uid()}`;
      inboxMap.set(key, iid);
      nodes.push({ id: iid, type: "inbox", position: { x: 620, y: inboxMap.size * 130 - 70 }, data: { kind: "inbox", name: rule.inbox, outputMode: rule.outputMode || "static" } });
    }
    const inboxId = inboxMap.get(key)!;
    let outputId = patternIds[0];
    if (patternIds.length > 1) {
      outputId = `l_${rule.id}`;
      nodes.push({ id: outputId, type: "logic", position: { x: 360, y: i * 150 + 60 }, data: { kind: "logic", operator: rule.logic || "and", name: (rule.logic || "and").toUpperCase() } });
      patternIds.forEach((patternId, index) => edges.push({ id: `e_${rule.id}_condition_${index}`, source: patternId, sourceHandle: "out", target: outputId, targetHandle: "in", data: { ruleId: `${rule.id}_condition_${index}` } }));
    }
    edges.push({ id: `e_${rule.id}`, source: outputId, sourceHandle: "out", target: inboxId, targetHandle: "in", animated: rule.enabled, markerEnd: { type: MarkerType.ArrowClosed, color: rule.enabled ? "#3b82f6" : "#475569" }, style: { stroke: rule.enabled ? "#3b82f6" : "#475569", strokeWidth: 2 }, data: { ruleId: rule.id } });
  });

  // Folder nodes only describe list configuration. They never hide graph nodes.
  folders.forEach((folder, index) => {
    const folderNodeId = `f_${folder.id}`;
    nodes.push({
      id: folderNodeId,
      type: "folder",
      position: { x: 1010, y: index * 150 + 60 },
      data: { kind: "folder", name: folder.name, collapsed: Boolean(folder.collapsed), includeCatchAll: Boolean(folder.includeCatchAll) },
    });
    folder.inboxes.forEach((name) => {
      const inboxId = inboxMap.get(name.trim().toLowerCase());
      if (!inboxId) return;
      if (edges.some((edge) => edge.source === inboxId && edge.target === folderNodeId)) return;
      edges.push({ id: `folder_${folder.id}_${inboxId}`, source: inboxId, sourceHandle: "out", target: folderNodeId, targetHandle: "in", animated: false, data: { folderId: folder.id } });
    });
  });

  return { nodes, edges };
}

function graphToRules(nodes: Node<NodeData>[], edges: Edge[]): AliasRule[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const collect = (nodeId: string, visited = new Set<string>()): Array<{ alias: string; matchType: MatchType; field: PatternData["field"] }> => {
    if (visited.has(nodeId)) return [];
    visited.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!node) return [];
    if (node.data.kind === "pattern") return [{ alias: node.data.alias, matchType: node.data.matchType, field: node.data.field }, ...edges.filter((edge) => edge.target === nodeId).flatMap((edge) => collect(edge.source, new Set(visited)))];
    if (node.data.kind !== "logic" && node.data.kind !== "folder") return [];
    return edges.filter((edge) => edge.target === nodeId).flatMap((edge) => collect(edge.source, new Set(visited)));
  };
  return edges.flatMap((edge) => {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt || tgt.data.kind !== "inbox" || (src.data.kind !== "pattern" && src.data.kind !== "logic" && src.data.kind !== "folder")) return [];
    const conditions = collect(src.id);
    if (!conditions.length) return [];
    const ruleId = (edge.data as any)?.ruleId || uid();
    const logic = src.data.kind === "logic" ? src.data.operator : undefined;
    const first = conditions[0];
    return [{
      id: ruleId,
      alias: first.alias,
      matchType: first.matchType,
      field: first.field,
      conditions: conditions.length > 1 || first.field !== "recipient" ? conditions : undefined,
      logic,
      inbox: (tgt.data as InboxData).name,
      outputMode: (tgt.data as InboxData).outputMode,
      enabled: src.data.kind === "pattern" ? (src.data as PatternData).enabled !== false : conditions.every((condition) => {
        const conditionNode = nodes.find((n) => n.data.kind === "pattern" && n.data.alias === condition.alias);
        return (conditionNode?.data as PatternData | undefined)?.enabled !== false;
      }),
    }];
  });
}

function graphToFolders(nodes: Node<NodeData>[], edges: Edge[]): InboxFolder[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => node.data.kind === "folder").map((folderNode) => {
    const folder = folderNode.data as FolderData;
    const inboxes = new Set<string>();
    for (const edge of edges) {
      if (edge.target !== folderNode.id) continue;
      const source = nodeMap.get(edge.source);
      if (source?.data.kind === "inbox" && source.data.name.trim()) inboxes.add(source.data.name.trim());
    }
    return {
      id: folderNode.id.replace(/^f_/, ""),
      name: folder.name,
      inboxes: [...inboxes],
      collapsed: Boolean(folder.collapsed),
      includeCatchAll: Boolean(folder.includeCatchAll),
    };
  });
}

// ── main component ────────────────────────────────────────────────────────────
function NodeEditorInner() {
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [folders, setFolders] = useState<InboxFolder[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const flow = useReactFlow<Node<NodeData>, Edge>();
  const canvasRef = useRef<HTMLDivElement>(null);

  const nodesRef = useRef(nodes); nodesRef.current = nodes;
  const edgesRef = useRef(edges); edgesRef.current = edges;
  const rulesRef = useRef(rules); rulesRef.current = rules;

  const historyRef = useRef<Array<{ nodes: Node<NodeData>[]; edges: Edge[] }>>([]);
  const redoRef = useRef<Array<{ nodes: Node<NodeData>[]; edges: Edge[] }>>([]);
  const [, setHistoryVersion] = useState(0);
  const pushHistory = (previousNodes = nodesRef.current, previousEdges = edgesRef.current) => {
    historyRef.current.push({ nodes: previousNodes, edges: previousEdges });
    if (historyRef.current.length > 100) historyRef.current.shift();
    redoRef.current = [];
    setHistoryVersion((version) => version + 1);
  };
  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(previous.nodes); setEdges(previous.edges); persist(previous.nodes, previous.edges);
    setHistoryVersion((version) => version + 1);
  };
  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    setNodes(next.nodes); setEdges(next.edges); persist(next.nodes, next.edges);
    setHistoryVersion((version) => version + 1);
  };

  const [status, setStatus] = useState("");
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (message: string) => {
    if (statusTimer.current) clearTimeout(statusTimer.current);
    setStatus(message);
    statusTimer.current = setTimeout(() => setStatus(""), 2500);
  };
  const [testAddress, setTestAddress] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<PaletteTab>("conditions");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.matches("input, textarea, select, [contenteditable=true]")) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const refreshSuggestions = useCallback(async () => {
    setUnresolved(await collectUnresolvedAddresses(rulesRef.current));
  }, []);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([loadAliasRules(), loadInboxFolders()]).then(([saved, savedFolders]) => {
      setRules(saved);
      rulesRef.current = saved;
      setFolders(savedFolders);
      const { nodes: n, edges: e } = rulesToGraph(saved, savedFolders);
      setNodes(n);
      setEdges(e);
      setLoaded(true);
      void refreshSuggestions();
    });
  }, [refreshSuggestions]);

  // ── persist whenever nodes/edges change (debounced) ────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (nextNodes: Node<NodeData>[], nextEdges: Edge[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const derived = graphToRules(nextNodes, nextEdges);
        const derivedFolders = graphToFolders(nextNodes, nextEdges);
        const [ruleResult, folderResult] = await Promise.all([saveAliasRules(derived), saveInboxFolders(derivedFolders)]);
        setRules(derived);
        rulesRef.current = derived;
        setFolders(derivedFolders);
        flash(ruleResult.ok && folderResult.ok ? "Saved." : "Storage is full: changes are kept for this session only.");
      }, 400);
    },
    []
  );

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (statusTimer.current) clearTimeout(statusTimer.current);
  }, []);

  // ── connect: dragging a handle creates an edge (and thus a rule) ──────────
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      const source = nodesRef.current.find((node) => node.id === params.source);
      const target = nodesRef.current.find((node) => node.id === params.target);
      if (!source || !target || source.id === target.id) return;
      const sourceKind = source.data.kind;
      const targetKind = target.data.kind;
      const validRoute = ["pattern", "logic"].includes(sourceKind) && ["inbox", "logic"].includes(targetKind);
      const validFolderLink = sourceKind === "inbox" && targetKind === "folder";
      if (!validRoute && !validFolderLink) return;
      pushHistory();
      const newEdge: Edge = {
        ...params,
        id: `e_${uid()}`,
        animated: sourceKind !== "folder",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
        style: { stroke: "#3b82f6", strokeWidth: 2 },
        data: validFolderLink ? { folderId: target.id.replace(/^f_/, "") } : { ruleId: uid() },
      } as Edge;
      const next = addEdge(newEdge, edgesRef.current);
      setEdges(next);
      persist(nodesRef.current, next);
    },
    [persist]
  );

  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
      pushHistory();
      const ids = new Set(deleted.map((e) => e.id));
      const next = edgesRef.current.filter((e) => !ids.has(e.id));
      setEdges(next);
      persist(nodesRef.current, next);
    },
    [persist]
  );

  const onNodesDelete: OnNodesDelete = useCallback(
    (deleted) => {
      pushHistory();
      const deletedIds = new Set(deleted.map((n) => n.id));
      const nextEdges = edgesRef.current.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target));
      const nextNodes = nodesRef.current.filter((n) => !deletedIds.has(n.id));
      setEdges(nextEdges);
      setNodes(nextNodes);
      persist(nextNodes, nextEdges);
    },
    [persist]
  );

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const changeList: any[] = Array.isArray(changes) ? changes : (typeof (changes as any)?.toArray === "function" ? (changes as any).toArray() : []);
      onNodesChange(changes as any);
      if (changeList.some((c: any) => c.type === "position" && !c.dragging)) {
        pushHistory();
        // Read the refs after React has applied the position change.
        setTimeout(() => persist(nodesRef.current, edgesRef.current), 0);
      }
    },
    [onNodesChange, persist]
  );

  // ── palette: create a node in the middle of the current viewport ──────────
  const openEdit = (node: Node<NodeData>) => {
    setEditingId(node.id);
    if (node.data.kind === "pattern") {
      setEditAlias(node.data.alias);
      setEditMatchType(node.data.matchType);
      setEditField(node.data.field || "recipient");
      setEditEnabled(node.data.enabled !== false);
    } else if (node.data.kind === "inbox") {
      setEditInboxName(node.data.name);
      setEditOutputMode(node.data.outputMode);
    } else if (node.data.kind === "logic") {
      setEditLogicOperator(node.data.operator);
    } else {
      setEditFolderName(node.data.name);
      setEditIncludeCatchAll(Boolean(node.data.includeCatchAll));
    }
  };

  const addPaletteNode = (entry: PaletteEntry) => {
    pushHistory();
    const id = `${entry.kind === "pattern" ? "p" : entry.kind === "inbox" ? "i" : entry.kind === "folder" ? "f" : "l"}_${uid()}`;
    const rect = canvasRef.current?.getBoundingClientRect();
    const center = rect
      ? flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      : { x: 300, y: 200 };
    const stagger = (nodesRef.current.length % 4) * 22;
    const position = { x: Math.round(center.x - 95 + stagger), y: Math.round(center.y - 40 + stagger) };
    let node: Node<NodeData>;
    if (entry.kind === "pattern") {
      node = { id, type: "pattern", position, data: { kind: "pattern", alias: "", matchType: entry.matchType, field: "recipient", enabled: true } };
      setEditAlias(""); setEditMatchType(entry.matchType); setEditField("recipient"); setEditEnabled(true);
    } else if (entry.kind === "inbox") {
      node = { id, type: "inbox", position, data: { kind: "inbox", name: "", outputMode: "static" } };
      setEditInboxName(""); setEditOutputMode("static");
    } else if (entry.kind === "folder") {
      node = { id, type: "folder", position, data: { kind: "folder", name: "New folder", collapsed: false, includeCatchAll: false } };
      setEditFolderName("New folder"); setEditIncludeCatchAll(false);
    } else {
      node = { id, type: "logic", position, data: { kind: "logic", operator: "and", name: "AND" } };
      setEditLogicOperator("and");
    }
    const next = [...nodesRef.current, node];
    setNodes(next);
    pendingNodeRef.current = id;
    setEditingId(id);
  };

  const autoArrangeNodes = () => {
    pushHistory();
    const patterns = nodes.filter((node) => node.data.kind === "pattern").sort((a, b) => String((a.data as PatternData).alias).localeCompare(String((b.data as PatternData).alias)));
    const inboxes = nodes.filter((node) => node.data.kind === "inbox").sort((a, b) => String((a.data as InboxData).name).localeCompare(String((b.data as InboxData).name)));
    const arranged = nodes.map((node) => {
      if (node.data.kind === "pattern") return { ...node, position: { x: 80, y: 60 + patterns.indexOf(node) * 115 } };
      if (node.data.kind === "inbox") return { ...node, position: { x: 620, y: 60 + inboxes.indexOf(node) * 130 } };
      if (node.data.kind === "logic") return { ...node, position: { x: 350, y: 60 + nodes.filter((n) => n.data.kind === "logic").indexOf(node) * 150 } };
      return { ...node, position: { x: 1010, y: 60 + nodes.filter((n) => n.data.kind === "folder").indexOf(node) * 150 } };
    });
    setNodes(arranged);
    persist(arranged, edges);
  };

  const addExactRouteForAddress = (address: string) => {
    const normalized = address.trim().toLowerCase();
    if (!normalized || rules.some((rule) => rule.matchType === "exact" && rule.alias.toLowerCase() === normalized)) return;
    pushHistory();
    const ruleId = uid();
    const inboxId = `i_${uid()}`;
    const pattern: Node<PatternData> = { id: `p_${ruleId}`, type: "pattern", position: { x: 80, y: 80 + nodes.length * 28 }, data: { kind: "pattern", alias: normalized, matchType: "exact", field: "recipient", enabled: true } };
    const inbox: Node<InboxData> = { id: inboxId, type: "inbox", position: { x: 620, y: 80 + nodes.length * 28 }, data: { kind: "inbox", name: normalized, outputMode: "static" } };
    const edge: Edge = { id: `e_${ruleId}`, source: pattern.id, sourceHandle: "out", target: inboxId, targetHandle: "in", markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" }, style: { stroke: "#3b82f6", strokeWidth: 2 }, data: { ruleId } };
    const nextNodes = [...nodes, pattern, inbox];
    const nextEdges = [...edges, edge];
    setNodes(nextNodes); setEdges(nextEdges); persist(nextNodes, nextEdges);
    setUnresolved((current) => {
      const remaining = current.filter((item) => item !== normalized);
      void saveUnresolvedAddresses(remaining);
      return remaining;
    });
  };

  // ── configuration modal ───────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const pendingNodeRef = useRef<string | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editMatchType, setEditMatchType] = useState<MatchType>("exact");
  const [editField, setEditField] = useState<PatternData["field"]>("recipient");
  const [editInboxName, setEditInboxName] = useState("");
  const [editFolderName, setEditFolderName] = useState("");
  const [editIncludeCatchAll, setEditIncludeCatchAll] = useState(false);
  const [editOutputMode, setEditOutputMode] = useState<InboxData["outputMode"]>("static");
  const [editLogicOperator, setEditLogicOperator] = useState<LogicData["operator"]>("and");
  const [editEnabled, setEditEnabled] = useState(true);

  const removeEditingNode = () => {
    if (!editingId) return;
    pushHistory();
    const id = editingId;
    const nextNodes = nodesRef.current.filter((n) => n.id !== id);
    const nextEdges = edgesRef.current.filter((e) => e.source !== id && e.target !== id);
    setNodes(nextNodes); setEdges(nextEdges); persist(nextNodes, nextEdges);
    pendingNodeRef.current = null;
    setEditingId(null);
  };

  const commitEdit = () => {
    if (!editingId) return;
    const target = nodesRef.current.find((n) => n.id === editingId);
    if (!target) { setEditingId(null); return; }
    pendingNodeRef.current = null;
    pushHistory();
    let nextNodes: Node<NodeData>[];
    if (target.data.kind === "pattern") {
      nextNodes = nodesRef.current.map((n) =>
        n.id === editingId
          ? { ...n, data: { ...n.data, alias: editMatchType === "all" ? "" : editAlias.trim(), matchType: editMatchType, field: editField, enabled: editEnabled } as PatternData }
          : n
      );
    } else if (target.data.kind === "inbox") {
      nextNodes = nodesRef.current.map((n) => n.id === editingId ? { ...n, data: { ...n.data, name: editInboxName.trim(), outputMode: editOutputMode } as InboxData } : n);
    } else if (target.data.kind === "logic") {
      nextNodes = nodesRef.current.map((n) => n.id === editingId ? { ...n, data: { ...n.data, operator: editLogicOperator, name: editLogicOperator.toUpperCase() } as LogicData } : n);
    } else {
      nextNodes = nodesRef.current.map((n) => n.id === editingId ? { ...n, data: { ...n.data, name: editFolderName.trim(), includeCatchAll: editIncludeCatchAll } as FolderData } : n);
    }
    setNodes(nextNodes);
    setEditingId(null);
    persist(nextNodes, edgesRef.current);
  };

  const cancelEdit = () => {
    const pending = pendingNodeRef.current;
    pendingNodeRef.current = null;
    setEditingId(null);
    if (pending && nodesRef.current.some((node) => node.id === pending)) {
      const nextNodes = nodesRef.current.filter((n) => n.id !== pending);
      const nextEdges = edgesRef.current.filter((e) => e.source !== pending && e.target !== pending);
      setNodes(nextNodes); setEdges(nextEdges);
      persist(nextNodes, nextEdges);
    }
  };

  useEffect(() => {
    if (!editingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      cancelEdit();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  });

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node<NodeData>) => openEdit(node),
    [] // openEdit only sets state from the node argument
  );

  // ── test resolver ─────────────────────────────────────────────────────────
  const runTest = () => {
    if (!testAddress.trim()) return setTestResult(null);
    setTestResult(resolveInbox(testAddress.trim(), rulesRef.current));
  };

  if (!loaded) return <div className="uec-editor-loading">Loading routes…</div>;

  const editingNode = editingId ? nodes.find((n) => n.id === editingId) : null;
  const modalTitle = editingNode?.data.kind === "pattern" ? "Configure condition"
    : editingNode?.data.kind === "inbox" ? "Configure virtual inbox"
    : editingNode?.data.kind === "folder" ? "Configure folder"
    : "Configure logic";

  return (
    <div className="uec-editor">
      <div className="uec-editor-toolbar">
        <strong>Virtual Inbox Routing</strong>
        <div className="uec-toolbar-actions">
          <button type="button" onClick={undo} disabled={!historyRef.current.length} title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" onClick={redo} disabled={!redoRef.current.length} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button type="button" onClick={autoArrangeNodes} className="uec-btn-secondary" disabled={!nodes.length}>Auto arrange</button>
          {status && <span role="status" className="uec-status">{status}</span>}
        </div>
      </div>

      <div className="uec-editor-body">
        {/* ── node palette ─────────────────────────────────────────────── */}
        <aside className="uec-palette" aria-label="Node types">
          <div className="uec-palette-title">Add node</div>
          <div className="uec-palette-tabs" role="tablist">
            {PALETTE_TABS.map((tab) => (
              <button
                type="button"
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                className={activeTab === tab.id ? "uec-palette-tab active" : "uec-palette-tab"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="uec-palette-list">
            {PALETTE.filter((entry) => {
              if (activeTab === "conditions") return entry.kind === "pattern";
              if (activeTab === "logic") return entry.kind === "logic";
              return entry.kind === "inbox" || entry.kind === "folder";
            }).map((entry) => (
              <button type="button" key={`${entry.kind}-${entry.label}`} className={`uec-palette-item uec-palette-${entry.kind}`} onClick={() => addPaletteNode(entry)} title={`Create ${entry.label} in the centre of the canvas`}>
                <span className="uec-palette-item-label">＋ {entry.label}</span>
                <span className="uec-palette-item-hint">{entry.hint}</span>
              </button>
            ))}
          </div>
          <p className="uec-palette-note">Click a type to place it in the centre of the view and configure it immediately. Double-click any node to edit it again. Drag between handles to connect.</p>
        </aside>

        {/* ── canvas and test bar ──────────────────────────────────────── */}
        <div className="uec-editor-main">
          <div className="uec-tester-bar">
            <span>Test resolver:</span>
            <input
              placeholder="e.g. me+finance@example.com"
              value={testAddress}
              onChange={(e) => { setTestAddress(e.target.value); if (testResult) setTestResult(null); }}
              onKeyDown={(e) => e.key === "Enter" && runTest()}
            />
            <button type="button" onClick={runTest}>Resolve</button>
            {testResult && <span className="uec-test-match">→ <strong>{testResult}</strong></span>}
            <button type="button" className="uec-btn-secondary" onClick={() => void refreshSuggestions()} title="Rescan all cached mail, including older messages">Refresh suggestions</button>
          </div>

          {unresolved.length > 0 && <section className="uec-unresolved" aria-label="Unrouted addresses">
            <strong>Unrouted or catch-all-only addresses <span>({unresolved.length})</span></strong>
            <div className="uec-unresolved-list">{unresolved.map((address) => <button type="button" key={address} onClick={() => addExactRouteForAddress(address)} title={`Create exact-match route for ${address}`}>＋ {address} <small>Add exact route</small></button>)}</div>
          </section>}

          <div className="uec-editor-canvas" ref={canvasRef}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onEdgesDelete={onEdgesDelete}
              onNodesDelete={onNodesDelete}
              onNodeDoubleClick={onNodeDoubleClick}
              deleteKeyCode={["Delete", "Backspace"]}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#1e293b" />
              <Controls />
              <MiniMap nodeColor={(n) => (n.data as any)?.kind === "inbox" ? "#064e3b" : "#1e3a5f"} />
            </ReactFlow>
          </div>
        </div>
      </div>

      {/* ── configuration modal ─────────────────────────────────────────── */}
      {editingNode && (
        <div className="uec-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelEdit(); }}>
          <div className="uec-modal" role="dialog" aria-modal="true" aria-labelledby="uec-modal-title">
            <div className="uec-modal-header">
              <h2 id="uec-modal-title">{modalTitle}</h2>
              <button type="button" className="uec-modal-close" aria-label="Close" onClick={cancelEdit}>×</button>
            </div>
            <div className="uec-modal-body">
              {editingNode.data.kind === "pattern" ? (
                <>
                  <label>
                    Check field
                    <select value={editField} onChange={(e) => setEditField(e.target.value as PatternData["field"])}><option value="recipient">Recipient address</option><option value="sender">Sender</option><option value="subject">Subject</option><option value="body">Body preview</option></select>
                  </label>
                  <label>
                    Match type
                    <select value={editMatchType} onChange={(e) => setEditMatchType(e.target.value as MatchType)}>
                      {MATCH_TYPES.map((m) => (<option key={m.type} value={m.type}>{m.label}</option>))}
                    </select>
                  </label>
                  {editMatchType !== "all" ? (
                    <label>
                      Pattern
                      <input
                        autoFocus
                        placeholder={editMatchType === "domain" ? "domain.com" : editMatchType === "prefix" ? "user (matches user+*@...)" : editMatchType === "regex" ? "^newsletter.*@.*" : editMatchType === "contains" ? "receipt" : "alias@example.com"}
                        value={editAlias}
                        onChange={(e) => setEditAlias(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }}
                      />
                    </label>
                  ) : (
                    <p className="uec-modal-hint">Every message not matched by a more specific rule will follow this path.</p>
                  )}
                  <label className="uec-checkbox-label"><input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} /> Enabled</label>
                </>
              ) : editingNode.data.kind === "inbox" ? (
                <>
                  <label>Inbox label<input autoFocus placeholder="Finance, Work…" value={editInboxName} onChange={(e) => setEditInboxName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }} /></label>
                  <label>Inbox name from<select value={editOutputMode} onChange={(e) => setEditOutputMode(e.target.value as InboxData["outputMode"])}><option value="static">Fixed name</option><option value="subject">Email subject</option><option value="sender">Sender name/address</option><option value="senderDomain">Sender domain</option></select></label>
                  <p className="uec-modal-hint">Dynamic names create one virtual inbox per value. Connect this inbox to a folder and enable “catch-all inboxes” to collect them all.</p>
                </>
              ) : editingNode.data.kind === "logic" ? (
                <label>Combine conditions<select value={editLogicOperator} onChange={(e) => setEditLogicOperator(e.target.value as LogicData["operator"])}><option value="and">AND — all must match</option><option value="or">OR — any can match</option></select></label>
              ) : (
                <>
                  <label>Folder name<input autoFocus placeholder="Other, Work…" value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); }} /></label>
                  <label className="uec-checkbox-label"><input type="checkbox" checked={editIncludeCatchAll} onChange={(e) => setEditIncludeCatchAll(e.target.checked)} /> Include catch-all / unsorted inboxes</label>
                  <p className="uec-modal-hint">A folder only groups virtual inboxes in the inbox list. It never hides nodes or connections in this graph.</p>
                </>
              )}
            </div>
            <div className="uec-modal-footer">
              <button type="button" className="uec-btn-danger" onClick={removeEditingNode}>Delete node</button>
              <button type="button" className="uec-btn-cancel" onClick={cancelEdit}>Cancel</button>
              <button type="button" onClick={commitEdit}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function NodeEditor() {
  return (
    <ReactFlowProvider>
      <NodeEditorInner />
    </ReactFlowProvider>
  );
}
