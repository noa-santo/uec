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

import { AliasRule, resolveInbox } from "./alias_rules";
import AsyncStorage from "@react-native-async-storage/async-storage";

const UNRESOLVED_KEY = "uec.unresolvedAddresses.v1";
export async function loadUnresolvedAddresses(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(UNRESOLVED_KEY);
    return raw ? JSON.parse(raw) as string[] : [];
  } catch { return []; }
}
export async function saveUnresolvedAddresses(addresses: string[]): Promise<void> {
  try { await AsyncStorage.setItem(UNRESOLVED_KEY, JSON.stringify([...new Set(addresses.map((a) => a.trim().toLowerCase()).filter(Boolean))].slice(0, 500))); } catch {}
}

export function groupByToAddress(list: Email[], rules: AliasRule[] = []): Record<string, Email[]> {
  return list.reduce((acc, e) => {
    const inbox = resolveInbox(e.to, rules);
    (acc[inbox] ||= []).push(e);
    return acc;
  }, {} as Record<string, Email[]>);
}
