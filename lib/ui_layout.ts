import { getItem, setItem } from "./storage";

export type InboxLayout = {
  inboxesWidth: number;
  messagesWidth: number;
  collapsedInboxes: boolean;
  collapsedMessages: boolean;
  collapsedMessage: boolean;
};

export const DEFAULT_INBOX_LAYOUT: InboxLayout = {
  inboxesWidth: 270,
  messagesWidth: 320,
  collapsedInboxes: false,
  collapsedMessages: false,
  collapsedMessage: false,
};

const KEY = "uec.inboxLayout.v1";
const clampWidth = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(180, Math.min(720, value)) : fallback;

export async function loadInboxLayout(): Promise<InboxLayout> {
  try {
    const raw = await getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return DEFAULT_INBOX_LAYOUT;
    return {
      inboxesWidth: clampWidth(parsed.inboxesWidth, DEFAULT_INBOX_LAYOUT.inboxesWidth),
      messagesWidth: clampWidth(parsed.messagesWidth, DEFAULT_INBOX_LAYOUT.messagesWidth),
      collapsedInboxes: Boolean(parsed.collapsedInboxes),
      collapsedMessages: Boolean(parsed.collapsedMessages),
      collapsedMessage: Boolean(parsed.collapsedMessage),
    };
  } catch {
    return DEFAULT_INBOX_LAYOUT;
  }
}

export async function saveInboxLayout(layout: InboxLayout): Promise<void> {
  await setItem(KEY, JSON.stringify(layout));
}
