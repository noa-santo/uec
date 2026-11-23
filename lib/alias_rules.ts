import { getItem, setItem, type SaveResult } from "./storage";

export type MatchType = "exact" | "contains" | "domain" | "prefix" | "regex" | "all";

export type AliasRule = {
  id: string;
  alias: string;
  matchType?: MatchType;
  inbox: string;
  enabled: boolean;
  conditions?: Array<{ alias: string; matchType: MatchType; field?: "recipient" | "sender" | "subject" | "body" }>;
  logic?: "and" | "or";
  outputMode?: "static" | "subject" | "sender" | "senderDomain";
  field?: "recipient" | "sender" | "subject" | "body";
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

export function testRuleMatch(address: string, rule: AliasRule, email?: { from?: string; subject?: string; body?: string; to?: string }): boolean {
  if (!rule.enabled) return false;
  const valueFor = (field: AliasRule["field"] = "recipient") => field === "sender" ? (email?.from?.match(/<([^>]+)>/)?.[1] || email?.from || "") : field === "subject" ? (email?.subject || "") : field === "body" ? (email?.body || "") : (email?.to || address);
  if (rule.conditions?.length) {
    const outcomes = rule.conditions.map((condition) => testRuleMatch(valueFor(condition.field), { ...rule, alias: condition.alias, matchType: condition.matchType, conditions: undefined, field: undefined }, undefined));
    return rule.logic === "or" ? outcomes.some(Boolean) : outcomes.every(Boolean);
  }
  address = valueFor(rule.field);
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
      conditions: Array.isArray(item.conditions) ? item.conditions.filter((condition: any) => condition && typeof condition.alias === "string" && ["exact", "contains", "domain", "prefix", "regex"].includes(condition.matchType)).map((condition: any) => ({ alias: condition.alias.trim(), matchType: condition.matchType as MatchType, field: ["recipient", "sender", "subject", "body"].includes(condition.field) ? condition.field : "recipient" })) : undefined,
      logic: item.logic === "or" ? "or" : item.logic === "and" ? "and" : undefined,
      outputMode: ["static", "subject", "sender", "senderDomain"].includes(item.outputMode) ? item.outputMode : "static",
      field: ["recipient", "sender", "subject", "body"].includes(item.field) ? item.field : "recipient",
    };
    const key = `${rule.matchType}:${rule.alias.toLowerCase()}:${rule.inbox.toLowerCase()}:${JSON.stringify(rule.conditions || [])}`;
    const invalidCondition = rule.conditions?.some((condition) => {
      if ((condition.field === "subject" || condition.field === "body") && condition.matchType === "exact") return !condition.alias;
      return Boolean(validateRule({ alias: condition.alias, inbox: rule.inbox, matchType: condition.matchType }));
    });
    if ((rule.conditions?.length ? invalidCondition : validateRule(rule)) || seen.has(key)) return [];
    seen.add(key);
    return [rule];
  });
}

export async function loadAliasRules(): Promise<AliasRule[]> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return [];
    return normalizeRules(JSON.parse(raw));
  } catch {
    return [];
  }
}

export async function saveAliasRules(rules: AliasRule[]): Promise<SaveResult> {
  return setItem(KEY, JSON.stringify(normalizeRules(rules)));
}

/** Rules that can sort a message to a specific inbox (catch-all never counts). */
export function isSpecificRule(rule: AliasRule): boolean {
  return rule.enabled !== false && (rule.matchType || "exact") !== "all";
}

export function resolveInbox(address: string, rules: AliasRule[], email?: { from?: string; subject?: string; body?: string; to?: string }): string {
  const normalized = normalizeAddress(address);
  const orderedRules = [...rules.filter((rule) => (rule.matchType || "exact") !== "all"), ...rules.filter((rule) => (rule.matchType || "exact") === "all")];
  for (const rule of orderedRules) {
    if (testRuleMatch(normalized, rule, email)) return rule.inbox;
  }
  return normalized;
}
