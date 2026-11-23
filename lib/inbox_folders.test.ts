import test from "node:test";
import assert from "node:assert/strict";
import { AliasRule } from "./alias_rules";
import { Email, groupByToAddress } from "./email_utils";
import { folderInboxNames, folderMessages, isCatchAllGroup } from "./inbox_folders";

const email = (id: string, to: string, from: string): Email => ({
  id, to, from, subject: `Subject ${id}`, snippet: "", date: `2025-01-${id.padStart(2, "0")}T10:00:00.000Z`, body: "",
});

const rules: AliasRule[] = [
  { id: "catch", alias: "", matchType: "all", inbox: "Other", outputMode: "sender", enabled: true },
  { id: "billing", alias: "bills@shop.com", matchType: "exact", inbox: "Finance", enabled: true },
];

const groups = groupByToAddress([
  email("01", "bills@shop.com", "billing@shop.com"),
  email("02", "newsletter@example.com", "alice@news.net"),
  email("03", "alerts@example.com", "bob@status.io"),
], rules);

test("catch-all groups are recognised even when their inbox name is dynamic", () => {
  assert.equal(isCatchAllGroup(groups["Finance"], rules), false);
  assert.equal(isCatchAllGroup(groups["alice@news.net"], rules), true);
});

test("a catch-all folder collects all dynamic inboxes instead of its static name", () => {
  const folder = { id: "f1", name: "Other", inboxes: ["Other"], includeCatchAll: true };
  assert.deepEqual(folderInboxNames(folder, groups, rules), ["alice@news.net", "bob@status.io"]);
  assert.equal(folderMessages(folder, groups, rules).length, 2);
});

test("explicit folder membership still works without catch-all", () => {
  const folder = { id: "f2", name: "Finance", inboxes: ["Finance"] };
  assert.deepEqual(folderInboxNames(folder, groups, rules), ["Finance"]);
});

test("an existing folder pointing at the catch-all inbox collects unsorted mail automatically", () => {
  const legacy = { id: "f3", name: "Other", inboxes: ["Other"] };
  assert.deepEqual(folderInboxNames(legacy, groups, rules), ["alice@news.net", "bob@status.io"]);
});
