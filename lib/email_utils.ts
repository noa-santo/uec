export type Email = {
  id: string;
  to: string; // address the email was sent to (user's alias)
  from: string;
  subject: string;
  snippet: string;
  date: string; // ISO
  // Deprecated: plain body string kept for backward compatibility with early UI components.
  body: string;
  // New optional fields for proper rendering of Gmail messages.
  bodyText?: string; // text/plain content when available
  bodyHtml?: string; // text/html content when available
};

import { AliasRule, isSpecificRule, normalizeAddress, resolveInbox, testRuleMatch } from "./alias_rules";
import { getAllKeys, getItem, setItem } from "./storage";

const UNRESOLVED_KEY = "uec.unresolvedAddresses.v1";
const EMAIL_CACHE_PREFIX = "uec.email.";

export async function loadUnresolvedAddresses(): Promise<string[]> {
  try {
    const raw = await getItem(UNRESOLVED_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch { return []; }
}

export async function saveUnresolvedAddresses(addresses: string[]): Promise<void> {
  await setItem(UNRESOLVED_KEY, JSON.stringify([...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 500)));
}

/** Addresses that only a catch-all rule (or no rule at all) currently handles. */
export function unresolvedAddressesFromEmails(emails: Email[], rules: AliasRule[]): string[] {
  const specific = rules.filter(isSpecificRule);
  const unresolved = new Set<string>();
  for (const email of emails) {
    const address = normalizeAddress(email.to);
    if (address && !specific.some((rule) => testRuleMatch(address, rule, email))) unresolved.add(address);
  }
  return [...unresolved];
}

/** Read cached messages, including older pages fetched in the background. */
export async function loadCachedEmails(): Promise<Email[]> {
  const keys = (await getAllKeys()).filter((key) => key.startsWith(EMAIL_CACHE_PREFIX));
  const emails: Email[] = [];
  for (const key of keys) {
    try {
      const raw = await getItem(key, false);
      if (!raw) continue;
      const email = JSON.parse(raw) as Email;
      if (email && typeof email.id === "string" && typeof email.to === "string") emails.push(email);
    } catch { /* skip corrupt or evicted entries */ }
  }
  return emails;
}

/**
 * Resolver suggestions for every message we have ever cached — not just the
 * most recent page shown in the inbox. Stored suggestions are kept as well so
 * addresses from a previous session are not lost.
 */
export async function collectUnresolvedAddresses(rules: AliasRule[]): Promise<string[]> {
  const [stored, cached] = await Promise.all([loadUnresolvedAddresses(), loadCachedEmails()]);
  return [...new Set([...unresolvedAddressesFromEmails(cached, rules), ...stored])].slice(0, 500);
}

export function groupByToAddress(list: Email[], rules: AliasRule[] = []): Record<string, Email[]> {
  // A catch-all must never win over a specific rule, otherwise its dynamic
  // output name would swallow mail that was explicitly routed elsewhere.
  const orderedRules = [...rules.filter(isSpecificRule), ...rules.filter((rule) => !isSpecificRule(rule))];
  return list.reduce((acc, e) => {
    const matchedRule = orderedRules.find((rule) => testRuleMatch(e.to, rule, e));
    const fallbackInbox = resolveInbox(e.to, rules, e);
    let inbox = fallbackInbox;
    if (matchedRule?.outputMode === "subject") inbox = e.subject.trim() || matchedRule.inbox;
    else if (matchedRule?.outputMode === "sender") inbox = e.from.trim() || matchedRule.inbox;
    else if (matchedRule?.outputMode === "senderDomain") {
      const sender = e.from.match(/@([^>\s]+)/)?.[1]?.replace(/[>].*$/, "");
      inbox = sender || matchedRule.inbox;
    }
    (acc[inbox] ||= []).push(e);
    return acc;
  }, {} as Record<string, Email[]>);
}
