import {Email} from "./email_utils";
import {GmailAccount, MailAccount, getValidGmailAccount} from "./accounts";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {Platform} from "react-native";

function getHeader(headers: { name: string; value: string }[], key: string): string | undefined {
  const h = headers.find((x) => x.name.toLowerCase() === key.toLowerCase());
  return h?.value;
}

function decodeBody(data?: string): string | undefined {
  if (!data) return undefined;
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = typeof atob !== "undefined" ? atob(b64) : undefined;
    if (decoded === undefined) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function extractTextFromPayload(payload: any): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType?.startsWith("text/plain") && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const txt = extractTextFromPayload(part);
      if (txt) return txt;
    }
  }
  return undefined;
}

function extractHtmlFromPayload(payload: any): string | undefined {
  if (!payload) return undefined;
  if (payload.mimeType?.startsWith("text/html") && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    // Prefer direct html under multipart/alternative or nested structures
    for (const part of payload.parts) {
      const html = extractHtmlFromPayload(part);
      if (html) return html;
    }
  }
  return undefined;
}

const gmailEmailCache: Record<string, Email> = {};
let gmailPageTokenCache: Record<string, string | undefined> = {};

async function getCachedEmail(id: string): Promise<Email | undefined> {
  if (gmailEmailCache[id]) return gmailEmailCache[id];
  try {
    if (Platform.OS === "web") {
      const raw = localStorage.getItem(`uec.email.${id}`);
      if (raw) return JSON.parse(raw) as Email;
    } else {
      const raw = await AsyncStorage.getItem(`uec.email.${id}`);
      if (raw) return JSON.parse(raw) as Email;
    }
  } catch {}
  return undefined;
}

async function setCachedEmail(id: string, email: Email): Promise<void> {
  gmailEmailCache[id] = email;
  try {
    const data = JSON.stringify(email);
    if (Platform.OS === "web") {
      localStorage.setItem(`uec.email.${id}` , data);
    } else {
      await AsyncStorage.setItem(`uec.email.${id}`, data);
    }
  } catch {}
}

