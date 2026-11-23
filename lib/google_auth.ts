import { getItem, removeItem, setItem } from "./storage";

/**
 * Google Web application clients require client_secret on the token endpoint.
 * Let the user enter it at runtime instead of embedding it in a public build.
 * Desktop app client IDs (PKCE) do not need this.
 */
const KEY = "uec.googleClientSecret.v1";

export async function loadGoogleClientSecret(): Promise<string> {
  try {
    return (await getItem(KEY)) || "";
  } catch {
    return "";
  }
}

export async function saveGoogleClientSecret(secret: string): Promise<void> {
  const value = secret.trim();
  if (!value) {
    await removeItem(KEY);
    return;
  }
  await setItem(KEY, value);
}
