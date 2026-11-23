import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type MatchType = "exact" | "contains" | "domain" | "prefix" | "regex" | "all";

export type AliasRule = {
  id: string;
  alias: string;
  matchType?: MatchType;
  inbox: string;
  enabled: boolean;
};

const KEY = "uec.aliasRules.v1";

export function normalizeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

export function validateRule(rule: Pick<AliasRule, "alias" | "inbox" | "matchType">): string | undefined {
  const alias = rule.alias.trim();
  const inbox = rule.inbox.trim();
  const matchType = rule.matchType || "exact";

  if (!inbox || (matchType !== "all" && !alias)) return "Pattern and virtual inbox are required.";

  if (matchType === "all") return undefined;
  if (matchType === "exact") {
    const normalized = normalizeAddress(alias);
    if (!/^\S+@\S+\.\S+$/.test(normalized)) return "Enter a valid email address for exact match.";
  } else if (matchType === "domain") {
    const d = alias.replace(/^@/, "").toLowerCase();
    if (!/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(d)) return "Enter a valid domain (e.g. example.com or @example.com).";
  } else if (matchType === "regex") {
    try {
      new RegExp(alias, "i");
    } catch {
      return "Invalid regular expression pattern.";
    }
  }
  return undefined;
}

export function testRuleMatch(address: string, rule: AliasRule): boolean {
  if (!rule.enabled) return false;
  const target = normalizeAddress(address);
  const matchType = rule.matchType || "exact";
  const pattern = rule.alias.trim().toLowerCase();

  switch (matchType) {
    case "all":
      return true;
    case "exact":
      return target === normalizeAddress(rule.alias);
    case "contains":
      return target.includes(pattern);
    case "domain": {
      const dom = pattern.replace(/^@/, "");
      return target.endsWith(`@${dom}`) || target.endsWith(`.${dom}`);
    }
    case "prefix": {
      const localPart = target.split("@")[0] || "";
      const cleanPrefix = pattern.replace(/\+.*$/, "").replace(/@.*$/, "");
      return localPart.startsWith(cleanPrefix);
    }
    case "regex": {
      try {
        const re = new RegExp(rule.alias.trim(), "i");
        return re.test(target);
      } catch {
        return false;
      }
    }
    default:
      return target === normalizeAddress(rule.alias);
  }
}

function normalizeRules(value: unknown): AliasRule[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item: any) => {
    if (!item || typeof item.id !== "string" || typeof item.alias !== "string" || typeof item.inbox !== "string") return [];
    const matchType: MatchType = ["exact", "contains", "domain", "prefix", "regex", "all"].includes(item.matchType)
      ? item.matchType
      : "exact";
    const rule: AliasRule = {
      id: item.id,
      alias: matchType === "exact" ? normalizeAddress(item.alias) : item.alias.trim(),
      matchType,
      inbox: item.inbox.trim(),
      enabled: item.enabled !== false,
    };
    const key = `${rule.matchType}:${rule.alias.toLowerCase()}`;
    if (validateRule(rule) || seen.has(key)) return [];
    seen.add(key);
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
  for (const rule of rules) {
    if (testRuleMatch(normalized, rule)) {
      return rule.inbox;
    }
  }
  return normalized;
}
