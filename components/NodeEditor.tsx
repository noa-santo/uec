import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AliasRule, MatchType, loadAliasRules, saveAliasRules, validateRule, resolveInbox } from "@/lib/alias_rules";

const MATCH_TYPES: { type: MatchType; label: string }[] = [
  { type: "exact", label: "Exact" },
  { type: "domain", label: "Domain" },
  { type: "prefix", label: "Prefix" },
  { type: "contains", label: "Contains" },
  { type: "regex", label: "Regex" },
  { type: "all", label: "Catch all" },
];

export function NodeEditor() {
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [alias, setAlias] = useState("");
  const [inbox, setInbox] = useState("");
  const [matchType, setMatchType] = useState<MatchType>("exact");
  const [status, setStatus] = useState("");
  const [testAddr, setTestAddr] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadAliasRules().then(setRules);
  }, []);

  const add = async () => {
    const nextRule: AliasRule = {
      id: `rule_${Date.now()}`,
      alias: matchType === "all" ? "" : alias.trim(),
      matchType,
      inbox: inbox.trim(),
      enabled: true,
    };
    const error = validateRule(nextRule);
    if (error) return setStatus(error);
    if (rules.some((r) => r.matchType === nextRule.matchType && r.alias.toLowerCase() === nextRule.alias.toLowerCase())) {
      return setStatus("That pattern already has a rule.");
    }
    const next = [...rules, nextRule];
    const saved = await saveAliasRules(next);
    if (!saved.ok) return setStatus("Storage is full — route kept for this session only.");
    setRules(next);
    setAlias("");
    setInbox("");
    setStatus("Route saved.");
  };

  const remove = async (id: string) => {
    const next = rules.filter((rule) => rule.id !== id);
    await saveAliasRules(next);
    setRules(next);
  };

  const toggle = async (id: string) => {
    const next = rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
    await saveAliasRules(next);
    setRules(next);
  };

  const testRouting = () => {
    if (!testAddr.trim()) return setTestResult(null);
    const resolved = resolveInbox(testAddr.trim(), rules);
    setTestResult(resolved);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: "#070b12", padding: 16 }}>
      <Text style={{ color: "#f6f8fb", fontSize: 20, fontWeight: "700", marginBottom: 6 }}>Alias & Pattern Routing</Text>
      <Text style={{ color: "#93a4ba", marginBottom: 16 }}>
        Route incoming addresses to virtual inboxes via exact match, domain (@work.com), prefix (+tags), substring, or regex.
      </Text>

      {/* Match Type Selector */}
      <View style={{ flexDirection: "row", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {MATCH_TYPES.map((m) => (
          <Pressable
            key={m.type}
            onPress={() => setMatchType(m.type)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 6,
              backgroundColor: matchType === m.type ? "#2563eb" : "#111a28",
              borderWidth: 1,
              borderColor: matchType === m.type ? "#3b82f6" : "#34445b",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>{m.label}</Text>
          </Pressable>
        ))}
      </View>

      {matchType !== "all" && <TextInput
        accessibilityLabel="Alias pattern"
        placeholder={
          matchType === "domain"
            ? "example.com or @company.org"
            : matchType === "prefix"
            ? "newsletter (matches newsletter+tag@...)"
            : matchType === "regex"
            ? "^support.*@client\\.com$"
            : matchType === "contains"
            ? "billing"
            : "alias@example.com"
        }
        placeholderTextColor="#718096"
        value={alias}
        onChangeText={setAlias}
        style={{ color: "#fff", backgroundColor: "#111a28", borderColor: "#34445b", borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 10 }}
      />}
      <TextInput
        accessibilityLabel="Virtual inbox"
        placeholder="Destination Virtual Inbox (e.g. Work, Newsletters, Finance)"
        placeholderTextColor="#718096"
        value={inbox}
        onChangeText={setInbox}
        style={{ color: "#fff", backgroundColor: "#111a28", borderColor: "#34445b", borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 10 }}
      />
      <Pressable onPress={add} style={{ backgroundColor: "#2563eb", borderRadius: 6, padding: 11, alignItems: "center" }}>
        <Text style={{ color: "#fff", fontWeight: "700" }}>Add Rule</Text>
      </Pressable>

      <Text accessibilityLiveRegion="polite" style={{ color: "#93a4ba", marginVertical: 10 }}>
        {status}
      </Text>

      {/* Test Resolver Tool */}
      <View style={{ backgroundColor: "#0f172a", padding: 12, borderRadius: 8, marginVertical: 12, borderWidth: 1, borderColor: "#1e293b" }}>
        <Text style={{ color: "#cbd5e1", fontWeight: "600", marginBottom: 6 }}>Test Address Resolver</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput
            placeholder="test.user+spam@example.com"
            placeholderTextColor="#64748b"
            value={testAddr}
            onChangeText={(v) => {
              setTestAddr(v);
              if (testResult) setTestResult(null);
            }}
            style={{ flex: 1, color: "#fff", backgroundColor: "#0a0f1d", borderColor: "#334155", borderWidth: 1, borderRadius: 6, padding: 8 }}
          />
          <Pressable onPress={testRouting} style={{ backgroundColor: "#334155", borderRadius: 6, paddingHorizontal: 14, justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "600" }}>Test</Text>
          </Pressable>
        </View>
        {testResult && (
          <Text style={{ color: "#38bdf8", marginTop: 8 }}>
            Routes to Virtual Inbox: <Text style={{ fontWeight: "700" }}>{testResult}</Text>
          </Text>
        )}
      </View>

      <Text style={{ color: "#94a3b8", fontWeight: "700", marginTop: 10, marginBottom: 6 }}>Active Rules ({rules.length})</Text>
      {rules.map((rule) => (
        <View
          key={rule.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingVertical: 10,
            borderBottomWidth: 1,
            borderBottomColor: "#263244",
            opacity: rule.enabled ? 1 : 0.5,
          }}
        >
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ color: "#38bdf8", fontSize: 12, backgroundColor: "#0c4a6e", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                {rule.matchType || "exact"}
              </Text>
              <Text style={{ color: "#e6edf7", fontWeight: "600" }}>{rule.alias}</Text>
            </View>
            <Text style={{ color: "#94a3b8", marginTop: 2 }}>→ {rule.inbox}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
            <Pressable onPress={() => toggle(rule.id)}>
              <Text style={{ color: rule.enabled ? "#4ade80" : "#94a3b8" }}>{rule.enabled ? "Active" : "Disabled"}</Text>
            </Pressable>
            <Pressable onPress={() => remove(rule.id)}>
              <Text style={{ color: "#f87171" }}>Remove</Text>
            </Pressable>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
