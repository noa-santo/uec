import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type InboxFolder = { id: string; name: string; inboxes: string[]; collapsed?: boolean };
const KEY = "uec.inboxFolders.v1";
export async function loadInboxFolders(): Promise<InboxFolder[]> {
  try {
    const raw = Platform.OS === "web" ? await AsyncStorage.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((f) => f && typeof f.id === "string" && typeof f.name === "string" && Array.isArray(f.inboxes)) : [];
  } catch { return []; }
}
export async function saveInboxFolders(folders: InboxFolder[]): Promise<void> {
  const value = JSON.stringify(folders.map((f) => ({ ...f, name: f.name.trim(), inboxes: [...new Set(f.inboxes)] })).filter((f) => f.name));
  if (Platform.OS === "web") await AsyncStorage.setItem(KEY, value);
  else await SecureStore.setItemAsync(KEY, value);
}
