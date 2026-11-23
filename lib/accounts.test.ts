import test from "node:test";
import assert from "node:assert/strict";
import { GmailAccount, getAccounts, getValidGmailAccount } from "./accounts";

const originalFetch = globalThis.fetch;
const originalClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const originalSecret = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET;

function expiredAccount(overrides: Partial<GmailAccount> = {}): GmailAccount {
  return { id: "gmail-test", type: "gmail", email: "me@example.com", accessToken: "old", refreshToken: "refresh-1", expiresAt: Date.now() - 1000, ...overrides };
}

test("token refresh includes the client secret for web clients and stores a new expiry", async () => {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = "client-123";
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET = "secret-456";
  let body = "";
  (globalThis as any).fetch = async (_url: string, init: any) => {
    body = init.body;
    return { ok: true, status: 200, json: async () => ({ access_token: "new-token", expires_in: 3600 }) };
  };
  const { setItem } = await import("./storage");
  await setItem("uec.accounts", JSON.stringify([expiredAccount()]));
  const valid = await getValidGmailAccount(expiredAccount());
  assert.equal(valid.accessToken, "new-token");
  assert.ok(valid.expiresAt && valid.expiresAt > Date.now());
  const params = new URLSearchParams(body);
  assert.equal(params.get("client_secret"), "secret-456");
  assert.equal(params.get("refresh_token"), "refresh-1");
  const stored = await getAccounts();
  assert.equal((stored[0] as GmailAccount).accessToken, "new-token");
});

test("expired sessions without a refresh token fail with an actionable message", async () => {
  await assert.rejects(
    getValidGmailAccount(expiredAccount({ refreshToken: undefined })),
    /no refresh token was stored/i
  );
});

test("refresh uses a client secret entered at runtime", async () => {
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET;
  const { saveGoogleClientSecret } = await import("./google_auth");
  await saveGoogleClientSecret("runtime-secret");
  let body = "";
  (globalThis as any).fetch = async (_url: string, init: any) => {
    body = init.body;
    return { ok: true, status: 200, json: async () => ({ access_token: "refreshed", expires_in: 1800 }) };
  };
  const { setItem } = await import("./storage");
  await setItem("uec.accounts", JSON.stringify([expiredAccount()]));
  await getValidGmailAccount(expiredAccount());
  assert.equal(new URLSearchParams(body).get("client_secret"), "runtime-secret");
  await saveGoogleClientSecret("");
});

test.after(() => {
  (globalThis as any).fetch = originalFetch;
  if (originalClientId === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalClientId;
  if (originalSecret === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET;
  else process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_SECRET = originalSecret;
});
