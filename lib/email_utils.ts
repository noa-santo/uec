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

export function groupByToAddress(list: Email[], rules: AliasRule[] = []): Record<string, Email[]> {
  return list.reduce((acc, e) => {
    const inbox = resolveInbox(e.to, rules);
    (acc[inbox] ||= []).push(e);
    return acc;
  }, {} as Record<string, Email[]>);
}
