import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { AliasRule, loadAliasRules, saveAliasRules, validateRule } from "@/lib/alias_rules";

export function NodeEditor() {
  const [rules, setRules] = useState<AliasRule[]>([]);
  const [alias, setAlias] = useState(""); const [inbox, setInbox] = useState(""); const [status, setStatus] = useState("");
  useEffect(() => { loadAliasRules().then(setRules); }, []);
  const add = async () => { const nextRule = { id: `rule_${Date.now()}`, alias: alias.trim().toLowerCase(), inbox: inbox.trim(), enabled: true }; const error = validateRule(nextRule); if (error) return setStatus(error); if (rules.some((r) => r.alias === nextRule.alias)) return setStatus("That alias already has a route."); const next = [...rules, nextRule]; await saveAliasRules(next); setRules(next); setAlias(""); setInbox(""); setStatus("Route saved."); };
  const remove = async (id: string) => { const next = rules.filter((rule) => rule.id !== id); await saveAliasRules(next); setRules(next); };
  return <ScrollView style={{ flex: 1, backgroundColor: "#070b12", padding: 16 }}>
    <Text style={{ color: "#f6f8fb", fontSize: 20, fontWeight: "700", marginBottom: 6 }}>Alias routing</Text>
    <Text style={{ color: "#93a4ba", marginBottom: 16 }}>Route incoming aliases to virtual inboxes. Outgoing mail is not configured.</Text>
    <TextInput accessibilityLabel="Alias address" placeholder="alias@example.com" placeholderTextColor="#718096" value={alias} onChangeText={setAlias} style={{ color: "#fff", backgroundColor: "#111a28", borderColor: "#34445b", borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 10 }} />
    <TextInput accessibilityLabel="Virtual inbox" placeholder="Work inbox" placeholderTextColor="#718096" value={inbox} onChangeText={setInbox} style={{ color: "#fff", backgroundColor: "#111a28", borderColor: "#34445b", borderWidth: 1, borderRadius: 6, padding: 10, marginBottom: 10 }} />
    <Pressable onPress={add} style={{ backgroundColor: "#2563eb", borderRadius: 6, padding: 11, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>Add route</Text></Pressable>
    <Text accessibilityLiveRegion="polite" style={{ color: "#93a4ba", marginVertical: 10 }}>{status}</Text>
    {rules.map((rule) => <View key={rule.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#263244" }}><Text style={{ color: "#e6edf7", flex: 1 }}>{rule.alias} → {rule.inbox}</Text><Pressable onPress={() => remove(rule.id)}><Text style={{ color: "#93a4ba" }}>Remove</Text></Pressable></View>)}
  </ScrollView>;
}
