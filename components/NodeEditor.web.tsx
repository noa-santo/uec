import { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AliasRule, loadAliasRules, saveAliasRules, validateRule } from "@/lib/alias_rules";
import "./node-editor.css";

type RuleNodeData = { label: string; kind: "alias" | "inbox" };
const id = () => `rule_${Math.random().toString(36).slice(2, 9)}`;

function RuleNode({ data }: { data: RuleNodeData }) {
  return <div className={`uec-node uec-node-${data.kind}`}><Handle type="target" position={Position.Left} />{data.label}<Handle type="source" position={Position.Right} /></div>;
}

const nodeTypes = { rule: RuleNode };

export function NodeEditor() {
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [draft, setDraft] = useState({ alias: "", inbox: "" });
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { loadAliasRules().then((value) => { setRules(value); setLoaded(true); }); }, []);
  const nodes = useMemo<Node<RuleNodeData>[]>(() => rules.flatMap((rule, index) => [
    { id: `${rule.id}-alias`, type: "rule", position: { x: 40, y: index * 100 + 40 }, data: { kind: "alias", label: rule.alias } },
    { id: `${rule.id}-inbox`, type: "rule", position: { x: 380, y: index * 100 + 40 }, data: { kind: "inbox", label: rule.inbox } },
  ]), [rules]);
  const edges = useMemo<Edge[]>(() => rules.map((rule) => ({ id: rule.id, source: `${rule.id}-alias`, target: `${rule.id}-inbox`, animated: rule.enabled })), [rules]);

  const addRule = async () => {
    const alias = draft.alias.trim().toLowerCase();
    const inbox = draft.inbox.trim();
    const error = validateRule({ alias, inbox });
    if (error) return setStatus(error);
    if (rules.some((rule) => rule.alias === alias)) return setStatus("That alias already has a route.");
    const next = [...rules, { id: id(), alias, inbox, enabled: true }];
    await saveAliasRules(next); setRules(next); setDraft({ alias: "", inbox: "" }); setStatus("Route saved.");
  };
  const removeRule = async (ruleId: string) => { const next = rules.filter((rule) => rule.id !== ruleId); await saveAliasRules(next); setRules(next); setStatus("Route removed."); };
  if (!loaded) return <div className="uec-editor-loading">Loading routes…</div>;
  return <div className="uec-editor">
    <div className="uec-editor-toolbar"><strong>Alias routing</strong><span>Incoming aliases only — outgoing mail is not configured.</span></div>
    <div className="uec-editor-form">
      <input aria-label="Alias address" placeholder="alias@example.com" value={draft.alias} onChange={(e) => setDraft({ ...draft, alias: e.target.value })} />
      <input aria-label="Virtual inbox" placeholder="Work inbox" value={draft.inbox} onChange={(e) => setDraft({ ...draft, inbox: e.target.value })} />
      <button onClick={addRule}>Add route</button><span role="status">{status}</span>
    </div>
    <div className="uec-editor-canvas"><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView><Background color="#293241" /><Controls /><MiniMap /></ReactFlow></div>
    <div className="uec-route-list">{rules.map((rule) => <div className="uec-route-row" key={rule.id}><span>{rule.alias} → {rule.inbox}</span><button onClick={() => removeRule(rule.id)}>Remove</button></div>)}</div>
  </div>;
}
