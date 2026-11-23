import test from "node:test";
import assert from "node:assert/strict";
import { resolveInbox, validateRule, testRuleMatch, AliasRule } from "./alias_rules";

test("exact match routing", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "billing@shop.com", matchType: "exact", inbox: "Finance", enabled: true },
  ];
  assert.equal(resolveInbox("billing@shop.com", rules), "Finance");
  assert.equal(resolveInbox("BILLING@SHOP.COM", rules), "Finance");
  assert.equal(resolveInbox("support@shop.com", rules), "support@shop.com");
});

test("domain pattern routing", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "@github.com", matchType: "domain", inbox: "Code Notifications", enabled: true },
  ];
  assert.equal(resolveInbox("notifications@github.com", rules), "Code Notifications");
  assert.equal(resolveInbox("support@sub.github.com", rules), "Code Notifications");
  assert.equal(resolveInbox("user@notgithub.com", rules), "user@notgithub.com");
});

test("prefix pattern routing (+tags)", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "news", matchType: "prefix", inbox: "Newsletters", enabled: true },
  ];
  assert.equal(resolveInbox("news+weekly@domain.com", rules), "Newsletters");
  assert.equal(resolveInbox("newsletter@domain.com", rules), "Newsletters");
  assert.equal(resolveInbox("personal@domain.com", rules), "personal@domain.com");
});

test("contains pattern routing", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "receipt", matchType: "contains", inbox: "Receipts", enabled: true },
  ];
  assert.equal(resolveInbox("order-receipt-99@store.com", rules), "Receipts");
  assert.equal(resolveInbox("receipts@acme.org", rules), "Receipts");
});

test("regex pattern routing", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "^app-[0-9]+@test\\.io$", matchType: "regex", inbox: "CI Bots", enabled: true },
  ];
  assert.equal(resolveInbox("app-42@test.io", rules), "CI Bots");
  assert.equal(resolveInbox("app-xyz@test.io", rules), "app-xyz@test.io");
});

test("combined sender and subject conditions route with AND/OR", () => {
  const rule: AliasRule = {
    id: "combo", alias: "orders@example.com", matchType: "exact", inbox: "Orders", enabled: true,
    logic: "and", conditions: [
      { alias: "orders@example.com", matchType: "exact", field: "recipient" },
      { alias: "invoice", matchType: "contains", field: "subject" },
    ],
  };
  assert.equal(resolveInbox("orders@example.com", [rule], { to: "orders@example.com", subject: "Your invoice", from: "store@example.net" }), "Orders");
  assert.equal(resolveInbox("orders@example.com", [rule], { to: "orders@example.com", subject: "Your order", from: "store@example.net" }), "orders@example.com");
});

test("catch-all routes only unmatched addresses after specific rules", () => {
  const rules: AliasRule[] = [
    { id: "catch", alias: "", matchType: "all", inbox: "Other", enabled: true },
    { id: "exact", alias: "billing@shop.com", matchType: "exact", inbox: "Finance", enabled: true },
  ];
  assert.equal(resolveInbox("billing@shop.com", rules), "Finance");
  assert.equal(resolveInbox("news@example.com", rules), "Other");
});

test("disabled rules are skipped", () => {
  const rules: AliasRule[] = [
    { id: "1", alias: "work@corp.com", matchType: "exact", inbox: "Work", enabled: false },
  ];
  assert.equal(resolveInbox("work@corp.com", rules), "work@corp.com");
});

test("validation accepts valid patterns and rejects invalid ones", () => {
  assert.equal(validateRule({ alias: "user@corp.com", inbox: "Work", matchType: "exact" }), undefined);
  assert.equal(validateRule({ alias: "invalid", inbox: "Work", matchType: "exact" }), "Enter a valid email address for exact match.");
  assert.equal(validateRule({ alias: "[invalid", inbox: "Work", matchType: "regex" }), "Invalid regular expression pattern.");
});
