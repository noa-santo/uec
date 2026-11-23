import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Small storage facade used by all app settings.
 *
 * Two problems it solves:
 *  - Browser storage has a hard quota (typically ~5 MB). Cached Gmail bodies can
 *    exhaust it, which used to surface as an unhandled "Quota exceeded" error
 *    from AsyncStorage.setItem when the node editor tried to save its rules.
 *  - A failed write must never take down the editor. Values stay available in
 *    memory for the rest of the session and callers get a success flag.
 */

export type SaveResult = { ok: boolean; error?: string };

const memory = new Map<string, string>();
const quotaRecovery: Array<() => Promise<void>> = [];

/** Register work that frees space (e.g. pruning the mail cache) before a retry. */
export function onStorageQuotaExceeded(handler: () => Promise<void>): void {
  quotaRecovery.push(handler);
}

export function isQuotaError(error: unknown): boolean {
  const name = String((error as any)?.name || "");
  const message = String((error as any)?.message || error || "");
  return (
    name === "QuotaExceededError" ||
    name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    /quota|storage is full|exceeded the storage/i.test(message)
  );
}

const secureByDefault = () => Platform.OS !== "web";

export async function getItem(key: string, secure = secureByDefault()): Promise<string | null> {
  try {
    const value = secure ? await SecureStore.getItemAsync(key) : await AsyncStorage.getItem(key);
    return value ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

export async function setItem(key: string, value: string, secure = secureByDefault()): Promise<SaveResult> {
  memory.set(key, value);
  const write = () => (secure ? SecureStore.setItemAsync(key, value) : AsyncStorage.setItem(key, value));

  try {
    await write();
    memory.delete(key);
    return { ok: true };
  } catch (error) {
    let lastError = error;
    if (isQuotaError(error)) {
      for (const recover of quotaRecovery) {
        try { await recover(); } catch { /* a failed cleanup must not mask the original error */ }
      }
      try {
        await write();
        memory.delete(key);
        return { ok: true };
      } catch (retryError) {
        lastError = retryError;
      }
    }
    const message = String((lastError as any)?.message || lastError || "Unknown storage error");
    return { ok: false, error: message };
  }
}

export async function removeItem(key: string, secure = secureByDefault()): Promise<void> {
  memory.delete(key);
  try {
    if (secure) await SecureStore.deleteItemAsync(key);
    else await AsyncStorage.removeItem(key);
  } catch {
    // Nothing else to do — the value is gone from this session's memory.
  }
}

export async function getAllKeys(): Promise<string[]> {
  const keys = new Set(memory.keys());
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) keys.add(key);
      }
    } else {
      for (const key of await AsyncStorage.getAllKeys()) keys.add(key);
    }
  } catch {
    // Fall back to the keys we know about in memory.
  }
  return [...keys];
}
