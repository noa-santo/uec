import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type AliasRule = {
  id: string;
  alias: string;
  inbox: string;
  enabled: boolean;
};

const KEY = "uec.aliasRules.v1";

export function normalizeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export function validateRule(rule: Pick<AliasRule, "alias" | "inbox">): string | undefined {
  if (!normalizeAddress(rule.alias) || !rule.inbox.trim()) return "Alias and inbox are required.";
  if (!/^\S+@\S+\.\S+$/.test(normalizeAddress(rule.alias))) return "Enter a valid alias address.";
  return undefined;
}

function normalizeRules(value: unknown): AliasRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: any) => {
    if (!item || typeof item.id !== "string" || typeof item.alias !== "string" || typeof item.inbox !== "string") return [];
    const rule: AliasRule = { id: item.id, alias: normalizeAddress(item.alias), inbox: item.inbox.trim(), enabled: item.enabled !== false };
    if (validateRule(rule) || seen.has(rule.alias)) return [];
    seen.add(rule.alias);
    return [rule];
  });
}

async function read(): Promise<string | null> {
  return Platform.OS === "web" ? AsyncStorage.getItem(KEY) : SecureStore.getItemAsync(KEY);
}

async function write(value: string): Promise<void> {
  if (Platform.OS === "web") await AsyncStorage.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value);
}

export async function loadAliasRules(): Promise<AliasRule[]> {
  try {
    const raw = await read();
    if (!raw) return [];
    return normalizeRules(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveAliasRules(rules: AliasRule[]): Promise<void> {
  await write(JSON.stringify(normalizeRules(rules)));
}

export function resolveInbox(address: string, rules: AliasRule[]): string {
  const normalized = normalizeAddress(address);
  return rules.find((rule) => rule.enabled && normalizeAddress(rule.alias) === normalized)?.inbox || normalized;
}
