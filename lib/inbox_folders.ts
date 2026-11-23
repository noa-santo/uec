import { AliasRule, isSpecificRule, testRuleMatch } from "./alias_rules";
import type { Email } from "./email_utils";
import { getItem, setItem, type SaveResult } from "./storage";

export type InboxFolder = {
  id: string;
  name: string;
  /** Inboxes explicitly assigned to this folder. */
  inboxes: string[];
  /** Collapsed in the inbox list of the main view (never hides graph nodes). */
  collapsed?: boolean;
  /** Also collect the dynamic inboxes produced by catch-all rules. */
  includeCatchAll?: boolean;
};

const KEY = "uec.inboxFolders.v1";

export async function loadInboxFolders(): Promise<InboxFolder[]> {
  try {
    const raw = await getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((f) => f && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.inboxes))
          .map((f) => ({
            id: f.id,
            name: f.name,
            inboxes: f.inboxes.filter((value: unknown) => typeof value === "string"),
            collapsed: Boolean(f.collapsed),
            includeCatchAll: Boolean(f.includeCatchAll),
          }))
      : [];
  } catch { return []; }
}

export async function saveInboxFolders(folders: InboxFolder[]): Promise<SaveResult> {
  const value = JSON.stringify(folders.map((f) => ({
    ...f,
    name: f.name.trim(),
    inboxes: [...new Set(f.inboxes.map((name) => name.trim()).filter(Boolean))],
  })).filter((f) => f.name));
  return setItem(KEY, value);
}

/**
 * A folder collects unsorted mail when explicitly enabled, or when it already
 * contains the (static) inbox name of a catch-all rule. The latter keeps older
 * configurations working without any manual migration.
 */
export function folderCollectsCatchAll(folder: InboxFolder, rules: AliasRule[]): boolean {
  if (folder.includeCatchAll) return true;
  const names = new Set(folder.inboxes.map((name) => name.trim().toLowerCase()));
  return rules.some((rule) =>
    rule.enabled !== false &&
    (rule.matchType || "exact") === "all" &&
    names.has(rule.inbox.trim().toLowerCase())
  );
}

/**
 * True when at least one message in the group was not sorted by a specific
 * rule. Those are the messages a catch-all rule handles — their virtual inbox
 * name is dynamic (e.g. derived from the sender), so it can't be listed by name
 * when the folder is configured.
 */
export function isCatchAllGroup(emails: Email[], rules: AliasRule[]): boolean {
  const specific = rules.filter(isSpecificRule);
  return emails.some((email) => !specific.some((rule) => testRuleMatch(email.to, rule, email)));
}

/** Resolve the actual, currently populated inbox names belonging to a folder. */
export function folderInboxNames(folder: InboxFolder, groups: Record<string, Email[]>, rules: AliasRule[]): string[] {
  const explicit = new Set(folder.inboxes.map((name) => name.trim().toLowerCase()));
  const collectCatchAll = folderCollectsCatchAll(folder, rules);
  return Object.keys(groups)
    .filter((name) => explicit.has(name.trim().toLowerCase()) || (collectCatchAll && isCatchAllGroup(groups[name], rules)))
    .sort((a, b) => a.localeCompare(b));
}

export function folderMessages(folder: InboxFolder, groups: Record<string, Email[]>, rules: AliasRule[]): Email[] {
  return folderInboxNames(folder, groups, rules).flatMap((name) => groups[name] || []);
}
