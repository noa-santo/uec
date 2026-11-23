import test from "node:test";
import assert from "node:assert/strict";
import { AliasRule } from "./alias_rules";
import { Email, collectUnresolvedAddresses, groupByToAddress, saveUnresolvedAddresses, unresolvedAddressesFromEmails } from "./email_utils";

const email = (id: string, to: string, from: string): Email => ({
  id, to, from, subject: `Subject ${id}`, snippet: "", date: `2025-01-${id.padStart(2, "0")}T10:00:00.000Z`, body: "",
});

test("suggestions include old messages sorted only by a catch-all rule", () => {
  const rules: AliasRule[] = [
    { id: "catch", alias: "", matchType: "all", inbox: "Other", enabled: true },
    { id: "billing", alias: "bills@shop.com", matchType: "exact", inbox: "Finance", enabled: true },
  ];
  const older = email("01", "newsletter@example.com", "alice@news.net");
  const recent = email("02", "bills@shop.com", "billing@shop.com");
  assert.deepEqual(unresolvedAddressesFromEmails([older, recent], rules), ["newsletter@example.com"]);
});

test("dynamic inbox names are grouped from catch-all output modes", () => {
  const rules: AliasRule[] = [
    { id: "catch", alias: "", matchType: "all", inbox: "Other", outputMode: "senderDomain", enabled: true },
    { id: "billing", alias: "bills@shop.com", matchType: "exact", inbox: "Finance", enabled: true },
  ];
  const groups = groupByToAddress([
    email("01", "newsletter@example.com", "alice@news.net"),
    email("02", "alerts@example.com", "bob@status.io"),
    email("03", "bills@shop.com", "billing@shop.com"),
  ], rules);
  assert.deepEqual(Object.keys(groups).sort(), ["Finance", "news.net", "status.io"]);
});

test("collectUnresolvedAddresses also reads cached older mail", async () => {
  const rules: AliasRule[] = [{ id: "billing", alias: "bills@shop.com", matchType: "exact", inbox: "Finance", enabled: true }];
  await saveUnresolvedAddresses(["stored@example.com"]);
  // Older cached messages are stored under the Gmail cache prefix.
  const { setItem } = await import("./storage");
  await setItem("uec.email.older-1", JSON.stringify(email("01", "old-alias@example.com", "alice@news.net")), false);
  const suggestions = await collectUnresolvedAddresses(rules);
  assert.ok(suggestions.includes("old-alias@example.com"));
  assert.ok(suggestions.includes("stored@example.com"));
});