async function getCachedEmailList(accountEmail: string): Promise<{ ids: string[]; nextPageToken?: string } | undefined> {
  try {
    if (Platform.OS === "web") {
      const raw = localStorage.getItem(`uec.emailList.v2.${accountEmail}`);
      if (raw) return JSON.parse(raw);
    } else {
      const raw = await AsyncStorage.getItem(`uec.emailList.v2.${accountEmail}`);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return undefined;
}

async function setCachedEmailList(accountEmail: string, ids: string[], nextPageToken?: string): Promise<void> {
  try {
    const previous = await getCachedEmailList(accountEmail);
    const mergedIds = [...new Set([...(previous?.ids || []), ...ids])];
    const data = JSON.stringify({ ids: mergedIds, nextPageToken });
    if (Platform.OS === "web") {
      localStorage.setItem(`uec.emailList.v2.${accountEmail}`, data);
    } else {
      await AsyncStorage.setItem(`uec.emailList.v2.${accountEmail}`, data);
    }
  } catch {}
}

function getOneMonthAgoDateString() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
}

export async function fetchGmailEmails(
  account: GmailAccount,
  maxResults: number = 20,
  pageToken?: string,
  onlyOneMonth: boolean = false
): Promise<{ emails: Email[]; nextPageToken?: string; reachedOneMonthAgo?: boolean }> {
  account = await getValidGmailAccount(account);
  const headers = { Authorization: `Bearer ${account.accessToken}` } as const;
  let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`;
  if (pageToken) url += `&pageToken=${pageToken}`;
  const query = ["-in:sent", "-in:drafts", ...(onlyOneMonth ? [`after:${getOneMonthAgoDateString()}`] : [])].join(" ");
  url += `&q=${encodeURIComponent(query)}`;

  // Always refresh the message ID page so newly arrived email appears; message bodies remain locally cached.
  // If no cached list, fetch from API
  const listRes = await fetch(url, { headers });
  if (!listRes.ok) {
    let detail = "";
    try {
      const payload = await listRes.json();
      detail = payload?.error?.message || payload?.error_description || "";
    } catch {}
    if (listRes.status === 401) {
      throw new Error("Gmail authorization expired or was revoked. Remove this Gmail account and connect it again.");
    }
    if (listRes.status === 403) {
      throw new Error(`Gmail access denied${detail ? `: ${detail}` : ". Check that Gmail API is enabled for your Google Cloud project and reconnect with Gmail read-only permission."}`);
    }
    throw new Error(`Gmail list failed: HTTP ${listRes.status}${detail ? ` — ${detail}` : ""}`);
  }
  const listJson = await listRes.json();
  const ids: string[] = (listJson.messages || []).map((m: any) => m.id);
  const nextPageToken: string | undefined = listJson.nextPageToken;
  if (ids.length === 0) return { emails: [], nextPageToken, reachedOneMonthAgo: true };

  // Cache the list of IDs and nextPageToken
  if (account.email) {
    await setCachedEmailList(account.email, ids, nextPageToken);
  }

  const emailPromises = ids.map(async (id) => {
    let cached = await getCachedEmail(id);
    if (cached) {
      gmailEmailCache[id] = cached;
      return cached;
    }
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
      { headers }
    );
    if (!msgRes.ok) return undefined;
    const msg = await msgRes.json();
    const hdrs: { name: string; value: string }[] = msg.payload?.headers || [];
    const from = getHeader(hdrs, "From") || "";
    const to = getHeader(hdrs, "To") || (account.email || "");
    const subject = getHeader(hdrs, "Subject") || "(no subject)";
    const dateHeader = getHeader(hdrs, "Date");
    const date = dateHeader ? new Date(dateHeader).toISOString() : new Date(msg.internalDate ? Number(msg.internalDate) : Date.now()).toISOString();
    const snippet: string = msg.snippet || "";
    const bodyText = extractTextFromPayload(msg.payload);
    const bodyHtml = extractHtmlFromPayload(msg.payload);
    const body = bodyText || snippet; // keep legacy field populated for older UI
    const email: Email = {
      id,
      to,
      from,
      subject,
      snippet,
      date,
      body,
      bodyText: bodyText ?? undefined,
      bodyHtml: bodyHtml ?? undefined
    };
    await setCachedEmail(id, email);
    gmailEmailCache[id] = email;
    return email;
  });
  const emails = (await Promise.all(emailPromises)).filter(Boolean) as Email[];

  return { emails, nextPageToken };
}

export async function fetchGmailEmailsOneMonth(account: GmailAccount, maxResults: number = 50): Promise<Email[]> {
  let allEmails: Email[] = [];
  let pageToken: string | undefined = undefined;
  let reachedOneMonthAgo = false;
  do {
    const { emails, nextPageToken, reachedOneMonthAgo: reached } = await fetchGmailEmails(account, maxResults, pageToken, true);
    allEmails = allEmails.concat(emails);
    pageToken = nextPageToken;
    reachedOneMonthAgo = reached || !nextPageToken;
  } while (!reachedOneMonthAgo && pageToken);
  if (account.email) {
    gmailPageTokenCache[account.email] = pageToken;
  }
  return allEmails;
}

export async function fetchOlderGmailEmails(account: GmailAccount, firstPageToken?: string, maxPages = 10, onPage?: (emails: Email[], hasMore: boolean, syncing: boolean) => void): Promise<Email[]> {
  const collected: Email[] = [];
  const cachedList = account.email ? await getCachedEmailList(account.email) : undefined;
  let token = firstPageToken || cachedList?.nextPageToken;
  for (let page = 0; token && page < maxPages; page++) {
    account = await getValidGmailAccount(account);
    const result = await fetchGmailEmails(account, 50, token, false);
    collected.push(...result.emails);
    token = result.nextPageToken;
    onPage?.(result.emails, Boolean(token), Boolean(token) && page + 1 < maxPages);
  }
  return collected;
}

export async function fetchAllEmailsFromAccounts(accounts: MailAccount[], onOlderPage?: (account: GmailAccount, emails: Email[], hasMore: boolean, syncing: boolean) => void): Promise<Email[]> {
  const gmailAccounts = accounts.filter((a) => a.type === "gmail");
  const all: Email[] = [];
  for (const acc of gmailAccounts) {
    try {
      const gmailAccount = acc as GmailAccount;
      const firstPage = await fetchGmailEmails(gmailAccount, 50, undefined, false);
      all.push(...firstPage.emails);
      onOlderPage?.(gmailAccount, [], Boolean(firstPage.nextPageToken), Boolean(firstPage.nextPageToken));
      // Fetch older pages without blocking the initial inbox render. Messages and IDs are cached as pages arrive.
      if (firstPage.nextPageToken) {
        void fetchOlderGmailEmails(gmailAccount, firstPage.nextPageToken, 20, (pageEmails, hasMore, syncing) => onOlderPage?.(gmailAccount, pageEmails, hasMore, syncing)).catch((error) => {
          onOlderPage?.(gmailAccount, [], true, false);
          console.warn("Background Gmail sync stopped", gmailAccount.email, error);
        });
      }
    } catch (e) {
      console.warn("Failed to fetch from account", acc.id, e);
    }
  }
  return all;
}

export async function fetchGmailEmailById(account: GmailAccount, id: string): Promise<Email | undefined> {
  const cached = await getCachedEmail(id);
  if (cached) return cached;
  account = await getValidGmailAccount(account);
  const headers = { Authorization: `Bearer ${account.accessToken}` } as const;
  const msgRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`, { headers });
  if (!msgRes.ok) {
    throw new Error(`Gmail message fetch failed: HTTP ${msgRes.status}`);
  }
  const msg = await msgRes.json();
  const hdrs: { name: string; value: string }[] = msg.payload?.headers || [];
  const from = getHeader(hdrs, "From") || "";
  const to = getHeader(hdrs, "To") || (account.email || "");
  const subject = getHeader(hdrs, "Subject") || "(no subject)";
  const dateHeader = getHeader(hdrs, "Date");
  const date = dateHeader ? new Date(dateHeader).toISOString() : new Date(msg.internalDate ? Number(msg.internalDate) : Date.now()).toISOString();
  const snippet: string = msg.snippet || "";
  const bodyText = extractTextFromPayload(msg.payload);
  const bodyHtml = extractHtmlFromPayload(msg.payload);
  const body = bodyText || snippet;
  const email: Email = { id, to, from, subject, snippet, date, body, bodyText: bodyText ?? undefined, bodyHtml: bodyHtml ?? undefined };
  await setCachedEmail(id, email);
  return email;
}

