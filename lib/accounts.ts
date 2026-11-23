import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {Platform} from "react-native";

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
  const raw =
    Platform.OS === "web"
      ? await AsyncStorage.getItem(KEY)
      : await SecureStore.getItemAsync(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MailAccount[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAccounts(list: MailAccount[]): Promise<void> {
  const data = JSON.stringify(list);
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(KEY, data);
  } else {
    await SecureStore.setItemAsync(KEY, data);
  }
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

export async function getValidGmailAccount(account: GmailAccount): Promise<GmailAccount> {
  if (account.expiresAt && account.expiresAt > Date.now() + 60_000) return account;
  if (!account.refreshToken) {
    if (account.expiresAt && account.expiresAt <= Date.now()) throw new Error("Gmail session expired. Reconnect this account to renew access.");
    return account;
  }
  const clientId = Platform.OS === "ios"
    ? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
    : Platform.OS === "android"
      ? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID
      : process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  if (!clientId) throw new Error("Google OAuth client ID is not configured for this platform.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, grant_type: "refresh_token", refresh_token: account.refreshToken }).toString(),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new Error("Gmail refresh token was revoked or expired. Reconnect this account.");
    throw new Error(result.error_description || `Google token refresh failed: HTTP ${response.status}`);
  }
  const updated: GmailAccount = { ...account, accessToken: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 };
  await updateAccount(account.id, updated);
  return updated;
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
