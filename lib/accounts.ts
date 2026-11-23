import {Platform} from "react-native";
import { getItem, setItem } from "./storage";
import { loadGoogleClientSecret } from "./google_auth";

export type Protocol = "imap" | "pop3";

export type ImapPopConfig = {
  protocol: Protocol;
  host: string;
  port: number;
  secure: boolean; // TLS
  username: string;
  password?: string; // optional if using OAuth2
};

export type GmailAccount = {
  id: string;
  type: "gmail";
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
};

export type ManualAccount = {
  id: string;
  type: "manual";
  displayName?: string;
  incoming: ImapPopConfig;
};

export type MailAccount = GmailAccount | ManualAccount;

const KEY = "uec.accounts";

export async function getAccounts(): Promise<MailAccount[]> {
  const raw = await getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MailAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAccounts(list: MailAccount[]): Promise<void> {
  await setItem(KEY, JSON.stringify(list));
}

export async function addAccount(acc: MailAccount): Promise<void> {
  const list = await getAccounts();
  list.push(acc);
  await saveAccounts(list);
}

export async function removeAccount(id: string): Promise<void> {
  const list = await getAccounts();
  const acc = list.find((a) => a.id === id);
  if (acc && acc.type === "gmail" && acc.accessToken) {
    await revokeGoogleToken(acc.accessToken);
  }
  const next = list.filter((a) => a.id !== id);
  await saveAccounts(next);
}

export async function updateAccount(id: string, patch: Partial<MailAccount>): Promise<void> {
  const list = await getAccounts();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) return;
    list[idx] = {...list[idx], ...patch} as MailAccount;
  await saveAccounts(list);
}

export function makeId(prefix: string = "acct"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function googleOAuthConfig(): { clientId?: string; clientSecret?: string; platform: string } {
  const platform = Platform.OS;
  const clientId = platform === "ios"
    ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
    : platform === "android"
      ? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
      : process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  // Web OAuth clients require a client secret on the token endpoint. Desktop
  // app clients (recommended for Tauri/web here) deliberately have none and use
  // PKCE instead.
  const clientSecret = platform === "web" ? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET || undefined : undefined;
  return { clientId, clientSecret, platform };
}

const refreshInFlight = new Map<string, Promise<GmailAccount>>();

async function refreshGmailAccount(account: GmailAccount): Promise<GmailAccount> {
  if (!account.refreshToken) {
    throw new Error("Gmail session expired and no refresh token was stored. Reconnect the account with offline access.");
  }
  const { clientId, clientSecret: envSecret } = googleOAuthConfig();
  const clientSecret = envSecret || await loadGoogleClientSecret();
  if (!clientId) throw new Error("Google OAuth client ID is not configured for this platform.");
  const body: Record<string, string> = {
    client_id: clientId,
    grant_type: "refresh_token",
    refresh_token: account.refreshToken,
  };
  if (clientSecret) body.client_secret = clientSecret;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  let result: any = {};
  try { result = await response.json(); } catch { /* keep the HTTP status below */ }
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new Error("Gmail refresh token was revoked or expired. Reconnect this account.");
    if (result.error === "invalid_client") {
      throw new Error(clientSecret
        ? "Google rejected the OAuth client. Check the client ID and secret in your .env file."
        : "Google requires a client secret for this OAuth client. Use a Desktop app client ID (PKCE, no secret) or set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET.");
    }
    throw new Error(result.error_description || `Google token refresh failed: HTTP ${response.status}`);
  }
  // Google does not return a new refresh token on every refresh. Keep the old one.
  const updated: GmailAccount = {
    ...account,
    accessToken: result.access_token,
    refreshToken: result.refresh_token || account.refreshToken,
    expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000,
  };
  await updateAccount(account.id, updated);
  return updated;
}

export async function getValidGmailAccount(account: GmailAccount): Promise<GmailAccount> {
  if (account.expiresAt && account.expiresAt > Date.now() + 60_000) return account;
  const pending = refreshInFlight.get(account.id);
  if (pending) return pending;
  const refresh = refreshGmailAccount(account).finally(() => refreshInFlight.delete(account.id));
  refreshInFlight.set(account.id, refresh);
  return refresh;
}

export async function verifyGmailAccessToken(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as { email?: string };
    return { ok: true, email: data.email };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${token}`, {
      method: "POST",
      headers: { "Content-type": "application/x-www-form-urlencoded" },
    });
  } catch (e) {
    // Ignore errors
  }
}

export function platformInfo(): string {
  return `${Platform.OS} ${Platform.Version}`;
}
