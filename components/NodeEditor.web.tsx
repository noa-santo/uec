import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
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
  validateRule,
  resolveInbox,
} from "@/lib/alias_rules";
import { loadUnresolvedAddresses, saveUnresolvedAddresses } from "@/lib/email_utils";
import { InboxFolder, loadInboxFolders, saveInboxFolders } from "@/lib/inbox_folders";
import "./node-editor.css";

// ── tiny uid ────────────────────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 9);

// ── node data shapes ─────────────────────────────────────────────────────────
type PatternData = {
  kind: "pattern";
  alias: string;
  matchType: MatchType;
  enabled: boolean;
};

type InboxData = {
  kind: "inbox";
  name: string;
};

type FolderData = { kind: "folder"; name: string; collapsed: boolean };
type NodeData = PatternData | InboxData | FolderData;

// ── node renderers ────────────────────────────────────────────────────────────
function PatternNode({ id, data }: NodeProps<Node<PatternData>>) {
  const d = data as PatternData;
  return (
    <div className={`uec-node uec-node-pattern ${d.enabled === false ? "uec-node-disabled" : ""}`}>
      <div className="uec-badge">{d.matchType}</div>
      <div className="uec-node-label">{d.alias || <em style={{ color: "#64748b" }}>no pattern</em>}</div>
      {/* outgoing: pattern → inbox */}
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function InboxNode({ id, data }: NodeProps<Node<InboxData>>) {
  const d = data as InboxData;
  return (
    <div className="uec-node uec-node-inbox">
      <Handle type="target" position={Position.Left} id="in" />
      <div className="uec-node-label">{d.name || <em style={{ color: "#a3e6cb" }}>unnamed inbox</em>}</div>
      <Handle type="source" position={Position.Right} id="out" />
    </div>
  );
}

function FolderNode({ data }: NodeProps<Node<FolderData>>) {
  const d = data as FolderData;
  return <div className="uec-node uec-node-folder"><Handle type="target" position={Position.Left} id="in" /><div className="uec-node-label">{d.collapsed ? "+" : "−"} {d.name || "Unnamed folder"}</div></div>;
}

const nodeTypes = {
  pattern: PatternNode,
  inbox: InboxNode,
  folder: FolderNode,
};

// ── helpers: convert rules ↔ nodes/edges ─────────────────────────────────────
function rulesToGraph(rules: AliasRule[], folders: InboxFolder[] = []) {
  // Each rule = 1 pattern node + 1 inbox node + 1 edge.
  // Multiple rules may share an inbox node if they map to the same name.
  const inboxMap = new Map<string, string>(); // inboxName → nodeId

  const nodes: Node<NodeData>[] = [];
  const edges: Edge[] = [];

  rules.forEach((rule, i) => {
    const pid = `p_${rule.id}`;
    nodes.push({
      id: pid,
      type: "pattern",
      position: { x: 80, y: i * 120 + 60 },
      data: { kind: "pattern", alias: rule.alias, matchType: rule.matchType || "exact", enabled: rule.enabled },
    });

    const key = rule.inbox.trim().toLowerCase();
    if (!inboxMap.has(key)) {
      const iid = `i_${uid()}`;
      inboxMap.set(key, iid);
      nodes.push({
        id: iid,
        type: "inbox",
        position: { x: 500, y: inboxMap.size * 130 - 70 },
        data: { kind: "inbox", name: rule.inbox },
      });
    }

    const iid = inboxMap.get(key)!;
    edges.push({
      id: `e_${rule.id}`,
      source: pid,
      sourceHandle: "out",
      target: iid,
      targetHandle: "in",
      animated: rule.enabled,
      markerEnd: { type: MarkerType.ArrowClosed, color: rule.enabled ? "#3b82f6" : "#475569" },
      style: { stroke: rule.enabled ? "#3b82f6" : "#475569", strokeWidth: 2 },
      // store rule id so we can look it up on delete
      data: { ruleId: rule.id },
    });
  });

  folders.forEach((folder, index) => {
    const folderId = `f_${folder.id}`;
    nodes.push({ id: folderId, type: "folder", position: { x: 900, y: index * 150 + 60 }, data: { kind: "folder", name: folder.name, collapsed: Boolean(folder.collapsed) } });
    folder.inboxes.forEach((name) => {
      const inboxId = inboxMap.get(name.trim().toLowerCase());
      if (!inboxId) return;
      if (folder.collapsed) {
        const childIds = new Set([inboxId, ...edges.filter((edge) => edge.target === inboxId).map((edge) => edge.source)]);
        nodes.forEach((node) => { if (childIds.has(node.id)) node.hidden = true; });
      }
      edges.push({ id: `folder_${folder.id}_${inboxId}`, source: inboxId, sourceHandle: "out", target: folderId, targetHandle: "in", animated: false, data: { folderId: folder.id } });
    });
  });

  return { nodes, edges };
}

// Derive persisted rules from the current graph state.
// Edges connect pattern nodes → inbox nodes; the rule attributes live on the pattern node.
function graphToRules(nodes: Node<NodeData>[], edges: Edge[]): AliasRule[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return edges.flatMap((edge) => {
    const src = nodeMap.get(edge.source);
    const tgt = nodeMap.get(edge.target);
    if (!src || !tgt || src.data.kind !== "pattern" || tgt.data.kind !== "inbox") return [];
    const pd = src.data as PatternData;
    const id_ = (edge.data as any)?.ruleId || uid();
    return [{
      id: id_,
      alias: pd.alias,
      matchType: pd.matchType,
      inbox: (tgt.data as InboxData).name,
      enabled: pd.enabled !== false,
    }];
  });
}

function graphToFolders(nodes: Node<NodeData>[], edges: Edge[]): InboxFolder[] {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  return nodes.filter((node) => node.data.kind === "folder").map((folderNode) => {
    const folder = folderNode.data as FolderData;
    const inboxes = edges.flatMap((edge) => {
      const source = nodeMap.get(edge.source);
      return edge.target === folderNode.id && source?.data.kind === "inbox" ? [(source.data as InboxData).name.trim()] : [];
    });
    return { id: folderNode.id.replace(/^f_/, ""), name: folder.name, inboxes, collapsed: folder.collapsed };
  });
}

// ── MATCH_TYPES list ──────────────────────────────────────────────────────────
const MATCH_TYPES: { type: MatchType; label: string }[] = [
  { type: "exact", label: "Exact" },
  { type: "domain", label: "Domain" },
  { type: "prefix", label: "Prefix (+tags)" },
  { type: "contains", label: "Contains" },
  { type: "regex", label: "Regex" },
  { type: "all", label: "Catch all" },
];

// ── main component ────────────────────────────────────────────────────────────
export function NodeEditor() {
  const [loaded, setLoaded] = useState(false);
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [folders, setFolders] = useState<InboxFolder[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const [status, setStatus] = useState("");
  const [testAddress, setTestAddress] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);

  // ── load ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    loadUnresolvedAddresses().then(setUnresolved);
    Promise.all([loadAliasRules(), loadInboxFolders()]).then(([saved, savedFolders]) => {
      setRules(saved);
      setFolders(savedFolders);
      const { nodes: n, edges: e } = rulesToGraph(saved, savedFolders);
      setNodes(n);
      setEdges(e);
      setLoaded(true);
    });
  }, []);

  // ── persist whenever nodes/edges change (debounced) ────────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback(
    (nextNodes: Node<NodeData>[], nextEdges: Edge[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const derived = graphToRules(nextNodes, nextEdges);
        const derivedFolders = graphToFolders(nextNodes, nextEdges);
        await Promise.all([saveAliasRules(derived), saveInboxFolders(derivedFolders)]);
        setRules(derived);
        setFolders(derivedFolders);
        setStatus("Saved.");
        setTimeout(() => setStatus(""), 1500);
      }, 400);
    },
    []
  );

  // ── connect: dragging a handle creates an edge (and thus a rule) ──────────
  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      const source = nodes.find((node) => node.id === params.source);
      const target = nodes.find((node) => node.id === params.target);
      if (!source || !target || !((source.data.kind === "pattern" && target.data.kind === "inbox") || (source.data.kind === "inbox" && target.data.kind === "folder"))) return;
      const newEdge: Edge = {
        ...params,
        id: `e_${uid()}`,
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
        style: { stroke: "#3b82f6", strokeWidth: 2 },
        data: { ruleId: uid() },
      } as Edge;
      const next = addEdge(newEdge, edges);
      setEdges(next);
      persist(nodes, next);
    },
    [edges, nodes, persist]
  );

  // ── delete edge → removes route ───────────────────────────────────────────
  const onEdgesDelete: OnEdgesDelete = useCallback(
    (deleted) => {
      const ids = new Set(deleted.map((e) => e.id));
      const next = edges.filter((e) => !ids.has(e.id));
      setEdges(next);
      persist(nodes, next);
    },
    [edges, nodes, persist]
  );

  // ── delete node → remove connected edges too ──────────────────────────────
  const onNodesDelete: OnNodesDelete = useCallback(
    (deleted) => {
      const deletedIds = new Set(deleted.map((n) => n.id));
      const nextEdges = edges.filter(
        (e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)
      );
      const nextNodes = nodes.filter((n) => !deletedIds.has(n.id));
      setEdges(nextEdges);
      setNodes(nextNodes);
      persist(nextNodes, nextEdges);
    },
    [edges, nodes, persist]
  );

  // ── node change callback: persist on move/label change ────────────────────
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const changeList: any[] = Array.isArray(changes) ? changes : (typeof (changes as any)?.toArray === "function" ? (changes as any).toArray() : []);
      onNodesChange(changes as any);
      // React Flow emits either a single change or a list depending on event path/version.
      const hasDrag = changeList.some((c: any) => c.type === "position" && !c.dragging);
      if (hasDrag) {
        // nodes state hasn't updated yet; defer one tick
        setTimeout(() => persist(nodes, edges), 0);
      }
    },
    [onNodesChange, nodes, edges, persist]
  );

  // ── add a new pattern node ────────────────────────────────────────────────
  const addPatternNode = () => {
    const id = `p_${uid()}`;
    const next: Node<PatternData> = {
      id,
      type: "pattern",
      position: { x: 80 + Math.random() * 60 - 30, y: 60 + nodes.length * 40 },
      data: { kind: "pattern", alias: "", matchType: "exact", enabled: true },
    };
    const nextNodes = [...nodes, next];
    setNodes(nextNodes);
    // open inline edit
    setEditingId(id);
  };

  // ── add a new inbox node ──────────────────────────────────────────────────
  const addFolderNode = () => {
    const id = `f_${uid()}`;
    const folder: Node<FolderData> = { id, type: "folder", position: { x: 900, y: 60 + nodes.filter((n) => n.data.kind === "folder").length * 150 }, data: { kind: "folder", name: "New folder", collapsed: false } };
    const next = [...nodes, folder];
    setNodes(next);
    setEditingId(id);
    setEditFolderName("New folder");
    persist(next, edges);
  };

  const toggleFolder = (folderNode: Node<NodeData>) => {
    if (folderNode.data.kind !== "folder") return;
    const collapsed = !folderNode.data.collapsed;
    const inboxIds = new Set(edges.filter((edge) => edge.target === folderNode.id).map((edge) => edge.source));
    const childIds = new Set([...inboxIds, ...edges.filter((edge) => inboxIds.has(edge.target)).map((edge) => edge.source)]);
    const next = nodes.map((node) => node.id === folderNode.id
      ? { ...node, data: { ...node.data, collapsed } as FolderData }
      : childIds.has(node.id) ? { ...node, hidden: collapsed } : node);
    setNodes(next);
    persist(next, edges);
  };

  const addInboxNode = () => {
    const id = `i_${uid()}`;
    const next: Node<InboxData> = {
      id,
      type: "inbox",
      position: { x: 500 + Math.random() * 60 - 30, y: 60 + nodes.filter((n) => (n.data as any).kind === "inbox").length * 130 },
      data: { kind: "inbox", name: "" },
    };
    const nextNodes = [...nodes, next];
    setNodes(nextNodes);
    setEditingId(id);
  };

  const autoArrangeNodes = () => {
    const patterns = nodes.filter((node) => node.data.kind === "pattern").sort((a, b) => String((a.data as PatternData).alias).localeCompare(String((b.data as PatternData).alias)));
    const inboxes = nodes.filter((node) => node.data.kind === "inbox").sort((a, b) => String((a.data as InboxData).name).localeCompare(String((b.data as InboxData).name)));
    const arranged = nodes.map((node) => {
      if (node.data.kind === "pattern") return { ...node, position: { x: 80, y: 60 + patterns.indexOf(node) * 115 } };
      if (node.data.kind === "inbox") return { ...node, position: { x: 520, y: 60 + inboxes.indexOf(node) * 130 } };
      return { ...node, position: { x: 960, y: 60 + nodes.filter((n) => n.data.kind === "folder").indexOf(node) * 150 } };
    });
    setNodes(arranged);
    persist(arranged, edges);
  };

  const addOtherCatchAll = () => {
    if (rules.some((rule) => rule.matchType === "all" && rule.enabled)) return;
    const nextNodes = [...nodes];
    const nextEdges = [...edges];
    let folder = nextNodes.find((node) => node.data.kind === "folder" && node.data.name.toLowerCase() === "other") as Node<FolderData> | undefined;
    if (!folder) {
      folder = { id: `f_${uid()}`, type: "folder", position: { x: 960, y: 300 }, data: { kind: "folder", name: "Other", collapsed: false } };
      nextNodes.push(folder);
    }
    let otherInbox = nextNodes.find((node) => node.data.kind === "inbox" && node.data.name.toLowerCase() === "other") as Node<InboxData> | undefined;
    if (!otherInbox) {
      otherInbox = { id: `i_${uid()}`, type: "inbox", position: { x: 520, y: 500 }, data: { kind: "inbox", name: "Other" } };
      nextNodes.push(otherInbox);
    }
    const ruleId = uid();
    const pattern: Node<PatternData> = { id: `p_${ruleId}`, type: "pattern", position: { x: 80, y: 60 + nextNodes.filter((node) => node.data.kind === "pattern").length * 115 }, data: { kind: "pattern", alias: "", matchType: "all", enabled: true } };
    nextNodes.push(pattern);
    nextEdges.push({ id: `e_${ruleId}`, source: pattern.id, sourceHandle: "out", target: otherInbox.id, targetHandle: "in", markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" }, style: { stroke: "#3b82f6", strokeWidth: 2 }, data: { ruleId } });
    for (const inbox of nextNodes.filter((node) => node.data.kind === "inbox")) {
      if (!nextEdges.some((edge) => edge.source === inbox.id && edge.target === folder!.id)) nextEdges.push({ id: `folder_${uid()}`, source: inbox.id, sourceHandle: "out", target: folder.id, targetHandle: "in", data: { folderId: folder.id } });
    }
    setNodes(nextNodes); setEdges(nextEdges); persist(nextNodes, nextEdges);
  };

  const addExactRouteForAddress = (address: string) => {
    const normalized = address.trim().toLowerCase();
    if (!normalized || rules.some((rule) => rule.matchType === "exact" && rule.alias.toLowerCase() === normalized)) return;
    const ruleId = uid();
    const inboxId = `i_${uid()}`;
    const pattern: Node<PatternData> = { id: `p_${ruleId}`, type: "pattern", position: { x: 80, y: 80 + nodes.length * 28 }, data: { kind: "pattern", alias: normalized, matchType: "exact", enabled: true } };
    const inbox: Node<InboxData> = { id: inboxId, type: "inbox", position: { x: 500, y: 80 + nodes.length * 28 }, data: { kind: "inbox", name: normalized } };
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

  // ── inline editing ────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAlias, setEditAlias] = useState("");
  const [editMatchType, setEditMatchType] = useState<MatchType>("exact");
  const [editInboxName, setEditInboxName] = useState("");
  const [editFolderName, setEditFolderName] = useState("");
  const [editEnabled, setEditEnabled] = useState(true);

  const openEdit = (node: Node<NodeData>) => {
    setEditingId(node.id);
    if (node.data.kind === "pattern") {
      setEditAlias(node.data.alias);
      setEditMatchType(node.data.matchType);
      setEditEnabled(node.data.enabled !== false);
    } else if (node.data.kind === "inbox") {
      setEditInboxName(node.data.name);
    } else {
      setEditFolderName(node.data.name);
    }
  };

  const commitEdit = () => {
    if (!editingId) return;
    const target = nodes.find((n) => n.id === editingId);
    if (!target) { setEditingId(null); return; }

    let nextNodes: Node<NodeData>[];
    if (target.data.kind === "pattern") {
      nextNodes = nodes.map((n) =>
        n.id === editingId
          ? { ...n, data: { ...n.data, alias: editAlias, matchType: editMatchType, enabled: editEnabled } as PatternData }
          : n
      );
    } else if (target.data.kind === "inbox") {
      nextNodes = nodes.map((n) => n.id === editingId ? { ...n, data: { ...n.data, name: editInboxName } as InboxData } : n);
    } else {
      nextNodes = nodes.map((n) => n.id === editingId ? { ...n, data: { ...n.data, name: editFolderName } as FolderData } : n);
    }
    setNodes(nextNodes);
    setEditingId(null);
    persist(nextNodes, edges);
  };

  const cancelEdit = () => setEditingId(null);

  // open editor on node double-click
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node<NodeData>) => openEdit(node),
    [nodes]
  );

  // ── test resolver ─────────────────────────────────────────────────────────
  const runTest = () => {
    if (!testAddress.trim()) return setTestResult(null);
    setTestResult(resolveInbox(testAddress.trim(), rules));
  };

  if (!loaded) return <div className="uec-editor-loading">Loading routes…</div>;

  const editingNode = editingId ? nodes.find((n) => n.id === editingId) : null;

  return (
    <div className="uec-editor">
      {/* ── toolbar ────────────────────────────────────────────────── */}
      <div className="uec-editor-toolbar">
        <strong>Virtual Inbox Routing</strong>
        <div className="uec-toolbar-actions">
          <button type="button" onClick={autoArrangeNodes} className="uec-btn-secondary" disabled={!nodes.length}>Auto arrange</button>
          <button type="button" onClick={addPatternNode} className="uec-btn-add-pattern">
            + Pattern
          </button>
          <button type="button" onClick={addInboxNode} className="uec-btn-add-inbox">+ Inbox</button>
          <button type="button" onClick={addFolderNode} className="uec-btn-secondary">+ Folder</button>
          <button type="button" onClick={addOtherCatchAll} className="uec-btn-secondary" disabled={rules.some((rule) => rule.matchType === "all" && rule.enabled)}>Add Other catch-all</button>
        </div>
        {status && <span role="status" className="uec-status">{status}</span>}
      </div>

      {/* ── test bar ────────────────────────────────────────────────── */}
      <div className="uec-tester-bar">
        <span>Test resolver:</span>
        <input
          placeholder="e.g. me+finance@example.com"
          value={testAddress}
          onChange={(e) => { setTestAddress(e.target.value); if (testResult) setTestResult(null); }}
          onKeyDown={(e) => e.key === "Enter" && runTest()}
        />
        <button type="button" onClick={runTest}>Resolve</button>
        {testResult && (
          <span className="uec-test-match">
            → <strong>{testResult}</strong>
          </span>
        )}
      </div>

      {unresolved.length > 0 && <section className="uec-unresolved" aria-label="Unrouted addresses">
        <strong>Unrouted addresses <span>({unresolved.length})</span></strong>
        <div className="uec-unresolved-list">{unresolved.map((address) => <button type="button" key={address} onClick={() => addExactRouteForAddress(address)} title={`Create exact-match route for ${address}`}>＋ {address} <small>Add exact route</small></button>)}</div>
      </section>}

      {/* ── inline editor panel ─────────────────────────────────────── */}
      {editingNode && (
        <div className="uec-inline-editor">
          {editingNode.data.kind === "pattern" ? (
            <>
              <label>
                Match type
                <select value={editMatchType} onChange={(e) => setEditMatchType(e.target.value as MatchType)}>
                  {MATCH_TYPES.map((m) => (
                    <option key={m.type} value={m.type}>{m.label}</option>
                  ))}
                </select>
              </label>
              {editMatchType !== "all" && <label>
                Pattern
                <input
                  autoFocus
                  placeholder={
                    editMatchType === "domain" ? "domain.com"
                    : editMatchType === "prefix" ? "user (matches user+*@...)"
                    : editMatchType === "regex" ? "^newsletter.*@.*"
                    : editMatchType === "contains" ? "receipt"
                    : "alias@example.com"
                  }
                  value={editAlias}
                  onChange={(e) => setEditAlias(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                />
              </label>}
              <label className="uec-checkbox-label">
                <input type="checkbox" checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} />
                Enabled
              </label>
            </>
          ) : editingNode.data.kind === "inbox" ? (
            <label>
              Inbox name
              <input autoFocus placeholder="Finance, Work, Newsletters…" value={editInboxName} onChange={(e) => setEditInboxName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} />
            </label>
          ) : (
            <label>
              Folder name
              <input autoFocus placeholder="Other, Work…" value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }} />
            </label>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={commitEdit}>Save</button>
            <button type="button" className="uec-btn-cancel" onClick={cancelEdit}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── flow canvas ─────────────────────────────────────────────── */}
      <div className="uec-editor-canvas">
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
          onNodeClick={(_, node) => { if (node.data.kind === "folder") toggleFolder(node as Node<NodeData>); }}
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
  );
}
